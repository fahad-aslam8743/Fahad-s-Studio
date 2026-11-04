// Low-latency Web Audio incremental PCM / WAV streaming player for Gemini TTS
// Audio formats supported:
// 1. Raw 16-bit signed LE linear PCM (audio/l16), 24 kHz mono
// 2. Standard 16-bit PCM WAV (audio/wav with RIFF header), 24 kHz mono

export interface AudioStreamerOptions {
  sampleRate?: number;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
  onError?: (err: unknown) => void;
}

export class AudioStreamer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sampleRate: number;
  private scheduledEndTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private isPlaying = false;
  private hasReportedStart = false;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;
  private onError?: (err: unknown) => void;

  constructor(options: AudioStreamerOptions = {}) {
    this.sampleRate = options.sampleRate || 24000;
    this.onPlaybackStart = options.onPlaybackStart;
    this.onPlaybackEnd = options.onPlaybackEnd;
    this.onError = options.onError;
  }

  private initContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: this.sampleRate });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Explicitly ensures the AudioContext is initialized and resumed within a user gesture.
   */
  public ensureContext(): void {
    try {
      const ctx = this.initContext();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
    } catch {}
  }

  public getAnalyser(): AnalyserNode | null {
    if (!this.analyser) {
      this.initContext();
    }
    return this.analyser;
  }

  public queuePcmBase64(base64Chunk: string): void {
    try {
      if (!base64Chunk || typeof base64Chunk !== 'string') return;
      const ctx = this.initContext();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      // Decode base64 to binary
      const binaryString = atob(base64Chunk.trim());
      const len = binaryString.length;
      if (len < 2) return;

      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Detect and strip WAV / RIFF header if present
      let pcmOffset = 0;
      let pcmLength = bytes.length;
      if (
        bytes.length >= 44 &&
        bytes[0] === 0x52 && // 'R'
        bytes[1] === 0x49 && // 'I'
        bytes[2] === 0x46 && // 'F'
        bytes[3] === 0x46    // 'F'
      ) {
        let foundData = false;
        // Search for 'data' chunk marker (0x64, 0x61, 0x74, 0x61)
        for (let i = 12; i < bytes.length - 8; i++) {
          if (
            bytes[i] === 0x64 &&
            bytes[i + 1] === 0x61 &&
            bytes[i + 2] === 0x74 &&
            bytes[i + 3] === 0x61
          ) {
            pcmOffset = i + 8; // skip 'data' chunk header (4) + chunk size (4)
            pcmLength = bytes.length - pcmOffset;
            foundData = true;
            break;
          }
        }
        if (!foundData) {
          pcmOffset = 44; // Standard 44-byte WAV header fallback
          pcmLength = Math.max(0, bytes.length - 44);
        }
      }

      // Convert 16-bit signed LE PCM to 32-bit float [-1.0, 1.0] using DataView
      const numSamples = Math.floor(pcmLength / 2);
      if (numSamples <= 0) return;

      const audioBuffer = ctx.createBuffer(1, numSamples, this.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset + pcmOffset, numSamples * 2);

      for (let i = 0; i < numSamples; i++) {
        channelData[i] = view.getInt16(i * 2, true) / 32768.0;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (this.analyser) {
        source.connect(this.analyser);
      } else {
        source.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      const startTime = Math.max(now + 0.005, this.scheduledEndTime);
      source.start(startTime);
      this.scheduledEndTime = startTime + audioBuffer.duration;

      this.activeSources.add(source);
      this.isPlaying = true;

      if (!this.hasReportedStart) {
        this.hasReportedStart = true;
        this.onPlaybackStart?.();
      }

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          if (ctx.currentTime >= this.scheduledEndTime - 0.05) {
            this.isPlaying = false;
            this.hasReportedStart = false;
            this.scheduledEndTime = 0;
            this.onPlaybackEnd?.();
          }
        }
      };
    } catch (err) {
      this.onError?.(err);
    }
  }

  public stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources.clear();
    this.scheduledEndTime = 0;
    this.isPlaying = false;
    this.hasReportedStart = false;
    this.onPlaybackEnd?.();
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
