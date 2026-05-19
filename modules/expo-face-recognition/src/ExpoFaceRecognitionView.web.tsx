import * as React from 'react';

import { ExpoFaceRecognitionViewProps } from './ExpoFaceRecognition.types';

export default function ExpoFaceRecognitionView(props: ExpoFaceRecognitionViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
