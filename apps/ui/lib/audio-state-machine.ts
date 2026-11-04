// JARVIS Unified Audio State Machine
// Formally manages transitions between wake listening, command capture, processing,
// speech playback, and audio drain settling.
// Prevents self-response loops, duplicate command triggers, and stale turn collisions.

export type AudioState =
  | 'IDLE_LISTENING'
  | 'WAKE_DETECTED'
  | 'COMMAND_LISTENING'
  | 'PROCESSING'
  | 'SPEAKING'
  | 'AUDIO_DRAIN'
  | 'MUTED'
  | 'ERROR';

export interface StateMachineConfig {
  commandTimeoutMs?: number; // Max time to wait for a command after acknowledgment
  drainDurationMs?: number;   // Settling interval after speaker output ceases before mic re-arms
  cooldownMs?: number;        // Minimum cooldown between wake triggers
  onStateTransition?: (from: AudioState, to: AudioState, turnId: string) => void;
  onTimeout?: (turnId: string) => void;
  onStatusMessage?: (status: string) => void;
}

export interface WakeParseResult {
  hasWakeWord: boolean;
  cleanCommand: string;
  isWakeOnly: boolean;
}

export class AudioStateMachine {
  private state: AudioState = 'IDLE_LISTENING';
  private currentTurnId = '';
  private turnCounter = 0;
  private lastSpeechEndTime = 0;
  private lastWakeTime = 0;
  private commandTimer: any = null;
  private drainTimer: any = null;
  private recentSpokenPhrases: string[] = [];

  private readonly commandTimeoutMs: number;
  private readonly drainDurationMs: number;
  private readonly cooldownMs: number;
  private readonly onStateTransition?: (from: AudioState, to: AudioState, turnId: string) => void;
  private readonly onTimeout?: (turnId: string) => void;
  private readonly onStatusMessage?: (status: string) => void;

  // Known acknowledgment phrases to filter out from transcription
  private readonly builtInAcks = [
    'yes sir',
    'yes i am listening',
    'i am listening',
    'online sir',
    'at your service',
    'how may i assist you',
    'what can i do for you',
    'ready for instructions'
  ];

  constructor(config: StateMachineConfig = {}) {
    this.commandTimeoutMs = config.commandTimeoutMs ?? 5500;
    this.drainDurationMs = config.drainDurationMs ?? 900;
    this.cooldownMs = config.cooldownMs ?? 2500;
    this.onStateTransition = config.onStateTransition;
    this.onTimeout = config.onTimeout;
    this.onStatusMessage = config.onStatusMessage;
  }

  public getState(): AudioState {
    return this.state;
  }

  public getCurrentTurnId(): string {
    return this.currentTurnId;
  }

  public isListening(): boolean {
    return this.state === 'IDLE_LISTENING' || this.state === 'COMMAND_LISTENING';
  }

  public canAcceptMicrophoneInput(): boolean {
    // Only accept microphone audio when actively listening for commands or idle
    return this.state === 'IDLE_LISTENING' || this.state === 'COMMAND_LISTENING';
  }

  public isSpeakingOrDraining(): boolean {
    return this.state === 'SPEAKING' || this.state === 'AUDIO_DRAIN';
  }

  private transitionTo(newState: AudioState, turnId: string): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.onStateTransition?.(oldState, newState, turnId);
    this.onStatusMessage?.(this.getHumanStatus(newState));
  }

  public getHumanStatus(s: AudioState = this.state): string {
    switch (s) {
      case 'IDLE_LISTENING': return 'Listening for "Hey Jarvis"';
      case 'WAKE_DETECTED': return 'Wake phrase detected';
      case 'COMMAND_LISTENING': return 'Listening for command...';
      case 'PROCESSING': return 'Processing directive...';
      case 'SPEAKING': return 'Speaking...';
      case 'AUDIO_DRAIN': return 'Settling audio...';
      case 'MUTED': return 'Microphone muted';
      case 'ERROR': return 'Audio error';
    }
  }

  /**
   * Parse a raw transcript to identify wake word prefixes and extract inline commands.
   * Handles:
   * - "Hey Jarvis" (wake only)
   * - "Hey Jarvis, open Chrome" (wake + command)
   * - "Open Chrome" (direct command)
   */
  public parseTranscript(rawText: string, customWakePhrase = 'Hey Jarvis'): WakeParseResult {
    const text = (rawText || '').trim();
    if (!text) {
      return {hasWakeWord: false, cleanCommand: '', isWakeOnly: false};
    }

    const wakeRegex = new RegExp(
      `^(?:${customWakePhrase}|hey\\s+jarvis|jarvis|okay\\s+jarvis|ok\\s+jarvis|computer)[,\\s!.]*`,
      'i'
    );

    const match = wakeRegex.exec(text);
    if (!match) {
      return {
        hasWakeWord: false,
        cleanCommand: text,
        isWakeOnly: false
      };
    }

    const matchedPrefix = match[0];
    const remainder = text.slice(matchedPrefix.length).trim();

    return {
      hasWakeWord: true,
      cleanCommand: remainder,
      isWakeOnly: remainder.length === 0
    };
  }

  /**
   * Evaluates if a given transcript is an echo of assistant-generated speech.
   */
  public isEcho(rawTranscript: string): boolean {
    const norm = (rawTranscript || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm || norm.length < 3) return false;

    // 1. Check against known acknowledgment phrases
    for (const ack of this.builtInAcks) {
      const normAck = ack.replace(/[^a-z0-9]/g, '');
      if (norm === normAck || norm.includes(normAck)) return true;
    }

    // 2. Check against recently spoken phrases from the assistant
    for (const recent of this.recentSpokenPhrases) {
      const normRecent = recent.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normRecent.length < 4) continue;
      if (norm.includes(normRecent) || normRecent.includes(norm)) return true;
      if (norm.length >= 8 && normRecent.includes(norm.slice(0, 10))) return true;
    }

    return false;
  }

  /**
   * Triggered when the wake word is detected.
   * Returns a unique turn ID if accepted, or null if rejected due to state/cooldown.
   */
  public onWakeDetected(inlineInstruction = ''): {accepted: boolean; turnId: string; inlineCommand?: string} {
    if (this.state === 'MUTED') {
      return {accepted: false, turnId: ''};
    }

    // If currently speaking or in audio drain, reject immediately to prevent self-loop
    if (this.state === 'SPEAKING' || this.state === 'AUDIO_DRAIN') {
      return {accepted: false, turnId: ''};
    }

    const now = Date.now();
    if (now - this.lastWakeTime < this.cooldownMs) {
      return {accepted: false, turnId: ''};
    }
    this.lastWakeTime = now;

    this.turnCounter++;
    const turnId = `turn_${Date.now()}_${this.turnCounter}`;
    this.currentTurnId = turnId;

    this.transitionTo('WAKE_DETECTED', turnId);

    // Case B: User said "Hey Jarvis, [instruction]" in a single utterance
    const trimmedInstruction = (inlineInstruction || '').trim();
    if (trimmedInstruction && trimmedInstruction.length >= 2 && !this.isEcho(trimmedInstruction)) {
      this.transitionTo('PROCESSING', turnId);
      return {
        accepted: true,
        turnId,
        inlineCommand: trimmedInstruction
      };
    }

    // Case A: User said wake phrase only ("Hey Jarvis")
    return {
      accepted: true,
      turnId
    };
  }

  /**
   * Called when JARVIS starts playing an acknowledgment ("Yes, sir?")
   * or a spoken response for the current turn.
   */
  public onSpeakingStart(text: string, turnId = this.currentTurnId): boolean {
    if (turnId !== this.currentTurnId) {
      // Reject stale turns
      return false;
    }

    this.clearCommandTimer();
    this.clearDrainTimer();

    // Track phrase in recent spoken history ring buffer (keep last 10)
    if (text && text.trim()) {
      this.recentSpokenPhrases.push(text.trim());
      if (this.recentSpokenPhrases.length > 10) {
        this.recentSpokenPhrases.shift();
      }
    }

    this.transitionTo('SPEAKING', turnId);
    return true;
  }

  /**
   * Called when acknowledgment speech finishes.
   * Transitions to COMMAND_LISTENING and starts the timeout countdown.
   */
  public onAcknowledgmentComplete(turnId = this.currentTurnId): void {
    if (turnId !== this.currentTurnId) return;

    this.transitionTo('COMMAND_LISTENING', turnId);

    // Case D: If user remains silent, time out gracefully
    this.clearCommandTimer();
    this.commandTimer = setTimeout(() => {
      if (this.state === 'COMMAND_LISTENING' && this.currentTurnId === turnId) {
        this.onTimeout?.(turnId);
        this.transitionTo('IDLE_LISTENING', turnId);
      }
    }, this.commandTimeoutMs);
  }

  /**
   * Called when a command directive has been captured and submitted for execution.
   */
  public onCommandSubmitted(command: string, turnId = this.currentTurnId): boolean {
    if (turnId !== this.currentTurnId) {
      return false;
    }

    this.clearCommandTimer();

    // Check anti-echo defense
    if (this.isEcho(command)) {
      this.transitionTo('IDLE_LISTENING', turnId);
      return false;
    }

    this.transitionTo('PROCESSING', turnId);
    return true;
  }

  /**
   * Called when speech playback finishes.
   * Moves into AUDIO_DRAIN to allow room reverberation and speaker decay to settle.
   */
  public onSpeakingComplete(turnId = this.currentTurnId): void {
    if (turnId !== this.currentTurnId) {
      return;
    }

    this.lastSpeechEndTime = Date.now();
    this.transitionTo('AUDIO_DRAIN', turnId);

    this.clearDrainTimer();
    this.drainTimer = setTimeout(() => {
      if (this.state === 'AUDIO_DRAIN') {
        this.transitionTo('IDLE_LISTENING', turnId);
      }
    }, this.drainDurationMs);
  }

  /**
   * Cancel or interrupt active playback, generation, or command listening.
   */
  public interrupt(): void {
    this.clearCommandTimer();
    this.clearDrainTimer();

    const turnId = this.currentTurnId;
    this.lastSpeechEndTime = Date.now();

    // Brief drain to settle interrupted output
    this.transitionTo('AUDIO_DRAIN', turnId);
    this.drainTimer = setTimeout(() => {
      this.transitionTo('IDLE_LISTENING', turnId);
    }, Math.min(300, this.drainDurationMs));
  }

  /**
   * User or tray toggled microphone mute.
   */
  public setMuted(muted: boolean): void {
    this.clearCommandTimer();
    this.clearDrainTimer();

    if (muted) {
      this.transitionTo('MUTED', this.currentTurnId);
    } else {
      this.transitionTo('IDLE_LISTENING', this.currentTurnId);
    }
  }

  /**
   * Handle Windows sleep/suspend.
   */
  public onSystemSuspend(): void {
    this.clearCommandTimer();
    this.clearDrainTimer();
    this.transitionTo('MUTED', this.currentTurnId);
  }

  /**
   * Handle Windows resume from sleep.
   */
  public onSystemResume(): void {
    // Graceful recovery to idle listening
    this.lastWakeTime = Date.now();
    this.transitionTo('IDLE_LISTENING', this.currentTurnId);
  }

  private clearCommandTimer(): void {
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
  }

  private clearDrainTimer(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  public reset(): void {
    this.clearCommandTimer();
    this.clearDrainTimer();
    this.currentTurnId = '';
    this.recentSpokenPhrases = [];
    this.state = 'IDLE_LISTENING';
  }
}
