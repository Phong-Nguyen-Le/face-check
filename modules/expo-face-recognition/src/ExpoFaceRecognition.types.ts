import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

/** All values are normalized 0–1 relative to the camera frame. */
export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Populated when a matching enrolled face is found, e.g. "Alice 87%" */
  name: string;
  /** Face yaw in radians from Vision. ~0 = front, positive = turned left, negative = turned right. */
  yaw: number;
};

export type FacesDetectedPayload = {
  faceCount: number;
  faces: FaceBox[];
};

export type ExpoFaceRecognitionViewProps = {
  onFacesDetected?: (event: { nativeEvent: FacesDetectedPayload }) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
};
