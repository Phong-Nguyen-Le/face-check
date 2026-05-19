import type { StyleProp, ViewStyle } from 'react-native';

/** All values are normalized 0–1 relative to the camera frame. */
export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Populated when a matching enrolled face is found, e.g. "Alice 87%" */
  name: string;
};

export type FacesDetectedPayload = {
  faceCount: number;
  faces: FaceBox[];
};

export type ExpoFaceRecognitionViewProps = {
  onFacesDetected?: (event: { nativeEvent: FacesDetectedPayload }) => void;
  style?: StyleProp<ViewStyle>;
};
