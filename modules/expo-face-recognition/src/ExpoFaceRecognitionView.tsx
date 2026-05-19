import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoFaceRecognitionViewProps } from './ExpoFaceRecognition.types';

const NativeView: React.ComponentType<ExpoFaceRecognitionViewProps> =
  requireNativeView('ExpoFaceRecognition');

export default function ExpoFaceRecognitionView(props: ExpoFaceRecognitionViewProps) {
  return <NativeView {...props} />;
}
