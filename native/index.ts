// TypeScript bindings for the native ScreenCaptureKit module
const path = require('path');

let nativeModule: any = null;

try {
  // Try to load the native module
  // In development: native/build/Release/screencapture.node
  // In production: should be in the same location relative to this file
  
  // Try multiple possible paths
  const possiblePaths = [
    // Development: from dist/native/index.js to native/build/Release/screencapture.node
    path.join(__dirname, '../../native/build/Release/screencapture.node'),
    // Alternative: from dist/native to root/native
    path.join(__dirname, '../../../native/build/Release/screencapture.node'),
    // Direct path (if cwd is project root)
    path.join(process.cwd(), 'native/build/Release/screencapture.node'),
  ];
  
  for (const nativePath of possiblePaths) {
    try {
      nativeModule = require(nativePath);
      console.log(`✅ ScreenCaptureKit loaded from: ${nativePath}`);
      break;
    } catch (err) {
      // Try next path
    }
  }
  
  if (!nativeModule) {
    throw new Error('Native module not found in any expected location');
  }
} catch (error) {
  console.warn('ScreenCaptureKit native module not available:', error);
}

export interface ScreenCaptureModule {
  startCapture(captureSystemAudio: boolean, captureMicrophone: boolean): boolean;
  stopCapture(): void;
  getAudioData(): Buffer | null;
  isCapturing(): boolean;
  getQueueSize(): number;
}

export const screenCapture: ScreenCaptureModule | null = nativeModule;

export function isAvailable(): boolean {
  return nativeModule !== null;
}

