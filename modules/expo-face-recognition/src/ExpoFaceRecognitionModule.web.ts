import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './ExpoFaceRecognition.types';

type ExpoFaceRecognitionModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class ExpoFaceRecognitionModule extends NativeModule<ExpoFaceRecognitionModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(ExpoFaceRecognitionModule, 'ExpoFaceRecognitionModule');
