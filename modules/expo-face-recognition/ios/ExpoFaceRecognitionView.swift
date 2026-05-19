import ExpoModulesCore
import AVFoundation
import Vision

class ExpoFaceRecognitionView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {

  // MARK: – Events
  let onFacesDetected = EventDispatcher()

  // MARK: – Capture
  private let session = AVCaptureSession()
  private let videoOutput = AVCaptureVideoDataOutput()
  private let sessionQueue = DispatchQueue(label: "expo.facerecognition.session", qos: .userInitiated)
  private let outputQueue = DispatchQueue(label: "expo.facerecognition.output", qos: .userInitiated)

  // MARK: – Preview
  private var previewLayer: AVCaptureVideoPreviewLayer!

  // MARK: – Detection throttle (~10 fps)
  private var lastDetectionTime: CFTimeInterval = 0
  private let detectionInterval: CFTimeInterval = 0.1

  // MARK: – Frame store throttle (~5 fps for captureFrameAsync)
  private var lastFrameStoreTime: CFTimeInterval = 0

  // MARK: – Recognition cache (~1 fps)
  private var cachedNames: [String] = []
  private var lastRecognitionTime: CFTimeInterval = 0
  private let recognitionInterval: CFTimeInterval = 1.0
  private var isRecognizing = false
  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  // MARK: – Init
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    setupCamera()
  }

  deinit {
    sessionQueue.async { [session] in session.stopRunning() }
  }

  // MARK: – Layout
  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
  }

  // MARK: – Camera setup
  private func setupCamera() {
    session.beginConfiguration()
    session.sessionPreset = .hd1280x720

    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      session.commitConfiguration()
      return
    }
    session.addInput(input)

    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    ]
    videoOutput.setSampleBufferDelegate(self, queue: outputQueue)

    guard session.canAddOutput(videoOutput) else {
      session.commitConfiguration()
      return
    }
    session.addOutput(videoOutput)

    if let connection = videoOutput.connection(with: .video) {
      if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }

    session.commitConfiguration()

    previewLayer = AVCaptureVideoPreviewLayer(session: session)
    previewLayer.videoGravity = .resizeAspect
    DispatchQueue.main.async { self.layer.addSublayer(self.previewLayer) }

    sessionQueue.async { self.session.startRunning() }
  }

  // MARK: – AVCaptureVideoDataOutputSampleBufferDelegate
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    let now = CACurrentMediaTime()
    guard now - lastDetectionTime >= detectionInterval else { return }
    lastDetectionTime = now

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    // Keep a fresh frame available for captureFrameAsync (~5 fps)
    if now - lastFrameStoreTime >= 0.2 {
      lastFrameStoreTime = now
      let storeCi = CIImage(cvPixelBuffer: pixelBuffer)
      if let storeCg = ciContext.createCGImage(storeCi, from: storeCi.extent) {
        FrameStore.shared.update(UIImage(cgImage: storeCg))
      }
    }

    // Snapshot for async recognition (lightweight, done before Vision request)
    let shouldRecognize = MobileFaceNetService.shared.isModelLoaded
      && !isRecognizing
      && (now - lastRecognitionTime) >= recognitionInterval

    var snapshotImage: UIImage?
    if shouldRecognize {
      let ci = CIImage(cvPixelBuffer: pixelBuffer)
      if let cg = ciContext.createCGImage(ci, from: ci.extent) {
        snapshotImage = UIImage(cgImage: cg)
      }
    }

    let request = VNDetectFaceRectanglesRequest { [weak self] req, _ in
      guard let self else { return }

      let observations = req.results?.compactMap { $0 as? VNFaceObservation } ?? []

      // Kick off recognition if we have a snapshot and faces
      if let image = snapshotImage, !observations.isEmpty {
        self.lastRecognitionTime = now
        self.isRecognizing = true
        let observationsCopy = observations

        Task { [weak self] in
          guard let self else { return }
          var names = [String](repeating: "", count: observationsCopy.count)
          for (i, obs) in observationsCopy.enumerated() {
            if let cropped = self.cropFace(image: image, observation: obs) {
              if let result = try? await MobileFaceNetService.shared.recognize(image: cropped) {
                names[i] = result.found
                  ? "\(result.name) \(Int(result.confidence * 100))%"
                  : ""
              }
            }
          }
          self.cachedNames = names
          self.isRecognizing = false
        }
      }

      // Build face payload with cached names + yaw for guided enrollment
      let faces: [[String: Any]] = observations.enumerated().map { (i, obs) in
        let bb = obs.boundingBox
        return [
          "x":      1.0 - bb.maxX,   // mirror X for front camera
          "y":      1.0 - bb.maxY,   // flip Y (Vision origin bottom-left)
          "width":  bb.width,
          "height": bb.height,
          "name":   i < self.cachedNames.count ? self.cachedNames[i] : "",
          "yaw":    obs.yaw?.floatValue ?? 0,
        ]
      }

      self.onFacesDetected([
        "faceCount": observations.count,
        "faces": faces,
      ])
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    try? handler.perform([request])
  }

  // MARK: – Crop face from UIImage using Vision normalized bbox

  private func cropFace(image: UIImage, observation: VNFaceObservation) -> UIImage? {
    guard let cgImage = image.cgImage else { return nil }
    let w = CGFloat(cgImage.width)
    let h = CGFloat(cgImage.height)
    let bb = observation.boundingBox

    var rect = CGRect(
      x:      bb.minX * w,
      y:      (1 - bb.maxY) * h,
      width:  bb.width * w,
      height: bb.height * h
    )
    // 20 % padding
    rect = rect.insetBy(dx: -rect.width * 0.2, dy: -rect.height * 0.2)
      .intersection(CGRect(x: 0, y: 0, width: w, height: h))

    guard let cropped = cgImage.cropping(to: rect) else { return nil }
    return UIImage(cgImage: cropped)
  }
}

// MARK: - FrameStore (shared storage for captureFrameAsync)

final class FrameStore {
  static let shared = FrameStore()
  private let lock = NSLock()
  private var _image: UIImage?

  private init() {}

  func update(_ image: UIImage) {
    lock.lock(); defer { lock.unlock() }
    _image = image
  }

  func take() -> UIImage? {
    lock.lock(); defer { lock.unlock() }
    return _image
  }
}
