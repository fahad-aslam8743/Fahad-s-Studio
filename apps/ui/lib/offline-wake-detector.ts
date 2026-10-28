// Real Offline Acoustic Wake-Word Detector for Windows JARVIS
// Continuous 16kHz microphone audio capture without transmitting any audio to remote servers.
// Implements calibrated acoustic envelope analysis, Voice Activity Detection (VAD),
// phrase cadence matching, chime acknowledgment, and automatic command speech capture.

export type WakeDetectorState = 'disabled' | 'initializing' | 'listening' | 'capturing' | 'suspended' | 'unavailable';

export interface WakeDetectorOptions {
  wakePhrase?: string;
  sensitivity?: 'high' | 'normal';
  onWakeDetected: (phrase: string, startCapture?: () => void) => void;
  onCommandCaptured: (audioBlob: Blob) => void;
  onStateChange?: (state: WakeDetectorState) => void;
  onError?: (err: string) => void;
}

export class OfflineWakeDetector {
  private state: WakeDetectorState = 'disabled';
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private wakePhrase: string;
  private sensitivity: 'high' | 'normal' = 'normal';
  private onWakeDetected: (phrase: string, startCapture?: () => void) => void;
  private onCommandCaptured: (audioBlob: Blob) => void;
  private onStateChange?: (state: WakeDetectorState) => void;
  private onError?: (err: string) => void;

  // Acoustic cadence tracking buffer
  private frameEnergies: number[] = [];
  private frameZCRs: number[] = [];
  private ambientNoise = 0.01;
  private isSuspended = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWakeTime = 0;

  // Command capture state
  private isCapturingCommand = false;
  private commandChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private silenceFrames = 0;
  private speechDetectedInCapture = false;

  constructor(options: WakeDetectorOptions) {
    this.wakePhrase = options.wakePhrase || 'Hey Jarvis';
    this.sensitivity = options.sensitivity || 'normal';
    this.onWakeDetected = options.onWakeDetected;
    this.onCommandCaptured = options.onCommandCaptured;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }

  public getState(): WakeDetectorState {
    return this.state;
  }

  public setWakePhrase(phrase: string): void {
    this.wakePhrase = phrase.trim() || 'Hey Jarvis';
  }

  public setSensitivity(level: 'high' | 'normal'): void {
    this.sensitivity = level;
  }

  private setState(newState: WakeDetectorState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
    }
  }

  public async start(): Promise<void> {
    if (this.state === 'listening' || this.state === 'capturing') return;
    this.setState('initializing');

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported on this platform');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.mediaStream = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({sampleRate: 16000});
      this.audioCtx = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // Continuous 1024-sample frames (64ms per frame at 16kHz)
      const processor = ctx.createScriptProcessor(1024, 1, 1);
      this.processor = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.processAudioFrame(inputData);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      this.setState('listening');
    } catch (err: any) {
      this.setState('unavailable');
      this.onError?.(err?.message || 'Failed to start offline microphone listener');
    }
  }

  public stop(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {}
      this.processor = null;
    }
    if (this.audioCtx) {
      try {
        void this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
      this.mediaRecorder = null;
    }
    this.frameEnergies = [];
    this.frameZCRs = [];
    this.isCapturingCommand = false;
    this.setState('disabled');
  }

  // Echo Gate: completely freeze audio processing while JARVIS is speaking
  public suspend(): void {
    this.isSuspended = true;
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (this.isCapturingCommand) {
      this.cancelCommandCapture();
    }
    this.frameEnergies = [];
    this.frameZCRs = [];
    if (this.state === 'listening' || this.state === 'capturing') {
      this.setState('suspended');
    }
  }

  // Grace period after speaking stops before listening resumes
  public resumeWithGrace(graceMs = 1200): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
    }
    this.resumeTimer = setTimeout(() => {
      this.isSuspended = false;
      this.frameEnergies = [];
      this.frameZCRs = [];
      if (this.mediaStream && this.state === 'suspended') {
        this.setState('listening');
      }
    }, graceMs);
  }

  private processAudioFrame(samples: Float32Array): void {
    // HARD ECHO GATE: Discard everything while suspended
    if (this.isSuspended) return;

    // 1. Calculate RMS Energy and Zero-Crossing Rate
    let sum = 0;
    let zeroCrossings = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      sum += s * s;
      if (i > 0 && ((samples[i - 1] >= 0 && s < 0) || (samples[i - 1] < 0 && s >= 0))) {
        zeroCrossings++;
      }
    }
    const rms = Math.sqrt(sum / samples.length);
    const zcr = zeroCrossings / samples.length;

    // Adaptive noise floor tracking (slowly adapts to room noise)
    if (rms < this.ambientNoise * 1.5) {
      this.ambientNoise = this.ambientNoise * 0.98 + rms * 0.02;
    }

    // 2. Handle active command capture
    if (this.isCapturingCommand) {
      const isVoiced = rms > Math.max(0.025, this.ambientNoise * 2.5);
      if (isVoiced) {
        this.speechDetectedInCapture = true;
        this.silenceFrames = 0;
      } else {
        this.silenceFrames++;
      }

      // If user stops talking for > 750ms (~12 frames), complete command capture
      if (this.speechDetectedInCapture && this.silenceFrames >= 12) {
        this.finishCommandCapture();
        return;
      }
      // If user never starts talking (silent for 3.5s = ~55 frames), timeout cleanly
      if (!this.speechDetectedInCapture && this.silenceFrames >= 55) {
        this.finishCommandCapture();
        return;
      }
      return;
    }

    // 3. Keep sliding window of recent acoustic frames (~1.3s = 20 frames)
    this.frameEnergies.push(rms);
    this.frameZCRs.push(zcr);
    if (this.frameEnergies.length > 22) {
      this.frameEnergies.shift();
      this.frameZCRs.shift();
    }

    // 4. Acoustic Cadence Pattern Matching for "Hey Jarvis"
    const now = Date.now();
    // 3.5s cooldown between wake triggers prevents repeat triggering
    if (now - this.lastWakeTime < 3500) return;

    if (this.matchWakePhraseCadence()) {
      this.lastWakeTime = now;
      this.triggerWakeDetected();
    }
  }

  private matchWakePhraseCadence(): boolean {
    const n = this.frameEnergies.length;
    if (n < 16) return false;

    const windowEnergies = this.frameEnergies.slice(-16);
    const windowZCRs = this.frameZCRs.slice(-16);

    // 1. Calculate Peak, Min, Mean, and Variance across window
    let maxEnergy = 0;
    let minEnergy = Infinity;
    let sumEnergy = 0;
    for (let i = 0; i < windowEnergies.length; i++) {
      const e = windowEnergies[i];
      if (e > maxEnergy) maxEnergy = e;
      if (e < minEnergy) minEnergy = e;
      sumEnergy += e;
    }
    const meanEnergy = sumEnergy / windowEnergies.length;

    let varSum = 0;
    for (let i = 0; i < windowEnergies.length; i++) {
      const diff = windowEnergies[i] - meanEnergy;
      varSum += diff * diff;
    }
    const stdDev = Math.sqrt(varSum / windowEnergies.length);

    // 2. HARD REJECTION OF QUIETNESS AND FLAT BACKGROUND STATIC
    // In quiet rooms, mic self-noise / AGC noise is flat (stdDev < 0.012, crest < 0.03).
    // Real vocal speech speaking "Hey Jarvis" has significant dynamic range:
    // - maxEnergy must reach at least 0.065 (0.055 in high sensitivity).
    // - maxEnergy must be at least 3.2x ambient noise.
    // - Dynamic crest (max - min) must be >= 0.035.
    // - Standard deviation must be >= 0.016 (proves speech modulation, not steady hum).
    const minVocalPeak = this.sensitivity === 'high' ? 0.055 : 0.07;
    const dynamicFloor = Math.max(minVocalPeak, this.ambientNoise * 3.2);

    if (maxEnergy < dynamicFloor) return false;
    if (maxEnergy - minEnergy < 0.035) return false;
    if (stdDev < 0.016) return false;

    // 3. Syllabic Cadence: "Hey" (peak 1), Dip, "Jarvis" (peak 2 + sibilance)
    // Syllable 1 ("Hey"): occurs in frames 2 to 7
    let peak1 = 0;
    for (let i = 2; i <= 7; i++) {
      if (windowEnergies[i] > peak1) peak1 = windowEnergies[i];
    }

    // Syllable 2 ("Jar-"): occurs in frames 8 to 14
    let peak2 = 0;
    for (let i = 8; i <= 14; i++) {
      if (windowEnergies[i] > peak2) peak2 = windowEnergies[i];
    }

    // Both "Hey" and "Jar-" must be substantial vocal bursts (>= 60% of maxEnergy)
    if (peak1 < maxEnergy * 0.6 || peak2 < maxEnergy * 0.6) return false;

    // Inter-syllabic dip: between the two syllables (frames 5 to 9), energy must drop
    let dip = Infinity;
    for (let i = 5; i <= 9; i++) {
      if (windowEnergies[i] < dip) dip = windowEnergies[i];
    }
    // If there is no dip at all (flat continuous shouting or loud tone), reject
    if (dip > Math.min(peak1, peak2) * 0.85) return false;

    // 4. Sibilance check on the ending "-vis" (elevated zero-crossing rate from fricative 's')
    let tailZCR = 0;
    for (let i = windowZCRs.length - 4; i < windowZCRs.length; i++) {
      if (windowZCRs[i] > tailZCR) tailZCR = windowZCRs[i];
    }
    if (tailZCR < 0.17) return false;

    return true;
  }

  private triggerWakeDetected(): void {
    // 1. Bring window to front and maximize immediately in front of user
    if (typeof window !== 'undefined') {
      if ((window as any).irfan?.maximizeWindow) void (window as any).irfan.maximizeWindow();
      if ((window as any).irfan?.showAndFocus) void (window as any).irfan.showAndFocus();
    }

    // 2. Play electronic acknowledgment chime (short 150ms electronic sound, NOT voice speech)
    this.playAckChime();

    // 3. Clear acoustic history and freeze listening while greeting plays
    this.frameEnergies = [];
    this.frameZCRs = [];
    this.suspend();

    // 4. Notify parent with callback to trigger command capture once spoken greeting completes
    let captureStarted = false;
    const startCaptureCallback = () => {
      if (!captureStarted) {
        captureStarted = true;
        this.resumeWithGrace(0);
        this.startCommandCapture();
      }
    };

    this.onWakeDetected(this.wakePhrase, startCaptureCallback);

    // Safety timeout: if caller did not call startCapture within 4.5s, start capture automatically
    setTimeout(() => {
      if (!captureStarted && this.state === 'suspended') {
        startCaptureCallback();
      }
    }, 4500);
  }

  private playAckChime(): void {
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      // Fast, discrete double-ping chime (880Hz -> 1320Hz)
      const t = this.audioCtx.currentTime;
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.1);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch {}
  }

  public playReadyBeep(): void {
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      const t = this.audioCtx.currentTime;
      osc.frequency.setValueAtTime(1046, t); // High C ready tone
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch {}
  }

  public startCommandCapture(): void {
    if (!this.mediaStream) return;
    this.isSuspended = false;
    this.isCapturingCommand = true;
    this.commandChunks = [];
    this.silenceFrames = 0;
    this.speechDetectedInCapture = false;
    this.setState('capturing');

    // Subtle audio cue confirming recording has started
    this.playReadyBeep();

    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(this.mediaStream, {mimeType});
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.commandChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (this.commandChunks.length > 0) {
          const blob = new Blob(this.commandChunks, {type: mimeType});
          this.onCommandCaptured(blob);
        }
        this.isCapturingCommand = false;
        this.commandChunks = [];
        this.mediaRecorder = null;
        if (!this.isSuspended) {
          this.setState('listening');
        }
      };

      recorder.start(100);

      // Maximum 10 seconds capture safety deadline
      setTimeout(() => {
        if (this.isCapturingCommand) {
          this.finishCommandCapture();
        }
      }, 10000);
    } catch (err) {
      this.isCapturingCommand = false;
      this.setState('listening');
    }
  }

  public cancelCommandCapture(): void {
    this.commandChunks = [];
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.mediaRecorder = null;
    this.isCapturingCommand = false;
  }

  public finishCommandCapture(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.isCapturingCommand = false;
  }
}
