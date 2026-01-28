#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>

static bool g_loggedFormat = false;
#import <napi.h>
#include <queue>
#include <mutex>

// Audio buffer queue for thread-safe audio data passing
class AudioBufferQueue {
private:
    std::queue<std::vector<int16_t>> buffers;
    std::mutex mutex;
    
public:
    void push(const std::vector<int16_t>& buffer) {
        std::lock_guard<std::mutex> lock(mutex);
        buffers.push(buffer);
        // Limit queue size to prevent memory issues
        while (buffers.size() > 100) {
            buffers.pop();
        }
    }
    
    bool pop(std::vector<int16_t>& buffer) {
        std::lock_guard<std::mutex> lock(mutex);
        if (buffers.empty()) return false;
        buffer = buffers.front();
        buffers.pop();
        return true;
    }
    
    size_t size() {
        std::lock_guard<std::mutex> lock(mutex);
        return buffers.size();
    }
};

// Stream output handler
@interface AudioStreamOutput : NSObject <SCStreamOutput, SCStreamDelegate>
@property (nonatomic, strong) dispatch_queue_t audioQueue;
@property (nonatomic, strong) dispatch_queue_t micQueue;
@property (nonatomic, assign) AudioBufferQueue* systemAudioQueue;
@property (nonatomic, assign) AudioBufferQueue* micAudioQueue;
@end

@implementation AudioStreamOutput

- (instancetype)initWithSystemQueue:(AudioBufferQueue*)systemQueue micQueue:(AudioBufferQueue*)micQueue {
    if (self = [super init]) {
        _audioQueue = dispatch_queue_create("com.meetingscheduler.audioqueue", DISPATCH_QUEUE_SERIAL);
        _micQueue = dispatch_queue_create("com.meetingscheduler.micqueue", DISPATCH_QUEUE_SERIAL);
        _systemAudioQueue = systemQueue;
        _micAudioQueue = micQueue;
    }
    return self;
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (!CMSampleBufferIsValid(sampleBuffer)) {
        return;
    }
    
    // In macOS 13.0-14.x, only SCStreamOutputTypeAudio is available
    // We'll capture system audio only
    if (type != SCStreamOutputTypeAudio) {
        return;
    }
    
    AudioBufferQueue* targetQueue = _systemAudioQueue;
    
    // Get format description
    CMAudioFormatDescriptionRef formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
    const AudioStreamBasicDescription *asbd = formatDesc ? CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) : nullptr;
    
    if (asbd && !g_loggedFormat) {
        NSLog(@"🎚️ ScreenCaptureKit audio format: sampleRate=%.2f Hz, channels=%u, bits=%u, flags=0x%x",
              asbd->mSampleRate,
              (unsigned int)asbd->mChannelsPerFrame,
              (unsigned int)asbd->mBitsPerChannel,
              (unsigned int)asbd->mFormatFlags);
        g_loggedFormat = true;
    }
    
    bool isFloat = false;
    bool isNonInterleaved = false;
    uint32_t channels = 2;
    uint32_t bitsPerChannel = 16;
    
    if (asbd) {
        isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
        isNonInterleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
        channels = asbd->mChannelsPerFrame;
        bitsPerChannel = asbd->mBitsPerChannel;
    }
    
    // Get audio buffer list to handle both interleaved and non-interleaved formats
    CMBlockBufferRef blockBuffer = nullptr;
    size_t bufferListSize = sizeof(AudioBufferList) + (channels - 1) * sizeof(AudioBuffer);
    AudioBufferList *bufferList = (AudioBufferList *)malloc(bufferListSize);
    if (!bufferList) return;
    
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        NULL,
        bufferList,
        bufferListSize,
        NULL,
        NULL,
        0,
        &blockBuffer
    );
    
    if (status != noErr) {
        NSLog(@"❌ Failed to get audio buffer list: %d", (int)status);
        free(bufferList);
        return;
    }
    
    // Convert to interleaved int16 PCM
    std::vector<int16_t> convertedSamples;
    
    if (isNonInterleaved && bufferList->mNumberBuffers > 1) {
        // Non-interleaved: separate channels, need to interleave manually
        size_t samplesPerChannel = bufferList->mBuffers[0].mDataByteSize / (bitsPerChannel / 8);
        
        if (isFloat) {
            std::vector<const float*> channelPtrs;
            for (UInt32 i = 0; i < bufferList->mNumberBuffers; i++) {
                channelPtrs.push_back((const float *)bufferList->mBuffers[i].mData);
            }
            
            for (size_t sample = 0; sample < samplesPerChannel; sample++) {
                for (size_t ch = 0; ch < channelPtrs.size(); ch++) {
                    float val = channelPtrs[ch][sample];
                    float clamped = fmaxf(-1.0f, fminf(1.0f, val));
                    convertedSamples.push_back((int16_t)(clamped * 32767.0f));
                }
            }
        } else {
            std::vector<const int16_t*> channelPtrs;
            for (UInt32 i = 0; i < bufferList->mNumberBuffers; i++) {
                channelPtrs.push_back((const int16_t *)bufferList->mBuffers[i].mData);
            }
            
            for (size_t sample = 0; sample < samplesPerChannel; sample++) {
                for (size_t ch = 0; ch < channelPtrs.size(); ch++) {
                    convertedSamples.push_back(channelPtrs[ch][sample]);
                }
            }
        }
    } else {
        // Already interleaved or single channel
        for (UInt32 bufIndex = 0; bufIndex < bufferList->mNumberBuffers; bufIndex++) {
            AudioBuffer buffer = bufferList->mBuffers[bufIndex];
            size_t sampleCount = buffer.mDataByteSize / (bitsPerChannel / 8);
            
            if (isFloat) {
                const float *floatSamples = (const float *)buffer.mData;
                for (size_t i = 0; i < sampleCount; i++) {
                    float sample = floatSamples[i];
                    // Clamp and convert to int16
                    float clamped = fmaxf(-1.0f, fminf(1.0f, sample));
                    convertedSamples.push_back((int16_t)(clamped * 32767.0f));
                }
            } else {
                // Assume signed int16 PCM
                const int16_t *intSamples = (const int16_t *)buffer.mData;
                convertedSamples.insert(convertedSamples.end(), intSamples, intSamples + sampleCount);
            }
        }
    }
    
    if (blockBuffer) {
        CFRelease(blockBuffer);
    }
    free(bufferList);
    
    if (!convertedSamples.empty()) {
        targetQueue->push(convertedSamples);
    }
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    if (error) {
        NSLog(@"Stream stopped with error: %@", error.localizedDescription);
    } else {
        NSLog(@"Stream stopped normally");
    }
}

@end

// C++ wrapper class
class ScreenCaptureWrapper {
private:
    SCStream* stream = nullptr;
    AudioStreamOutput* streamOutput = nullptr;
    AudioBufferQueue systemAudioQueue;
    AudioBufferQueue micAudioQueue;
    bool isCapturing = false;
    
public:
    ScreenCaptureWrapper() {}
    
    ~ScreenCaptureWrapper() {
        stopCapture();
    }
    
    // Start capture with system audio and microphone
    bool startCapture(bool captureSystemAudio, bool captureMicrophone) {
        if (isCapturing) {
            NSLog(@"Already capturing");
            return true;
        }
        
        // macOS 13.0+ required
        if (@available(macOS 13.0, *)) {
            dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
            __block NSError* error = nil;
            __block SCShareableContent* content = nil;
            
            // Get shareable content
            [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable shareableContent, NSError * _Nullable err) {
                content = shareableContent;
                error = err;
                dispatch_semaphore_signal(semaphore);
            }];
            
            dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
            
            if (error || !content) {
                NSLog(@"Failed to get shareable content: %@", error.localizedDescription);
                return false;
            }
            
            // Create content filter (capture all displays)
            SCContentFilter* filter = [[SCContentFilter alloc] initWithDisplay:content.displays.firstObject
                                                               excludingWindows:@[]];
            
            // Configure stream
            SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
            
            // Audio configuration
            config.capturesAudio = captureSystemAudio;
            // Note: captureMicrophone is only available in macOS 15.0+
            // For macOS 13.0-14.x, we only capture system audio
            config.excludesCurrentProcessAudio = YES; // Don't capture our own app's audio
            config.sampleRate = 48000; // Use 48kHz (common system sample rate)
            config.channelCount = 2; // Stereo (will be downmixed later if needed)
            
            // Minimal video configuration (we don't need video)
            config.width = 100;
            config.height = 100;
            config.minimumFrameInterval = CMTimeMake(1, 1); // 1 fps (minimal)
            config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
            
            // Create stream output
            streamOutput = [[AudioStreamOutput alloc] initWithSystemQueue:&systemAudioQueue 
                                                                  micQueue:&micAudioQueue];
            
            // Create stream
            stream = [[SCStream alloc] initWithFilter:filter 
                                        configuration:config 
                                             delegate:streamOutput];
            
            // Add stream outputs
            NSError* addOutputError = nil;
            if (captureSystemAudio) {
                [stream addStreamOutput:streamOutput 
                                   type:SCStreamOutputTypeAudio 
                     sampleHandlerQueue:streamOutput.audioQueue 
                                  error:&addOutputError];
                if (addOutputError) {
                    NSLog(@"Failed to add audio output: %@", addOutputError.localizedDescription);
                    return false;
                }
            }
            
            // Note: Microphone capture via SCStreamOutputTypeMicrophone is only available in macOS 15.0+
            // For macOS 13.0-14.x, users need to use Web Audio API for microphone separately
            if (captureMicrophone) {
                NSLog(@"⚠️ Microphone capture via ScreenCaptureKit requires macOS 15.0+");
                NSLog(@"   System will use Web Audio API for microphone input");
            }
            
            // Start capture and wait for result
            dispatch_semaphore_t startSemaphore = dispatch_semaphore_create(0);
            __block NSError* startError = nil;
            
            [stream startCaptureWithCompletionHandler:^(NSError * _Nullable error) {
                startError = error;
                if (error) {
                    NSLog(@"❌ Failed to start capture: %@", error.localizedDescription);
                    NSLog(@"   Error code: %ld", (long)error.code);
                    NSLog(@"   Error domain: %@", error.domain);
                } else {
                    NSLog(@"✅ ScreenCaptureKit capture started successfully");
                }
                dispatch_semaphore_signal(startSemaphore);
            }];
            
            // Wait for start to complete (max 5 seconds)
            dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC);
            long result = dispatch_semaphore_wait(startSemaphore, timeout);
            
            if (result != 0) {
                NSLog(@"❌ Timeout waiting for capture to start");
                return false;
            }
            
            if (startError) {
                NSLog(@"❌ Stream failed to start: %@", startError.localizedDescription);
                return false;
            }
            
            isCapturing = true;
            return true;
        } else {
            NSLog(@"ScreenCaptureKit requires macOS 13.0 or later");
            return false;
        }
    }
    
    void stopCapture() {
        if (!isCapturing) return;
        
        if (stream) {
            [stream stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
                if (error) {
                    NSLog(@"Error stopping capture: %@", error.localizedDescription);
                } else {
                    NSLog(@"Capture stopped successfully");
                }
            }];
            stream = nullptr;
        }
        
        streamOutput = nullptr;
        isCapturing = false;
    }
    
    // Get audio data (system audio only on macOS 13-14, or mixed on macOS 15+)
    std::vector<int16_t> getAudioData() {
        std::vector<int16_t> systemBuffer;
        std::vector<int16_t> micBuffer;
        
        systemAudioQueue.pop(systemBuffer);
        micAudioQueue.pop(micBuffer);
        
        // If we have microphone data (macOS 15+), mix it with system audio
        if (!systemBuffer.empty() && !micBuffer.empty()) {
            // Mix both audio sources
            size_t maxSize = std::max(systemBuffer.size(), micBuffer.size());
            std::vector<int16_t> mixedBuffer(maxSize, 0);
            
            for (size_t i = 0; i < maxSize; i++) {
                int32_t mixed = 0;
                if (i < systemBuffer.size()) mixed += systemBuffer[i];
                if (i < micBuffer.size()) mixed += micBuffer[i];
                
                // Clip to int16 range
                if (mixed > INT16_MAX) mixed = INT16_MAX;
                if (mixed < INT16_MIN) mixed = INT16_MIN;
                
                mixedBuffer[i] = static_cast<int16_t>(mixed);
            }
            
            return mixedBuffer;
        }
        
        // Return whichever buffer we have
        if (!systemBuffer.empty()) return systemBuffer;
        if (!micBuffer.empty()) return micBuffer;
        
        return std::vector<int16_t>();
    }
    
    bool isActive() const {
        return isCapturing;
    }
    
    size_t getQueueSize() {
        return systemAudioQueue.size() + micAudioQueue.size();
    }
};

// Node.js N-API bindings
static ScreenCaptureWrapper* g_capture = nullptr;

Napi::Value StartCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: captureSystemAudio, captureMicrophone").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    bool captureSystemAudio = info[0].As<Napi::Boolean>().Value();
    bool captureMicrophone = info[1].As<Napi::Boolean>().Value();
    
    if (!g_capture) {
        g_capture = new ScreenCaptureWrapper();
    }
    
    bool success = g_capture->startCapture(captureSystemAudio, captureMicrophone);
    return Napi::Boolean::New(env, success);
}

Napi::Value StopCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_capture) {
        g_capture->stopCapture();
        delete g_capture;
        g_capture = nullptr;
    }
    
    return env.Null();
}

Napi::Value GetAudioData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_capture) {
        return env.Null();
    }
    
    std::vector<int16_t> data = g_capture->getAudioData();
    
    if (data.empty()) {
        return env.Null();
    }
    
    // Create Node.js Buffer
    Napi::Buffer<int16_t> buffer = Napi::Buffer<int16_t>::Copy(env, data.data(), data.size());
    return buffer;
}

Napi::Value IsCapturing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool isActive = g_capture ? g_capture->isActive() : false;
    return Napi::Boolean::New(env, isActive);
}

Napi::Value GetQueueSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    size_t size = g_capture ? g_capture->getQueueSize() : 0;
    return Napi::Number::New(env, size);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "startCapture"), Napi::Function::New(env, StartCapture));
    exports.Set(Napi::String::New(env, "stopCapture"), Napi::Function::New(env, StopCapture));
    exports.Set(Napi::String::New(env, "getAudioData"), Napi::Function::New(env, GetAudioData));
    exports.Set(Napi::String::New(env, "isCapturing"), Napi::Function::New(env, IsCapturing));
    exports.Set(Napi::String::New(env, "getQueueSize"), Napi::Function::New(env, GetQueueSize));
    return exports;
}

NODE_API_MODULE(screencapture, Init)

