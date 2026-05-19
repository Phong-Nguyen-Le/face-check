import ExpoModulesCore
import Vision
import UIKit

public class ExpoFaceRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoFaceRecognition")

    Function("hello") {
      NSLog("ExpoFaceRecognition hello() called")
      return "Hello from ExpoFaceRecognition"
    }

    AsyncFunction("detectFacesAsync") { (imageUri: String) async throws -> [String: Any] in
      NSLog("ExpoFaceRecognition detectFacesAsync called with: \(imageUri)")
      let filePath: String

      if imageUri.hasPrefix("file://") {
        guard let url = URL(string: imageUri) else {
          throw NSError(
            domain: "ExpoFaceRecognition",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Invalid file URI"]
          )
        }
        filePath = url.path
      } else {
        filePath = imageUri
      }

      guard let image = UIImage(contentsOfFile: filePath) else {
        throw NSError(
          domain: "ExpoFaceRecognition",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Could not load image at path: \(filePath)"]
        )
      }

      guard let cgImage = image.cgImage else {
        throw NSError(
          domain: "ExpoFaceRecognition",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Could not convert image to CGImage"]
        )
      }

      let request = VNDetectFaceRectanglesRequest()

      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

      do {
        try handler.perform([request])
      } catch {
        throw NSError(
          domain: "ExpoFaceRecognition",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Face detection failed: \(error.localizedDescription)"]
        )
      }

      let observations = request.results ?? []

      let imageWidth = Double(image.size.width)
      let imageHeight = Double(image.size.height)

      let faces = observations.map { observation -> [String: Double] in
        let box = observation.boundingBox

        let x = box.origin.x * imageWidth
        let y = (1.0 - box.origin.y - box.height) * imageHeight
        let width = box.width * imageWidth
        let height = box.height * imageHeight

        return [
          "x": x,
          "y": y,
          "width": width,
          "height": height
        ]
      }

      NSLog("ExpoFaceRecognition detected \(faces.count) face(s)")

      return [
        "faces": faces
      ]
    }

    // MARK: - Face Recognition (MobileFaceNet)

    AsyncFunction("enrollFaceAsync") { (imageUri: String, name: String) async throws -> [String: Any] in
      let image = try Self.loadImage(from: imageUri)
      let ok = try await MobileFaceNetService.shared.enroll(image: image, name: name)
      return ["success": ok, "name": name]
    }

    AsyncFunction("addFaceEmbeddingAsync") { (imageUri: String, name: String) async throws -> [String: Any] in
      let image = try Self.loadImage(from: imageUri)
      let ok = try await MobileFaceNetService.shared.addEmbedding(image: image, name: name)
      return ["success": ok, "name": name]
    }

    AsyncFunction("captureFrameAsync") { () async throws -> String in
      guard let image = FrameStore.shared.take() else {
        throw NSError(
          domain: "ExpoFaceRecognition", code: 20,
          userInfo: [NSLocalizedDescriptionKey: "No camera frame available. Open the camera view first."]
        )
      }
      guard let data = image.jpegData(compressionQuality: 0.85) else {
        throw NSError(
          domain: "ExpoFaceRecognition", code: 21,
          userInfo: [NSLocalizedDescriptionKey: "Failed to encode frame as JPEG"]
        )
      }
      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("enroll_\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
      try data.write(to: url)
      return url.absoluteString
    }

    AsyncFunction("recognizeFaceAsync") { (imageUri: String) async throws -> [String: Any] in
      let image = try Self.loadImage(from: imageUri)
      let result = try await MobileFaceNetService.shared.recognize(image: image)
      return [
        "name": result.name,
        "distance": result.distance,
        "confidence": result.confidence,
        "found": result.found,
      ]
    }

    Function("listEnrolledFaces") {
      MobileFaceNetService.shared.listEnrolled()
    }

    Function("removeEnrolledFace") { (name: String) in
      MobileFaceNetService.shared.removeEnrolled(name: name)
    }

    Function("clearEnrolledFaces") {
      MobileFaceNetService.shared.clearAll()
    }

    Function("isModelLoaded") {
      MobileFaceNetService.shared.isModelLoaded
    }

    View(ExpoFaceRecognitionView.self) {
      Events("onFacesDetected")
    }
  }

  // MARK: - Helpers

  private static func loadImage(from uri: String) throws -> UIImage {
    let path = uri.hasPrefix("file://")
      ? (URL(string: uri)?.path ?? uri)
      : uri
    guard let image = UIImage(contentsOfFile: path) else {
      throw NSError(
        domain: "ExpoFaceRecognition", code: 10,
        userInfo: [NSLocalizedDescriptionKey: "Cannot load image: \(path)"]
      )
    }
    return image
  }
}