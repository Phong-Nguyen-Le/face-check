import { requireNativeModule } from "expo-modules-core";

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FaceDetectionResult = {
  faces: FaceBox[];
};

export type EnrollResult = {
  success: boolean;
  name: string;
};

export type RecognizeResult = {
  name: string;
  distance: number;
  confidence: number;
  found: boolean;
};

export type EnrolledFaceEntry = {
  name: string;
  enrolledAt: number; // unix timestamp
  embeddingCount: number;
};

export type CameraEnrollResult = {
  success: boolean;
  name: string;
  frameCount: number;
};

type ExpoFaceRecognitionModule = {
  hello(): string;
  isModelLoaded(): boolean;
  detectFacesAsync(imageUri: string): Promise<FaceDetectionResult>;
  enrollFaceAsync(imageUri: string, name: string): Promise<EnrollResult>;
  addFaceEmbeddingAsync(imageUri: string, name: string): Promise<EnrollResult>;
  /** Enroll using averaged embeddings from buffered camera frames. Use only during live camera enrollment. */
  enrollFromCameraFramesAsync(name: string): Promise<CameraEnrollResult>;
  /** Append an averaged embedding from buffered camera frames. Use only during live camera enrollment. */
  addEmbeddingFromCameraFramesAsync(name: string): Promise<CameraEnrollResult>;
  captureFrameAsync(): Promise<string>;
  recognizeFaceAsync(imageUri: string): Promise<RecognizeResult>;
  listEnrolledFaces(): EnrolledFaceEntry[];
  removeEnrolledFace(name: string): void;
  clearEnrolledFaces(): void;
};

export default requireNativeModule<ExpoFaceRecognitionModule>(
  "ExpoFaceRecognition",
);
