import Accelerate
import TensorFlowLite
import UIKit
import Vision

// MARK: - Stored face entry

struct EnrolledFace: Codable {
  let name: String
  var embeddings: [[Float]]
  let enrolledAt: TimeInterval

  // Handles migration from old format that stored a single `embedding` field
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    name = try c.decode(String.self, forKey: .name)
    enrolledAt = try c.decode(TimeInterval.self, forKey: .enrolledAt)
    if let multi = try? c.decode([[Float]].self, forKey: .embeddings) {
      embeddings = multi
    } else if let single = try? c.decode([Float].self, forKey: .embedding) {
      embeddings = [single]
    } else {
      embeddings = []
    }
  }

  init(name: String, embeddings: [[Float]], enrolledAt: TimeInterval) {
    self.name = name; self.embeddings = embeddings; self.enrolledAt = enrolledAt
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(embeddings, forKey: .embeddings)
    try c.encode(enrolledAt, forKey: .enrolledAt)
  }

  enum CodingKeys: String, CodingKey { case name, embeddings, embedding, enrolledAt }
}

// MARK: - Recognition result

struct RecognitionResult {
  let name: String
  let distance: Float
  /// 0.0–1.0
  let confidence: Float
  let found: Bool
}

// MARK: - Service

/// Uses TensorFlow Lite (mobilefacenet.tflite) for face embedding extraction.
///
/// Model placement:
///   Put `mobilefacenet.tflite` inside
///   `modules/expo-face-recognition/ios/Models/mobilefacenet.tflite`
///   (the podspec already includes `ios/Models/*.tflite` as a resource).
///
/// Expected model signature:
///   Input  [1, 112, 112, 3]  float32  normalized to [-1, 1]
///   Output [1, N]            float32  face embedding (N = 192 or 512)
class MobileFaceNetService {

  static let shared = MobileFaceNetService()

  // MARK: - Config

  private let kModelName      = "mobilefacenet"
  private let kInputSize      = CGSize(width: 112, height: 112)
  /// Cosine distance threshold: 0 = identical, 2 = opposite.
  private let kMatchThreshold: Float = 0.6

  // MARK: - State

  private var interpreter: Interpreter?
  private var enrolledFaces: [EnrolledFace] = []
  private let queue = DispatchQueue(label: "expo.facerecognition.tflite", qos: .userInitiated)

  // MARK: - Init

  private init() {
    loadModel()
    loadDatabase()
  }

  // MARK: - Model loading

  private func loadModel() {
    // Search main bundle first, then the module's own bundle
    let path = Bundle.main.path(forResource: kModelName, ofType: "tflite")
      ?? Bundle(for: MobileFaceNetService.self).path(forResource: kModelName, ofType: "tflite")

    guard let modelPath = path else {
      NSLog("[MobileFaceNet] ⚠️  '\(kModelName).tflite' not found in bundle.")
      return
    }

    do {
      var options = Interpreter.Options()
      options.threadCount = 2
      interpreter = try Interpreter(modelPath: modelPath, options: options)
      try interpreter?.allocateTensors()
      NSLog("[MobileFaceNet] ✅ Model loaded from: \(modelPath)")
    } catch {
      NSLog("[MobileFaceNet] ❌ Failed to load interpreter: \(error)")
    }
  }

  var isModelLoaded: Bool { interpreter != nil }

  // MARK: - Public API

  /// Creates (or replaces) the enrolled entry for `name` from a single image.
  func enroll(image: UIImage, name: String) async throws -> Bool {
    guard let embedding = try await extractEmbedding(from: image) else { return false }
    queue.sync {
      enrolledFaces.removeAll { $0.name.lowercased() == name.lowercased() }
      enrolledFaces.append(
        EnrolledFace(name: name, embeddings: [embedding], enrolledAt: Date().timeIntervalSince1970)
      )
      saveDatabase()
    }
    NSLog("[MobileFaceNet] Enrolled '\(name)'. Total: \(enrolledFaces.count)")
    return true
  }

  /// Creates (or replaces) the enrolled entry for `name` from multiple camera frames.
  /// Embeddings are averaged for a more stable representation.
  func enrollFromFrames(images: [UIImage], name: String) async throws -> Bool {
    guard let embedding = try await averagedEmbedding(from: images) else { return false }
    queue.sync {
      enrolledFaces.removeAll { $0.name.lowercased() == name.lowercased() }
      enrolledFaces.append(
        EnrolledFace(name: name, embeddings: [embedding], enrolledAt: Date().timeIntervalSince1970)
      )
      saveDatabase()
    }
    NSLog("[MobileFaceNet] Enrolled '\(name)' from \(images.count) frame(s). Total: \(enrolledFaces.count)")
    return true
  }

  /// Appends an embedding for `name` from a single image.
  /// Creates a new entry if `name` does not exist yet.
  func addEmbedding(image: UIImage, name: String) async throws -> Bool {
    guard let embedding = try await extractEmbedding(from: image) else { return false }
    queue.sync {
      if let idx = enrolledFaces.firstIndex(where: { $0.name.lowercased() == name.lowercased() }) {
        enrolledFaces[idx].embeddings.append(embedding)
        NSLog("[MobileFaceNet] Added embedding for '\(name)'. Count: \(enrolledFaces[idx].embeddings.count)")
      } else {
        enrolledFaces.append(
          EnrolledFace(name: name, embeddings: [embedding], enrolledAt: Date().timeIntervalSince1970)
        )
        NSLog("[MobileFaceNet] New entry '\(name)'.")
      }
      saveDatabase()
    }
    return true
  }

  /// Appends an averaged embedding for `name` from multiple camera frames.
  func addEmbeddingFromFrames(images: [UIImage], name: String) async throws -> Bool {
    guard let embedding = try await averagedEmbedding(from: images) else { return false }
    queue.sync {
      if let idx = enrolledFaces.firstIndex(where: { $0.name.lowercased() == name.lowercased() }) {
        enrolledFaces[idx].embeddings.append(embedding)
        NSLog("[MobileFaceNet] Added averaged embedding for '\(name)' from \(images.count) frame(s). Count: \(enrolledFaces[idx].embeddings.count)")
      } else {
        enrolledFaces.append(
          EnrolledFace(name: name, embeddings: [embedding], enrolledAt: Date().timeIntervalSince1970)
        )
        NSLog("[MobileFaceNet] New entry '\(name)' from \(images.count) frame(s).")
      }
      saveDatabase()
    }
    return true
  }

  func recognize(image: UIImage) async throws -> RecognitionResult {
    guard isModelLoaded else { throw MFNError.modelNotLoaded }
    guard let query = try await extractEmbedding(from: image) else { throw MFNError.noFaceDetected }
    return queue.sync { bestMatch(for: query) }
  }

  func listEnrolled() -> [[String: Any]] {
    queue.sync {
      enrolledFaces.map {
        ["name": $0.name, "enrolledAt": $0.enrolledAt, "embeddingCount": $0.embeddings.count]
      }
    }
  }

  func removeEnrolled(name: String) {
    queue.sync {
      enrolledFaces.removeAll { $0.name.lowercased() == name.lowercased() }
      saveDatabase()
    }
  }

  func clearAll() {
    queue.sync {
      enrolledFaces.removeAll()
      saveDatabase()
    }
  }

  // MARK: - Embedding pipeline

  /// Extracts embeddings from all images, averages them element-wise, and L2-normalizes.
  /// Falls back to a single embedding if only one image yields a result.
  private func averagedEmbedding(from images: [UIImage]) async throws -> [Float]? {
    var embeddings: [[Float]] = []
    for img in images {
      if let emb = try? await extractEmbedding(from: img) {
        embeddings.append(emb)
      }
    }
    guard !embeddings.isEmpty else { return nil }
    guard embeddings.count > 1 else { return embeddings[0] }

    let dim = embeddings[0].count
    var avg = [Float](repeating: 0, count: dim)
    for emb in embeddings {
      vDSP_vadd(avg, 1, emb, 1, &avg, 1, vDSP_Length(dim))
    }
    var n = Float(embeddings.count)
    vDSP_vsdiv(avg, 1, &n, &avg, 1, vDSP_Length(dim))
    Self.l2Normalize(&avg)
    return avg
  }

  private func extractEmbedding(from image: UIImage) async throws -> [Float]? {
    guard let cgImage = image.cgImage else { throw MFNError.invalidImage }

    // 1. Vision: detect, align by eye landmarks, and crop face
    guard let faceImage = try await detectAlignAndCrop(cgImage: cgImage) else { return nil }

    // 2. Preprocess: resize → RGB float [-1,1] → Data
    guard let inputData = preprocess(image: faceImage, size: kInputSize) else {
      throw MFNError.preprocessingFailed
    }

    // 3. TFLite inference (blocking, already on background queue via async)
    return try runInference(inputData: inputData)
  }

  // MARK: - TFLite inference

  private func runInference(inputData: Data) throws -> [Float] {
    guard let interp = interpreter else { throw MFNError.modelNotLoaded }

    try interp.copy(inputData, toInputAt: 0)
    try interp.invoke()

    let outputTensor = try interp.output(at: 0)
    guard var embedding = [Float](unsafeData: outputTensor.data) else {
      throw MFNError.preprocessingFailed
    }
    Self.l2Normalize(&embedding)
    return embedding
  }

  // MARK: - Image preprocessing

  /// Resize to `size`, draw into RGBA bitmap (required by CGContext),
  /// then extract only RGB and normalize each channel to [-1, 1].
  private func preprocess(image: UIImage, size: CGSize) -> Data? {
    let w = Int(size.width)
    let h = Int(size.height)

    // CGContext requires 4-channel RGBA — plain RGB is unsupported
    var rgba = [UInt8](repeating: 0, count: w * h * 4)
    guard let context = CGContext(
      data: &rgba,
      width: w, height: h,
      bitsPerComponent: 8,
      bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ), let cgImage = image.cgImage else { return nil }

    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))

    // Stride over RGBA, keep only R G B, normalize to [-1, 1]
    var floats = [Float]()
    floats.reserveCapacity(w * h * 3)
    for i in stride(from: 0, to: rgba.count, by: 4) {
      floats.append((Float(rgba[i])     / 127.5) - 1.0)  // R
      floats.append((Float(rgba[i + 1]) / 127.5) - 1.0)  // G
      floats.append((Float(rgba[i + 2]) / 127.5) - 1.0)  // B
      // rgba[i + 3] is alpha — skip
    }
    return floats.withUnsafeBytes { Data($0) }
  }

  // MARK: - Face detection, alignment, and crop (Vision)

  private func detectAlignAndCrop(cgImage: CGImage) async throws -> UIImage? {
    try await withCheckedThrowingContinuation { continuation in
      let request = VNDetectFaceLandmarksRequest { req, error in
        if let error { continuation.resume(throwing: error); return }
        guard let obs = req.results?.first as? VNFaceObservation else {
          continuation.resume(returning: nil); return
        }

        let size = CGSize(width: cgImage.width, height: cgImage.height)

        // Prefer full 5-point similarity warp → exact ArcFace 112×112 geometry
        if let srcPts = Self.fiveLandmarks(from: obs, imageSize: size) {
          continuation.resume(returning: Self.similarityAlignedCrop(cgImage: cgImage, src: srcPts))
          return
        }

        // Fallback: rotate by eye angle + crop
        let bb = obs.boundingBox
        var rect = CGRect(x: bb.minX * size.width,  y: (1 - bb.maxY) * size.height,
                          width: bb.width * size.width, height: bb.height * size.height)
        rect = rect.insetBy(dx: -rect.width * 0.2, dy: -rect.height * 0.2)
                   .intersection(CGRect(origin: .zero, size: size))
        let angle = Self.eyeAngle(from: obs, imageSize: size)
        continuation.resume(returning: Self.rotateAndCrop(cgImage: cgImage, angle: angle, cropRect: rect))
      }

      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      do { try handler.perform([request]) }
      catch { continuation.resume(throwing: error) }
    }
  }

  // MARK: - 5-Point Similarity Alignment

  // ArcFace / InsightFace reference landmark positions for a 112×112 aligned face.
  private static let kAlignSize = CGSize(width: 112, height: 112)
  private static let kRefLandmarks: [(CGFloat, CGFloat)] = [
    (38.2946, 51.6963),  // left eye
    (73.5318, 51.5014),  // right eye
    (56.0252, 71.7366),  // nose tip
    (41.5493, 92.3655),  // left mouth corner
    (70.7299, 92.2041),  // right mouth corner
  ]

  /// Returns 5 landmark positions in UIKit pixel coordinates, or nil if any are missing.
  private static func fiveLandmarks(from obs: VNFaceObservation, imageSize: CGSize) -> [(CGFloat, CGFloat)]? {
    guard let lm = obs.landmarks else { return nil }

    guard let leftPt  = landmarkCenterTuple(lm.leftPupil  ?? lm.leftEye,  obs: obs, size: imageSize),
          let rightPt = landmarkCenterTuple(lm.rightPupil ?? lm.rightEye, obs: obs, size: imageSize)
    else { return nil }

    // Nose tip: last point of noseCrest (bridge → tip)
    let nosePt: (CGFloat, CGFloat)?
    if let crest = lm.noseCrest, let last = crest.normalizedPoints.last {
      let p = landmarkCenter([last], bb: obs.boundingBox, size: imageSize)
      nosePt = (p.x, p.y)
    } else if let nose = lm.nose, !nose.normalizedPoints.isEmpty {
      let p = landmarkCenter(nose.normalizedPoints, bb: obs.boundingBox, size: imageSize)
      nosePt = (p.x, p.y)
    } else { nosePt = nil }
    guard let nose = nosePt else { return nil }

    // Mouth corners: leftmost and rightmost points of outerLips
    guard let lips = lm.outerLips, !lips.normalizedPoints.isEmpty else { return nil }
    let lipPts = lips.normalizedPoints.map { landmarkCenter([$0], bb: obs.boundingBox, size: imageSize) }
    guard let lMouth = lipPts.min(by: { $0.x < $1.x }),
          let rMouth = lipPts.max(by: { $0.x < $1.x }) else { return nil }

    return [leftPt, rightPt, nose,
            (lMouth.x, lMouth.y), (rMouth.x, rMouth.y)]
  }

  private static func landmarkCenterTuple(
    _ region: VNFaceLandmarkRegion2D?, obs: VNFaceObservation, size: CGSize
  ) -> (CGFloat, CGFloat)? {
    guard let r = region, !r.normalizedPoints.isEmpty else { return nil }
    let p = landmarkCenter(r.normalizedPoints, bb: obs.boundingBox, size: size)
    return (p.x, p.y)
  }

  /// Warps `cgImage` so the 5 detected `src` landmarks align to `kRefLandmarks`
  /// using a least-squares similarity transform, producing a 112×112 output.
  private static func similarityAlignedCrop(cgImage: CGImage, src: [(CGFloat, CGFloat)]) -> UIImage? {
    let dst = kRefLandmarks
    let N   = CGFloat(src.count)

    var Cx: CGFloat = 0, Cy: CGFloat = 0
    var CxP: CGFloat = 0, CyP: CGFloat = 0
    var W: CGFloat = 0, sumA: CGFloat = 0, sumB: CGFloat = 0

    for i in 0..<src.count {
      let (xi, yi)   = src[i]
      let (xip, yip) = dst[i]
      Cx += xi;  Cy += yi
      CxP += xip; CyP += yip
      W    += xi*xi + yi*yi
      sumA += xi*xip + yi*yip
      sumB += xi*yip - yi*xip
    }

    let D = N * W - Cx*Cx - Cy*Cy
    guard abs(D) > 1e-6 else { return nil }

    let a  = (N * sumA - Cx * CxP - Cy * CyP) / D
    let b  = (N * sumB - Cx * CyP + Cy * CxP) / D
    let tx = (CxP - a * Cx + b * Cy) / N
    let ty = (CyP - b * Cx - a * Cy) / N

    // CGAffineTransform: x' = cg.a·x + cg.c·y + cg.tx
    //                    y' = cg.b·x + cg.d·y + cg.ty
    // Similarity:        x' =  a·x   - b·y   + tx
    //                    y' =  b·x   + a·y   + ty
    let transform = CGAffineTransform(a: a, b: b, c: -b, d: a, tx: tx, ty: ty)

    UIGraphicsBeginImageContextWithOptions(kAlignSize, false, 1.0)
    defer { UIGraphicsEndImageContext() }
    guard let ctx = UIGraphicsGetCurrentContext() else { return nil }

    ctx.concatenate(transform)
    UIImage(cgImage: cgImage).draw(
      in: CGRect(origin: .zero, size: CGSize(width: cgImage.width, height: cgImage.height))
    )
    return UIGraphicsGetImageFromCurrentImageContext()
  }

  // MARK: - Eye-angle fallback helpers

  private static func eyeAngle(from obs: VNFaceObservation, imageSize: CGSize) -> CGFloat {
    guard let lm = obs.landmarks,
          let leftEye  = lm.leftEye,  !leftEye.normalizedPoints.isEmpty,
          let rightEye = lm.rightEye, !rightEye.normalizedPoints.isEmpty
    else { return 0 }
    let lc = landmarkCenter(leftEye.normalizedPoints,  bb: obs.boundingBox, size: imageSize)
    let rc = landmarkCenter(rightEye.normalizedPoints, bb: obs.boundingBox, size: imageSize)
    return atan2(rc.y - lc.y, rc.x - lc.x)
  }

  // Rotates the full image around the face centre, then crops.
  private static func rotateAndCrop(cgImage: CGImage, angle: CGFloat, cropRect: CGRect) -> UIImage? {
    guard abs(angle) > 0.017 else {
      guard let cropped = cgImage.cropping(to: cropRect) else { return nil }
      return UIImage(cgImage: cropped)
    }
    let size  = CGSize(width: cgImage.width, height: cgImage.height)
    let pivot = CGPoint(x: cropRect.midX, y: cropRect.midY)
    UIGraphicsBeginImageContextWithOptions(size, false, 1.0)
    defer { UIGraphicsEndImageContext() }
    guard let ctx = UIGraphicsGetCurrentContext() else { return nil }
    ctx.translateBy(x: pivot.x, y: pivot.y)
    ctx.rotate(by: -angle)
    ctx.translateBy(x: -pivot.x, y: -pivot.y)
    UIImage(cgImage: cgImage).draw(in: CGRect(origin: .zero, size: size))
    guard let rotatedCG = UIGraphicsGetImageFromCurrentImageContext()?.cgImage else { return nil }
    guard let cropped   = rotatedCG.cropping(to: cropRect) else { return nil }
    return UIImage(cgImage: cropped)
  }

  // Converts Vision landmark points (normalised in bounding-box space, origin bottom-left)
  // to UIKit image pixel coordinates (origin top-left, Y down).
  private static func landmarkCenter(_ pts: [CGPoint], bb: CGRect, size: CGSize) -> CGPoint {
    let n  = CGFloat(pts.count)
    let sx = pts.reduce(0.0) { $0 + $1.x }
    let sy = pts.reduce(0.0) { $0 + $1.y }
    return CGPoint(
      x: (bb.minX + (sx / n) * bb.width)  * size.width,
      y: (1.0 - (bb.minY + (sy / n) * bb.height)) * size.height
    )
  }

  // MARK: - Matching

  /// Finds the enrolled person whose closest embedding is nearest to `query`.
  private func bestMatch(for query: [Float]) -> RecognitionResult {
    var bestName     = "Unknown"
    var bestDistance = Float.infinity

    for face in enrolledFaces {
      for emb in face.embeddings {
        let d = cosineDistance(query, emb)
        if d < bestDistance { bestDistance = d; bestName = face.name }
      }
    }

    let found      = bestDistance < kMatchThreshold
    let confidence = found ? max(0, 1.0 - bestDistance / kMatchThreshold) : 0
    return RecognitionResult(
      name:       found ? bestName : "Unknown",
      distance:   bestDistance,
      confidence: confidence,
      found:      found
    )
  }

  // MARK: - Math (Accelerate)

  /// Cosine distance using L2-normalised vectors: dist = 1 − dot(a, b)
  private func cosineDistance(_ a: [Float], _ b: [Float]) -> Float {
    var dot: Float = 0
    vDSP_dotpr(a, 1, b, 1, &dot, vDSP_Length(a.count))
    return 1.0 - dot
  }

  static func l2Normalize(_ v: inout [Float]) {
    var norm: Float = 0
    vDSP_svesq(v, 1, &norm, vDSP_Length(v.count))
    norm = sqrtf(norm)
    guard norm > 1e-8 else { return }
    vDSP_vsdiv(v, 1, &norm, &v, 1, vDSP_Length(v.count))
  }

  // MARK: - Persistence

  private var databaseURL: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("face_database.json")
  }

  private func loadDatabase() {
    guard
      let data  = try? Data(contentsOf: databaseURL),
      let faces = try? JSONDecoder().decode([EnrolledFace].self, from: data)
    else { return }
    enrolledFaces = faces
    NSLog("[MobileFaceNet] Loaded \(enrolledFaces.count) enrolled face(s).")
  }

  private func saveDatabase() {
    guard let data = try? JSONEncoder().encode(enrolledFaces) else { return }
    try? data.write(to: databaseURL, options: .atomic)
  }
}

// MARK: - Errors

enum MFNError: Error, LocalizedError {
  case modelNotLoaded, noFaceDetected, invalidImage, preprocessingFailed

  var errorDescription: String? {
    switch self {
    case .modelNotLoaded:      return "TFLite model not loaded. Place mobilefacenet.tflite in ios/Models/."
    case .noFaceDetected:      return "No face detected in the image."
    case .invalidImage:        return "Cannot decode the image."
    case .preprocessingFailed: return "Image preprocessing or tensor copy failed."
    }
  }
}

// MARK: - Data → [Float]

private extension Array where Element == Float {
  init?(unsafeData: Data) {
    guard unsafeData.count % MemoryLayout<Float>.stride == 0 else { return nil }
    self = unsafeData.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }
}
