'use client';
import {useEffect, useRef, useState} from 'react';
import {OfflineWakeDetector, type WakeDetectorState} from '../lib/offline-wake-detector';

export default function WakeWord({
  onCommand,
  onCommandAudio,
  onGreeting,
  currentPhrase = 'Hey Jarvis',
  onPhraseChange,
  paused = false
}: {
  onCommand: (command: string) => void;
  onCommandAudio?: (blob: Blob) => void;
  onGreeting: (startCapture?: () => void) => void;
  language?: string;
  currentPhrase?: string;
  onPhraseChange?: (phrase: string) => void;
  paused?: boolean;
}) {
  const [state, setState] = useState<WakeDetectorState>('disabled');
  const [problem, setProblem] = useState('');
  const [phrase, setPhrase] = useState(currentPhrase);
  const [sensitivity, setSensitivity] = useState<'high' | 'normal'>('high');
  const [showConfig, setShowConfig] = useState(false);

  const detectorRef = useRef<OfflineWakeDetector | null>(null);
  const commandRef = useRef(onCommand);
  const commandAudioRef = useRef(onCommandAudio);
  const greetRef = useRef(onGreeting);

  commandRef.current = onCommand;
  commandAudioRef.current = onCommandAudio;
  greetRef.current = onGreeting;

  // Auto-start listener on mount for zero-click "always listening" experience
  useEffect(() => {
    let savedPhrase = currentPhrase;
    try {
      const saved = localStorage.getItem('irfan_wake_phrase');
      if (saved) {
        savedPhrase = saved;
        setPhrase(saved);
        onPhraseChange?.(saved);
      }
    } catch {}

    const detector = new OfflineWakeDetector({
      wakePhrase: savedPhrase,
      sensitivity: 'high',
      onWakeDetected: (_detectedPhrase, startCapture) => {
        greetRef.current(startCapture);
      },
      onCommandCaptured: (audioBlob) => {
        if (commandAudioRef.current) {
          commandAudioRef.current(audioBlob);
        }
      },
      onStateChange: (s) => setState(s),
      onError: (err) => {
        setProblem(err);
        setState('unavailable');
      }
    });
    detectorRef.current = detector;

    // Start listening automatically
    void detector.start();

    return () => {
      detector.stop();
      detectorRef.current = null;
    };
  }, []);

  // Suspend/resume detector based on speech playback (Echo Prevention)
  useEffect(() => {
    if (!detectorRef.current) return;
    if (paused) {
      detectorRef.current.suspend();
    } else {
      detectorRef.current.resumeWithGrace(1500);
    }
  }, [paused]);

  function updatePhrase(newPhrase: string) {
    const clean = newPhrase.slice(0, 50);
    setPhrase(clean);
    try {
      localStorage.setItem('irfan_wake_phrase', clean);
    } catch {}
    detectorRef.current?.setWakePhrase(clean);
    onPhraseChange?.(clean);
  }

  function toggleStart() {
    if (detectorRef.current && (state === 'listening' || state === 'capturing' || state === 'suspended')) {
      detectorRef.current.stop();
      detectorRef.current = null;
      setState('disabled');
    } else {
      setProblem('');
      const detector = new OfflineWakeDetector({
        wakePhrase: phrase,
        sensitivity,
        onWakeDetected: (_detectedPhrase) => {
          greetRef.current();
        },
        onCommandCaptured: (audioBlob) => {
          if (commandAudioRef.current) {
            commandAudioRef.current(audioBlob);
          }
        },
        onStateChange: (s) => setState(s),
        onError: (err) => {
          setProblem(err);
          setState('unavailable');
        }
      });
      detectorRef.current = detector;
      void detector.start();
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
          state === 'listening'
            ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
            : state === 'capturing'
            ? 'bg-orange-950/40 border-orange-500 text-orange-200 animate-pulse shadow-[0_0_15px_rgba(249,115,22,0.3)]'
            : state === 'suspended'
            ? 'bg-cyan-950/20 border-cyan-800 text-cyan-400'
            : 'bg-slate-900/40 border-slate-700 text-slate-400'
        }`}
        onClick={toggleStart}
        title="Click to toggle always-listening mode"
      >
        <div className="flex items-center gap-2">
          {state === 'listening' && <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />}
          {state === 'capturing' && <span className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />}
          {state === 'suspended' && <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />}
          {state === 'disabled' && <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />}
          <div className="text-left">
            <div className="text-xs font-semibold tracking-wide">
              {state === 'listening'
                ? `ALWAYS LISTENING: “${phrase.toUpperCase()}”`
                : state === 'capturing'
                ? 'CAPTURING VOICE DIRECTIVE...'
                : state === 'suspended'
                ? 'ECHO SHIELD (JARVIS SPEAKING)'
                : 'SENSOR MUTED (CLICK TO ARM)'}
            </div>
            <div className="text-[10px] opacity-75">
              {state === 'listening'
                ? 'Speak anytime • Window auto-maximizes'
                : state === 'capturing'
                ? 'Listening to your command speech'
                : 'Zero remote audio • 100% on-device'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300"
          onClick={(e) => {
            e.stopPropagation();
            setShowConfig(!showConfig);
          }}
        >
          {showConfig ? 'Close' : 'Config'}
        </button>
      </div>

      {showConfig && (
        <div className="p-3 border border-cyan-800/80 rounded-lg bg-cyan-950/80 space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-cyan-300 font-semibold">Wake-Word Setup</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`px-1.5 py-0.5 rounded text-[10px] ${sensitivity === 'high' ? 'bg-cyan-500 text-black font-bold' : 'bg-cyan-950 text-cyan-300'}`}
                onClick={() => {
                  setSensitivity('high');
                  detectorRef.current?.setSensitivity('high');
                }}
              >
                High Sens.
              </button>
              <button
                type="button"
                className={`px-1.5 py-0.5 rounded text-[10px] ${sensitivity === 'normal' ? 'bg-cyan-500 text-black font-bold' : 'bg-cyan-950 text-cyan-300'}`}
                onClick={() => {
                  setSensitivity('normal');
                  detectorRef.current?.setSensitivity('normal');
                }}
              >
                Normal
              </button>
            </div>
          </div>
          <input
            className="input w-full text-xs py-1"
            value={phrase}
            onChange={(e) => updatePhrase(e.target.value)}
            placeholder="e.g. Hey Jarvis, Jarvis, Computer"
          />
          <div className="flex flex-wrap gap-1 text-[10px]">
            {['Hey Jarvis', 'Jarvis', 'Computer', 'Assistant'].map((preset) => (
              <button
                key={preset}
                type="button"
                className="px-2 py-0.5 rounded bg-cyan-900 hover:bg-cyan-800 text-cyan-200 border border-cyan-700/50"
                onClick={() => updatePhrase(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      )}

      {problem && (
        <p role="status" className="text-xs text-amber-300 bg-amber-950/50 p-2 rounded border border-amber-800">
          {problem}
        </p>
      )}
    </div>
  );
}
