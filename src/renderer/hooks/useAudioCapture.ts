import { useRef, useCallback, useState } from 'react';

interface UseAudioCaptureOptions {
  sampleRate?: number;
  channelCount?: number;
  bufferSize?: number;
}

interface UseAudioCaptureReturn {
  isCapturing: boolean;
  startCapture: () => Promise<boolean>;
  stopCapture: () => void;
  error: string | null;
}

export function useAudioCapture(options: UseAudioCaptureOptions = {}): UseAudioCaptureReturn {
  // Use refs for options to avoid re-creating callbacks when options change
  const optionsRef = useRef(options);
  optionsRef.current = options;
  
  const {
    sampleRate = 48000, // ElevenLabs supports 8kHz-48kHz, using 48kHz for better quality
    channelCount = 1,   // Mono audio
    bufferSize = 1024,  // Smaller buffer reduces latency, approximately 21ms @ 48kHz
  } = optionsRef.current;

  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const isCapturingRef = useRef(false);

  const startCapture = useCallback(async (): Promise<boolean> => {
    if (isCapturingRef.current) {
      console.log('Audio capture already in progress');
      return true;
    }

    setError(null);
    
    const { sampleRate: targetSampleRate, channelCount: targetChannelCount, bufferSize: targetBufferSize } = optionsRef.current;
    console.log('Starting audio capture with sampleRate:', targetSampleRate);

    try {
      // Request microphone access
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: targetChannelCount,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log('Microphone access granted');

      mediaStreamRef.current = stream;

      // Create AudioContext - let it use its preferred sample rate
      // We'll resample if needed
      console.log('Creating AudioContext...');
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      console.log('AudioContext created, sampleRate:', audioContext.sampleRate, 'state:', audioContext.state);

      if (audioContext.state === 'suspended') {
        console.log('AudioContext suspended, attempting to resume...');
        await audioContext.resume();
        console.log('AudioContext state after resume:', audioContext.state);
      }

      if (audioContext.state !== 'running') {
        throw new Error(`AudioContext failed to start. Current state: ${audioContext.state}`);
      }

      // Create source from the media stream
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Use ScriptProcessorNode for audio processing
      const scriptProcessor = audioContext.createScriptProcessor(
        targetBufferSize || 4096,
        targetChannelCount || 1,
        targetChannelCount || 1,
      );
      scriptProcessorRef.current = scriptProcessor;
      
      // Calculate resampling ratio
      const resampleRatio = audioContext.sampleRate / (targetSampleRate || 48000);
      console.log('Resample ratio:', resampleRatio);
      
      let audioChunkCount = 0;
      let audioProcessLogCount = 0;

      // Mark capturing before audio callbacks start firing
      isCapturingRef.current = true;
      setIsCapturing(true);
      
      scriptProcessor.onaudioprocess = (event) => {
        audioProcessLogCount++;
        const inputData = event.inputBuffer.getChannelData(0);
        const sampleCount = inputData.length;

        if (audioProcessLogCount <= 5) {
          console.log(
            `🎧 Audio process callback #${audioProcessLogCount}, capturing=${isCapturingRef.current}, samples=${sampleCount}`,
          );
        }

        if (!isCapturingRef.current) {
          if (audioProcessLogCount <= 5) {
            console.log('🎧 Audio callback skipped because capturing flag is false');
          }
          return;
        }
        
        try {
          // Resample to target sample rate if needed
          let processedData: Float32Array;
          if (resampleRatio !== 1) {
            const newLength = Math.floor(inputData.length / resampleRatio);
            processedData = new Float32Array(newLength);
            for (let i = 0; i < newLength; i++) {
              processedData[i] = inputData[Math.floor(i * resampleRatio)];
            }
          } else {
            processedData = inputData;
          }
          
          // Convert Float32Array to Int16Array (PCM 16-bit)
          const pcmData = float32ToInt16(processedData);
          
          // Send to main process via IPC
          if (window.electronAPI && window.electronAPI.sendAudioData) {
            window.electronAPI.sendAudioData(pcmData.buffer);
            audioChunkCount++;
            if (audioChunkCount === 1) {
              console.log('✅ First audio chunk sent!');
            }
            if (audioChunkCount % 50 === 0) {
              console.log(`📊 Sent ${audioChunkCount} audio chunks`);
            }
          } else {
            console.error('❌ electronAPI.sendAudioData not available!');
          }
        } catch (err) {
          console.error('❌ Error in audio processing:', err);
        }
      };

      // Connect nodes: source -> scriptProcessor -> destination
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      console.log('✅ Audio capture started successfully');
      
      return true;
    } catch (err: any) {
      console.error('❌ Failed to start audio capture:', err);
      setError(err.message || 'Failed to access microphone');
      setIsCapturing(false);
      isCapturingRef.current = false;
      return false;
    }
  }, []); // No dependencies - use optionsRef instead

  const stopCapture = useCallback(() => {
    if (!isCapturingRef.current) {
      console.log('No audio capture in progress');
      return;
    }

    console.log('Stopping audio capture...');
    
    // Mark as not capturing first to stop audio processing
    isCapturingRef.current = false;

    // Stop all media tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect audio nodes
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsCapturing(false);
    console.log('Audio capture stopped');
  }, []);

  return {
    isCapturing,
    startCapture,
    stopCapture,
    error,
  };
}

/**
 * Convert Float32Array audio samples to Int16Array (PCM 16-bit)
 * This is the format expected by most speech-to-text APIs
 */
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp the value between -1 and 1
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    // Convert to 16-bit integer
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  return int16Array;
}

export default useAudioCapture;
