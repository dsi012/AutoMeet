import { BrowserWindow } from 'electron';
import * as os from 'os';
import { screenCapture, isAvailable as isScreenCaptureAvailable } from '../../native';

export type AudioDataCallback = (audioData: Buffer) => void;

export class AudioCapture {
  private window: BrowserWindow | null = null;
  private mediaStream: MediaStream | null = null;
  private isCapturing: boolean = false;
  private useNativeCapture: boolean = false;
  private micCaptureSupported: boolean = false;
  private audioPollingInterval: NodeJS.Timeout | null = null;
  private audioDataCallback: AudioDataCallback | null = null;
  private lastAudioDataTime: number = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onStreamError?: () => void;

  constructor(window: BrowserWindow) {
    this.window = window;
    this.useNativeCapture = isScreenCaptureAvailable();
    this.micCaptureSupported = this.checkMicSupport();
    
    if (this.useNativeCapture) {
      if (this.micCaptureSupported) {
        console.log('✅ ScreenCaptureKit native module available - will use native capture (mic + system audio)');
      } else {
        console.log('⚠️ ScreenCaptureKit available, but native microphone capture requires macOS 15.0+. Will only capture system audio.');
      }
    } else {
      console.log('⚠️ ScreenCaptureKit not available - falling back to Web Audio API');
    }
  }

  private checkMicSupport(): boolean {
    if (process.platform !== 'darwin') {
      return true;
    }
    
    // macOS 15.0 corresponds to Darwin 24.x
    const darwinVersion = parseInt(os.release().split('.')[0], 10);
    return darwinVersion >= 24;
  }

  setAudioDataCallback(callback: AudioDataCallback) {
    this.audioDataCallback = callback;
  }

  setStreamErrorCallback(callback: () => void) {
    this.onStreamError = callback;
  }

  async startCapture(captureSystemAudio: boolean = true, captureMicrophone: boolean = true): Promise<MediaStream | null> {
    if (this.isCapturing) {
      console.log('Audio capture already in progress');
      return this.mediaStream;
    }

    try {
      if (this.useNativeCapture && screenCapture) {
        // Use native ScreenCaptureKit
        console.log(`🎙️ Starting native capture - System: ${captureSystemAudio}, Mic: ${captureMicrophone}`);
        const success = screenCapture.startCapture(captureSystemAudio, captureMicrophone);
        
        if (success) {
          this.isCapturing = true;
          console.log('✅ Native audio capture started successfully');
          
          // Start polling for audio data
          this.startAudioPolling();
          return null; // Native capture doesn't use MediaStream
        } else {
          console.error('❌ Failed to start native capture, falling back to Web Audio API');
          this.useNativeCapture = false;
        }
      }
      
      // Fallback: Use Web Audio API in renderer
      this.isCapturing = true;
      console.log('Audio capture started (Web Audio API)');
      return null; // Actual stream will be handled in renderer
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      this.isCapturing = false;
      return null;
    }
  }

  private startAudioPolling() {
    if (!screenCapture) return;
    
    // Use 20ms polling interval, closer to Web Audio callback frequency
    const POLL_INTERVAL_MS = 20;
    console.log(`📊 Starting audio polling (${POLL_INTERVAL_MS}ms interval)...`);
    let chunkCount = 0;
    
    this.audioPollingInterval = setInterval(() => {
      if (!this.isCapturing || !screenCapture) {
        this.stopAudioPolling();
        return;
      }

      let audioData: Buffer | null;
      let receivedDataThisCycle = false;
      while ((audioData = screenCapture.getAudioData())) {
        if (this.audioDataCallback) {
          chunkCount++;
          receivedDataThisCycle = true;
          
          // Convert 48kHz stereo to 48kHz mono
          const convertedAudio = this.convertAudio(audioData);
          
          // Call the callback with converted audio data
          this.audioDataCallback(convertedAudio);
        }
      }
      
      // Update last audio data time if we received data
      if (receivedDataThisCycle) {
        this.lastAudioDataTime = Date.now();
      }
    }, POLL_INTERVAL_MS);
    
    // Start health check for native audio stream
    this.startHealthCheck();
  }

  private startHealthCheck() {
    // Check every 5 seconds if we're still receiving audio data
    this.healthCheckInterval = setInterval(() => {
      if (!this.isCapturing || !this.useNativeCapture) {
        return;
      }
      
      const timeSinceLastAudio = Date.now() - this.lastAudioDataTime;
      
      // If no audio data for 10 seconds, the stream might have stopped
      if (this.lastAudioDataTime > 0 && timeSinceLastAudio > 10000) {
        console.warn('⚠️ No audio data received for 10 seconds - stream may have stopped');
        console.warn('💡 Tip: Stop and restart recording to resume audio capture');
        
        // Notify about stream error
        if (this.onStreamError) {
          this.onStreamError();
        }
      }
    }, 5000);
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private convertAudio(input: Buffer): Buffer {
    // Native module output: 48kHz stereo 16-bit signed integer PCM
    // ElevenLabs supports: 8kHz-48kHz PCM, we use 48kHz mono for better quality
    
    // Step 1: Read 16-bit integer data
    const int16Samples = new Int16Array(input.buffer, input.byteOffset, input.length / 2);
    const numFrames = int16Samples.length / 2; // 2 channels (stereo)
    
    // Step 2: Convert stereo to mono (maintain 48kHz sample rate)
    const output = new Int16Array(numFrames);
    
    for (let i = 0; i < numFrames; i++) {
      const left = int16Samples[i * 2] || 0;
      const right = int16Samples[i * 2 + 1] || 0;
      
      // Mix to mono
      const mono = (left + right) / 2;
      
      // Clamp to int16 range
      const clamped = Math.max(-32768, Math.min(32767, mono));
      output[i] = Math.round(clamped);
    }
    
    return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  }

  private stopAudioPolling() {
    if (this.audioPollingInterval) {
      clearInterval(this.audioPollingInterval);
      this.audioPollingInterval = null;
    }
    this.stopHealthCheck();
  }

  stopCapture() {
    if (!this.isCapturing) {
      console.log('No audio capture in progress');
      return;
    }

    if (this.useNativeCapture && screenCapture) {
      // Stop native capture
      screenCapture.stopCapture();
      this.stopAudioPolling();
      console.log('Native audio capture stopped');
    } else {
      // Stop Web Audio API capture
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        this.mediaStream = null;
      }
    }

    this.isCapturing = false;
    this.lastAudioDataTime = 0;
    console.log('Audio capture stopped');
  }

  isActive(): boolean {
    if (this.useNativeCapture && screenCapture) {
      return screenCapture.isCapturing();
    }
    return this.isCapturing;
  }

  getQueueSize(): number {
    if (this.useNativeCapture && screenCapture) {
      return screenCapture.getQueueSize();
    }
    return 0;
  }

  isUsingNativeCapture(): boolean {
    return this.useNativeCapture;
  }

  supportsMicrophoneCapture(): boolean {
    // Always return false to use Web Audio API for microphone capture
    // This avoids potential echo issues when system audio and mic are mixed in native capture
    // and gives us better control over the two audio streams separately
    return false;
  }
}

