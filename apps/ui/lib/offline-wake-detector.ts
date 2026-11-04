// JARVIS Keyword Spotting & Voice Directive Capture Engine
//
// Architecture & Capabilities:
// 1. Continuous transcript-based keyword spotting via the browser SpeechRecognition API.
//    NOTE: The Web Speech API is a browser-level speech recognition system. Depending on
//    the host OS and Chromium build, it may utilize local OS speech recognition (Windows Speech)
//    or cloud-backed recognition. It is NOT guaranteed 100% offline. Push-to-Talk (Alt+M)
//    remains available at all times as a deterministic fallback.
// 2. Strict phrase-matching logic: ONLY the user's configured wake phrase (and explicit aliases,
//    if configured) will trigger activation. Hardcoded fallback phrases are removed to prevent
//    false activations when a custom phrase (e.g. "Computer") is active.
// 3. Single-shot turn execution: Each activation creates a unique turn ID. Text recognition and
//    audio recording run in coordination: if text recognition succeeds, the audio recording
//    is immediately discarded and onCommandText fires once. If text recognition fails or yields
//    silence, the audio blob is submitted to onCommandCaptured once. Double-execution of a
//    single spoken command is strictly prevented.
// 4. Acoustic echo shield: Recognition is suspended while JARVIS is speaking and during an
//    acoustic drain grace period to prevent self-triggering from speaker audio.

export type WakeDetectorState =
  | 'disabled'
  | 'initializing'
  | 'listening'
  | 'capturing'
  | 'suspended'
  | 'unavailable'
  | 'api_unavailable';

export interface WakeDetectorOptions {
  wakePhrase?: string;
  aliases?: string[];
  sensitivity?: 'high' | 'normal';
  onWakeDetected: (phrase: string, startCapture?: () => void) => void;
  onCommandCaptured: (audioBlob: Blob) => void;
  onCommandText?: (text: string) => void;
  onStateChange?: (state: WakeDetectorState) => void;
  onError?: (err: string) => void;
}

// ── Pure Phrase Matching Functions ──────────────────────────────────────────

/**
 * Normalizes text for keyword spotting: converts to lowercase, strips punctuation,
 * collapses redundant whitespace.
 */
export function normalizePhrase(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MatchResult {
  detected: boolean;
  matchedPhrase: string;
  commandAfter: string;
}

/**
 * Checks whether a transcript contains the target wake phrase (or optional explicit aliases).
 * Uses word-boundary matching to prevent false positives from partial word substrings.
 * Does NOT fallback to unconfigured phrases.
 */
export function matchWakePhrase(
  transcript: string,
  targetPhrase: string,
  aliases: string[] = []
): MatchResult {
  const normTranscript = normalizePhrase(transcript);
  const targetNorm = normalizePhrase(targetPhrase);

  if (!targetNorm || !normTranscript) {
    return {detected: false, matchedPhrase: '', commandAfter: ''};
  }

  // Check the exact configured target phrase first, followed by explicit aliases
  const candidates = [targetNorm, ...aliases.map(normalizePhrase).filter(Boolean)];

  for (const candidate of candidates) {
    let searchStart = 0;
    while (searchStart < normTranscript.length) {
      const idx = normTranscript.indexOf(candidate, searchStart);
      if (idx === -1) break;

      // Ensure match starts at a word boundary (start of string or preceded by space)
      const isWordStart = idx === 0 || normTranscript[idx - 1] === ' ';
      const afterIdx = idx + candidate.length;
      // Ensure match ends at a word boundary (end of string or followed by space)
      const isWordEnd = afterIdx >= normTranscript.length || normTranscript[afterIdx] === ' ';

      if (isWordStart && isWordEnd) {
        const commandAfter = normTranscript.slice(afterIdx).trim();
        return {detected: true, matchedPhrase: candidate, commandAfter};
      }

      searchStart = idx + 1;
    }
  }

  return {detected: false, matchedPhrase: '', commandAfter: ''};
}

// Legacy alias kept for backward compatibility in imports
export function transcriptContainsWakePhrase(
  transcript: string,
  wakePhraseNorm: string
): {detected: boolean; commandAfter: string} {
  const res = matchWakePhrase(transcript, wakePhraseNorm);
  return {detected: res.detected, commandAfter: res.commandAfter};
}

// ── OfflineWakeDetector Class ───────────────────────────────────────────────

export class OfflineWakeDetector {
  private state: WakeDetectorState = 'disabled';
  private wakePhrase: string;
  private wakePhraseNorm: string;
  private aliases: string[] = [];
  private sensitivity: 'high' | 'normal' = 'normal';

  private onWakeDetected: (phrase: string, startCapture?: () => void) => void;
  private onCommandCaptured: (audioBlob: Blob) => void;
  private onCommandText?: (text: string) => void;
  private onStateChange?: (state: WakeDetectorState) => void;
  private onError?: (err: string) => void;

  private recognition: any = null;
  private commandRecognition: any = null;
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private commandChunks: Blob[] = [];

  // Turn management: prevents duplicate execution of single spoken commands
  private currentTurnId = 0;
  private turnResolved = false;

  private isSuspended = false;
  private isCapturingCommand = false;
  private lastWakeTime = 0;
  private readonly COOLDOWN_MS = 3000;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private suspendResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private isActive = false;
  private commandTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceChangeListener: (() => void) | null = null;

  constructor(options: WakeDetectorOptions) {
    this.wakePhrase = options.wakePhrase?.trim() || 'Hey Jarvis';
    this.wakePhraseNorm = normalizePhrase(this.wakePhrase);
    this.aliases = options.aliases || [];
    this.sensitivity = options.sensitivity || 'normal';
    this.onWakeDetected = options.onWakeDetected;
    this.onCommandCaptured = options.onCommandCaptured;
    this.onCommandText = options.onCommandText;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }

  public getState(): WakeDetectorState {
    return this.state;
  }

  public getWakePhrase(): string {
    return this.wakePhrase;
  }

  public setWakePhrase(phrase: string, aliases: string[] = []): void {
    const clean = phrase.trim() || 'Hey Jarvis';
    this.wakePhrase = clean;
    this.wakePhraseNorm = normalizePhrase(clean);
    this.aliases = aliases;
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

  private getSpeechRecognitionClass(): any {
    if (typeof window === 'undefined') return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
  }

  public async start(): Promise<void> {
    if (this.state === 'listening' || this.state === 'initializing') return;
    this.isActive = true;
    this.setState('initializing');

    const SpeechRecognitionClass = this.getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) {
      this.setState('api_unavailable');
      this.onError?.(
        'Speech recognition is unavailable in this environment. You can use Push-to-Talk (Alt+M) or text input at all times.'
      );
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        // Listen for track ending (e.g. microphone unplugged or device revoked)
        const tracks = typeof this.mediaStream.getAudioTracks === 'function'
          ? this.mediaStream.getAudioTracks()
          : (typeof this.mediaStream.getTracks === 'function' ? this.mediaStream.getTracks() : []);
        for (const track of tracks) {
          if (track) {
            track.onended = () => {
              if (this.isActive) {
                this.setState('unavailable');
                this.onError?.('Microphone disconnected. Please check audio device connection.');
                this.scheduleReconnect();
              }
            };
          }
        }

        // Listen for hardware audio device changes across Windows
        if (!this.deviceChangeListener && navigator.mediaDevices.addEventListener) {
          this.deviceChangeListener = () => {
            if (this.isActive && !this.isSuspended) {
              void this.reinitializeMicrophone();
            }
          };
          navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeListener);
        }

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
    } catch (err: any) {
      this.setState('unavailable');
      this.onError?.(err?.message || 'Microphone access denied. Please grant microphone permissions.');
      return;
    }

    this.startRecognition();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.isActive && (this.state === 'unavailable' || !this.mediaStream)) {
        void this.start();
      }
    }, 3000);
  }

  private async reinitializeMicrophone(): Promise<void> {
    if (!this.isActive) return;
    this.stopRecognition();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    await this.start();
  }

  private startRecognition(): void {
    if (!this.isActive) return;

    // Multiple recognition loop prevention: guarantee any previous instance is stopped
    if (this.recognition) {
      this.stopRecognition();
    }

    const SpeechRecognitionClass = this.getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) return;

    try {
      const rec = new SpeechRecognitionClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      this.recognition = rec;

      rec.onstart = () => {
        if (!this.isSuspended && !this.isCapturingCommand) {
          this.setState('listening');
        }
      };

      rec.onresult = (event: any) => {
        if (this.isSuspended || this.isCapturingCommand || !this.isActive) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          const confidence = res[0]?.confidence;

          // Confidence threshold check if confidence is reported
          if (typeof confidence === 'number' && confidence > 0) {
            const minConf = this.sensitivity === 'high' ? 0.15 : 0.40;
            if (confidence < minConf) continue;
          }

          const match = matchWakePhrase(transcript, this.wakePhrase, this.aliases);
          if (match.detected) {
            const now = Date.now();
            if (now - this.lastWakeTime < this.COOLDOWN_MS) return;

            this.stopRecognition();
            this.triggerWakeDetected(match.commandAfter);
            return;
          }
        }
      };

      rec.onerror = (event: any) => {
        if (!this.isActive) return;
        const code = event.error;
        if (code === 'no-speech' || code === 'aborted') {
          this.scheduleRestart(500);
          return;
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.setState('unavailable');
          this.onError?.('Microphone permission denied.');
          return;
        }
        if (code === 'network') {
          this.scheduleRestart(2000);
          return;
        }
        this.scheduleRestart(1500);
      };

      rec.onend = () => {
        if (!this.isActive || this.isSuspended || this.isCapturingCommand) return;
        this.scheduleRestart(300);
      };

      rec.start();
    } catch (err: any) {
      this.setState('unavailable');
      this.onError?.(err?.message || 'Failed to initialize speech recognition');
    }
  }

  private scheduleRestart(delayMs: number): void {
    if (!this.isActive) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (this.isActive && !this.isSuspended && !this.isCapturingCommand) {
        this.startRecognition();
      }
    }, delayMs);
  }

  private stopRecognition(): void {
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
      this.recognition = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  public stop(): void {
    this.isActive = false;
    this.isSuspended = false;
    this.isCapturingCommand = false;
    this.turnResolved = true;
    this.commandChunks = [];
    this.stopRecognition();
    this.stopCommandRecognition();
    this.stopMediaRecorder();
    if (this.suspendResumeTimer) { clearTimeout(this.suspendResumeTimer); this.suspendResumeTimer = null; }
    if (this.commandTimeoutTimer) { clearTimeout(this.commandTimeoutTimer); this.commandTimeoutTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.deviceChangeListener && typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeListener);
      this.deviceChangeListener = null;
    }
    if (this.audioCtx) { try { void this.audioCtx.close(); } catch {} this.audioCtx = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
    this.setState('disabled');
  }

  // Echo Gate: suspend during active speech playback
  public suspend(): void {
    this.isSuspended = true;
    this.stopRecognition();
    this.stopCommandRecognition();
    this.stopMediaRecorder();
    if (this.suspendResumeTimer) { clearTimeout(this.suspendResumeTimer); this.suspendResumeTimer = null; }
    if (this.state === 'listening' || this.state === 'capturing' || this.state === 'initializing') {
      this.setState('suspended');
    }
  }

  // Resume listening after speech finishes, with acoustic drain period
  public resumeWithGrace(graceMs = 1200): void {
    if (this.suspendResumeTimer) clearTimeout(this.suspendResumeTimer);
    this.suspendResumeTimer = setTimeout(() => {
      this.isSuspended = false;
      if (this.isActive && this.state === 'suspended') {
        this.startRecognition();
      }
    }, graceMs);
  }

  public triggerWakeDetected(inlineCommand: string): boolean {
    const now = Date.now();
    if (now - this.lastWakeTime < this.COOLDOWN_MS) return false;
    this.lastWakeTime = now;

    this.playAckChime();

    let captureStarted = false;
    const startCaptureCallback = () => {
      if (!captureStarted) {
        captureStarted = true;
        this.startCommandCapture();
      }
    };

    // If inline command text is already present in the wake utterance, resolve immediately
    if (inlineCommand && inlineCommand.length > 1) {
      this.currentTurnId++;
      this.turnResolved = true;
      this.onWakeDetected(this.wakePhrase, () => {});
      this.onCommandText?.(inlineCommand);
      // Resume background recognition after cooldown
      setTimeout(() => {
        if (this.isActive && !this.isSuspended && !this.isCapturingCommand) {
          this.startRecognition();
        }
      }, 500);
      return true;
    }

    // Normal wake: prompt parent greeting, then parent invokes startCaptureCallback
    this.onWakeDetected(this.wakePhrase, startCaptureCallback);

    // Safety timeout: if parent greeting fails to trigger capture within 6 seconds, start anyway
    setTimeout(() => {
      if (!captureStarted && this.isActive && !this.isSuspended) {
        startCaptureCallback();
      }
    }, 6000);
    return true;
  }

  public startCommandCapture(): void {
    if (!this.isActive || this.isSuspended) return;

    // Begin a new single-shot turn
    this.currentTurnId++;
    const turnId = this.currentTurnId;
    this.turnResolved = false;

    this.isCapturingCommand = true;
    this.commandChunks = [];
    this.setState('capturing');
    this.playReadyBeep();

    const SpeechRecognitionClass = this.getSpeechRecognitionClass();
    if (SpeechRecognitionClass) {
      this.startCommandRecognition(SpeechRecognitionClass, turnId);
    }

    // Prepare audio recorder as fallback for when text recognition yields nothing
    if (this.mediaStream) {
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(this.mediaStream, {mimeType});
        this.mediaRecorder = recorder;

        recorder.ondataavailable = (e) => {
          if (turnId === this.currentTurnId && !this.turnResolved && e.data && e.data.size > 0) {
            this.commandChunks.push(e.data);
          }
        };

        recorder.onstop = () => {
          this.isCapturingCommand = false;
          this.mediaRecorder = null;

          // CRITICAL FIX 2: Only submit audio fallback if text recognition did NOT resolve this turn
          if (turnId === this.currentTurnId && !this.turnResolved && this.commandChunks.length > 0) {
            this.turnResolved = true;
            const blob = new Blob(this.commandChunks, {type: mimeType});
            this.onCommandCaptured(blob);
          }
          this.commandChunks = [];

          if (this.isActive && !this.isSuspended) {
            this.startRecognition();
          }
        };

        recorder.start(100);

        // 10-second capture deadline
        this.commandTimeoutTimer = setTimeout(() => {
          if (turnId === this.currentTurnId && this.isCapturingCommand) {
            this.finishCommandCapture();
          }
        }, 10000);
      } catch {
        this.isCapturingCommand = false;
        if (this.isActive && !this.isSuspended) this.startRecognition();
      }
    }
  }

  private startCommandRecognition(SpeechRecognitionClass: any, turnId: number): void {
    try {
      const rec = new SpeechRecognitionClass();
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      this.commandRecognition = rec;

      rec.onresult = (event: any) => {
        // Prevent stale or duplicate results
        if (turnId !== this.currentTurnId || this.turnResolved) return;

        const rawTranscript = event.results[0]?.[0]?.transcript || '';
        const transcript = rawTranscript.trim();

        if (transcript.length > 0) {
          // CRITICAL FIX 2: Text recognition succeeded -> resolve turn immediately
          this.turnResolved = true;

          // Discard recorded chunks so recorder.onstop does NOT send audio blob
          this.commandChunks = [];

          // Strip any accidental repeated wake phrase from the command
          const match = matchWakePhrase(transcript, this.wakePhrase, this.aliases);
          const finalCommand = match.detected && match.commandAfter ? match.commandAfter : transcript;

          this.onCommandText?.(finalCommand);
          this.finishCommandCapture();
        }
      };

      rec.onerror = () => {
        // Text recognition failed -> let mediaRecorder handle the audio fallback
        this.stopCommandRecognition();
      };

      rec.onend = () => {
        this.stopCommandRecognition();
        // Give a short grace period for recorder chunks before closing
        setTimeout(() => {
          if (turnId === this.currentTurnId && this.isCapturingCommand && !this.turnResolved) {
            this.finishCommandCapture();
          }
        }, 400);
      };

      rec.start();
    } catch {
      // Fall through to audio recording fallback
    }
  }

  private stopCommandRecognition(): void {
    if (this.commandRecognition) {
      try { this.commandRecognition.stop(); } catch {}
      this.commandRecognition = null;
    }
  }

  private stopMediaRecorder(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch {}
      this.mediaRecorder = null;
    }
  }

  public finishCommandCapture(): void {
    if (this.commandTimeoutTimer) {
      clearTimeout(this.commandTimeoutTimer);
      this.commandTimeoutTimer = null;
    }
    this.stopCommandRecognition();
    this.stopMediaRecorder();
  }

  public cancelCommandCapture(): void {
    this.turnResolved = true;
    this.commandChunks = [];
    this.finishCommandCapture();
    this.isCapturingCommand = false;
    if (this.isActive && !this.isSuspended) {
      this.startRecognition();
    }
  }

  private playAckChime(): void {
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
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
      osc.frequency.setValueAtTime(1046, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch {}
  }
}
