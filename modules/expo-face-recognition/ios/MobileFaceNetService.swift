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

  /// Creates (or replaces) the enrolled entry for `name` with a single embedding from `image`.
  func enroll(image: UIImage, name: String) async throws -> Bool {
    guard let embedding = try await extractEmbedding(from: image) else { return false }
    queue.sync {
      enrolledFaces.removeAll { $0.name.lowercased() == name.lowercased() }
      enrolledFaces.append(
        EnrolledFace(name: name, embeddings: [embedding], enrolledAt: Date().timeIntervalSince1970)
      )
      saveDatabase()
    }
    NSLog("[MobileFaceNet] Enrolled '\(name)' (1 embedding). Total people: \(enrolledFaces.count)")
    return true
  }

  /// Appends an additional embedding for an already-enrolled `name`.
  /// If the person does not exist yet, creates a new entry.
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
        NSLog("[MobileFaceNet] New entry for '\(name)' via addEmbedding.")
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

  private func extractEmbedding(from image: UIImage) async throws -> [Float]? {
    guard let cgImage = image.cgImage else { throw MFNError.invalidImage }

    // 1. Vision: detect & crop face
    guard let faceImage = try await detectAndCrop(cgImage: cgImage) else { return nil }

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

  // MARK: - Face detection & crop (Vision)

  private func detectAndCrop(cgImage: CGImage) async throws -> UIImage? {
    try await withCheckedThrowingContinuation { continuation in
      let request = VNDetectFaceRectanglesRequest { req, error in
        if let error { continuation.resume(throwing: error); return }

        guard let obs = req.results?.first as? VNFaceObservation else {
          continuation.resume(returning: nil); return
        }

        let w = CGFloat(cgImage.width)
        let h = CGFloat(cgImage.height)
        let bb = obs.boundingBox

        // Vision bbox origin is bottom-left → flip Y
        var rect = CGRect(
          x:      bb.minX * w,
          y:      (1 - bb.maxY) * h,
          width:  bb.width  * w,
          height: bb.height * h
        )
        // 20 % padding so hairline/chin are included
        rect = rect.insetBy(dx: -rect.width * 0.2, dy: -rect.height * 0.2)
          .intersection(CGRect(x: 0, y: 0, width: w, height: h))

        guard let cropped = cgImage.cropping(to: rect) else {
          continuation.resume(returning: nil); return
        }
        continuation.resume(returning: UIImage(cgImage: cropped))
      }

      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      do { try handler.perform([request]) }
      catch { continuation.resume(throwing: error) }
    }
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
