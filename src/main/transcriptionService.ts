import WebSocket from 'ws';
export interface TranscriptionConfig {
  apiKey: string;
  model?: string;
  language?: string;
  sampleRate?: number;
}

export class TranscriptionService {
  private ws: WebSocket | null = null;
  private config: TranscriptionConfig;
  private onTranscriptCallback?: (text: string, isFinal: boolean) => void;
  private onConnectionStatusCallback?: (connected: boolean, error?: string) => void;
  private sessionId: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private audioChunkCount: number = 0;
  private lastPartialText: string = '';
  private lastCommittedText: string = '';
  private lastCommittedTime: number = 0;  // Record the time of last commit
  private isDisconnecting: boolean = false;
  private lastAudioSentTime: number = 0;
  private lastTranscriptTime: number = 0;
  private connectionStartTime: number = 0;

  constructor(config: TranscriptionConfig) {
    this.config = config;
  }

  connect(
    onTranscript: (text: string, isFinal: boolean) => void,
    onConnectionStatus?: (connected: boolean, error?: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isDisconnecting = false;
      this.onTranscriptCallback = onTranscript;
      this.onConnectionStatusCallback = onConnectionStatus;
      this.connectionStartTime = Date.now();

      // Validate API key
      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        console.error('ElevenLabs API key is missing or empty');
        reject(new Error('ElevenLabs API key is required. Please configure it in Settings.'));
        return;
      }

      // Log API key status (masked for security)
      const maskedKey = this.config.apiKey.substring(0, 8) + '...' + this.config.apiKey.substring(this.config.apiKey.length - 4);
      console.log('Connecting to ElevenLabs Scribe with API key:', maskedKey);

      // ElevenLabs Scribe v2 Realtime WebSocket endpoint
      // According to official documentation, VAD parameters must be set via URL query parameters
      // And must set commit_strategy='vad' to use custom VAD parameters
      const vadParams = new URLSearchParams({
        model_id: 'scribe_v2_realtime',
        audio_format: 'pcm_48000',             // Specify 48kHz PCM format
        commit_strategy: 'vad',
        vad_silence_threshold_secs: '1.2',     // Commit after 0.8 seconds of silence
        vad_threshold: '0.5',                  // Lowered to 0.5 for better balance (default is 0.4)
        min_speech_duration_ms: '500',         // Lowered to 300ms to avoid filtering too much
        min_silence_duration_ms: '300',        // Minimum silence 150ms
      });
      const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${vadParams.toString()}`;
      console.log('WebSocket URL with VAD params:', wsUrl);
      
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      });

      this.ws.on('open', () => {
        console.log('Connected to ElevenLabs Scribe, waiting for session_started...');
        if (this.onConnectionStatusCallback) {
          this.onConnectionStatusCallback(true);
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          
          switch (message.message_type) {
            case 'session_started':
              this.sessionId = message.session_id;
              console.log('Session started:', this.sessionId);
              console.log('Session config:', JSON.stringify(message.config, null, 2));
              
              // Start keep-alive and health check
              this.startKeepAlive();
              this.startHealthCheck();
              
              resolve();
              break;
              
            case 'partial_transcript':
              // Partial results (may change)
              // Only send if text has changed to avoid duplicates
              if (message.text && message.text !== this.lastPartialText) {
                this.lastPartialText = message.text;
                this.lastTranscriptTime = Date.now();
                if (this.onTranscriptCallback) {
                  this.onTranscriptCallback(message.text, false);
                }
              }
              break;
              
            case 'committed_transcript':
            case 'committed_transcript_with_timestamps':
              // Final result
              console.log(`📝 Committed transcript received: "${message.text?.substring(0, 50)}..."`);
              // Filter out empty text and duplicate text to avoid meaningless triggers
              if (message.text && message.text.trim() !== '') {
                const newText = message.text.trim();
                const now = Date.now();
                const timeSinceLastCommit = now - this.lastCommittedTime;
                
                // Deduplication logic:
                // 1. Exactly the same text -> duplicate
                // 2. Similar text received within short time (500ms) with only punctuation differences -> duplicate
                // 3. No longer using startsWith detection, as this incorrectly filters out normal incremental text
                
                const isExactDuplicate = newText === this.lastCommittedText;
                
                // Check if it's a duplicate with only punctuation differences (within short time window)
                const normalizedNew = newText.replace(/[^\w\s\u4e00-\u9fff]/g, '').toLowerCase();
                const normalizedLast = this.lastCommittedText.replace(/[^\w\s\u4e00-\u9fff]/g, '').toLowerCase();
                const isPunctuationDuplicate = timeSinceLastCommit < 500 && normalizedNew === normalizedLast;
                
                const isDuplicate = isExactDuplicate || isPunctuationDuplicate;
                
                if (!isDuplicate) {
                  this.lastCommittedText = newText;
                  this.lastCommittedTime = now;
                  this.lastPartialText = ''; // Reset partial text after commit
                  this.lastTranscriptTime = now;
                  if (this.onTranscriptCallback) {
                    this.onTranscriptCallback(newText, true);
                  }
                } else {
                  // If duplicate but new text is longer (has more punctuation), update stored text
                  if (newText.length > this.lastCommittedText.length) {
                    this.lastCommittedText = newText;
                  }
                }
              }
              break;
              
            case 'error':
              console.error('Transcription error:', message.error);
              break;
              
            case 'auth_error':
              console.error('Authentication error:', message.error);
              reject(new Error(`Authentication error: ${message.error}`));
              break;
              
            case 'quota_exceeded_error':
              console.error('Quota exceeded:', message.error);
              break;

            case 'queue_overflow':
              console.error('ElevenLabs queue overflow:', message.error);
              if (this.ws) {
                this.ws.close(1000, 'queue_overflow');
              }
              break;
              
            default:
              console.log('Unknown message type:', message.message_type);
          }
        } catch (error) {
          console.error('Error parsing transcription message:', error);
          console.log('Raw message:', data.toString());
        }
      });

      this.ws.on('error', (error: any) => {
        console.error('WebSocket error:', error);
        
        // Provide more specific error messages based on common issues
        let errorMessage = 'WebSocket connection error: ';
        
        if (error.message && error.message.includes('403')) {
          errorMessage += 'Authentication failed (403 Forbidden). Please check:\n' +
            '1. Your ElevenLabs API key is correct\n' +
            '2. Your account has access to Scribe v2 Realtime (requires Starter plan or higher)\n' +
            '3. Your API key has the correct permissions';
        } else if (error.message && error.message.includes('401')) {
          errorMessage += 'Invalid API key (401 Unauthorized). Please verify your ElevenLabs API key in Settings.';
        } else if (error.message && error.message.includes('429')) {
          errorMessage += 'Rate limit exceeded (429). Please try again later.';
        } else {
          errorMessage += error.message || 'Unknown error';
        }
        
        if (this.onConnectionStatusCallback) {
          this.onConnectionStatusCallback(false, errorMessage);
        }
        
        reject(new Error(errorMessage));
      });

      this.ws.on('close', (code, reason) => {
        console.log(`Disconnected from ElevenLabs Scribe (code: ${code}, reason: ${reason.toString() || 'none'})`);
        console.log(`Total audio chunks sent: ${this.audioChunkCount}`);
        
        this.stopKeepAlive();
        this.stopHealthCheck();
        
        // Notify connection status callback if unexpected disconnection
        if (!this.isDisconnecting && this.onConnectionStatusCallback) {
          this.onConnectionStatusCallback(false, `Connection lost (code: ${code})`);
        }
        
        this.ws = null;
        this.sessionId = null;
        this.audioChunkCount = 0;
        this.lastPartialText = '';
        this.lastCommittedText = '';
        this.lastCommittedTime = 0;
      });
    });
  }

  private startKeepAlive() {
    // Send empty audio chunks periodically to keep connection alive
    // This is only a fallback if no real audio is being sent
    this.keepAliveInterval = setInterval(() => {
      if (this.audioChunkCount === 0) {
        console.log('No audio received yet, connection is waiting for audio data...');
      }
    }, 5000);
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private startHealthCheck() {
    // Check connection health every 10 seconds
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceConnection = now - this.connectionStartTime;
      const timeSinceLastAudio = now - this.lastAudioSentTime;
      const timeSinceLastTranscript = now - this.lastTranscriptTime;
      
      // Log health status every 30 seconds for debugging
      const shouldLog = Math.floor(now / 30000) !== Math.floor((now - 10000) / 30000);
      if (shouldLog && this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log(`🔌 Transcription health: connected=${this.isConnected()}, audioChunks=${this.audioChunkCount}, lastAudio=${Math.round(timeSinceLastAudio/1000)}s ago, lastTranscript=${Math.round(timeSinceLastTranscript/1000)}s ago`);
      }
      
      // If we've been connected for more than 15 seconds but haven't sent audio in 10 seconds,
      // and we haven't received any transcripts, something might be wrong
      if (timeSinceConnection > 15000 && 
          this.lastAudioSentTime > 0 && 
          timeSinceLastAudio > 10000 && 
          this.lastTranscriptTime === 0) {
        console.warn('⚠️ Health check warning: No transcripts received despite sending audio');
        console.warn(`Audio chunks sent: ${this.audioChunkCount}, Time since last audio: ${Math.round(timeSinceLastAudio/1000)}s`);
        
        // Notify that connection might be unhealthy
        if (this.onConnectionStatusCallback) {
          this.onConnectionStatusCallback(
            true, 
            'Connection established but no transcripts received. Please check your audio input.'
          );
        }
      }
      
      // Check if WebSocket is still open
      if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
        console.error('❌ Health check failed: WebSocket not in OPEN state');
        if (this.onConnectionStatusCallback) {
          this.onConnectionStatusCallback(false, 'Connection lost unexpectedly');
        }
      }
    }, 10000); // Check every 10 seconds
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Send audio data to the WebSocket
   * Audio format: PCM 16-bit signed little-endian
   * Sample rate: 8kHz-48kHz supported (currently using 48kHz for better quality)
   */
  sendAudio(audioData: Buffer) {
    // Silently ignore if disconnecting or not connected
    if (this.isDisconnecting || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Convert audio buffer to base64
    const audioBase64 = audioData.toString('base64');
    
    // Send as JSON message per ElevenLabs API spec
    // Must include sample_rate field
    const message = {
      message_type: 'input_audio_chunk',
      audio_base_64: audioBase64,
      sample_rate: 48000,  // Must specify sample rate
    };
    
    this.ws.send(JSON.stringify(message));
    this.audioChunkCount++;
    this.lastAudioSentTime = Date.now();
  }

  disconnect() {
    // Print statistics before resetting
    console.log(`Disconnecting transcription service... (audio chunks sent: ${this.audioChunkCount})`);
    this.isDisconnecting = true;
    this.stopKeepAlive();
    this.stopHealthCheck();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.sessionId = null;
      this.audioChunkCount = 0;
      this.lastPartialText = '';
      this.lastCommittedText = '';
      this.lastCommittedTime = 0;
      this.lastAudioSentTime = 0;
      this.lastTranscriptTime = 0;
      this.connectionStartTime = 0;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

}
