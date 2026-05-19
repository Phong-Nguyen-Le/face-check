// Reexport the native module. On web, it will be resolved to ExpoFaceRecognitionModule.web.ts
// and on native platforms to ExpoFaceRecognitionModule.ts
export { default } from './src/ExpoFaceRecognitionModule';
export { default as ExpoFaceRecognitionView } from './src/ExpoFaceRecognitionView';
export * from  './src/ExpoFaceRecognition.types';
