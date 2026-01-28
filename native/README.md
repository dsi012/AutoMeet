# ScreenCaptureKit Native Module

This native module uses Apple's ScreenCaptureKit API to capture system audio and microphone audio.

## Features

- ✅ **System Audio Capture** - Captures audio played by other applications
- ⚠️ **Microphone Capture** - Requires macOS 15.0+, lower versions need to use Web Audio API
- ✅ **High-Performance Native Implementation** - Uses macOS native APIs
- ✅ **Automatic App Audio Exclusion** - Prevents echo
- ✅ **16kHz Mono Output** - Optimized for speech recognition
- ✅ **PCM Int16 Format** - Compatible with most speech recognition APIs

## System Requirements

- **macOS 13.0 (Ventura) or later** - Supports system audio capture
- **macOS 15.0 (Sequoia) or later** - Supports native microphone capture
- Xcode Command Line Tools
- Node.js and node-gyp

## Version Compatibility

| macOS Version | System Audio | Microphone (Native) | Recommended Approach |
|--------------|--------------|---------------------|---------------------|
| 13.0-14.x | ✅ Supported | ❌ Not Supported | System audio via ScreenCaptureKit, microphone via Web Audio API |
| 15.0+ | ✅ Supported | ✅ Supported | Fully native capture |

**Current Implementation**: Optimized for macOS 13.0-14.x, captures system audio only. Microphone is captured separately via Web Audio API.

## Building

```bash
# Install dependencies
cd native
npm install

# Build native module
npm run install

# Or from project root
npm run build:native
```

## Usage

### Using in TypeScript/JavaScript

```typescript
import { screenCapture, isAvailable } from '../native';

// Check if available
if (isAvailable()) {
  // Start capture (system audio + microphone)
  const success = screenCapture.startCapture(true, true);
  
  if (success) {
    console.log('Capture started');
    
    // Periodically get audio data
    setInterval(() => {
      const audioData = screenCapture.getAudioData();
      if (audioData) {
        // audioData is Buffer<Int16>
        // Process audio data...
      }
    }, 100);
  }
}

// Stop capture
screenCapture.stopCapture();
```

### API

#### `startCapture(captureSystemAudio: boolean, captureMicrophone: boolean): boolean`
Start audio capture.
- `captureSystemAudio`: Whether to capture system audio (audio from other applications)
- `captureMicrophone`: Whether to capture microphone audio
- Returns: `true` if successfully started, `false` if failed

#### `stopCapture(): void`
Stop audio capture.

#### `getAudioData(): Buffer | null`
Get mixed audio data.
- Returns: Buffer in PCM Int16 format, or `null` if queue is empty

#### `isCapturing(): boolean`
Check if currently capturing.

#### `getQueueSize(): number`
Get the number of buffers in the audio queue.

## Permission Configuration

The application requires the following permissions:

1. **Microphone Permission** - `NSMicrophoneUsageDescription`
2. **Screen Recording Permission** - `NSScreenCaptureUsageDescription`

These permissions are configured in `package.json` under `build.mac.extendInfo`.

## System Permission Authorization

On first run, macOS will prompt for permissions:

1. **Microphone Permission** - Allow microphone access
2. **Screen Recording Permission** - Allow system audio capture

Users need to manually grant permissions in **System Settings > Privacy & Security**.

## Troubleshooting

### Build Failures

```bash
# Ensure Xcode Command Line Tools are installed
xcode-select --install

# Clean and rebuild
cd native
rm -rf build node_modules
npm install
```

### Permission Issues

If capture fails, check:
1. System Settings > Privacy & Security > Screen Recording
2. Ensure the application is authorized
3. May need to restart the application

### Audio Quality Issues

Current configuration:
- Sample Rate: 16kHz (suitable for speech recognition)
- Channels: Mono
- Format: PCM Int16

To modify, edit the configuration in `screencapture.mm`:

```objc
config.sampleRate = 16000;  // Modify sample rate
config.channelCount = 1;     // Modify channel count
```

## Technical Details

### Audio Mixing

System audio and microphone audio are mixed at the C++ layer:

```cpp
// Simple additive mixing with clipping protection
int32_t mixed = systemSample + micSample;
if (mixed > INT16_MAX) mixed = INT16_MAX;
if (mixed < INT16_MIN) mixed = INT16_MIN;
```

### Thread Safety

Uses `std::mutex` to protect audio queues, supporting multi-threaded access.

### Queue Management

Maximum queue capacity is 100 buffers to prevent memory overflow.

## License

MIT License
