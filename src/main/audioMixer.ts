type SendFunction = (buffer: Buffer) => void;

interface BufferReadResult {
  samples: Int16Array;
  actualSamples: number;
}

class PCMBuffer {
  private buffer: Int16Array;
  private writePos = 0;
  private readPos = 0;
  private pendingSamples = 0;
  private droppedSamples = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Int16Array(capacity);
  }

  pushChunk(chunk: Buffer) {
    if (!chunk || chunk.length === 0) {
      return;
    }
    const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
    this.pushSamples(samples);
  }

  pushSamples(samples: Int16Array) {
    for (let i = 0; i < samples.length; i++) {
      if (this.pendingSamples === this.capacity) {
        // Buffer full: drop oldest sample to avoid overwriting unread data
        this.readPos = (this.readPos + 1) % this.capacity;
        this.pendingSamples--;
        this.droppedSamples++;
        // Silently handle overflow, don't output logs
      }

      this.buffer[this.writePos] = samples[i];
      this.writePos = (this.writePos + 1) % this.capacity;
      this.pendingSamples++;
    }
  }

  read(count: number): BufferReadResult {
    const output = new Int16Array(count);
    const samplesToRead = Math.min(count, this.pendingSamples);

    for (let i = 0; i < samplesToRead; i++) {
      output[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.capacity;
    }

    this.pendingSamples -= samplesToRead;
    return {
      samples: output,
      actualSamples: samplesToRead,
    };
  }

  available(): number {
    return this.pendingSamples;
  }

  clear() {
    this.buffer.fill(0);
    this.writePos = 0;
    this.readPos = 0;
    this.pendingSamples = 0;
    this.droppedSamples = 0;
  }
}

/**
 * Timeline-based audio mixer
 *
 * Outputs audio frames at fixed 100ms intervals; when any input buffer overflows,
 * only the oldest samples are discarded, ensuring no "large segments truncated" issues.
 * 
 * Note: 40ms interval causes ElevenLabs queue_overflow errors, changed to 100ms for stability.
 */
export class AudioMixer {
  private static readonly OUTPUT_INTERVAL_MS = 100;  // Changed from 40ms to 100ms to avoid ElevenLabs queue overflow
  private static readonly SAMPLE_RATE = 48000; // 48kHz (ElevenLabs supports 8kHz-48kHz)
  private static readonly SAMPLES_PER_INTERVAL = 4800; // 48000 * 0.100 = 4800 samples per 100ms
  private static readonly MAX_BUFFER_SAMPLES = 48000; // 1000ms @ 48kHz (increased buffer to accommodate larger frames)

  private readonly micBuffer = new PCMBuffer(AudioMixer.MAX_BUFFER_SAMPLES);
  private readonly systemBuffer = new PCMBuffer(AudioMixer.MAX_BUFFER_SAMPLES);

  private sendFn: SendFunction;
  private outputTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  // Diagnostic statistics
  private micChunksReceived = 0;
  private systemChunksReceived = 0;
  private framesEmitted = 0;
  private lastStatsTime = 0;
  private silentFrames = 0;  // Silent frame count (volume below threshold)

  constructor(sendFn: SendFunction) {
    this.sendFn = sendFn;
  }

  start() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    console.log(
      `🎚️ AudioMixer started (${AudioMixer.OUTPUT_INTERVAL_MS}ms output interval)`
    );
    this.outputTimer = setInterval(() => this.emitMixedFrame(), AudioMixer.OUTPUT_INTERVAL_MS);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    if (this.outputTimer) {
      clearInterval(this.outputTimer);
      this.outputTimer = null;
    }
    console.log('🎚️ AudioMixer stopped');
  }

  addMicChunk(chunk: Buffer) {
    if (!chunk || chunk.length === 0) {
      return;
    }
    this.micChunksReceived++;
    this.micBuffer.pushChunk(chunk);
  }

  addSystemChunk(chunk: Buffer) {
    if (!chunk || chunk.length === 0) {
      return;
    }
    this.systemChunksReceived++;
    this.systemBuffer.pushChunk(chunk);
  }

  reset() {
    this.micBuffer.clear();
    this.systemBuffer.clear();
  }

  private emitMixedFrame() {
    const frameSize = AudioMixer.SAMPLES_PER_INTERVAL;
    const micFrame = this.micBuffer.read(frameSize);
    const systemFrame = this.systemBuffer.read(frameSize);

    // If both channels have no data, can be considered silent frame, but still need to send to maintain real-time
    const mixedSamples = new Int16Array(frameSize);
    let maxAmplitude = 0;
    for (let i = 0; i < frameSize; i++) {
      let mixed = micFrame.samples[i] + systemFrame.samples[i];
      if (mixed > 32767) mixed = 32767;
      else if (mixed < -32768) mixed = -32768;
      mixedSamples[i] = mixed;
      const abs = Math.abs(mixed);
      if (abs > maxAmplitude) maxAmplitude = abs;
    }

    // Count silent frames (volume below 500, approximately -36dB)
    if (maxAmplitude < 500) {
      this.silentFrames++;
    }

    this.framesEmitted++;
    
    // Output diagnostic statistics every 30 seconds
    const now = Date.now();
    if (now - this.lastStatsTime >= 30000) {
      const silentPercent = this.framesEmitted > 0 
        ? Math.round(this.silentFrames / this.framesEmitted * 100) 
        : 0;
      console.log(`🎚️ AudioMixer stats: mic=${this.micChunksReceived} chunks, sys=${this.systemChunksReceived} chunks, frames=${this.framesEmitted}, silent=${silentPercent}%`);
      this.lastStatsTime = now;
      // Reset counters
      this.micChunksReceived = 0;
      this.systemChunksReceived = 0;
      this.framesEmitted = 0;
      this.silentFrames = 0;
    }

    const output = Buffer.from(
      mixedSamples.buffer,
      mixedSamples.byteOffset,
      mixedSamples.byteLength
    );
    this.sendFn(output);
  }
}
