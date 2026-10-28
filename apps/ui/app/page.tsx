'use client';
import {useState, useRef, useEffect} from 'react';
import dynamic from 'next/dynamic';
import Wave from '../components/Wave';
import EmailPanel from '../components/EmailPanel';
import VideoPanel from '../components/VideoPanel';
import WakeWord from '../components/WakeWord';
import AndroidPanel from '../components/AndroidPanel';
import DevicesPanel from '../components/DevicesPanel';
import DesktopPermissions from '../components/DesktopPermissions';
import RemoteInbox from '../components/RemoteInbox';
import WhatsAppPanel, {type WhatsAppNative} from '../components/WhatsAppPanel';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import PersonaManager from '../components/PersonaManager';
import SchedulerPanel from '../components/SchedulerPanel';
import {isAndroid, nativeCall} from '../lib/android';
import {AudioStreamer} from '../lib/audio-streamer';
import {SpeechChunker} from '../lib/speech-chunker';
import {runAgentLoop, cleanSpeech} from '../lib/agent-loop';

const Core = dynamic(() => import('../components/Core'), {ssr: false});
type Line = {role: 'user' | 'assistant'; content: string; time?: string};
type TimingMetrics = {
  firstTextMs?: number;
  firstSentenceMs?: number;
  firstAudioMs?: number;
  playStartMs?: number;
  totalMs?: number;
  ttsEngine?: string;
  fastPath?: boolean;
  utteranceIntervalMs?: number;
  voiceName?: string;
};

declare global {
  interface Window {
    irfan?: WhatsAppNative & {
      platform: string;
      version: string;
      desktopDiagnostics?: () => Promise<any>;
      listTools: () => Promise<Array<{name: string; risk: string; description: string}>>;
      listPolicies?: () => Promise<Array<{name: string; risk: string; minimum: string}>>;
      setPolicy?: (name: string, risk: string) => Promise<any>;
      checkUpdates?: () => Promise<any>;
      downloadUpdate?: () => Promise<any>;
      installUpdate?: () => Promise<any>;
      onUpdateStatus?: (fn: (update: any) => void) => () => void;
      propose: (name: string, args: unknown) => Promise<any>;
      decide: (id: string, approved: boolean) => Promise<any>;
      videoPropose: (kind: string, plan?: unknown) => Promise<any>;
      videoDecide: (id: string, approved: boolean) => Promise<any>;
      openExternal: (url: string) => Promise<void>;
      loadSettings?: () => Promise<{status: string; apiUrl?: string; token?: string; isDev?: boolean; defaultDevApi?: string}>;
      saveSettings?: (apiUrl: string, token: string) => Promise<{status: string}>;
      onVideoProgress?: (listener: (detail: any) => void) => () => void;
      onGlobalPtt?: (handler: () => void) => () => void;
      showAndFocus?: () => Promise<any>;
      maximizeWindow?: () => Promise<any>;
      minimizeWindow?: () => Promise<any>;
    };
  }
}

function isActionOrToolRequest(message: string): boolean {
  const m = message.trim();
  if (/^(?:hi|hello|hey|greetings|good (?:morning|afternoon|evening)|thanks|thank you|who are you|what is your name|are you (?:there|online|listening)|status check|ping)[.!?\s]*$/i.test(m)) {
    return false;
  }
  if (/^(?:what|why|how|who|when|where|can you explain|tell me about|explain)\b/i.test(m)) {
    return false;
  }
  const actionVerbs = /\b(?:open|launch|start|run|close|kill|terminate|switch to|turn on|turn off|set|adjust|increase|decrease|mute|unmute|volume|brightness|dark mode|light mode|lock|sleep|shutdown|restart|reboot|screenshot|capture|clipboard|copy|paste|search youtube|play on youtube|play|search google|google|find file|move file|delete file|remove file|inspect ui|summarize|read this page|find in page|maximize|minimize|restore|focus|whatsapp|gmail|email)\b/i;
  return actionVerbs.test(m);
}

const DEFAULT_API = process.env.NEXT_PUBLIC_IRFAN_API_URL || 'http://127.0.0.1:8787';

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => {
      try {
        blob.arrayBuffer().then(buf => {
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          resolve(btoa(binary));
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsDataURL(blob);
  });
}

export default function Home() {
  const [waDraft, setWaDraft] = useState<{nonce: number; recipient: string; body: string} | null>(null);
  const [toolName, setToolName] = useState('list_running_apps');
  const [toolArgs, setToolArgs] = useState('{}');
  const [toolList, setToolList] = useState<Array<{name: string; risk: string; description: string}>>([]);
  const [pending, setPending] = useState<{id: string; tool: string; args: unknown} | null>(null);
  const [toolResult, setToolResult] = useState('');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [isDevMode, setIsDevMode] = useState(false);
  const [mobilePaired, setMobilePaired] = useState(false);
  const [isMobileApp, setIsMobileApp] = useState(false);
  const [engine, setEngine] = useState<'local' | 'fal'>('local');
  const [unreadIds, setUnreadIds] = useState<string[]>([]);
  const [tab, setTab] = useState<'console' | 'personas' | 'scheduler' | 'email' | 'video' | 'android' | 'devices' | 'whatsapp' | 'settings' | 'devtools'>('console');
  const [voiceMode, setVoiceMode] = useState<'local' | 'cloud'>('local');
  const speechQueueRef = useRef<Array<{text: string; onFirstAudio?: () => void}>>([]);
  const isSpeakingChunkRef = useRef(false);
  const activeUtterancesRef = useRef(0);
  const lastChunkEndRef = useRef(0);
  const [metaVoices, setMetaVoices] = useState<{male?: string; female?: string}>({});
  
  // Persistent Conversation History
  const [messages, setMessages] = useState<Line[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Real-Time Hollywood Telemetry Logs
  const [telemetryLogs, setTelemetryLogs] = useState<string[]>([
    'JARVIS KERNEL v3.0 ONLINE',
    'ACOUSTIC RECOGNITION ARMED',
    'WIN32 RUNTIME AUTOMATION READY'
  ]);

  const [input, setInput] = useState('');
  const [persona, setPersona] = useState('jarvis');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [language, setLanguage] = useState('auto');
  const [low, setLow] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [memories, setMemories] = useState<Array<{id: string; fact: string; importance: number}>>([]);
  const [fact, setFact] = useState('');
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<TimingMetrics | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const utterance = useRef<HTMLAudioElement | null>(null);
  const stop = useRef<AbortController | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const lastSpokenUtteranceRef = useRef<string>('');
  const recentSpokenPhrasesRef = useRef<string[]>([]);
  const isAudioPlayingRef = useRef<boolean>(false);
  const lastSpeechEndTimeRef = useRef<number>(0);

  function changePersona(p: string) {
    setPersona(p);
    try { localStorage.setItem('jarvis_persona', p); } catch {}
  }

  function changeGender(g: 'male' | 'female') {
    setGender(g);
    try { localStorage.setItem('jarvis_gender', g); } catch {}
  }

  const auth = () => ({Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'});
  const isLocalWorker = apiUrl.includes('127.0.0.1:8787') || apiUrl.includes('localhost:8787');

  function addTelemetry(text: string) {
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    setTelemetryLogs(prev => [...prev.slice(-7), `${time} ${text}`]);
  }

  // Restore conversation history, persona, and voice gender from localStorage on load
  useEffect(() => {
    try {
      const savedPersona = localStorage.getItem('jarvis_persona');
      if (savedPersona) setPersona(savedPersona);
      const savedGender = localStorage.getItem('jarvis_gender');
      if (savedGender === 'male' || savedGender === 'female') setGender(savedGender);
      const saved = localStorage.getItem('jarvis_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch {}
    // Initial welcome if history was empty
    setMessages([{
      role: 'assistant',
      content: 'JARVIS initialized and ready. Always listening for "Hey Jarvis", or ask me to open apps, stream on YouTube, or manage your desktop.',
      time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
    }]);
  }, []);

  // Save history on changes and smooth auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem('jarvis_chat_history', JSON.stringify(messages.slice(-50)));
      } catch {}
    }
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages]);

  function clearChatHistory() {
    setMessages([{
      role: 'assistant',
      content: 'Conversation history reset. System ready for directives.',
      time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
    }]);
    try {
      localStorage.removeItem('jarvis_chat_history');
    } catch {}
    addTelemetry('[TELEMETRY: CHAT HISTORY RESET]');
  }

  const request = async (route: string, init: RequestInit = {}) => {
    if (isAndroid()) {
      const verb = (init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
      const result = await nativeCall('api', {route, verb, body});
      return result && Array.isArray(result.items) ? result.items : result;
    }
    const r = await fetch((apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl) + route, {
      ...init,
      headers: {...auth(), ...(init.headers || {})}
    });
    if (!r.ok) throw Error('API ' + r.status + ' ' + (await r.text()));
    return r.json();
  };

  const reload = async () => {
    try {
      setMemories(await request('/memories'));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };

  // Initialize Web Audio streamer for low-latency PCM chunks
  function getStreamer(): AudioStreamer {
    if (!streamerRef.current) {
      streamerRef.current = new AudioStreamer({
        sampleRate: 24000,
        onPlaybackStart: () => {
          isAudioPlayingRef.current = true;
          setSpeaking(true);
        },
        onPlaybackEnd: () => {
          isAudioPlayingRef.current = false;
          lastSpeechEndTimeRef.current = Date.now();
          setSpeaking(false);
        },
        onError: (err) => console.warn('[AudioStreamer error]', err)
      });
    }
    return streamerRef.current;
  }

  function enqueueSpeech(text: string, onFirstAudio?: () => void) {
    const clean = cleanSpeech(text);
    if (!clean) return;
    isAudioPlayingRef.current = true;
    setSpeaking(true);
    const norm = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm) {
      recentSpokenPhrasesRef.current.push(norm);
      if (recentSpokenPhrasesRef.current.length > 30) recentSpokenPhrasesRef.current.shift();
    }
    speechQueueRef.current.push({text: clean, onFirstAudio});
    void processSpeechQueue();
  }

  async function processSpeechQueue() {
    if (isSpeakingChunkRef.current || speechQueueRef.current.length === 0) return;
    const item = speechQueueRef.current.shift();
    if (!item) return;
    isSpeakingChunkRef.current = true;
    try {
      await speakChunk(item.text, item.onFirstAudio);
    } finally {
      isSpeakingChunkRef.current = false;
      if (speechQueueRef.current.length > 0) {
        void processSpeechQueue();
      } else if (voiceMode !== 'local' || activeUtterancesRef.current <= 0) {
        isAudioPlayingRef.current = false;
        lastSpeechEndTimeRef.current = Date.now();
        setSpeaking(false);
      }
    }
  }

  async function speakChunk(text: string, onFirstAudio?: () => void) {
    const clean = cleanSpeech(text);
    if (!clean) return;

    lastSpokenUtteranceRef.current = clean;
    isAudioPlayingRef.current = true;
    setSpeaking(true);
    const norm = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm) {
      recentSpokenPhrasesRef.current.push(norm);
      if (recentSpokenPhrasesRef.current.length > 30) recentSpokenPhrasesRef.current.shift();
    }

    if (voiceMode === 'local') {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      const utter = new SpeechSynthesisUtterance(clean);
      const voices = window.speechSynthesis.getVoices();
      let selectedVoiceName = 'Default Windows Voice';

      if (voices && voices.length) {
        let match: SpeechSynthesisVoice | undefined;
        if (gender === 'male') {
          match =
            voices.find(v => v.lang.startsWith('en') && v.localService && /david|mark|george|guy|christopher|eric|stefan/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && /david|mark|george|guy|christopher|eric|stefan/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && !/zira|susan|hazel|jenny|aria|elena|catherine|linda/i.test(v.name)) ||
            voices[0];
        } else {
          match =
            voices.find(v => v.lang.startsWith('en') && v.localService && /zira|susan|hazel|jenny|aria|elena|catherine|linda/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && /zira|susan|hazel|jenny|aria|elena|catherine|linda/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && !/david|mark|george|guy|christopher|eric|stefan/i.test(v.name)) ||
            voices[0];
        }

        if (match) {
          utter.voice = match;
          selectedVoiceName = `${match.name}${match.localService ? ' (localService)' : ''}`;
        }
      }

      activeUtterancesRef.current++;
      utter.onstart = () => {
        isAudioPlayingRef.current = true;
        setSpeaking(true);
        onFirstAudio?.();
        const now = performance.now();
        const gap = lastChunkEndRef.current > 0 ? Math.round(now - lastChunkEndRef.current) : 0;
        setMetrics(m => ({
          ...m,
          ttsEngine: 'local-speech-synthesis',
          voiceName: selectedVoiceName,
          utteranceIntervalMs: gap
        }));
      };

      utter.onend = () => {
        lastChunkEndRef.current = performance.now();
        activeUtterancesRef.current--;
        if (activeUtterancesRef.current <= 0) {
          activeUtterancesRef.current = 0;
          isAudioPlayingRef.current = false;
          lastSpeechEndTimeRef.current = Date.now();
          setSpeaking(false);
        }
      };

      utter.onerror = () => {
        activeUtterancesRef.current = Math.max(0, activeUtterancesRef.current - 1);
        if (activeUtterancesRef.current <= 0) {
          isAudioPlayingRef.current = false;
          lastSpeechEndTimeRef.current = Date.now();
          setSpeaking(false);
        }
      };

      window.speechSynthesis.speak(utter);
      return;
    }

    // Cloud Streaming via Gemini Interactions
    const st = getStreamer();
    const preferredVoice = gender === 'male' ? metaVoices.male || 'Puck' : metaVoices.female || 'Kore';
    const ttsCtrl = new AbortController();
    ttsAbortRef.current = ttsCtrl;

    try {
      const res = await fetch(apiUrl.replace(/\/$/, '') + '/tts/stream', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
          text: clean,
          persona,
          gender,
          voice: preferredVoice,
          language: language === 'auto' ? 'en' : language
        }),
        signal: ttsCtrl.signal
      });

      if (!res.ok || !res.body) throw new Error('TTS HTTP ' + res.status);

      const rd = res.body.getReader(),
        decoder = new TextDecoder();
      let buf = '',
        firstChunk = false;

      while (true) {
        const {done, value} = await rd.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        const blocks = buf.split('\n\n');
        buf = blocks.pop() || '';
        for (const block of blocks) {
          const lines = block.split('\n');
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine);
            if (ev.audio) {
              if (!firstChunk) {
                firstChunk = true;
                onFirstAudio?.();
                setMetrics(m => (m ? {...m, ttsEngine: 'cloud-stream'} : null));
              }
              st.queuePcmBase64(ev.audio);
            }
          } catch {}
        }
      }
    } catch (err) {
      if (ttsCtrl.signal.aborted) return;
      console.warn('[Cloud TTS Fallback to Local SpeechSynthesis]', err);
      return new Promise<void>(resolve => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          resolve();
          return;
        }
        setMetrics(m => (m ? {...m, ttsEngine: 'cloud-fallback-to-local'} : null));
        const utter = new SpeechSynthesisUtterance(clean);
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length) {
          const match =
            voices.find(v => v.lang.startsWith('en') && (gender === 'male' ? /david|mark|george/i.test(v.name) : /zira|susan|hazel/i.test(v.name))) ||
            voices.find(v => v.lang.startsWith('en')) ||
            voices[0];
          if (match) utter.voice = match;
        }
        utter.onstart = () => {
          setSpeaking(true);
          onFirstAudio?.();
        };
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    }
  }

  async function play(text: string) {
    const clean = cleanSpeech(text);
    if (!clean) return;
    isAudioPlayingRef.current = true;
    setSpeaking(true);
    getStreamer().ensureContext();
    enqueueSpeech(clean);
  }

  async function playWithCallback(text: string, onEnd?: () => void) {
    const clean = cleanSpeech(text);
    if (!clean) {
      onEnd?.();
      return;
    }
    isAudioPlayingRef.current = true;
    setSpeaking(true);
    const norm = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm) {
      recentSpokenPhrasesRef.current.push(norm);
      if (recentSpokenPhrasesRef.current.length > 30) recentSpokenPhrasesRef.current.shift();
    }

    if (voiceMode === 'local' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(clean);
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) {
        let match: SpeechSynthesisVoice | undefined;
        if (gender === 'male') {
          match =
            voices.find(v => v.lang.startsWith('en') && v.localService && /david|mark|george|guy|christopher|eric|stefan/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && /david|mark|george|guy|christopher|eric|stefan/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && !/zira|susan|hazel|jenny|aria|elena|catherine|linda/i.test(v.name)) ||
            voices[0];
        } else {
          match =
            voices.find(v => v.lang.startsWith('en') && v.localService && /zira|susan|hazel|jenny|aria|elena|catherine|linda/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && /zira|susan|hazel|jenny|aria|elena|catherine|linda/i.test(v.name)) ||
            voices.find(v => v.lang.startsWith('en') && !/david|mark|george|guy|christopher|eric|stefan/i.test(v.name)) ||
            voices[0];
        }
        if (match) utter.voice = match;
      }

      utter.onstart = () => {
        isAudioPlayingRef.current = true;
        setSpeaking(true);
      };

      const finish = () => {
        isAudioPlayingRef.current = false;
        lastSpeechEndTimeRef.current = Date.now();
        setSpeaking(false);
        onEnd?.();
      };

      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.speak(utter);
      return;
    }

    try {
      await play(clean);
    } finally {
      isAudioPlayingRef.current = false;
      lastSpeechEndTimeRef.current = Date.now();
      setSpeaking(false);
      onEnd?.();
    }
  }

  function interrupt() {
    speechQueueRef.current = [];
    isSpeakingChunkRef.current = false;
    activeUtterancesRef.current = 0;
    lastChunkEndRef.current = 0;
    isAudioPlayingRef.current = false;
    lastSpeechEndTimeRef.current = Date.now();
    stop.current?.abort();
    ttsAbortRef.current?.abort();
    streamerRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    utterance.current?.pause();
    utterance.current = null;
    setSpeaking(false);
    setBusy(false);
    addTelemetry('[SPEECH INTERRUPTED]');
  }

  async function send(value = input) {
    getStreamer().ensureContext();
    const message = value.trim();
    if (!message) return;
    if (!token && !mobilePaired) {
      setError('Jarvis is not connected to a backend. Open Settings and enter an APP_TOKEN matching your Worker.');
      return;
    }
    interrupt();
    setInput('');
    setError('');

    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const history = messages.slice(-12);

    // ── Instant Optimistic UI Update ──
    setMessages(prev => [...prev, {role: 'user', content: message, time: timeStr}]);
    addTelemetry(`[DIRECTIVE RECEIVED: "${message.slice(0, 40)}"]`);

    // ── Instant Snappy Audio Acknowledgment so User Never Feels Stuck ──
    if (isActionOrToolRequest(message)) {
      const snappyAcks = ['On it.', 'Processing.', 'Right away.', 'Checking that for you.'];
      const ack = snappyAcks[Math.floor(Math.random() * snappyAcks.length)];
      addTelemetry(`[SNAPPY ACKNOWLEDGMENT: "${ack}"]`);
      void play(ack);
    }

    if (isAndroid()) {
      const w = /^(?:send|write|compose)\s+(?:a\s+)?(?:whatsapp|wa)(?:\s+message)?\s+to\s+(\+?[0-9][0-9 ()-]{6,20})\s+(?:saying|that\s+says|message)\s+([\s\S]+)$/i.exec(message);
      if (w) {
        try {
          const to = w[1].replace(/[^0-9]/g, ''),
            body = w[2].trim();
          if (!/^[1-9]\d{6,15}$/.test(to) || !body || body.length > 4000) throw Error('Provide a valid international number and 1–4000 characters');
          const r = await request('/relay/submit', {method: 'POST', body: JSON.stringify({target: 'pc', tool: 'whatsapp_draft', args: {to, body}})});
          setMessages(prev => [...prev, {role: 'assistant', content: 'WhatsApp draft queued for PC confirmation. Task: ' + r.id, time: timeStr}]);
        } catch (e) {
          setError(String(e));
        }
        return;
      }
    }

    if (!isAndroid() && window.irfan) {
      const waSend = /^(?:send|write|compose)\s+(?:a\s+)?(?:whatsapp|wa)(?:\s+message)?\s+to\s+(.+?)\s+(?:saying|that\s+says|message)\s+([\s\S]+)$/i.exec(message);
      if (waSend) {
        setWaDraft({nonce: Date.now(), recipient: waSend[1].trim(), body: waSend[2].trim()});
        setTab('whatsapp');
        setMessages(prev => [...prev, {role: 'assistant', content: 'Prepared WhatsApp message. Review and approve before sending.', time: timeStr}]);
        return;
      }
    }

    if (/^(use (free )?local (tools|engine)|switch to local)$/i.test(message)) {
      setEngine('local');
      setTab('video');
      setMessages(prev => [...prev, {role: 'assistant', content: 'Free local video engine is active.', time: timeStr}]);
      return;
    }
    if (/^(use fal( ai)?|switch to fal( ai)?)$/i.test(message)) {
      setEngine('fal');
      setTab('video');
      setMessages(prev => [...prev, {role: 'assistant', content: 'fal.ai paid video engine selected.', time: timeStr}]);
      return;
    }
    if (/^(read my (new|unread) emails|any new emails\??)$/i.test(message)) {
      try {
        const data = await request('/email/unread-summary');
        setUnreadIds(data.emails.map((e: {id: string}) => e.id));
        setMessages(prev => [...prev, {role: 'assistant', content: data.spoken, time: timeStr}]);
        await play(data.spoken);
      } catch (e) {
        setError(String(e));
      }
      return;
    }

    // ── Multi-Step Bounded Agent Loop for Desktop & Browser Automation ──
    if (window.irfan && isActionOrToolRequest(message)) {
      setBusy(true);
      try {
        const agentResult = await runAgentLoop({
          message,
          tools: toolList,
          propose: window.irfan.propose,
          requestBackend: request,
          onDiagnostic: (line) => addTelemetry(line)
        });

        if (agentResult.done && agentResult.finalReply) {
          setMessages(prev => [...prev, {role: 'assistant', content: agentResult.finalReply!, time: timeStr}]);
          await play(agentResult.spokenReply || agentResult.finalReply);
          setBusy(false);
          return;
        }

        if (agentResult.confirmationRequired) {
          setPending(agentResult.confirmationRequired);
          setMessages(prev => [
            ...prev,
            {role: 'assistant', content: agentResult.finalReply || 'Please approve or deny this action on the confirmation card.', time: timeStr}
          ]);
          setBusy(false);
          return;
        }
      } catch (err) {
        console.warn('[Agent loop error, falling back to chat]', err);
      } finally {
        setBusy(false);
      }
    }

    if (isAndroid()) {
      setBusy(true);
      try {
        const r = await request('/chat', {method: 'POST', body: JSON.stringify({message, persona, language: language === 'auto' ? '' : language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', history})});
        const answer = String(r.text || 'No response from Jarvis');
        setMessages(prev => [...prev, {role: 'assistant', content: answer, time: timeStr}]);
        await play(answer);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── Desktop Streaming Conversational Pipeline ──
    setMessages(prev => [...prev, {role: 'assistant', content: '', time: timeStr}]);
    setBusy(true);

    const t0 = performance.now();
    let tFirstText: number | undefined;
    let tFirstSentence: number | undefined;
    let tFirstAudio: number | undefined;
    let tPlayStart: number | undefined;

    const controller = new AbortController();
    stop.current = controller;
    const chunker = new SpeechChunker({minWords: 6, minChars: 45, maxChars: 240});
    let replyText = '';

    // Safety timeout: abort if stalled for > 12s so message is NEVER lost in limbo
    const networkTimeout = setTimeout(() => {
      controller.abort();
    }, 12000);

    try {
      const res = await fetch(apiUrl.replace(/\/$/, '') + '/chat', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({message, persona, language: language === 'auto' ? '' : language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', history}),
        signal: controller.signal
      });

      clearTimeout(networkTimeout);
      if (!res.ok || !res.body) throw Error('Chat failed with HTTP ' + res.status);

      const rd = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const {done, value} = await rd.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const kind = block.match(/^event: (.*)$/m)?.[1],
            data = block.match(/^data: (.*)$/m)?.[1];
          if (!data) continue;
          const payload = JSON.parse(data);
          if (kind === 'meta') {
            // Keep user selected persona stable unless explicit prompt requested
            if (payload.voiceMale || payload.voiceFemale) setMetaVoices({male: payload.voiceMale, female: payload.voiceFemale});
          }
          if (kind === 'error') throw Error(payload.message);
          if (kind === 'delta') {
            if (!tFirstText) {
              tFirstText = Math.round(performance.now() - t0);
            }
            replyText += payload.text;
            setMessages(old => old.map((m, i) => (i === old.length - 1 ? {...m, content: replyText} : m)));

            const chunks = chunker.push(payload.text);
            for (const chunk of chunks) {
              if (chunk.length > 0 && !controller.signal.aborted) {
                if (!tFirstSentence) {
                  tFirstSentence = Math.round(performance.now() - t0);
                }
                enqueueSpeech(chunk, () => {
                  if (!tFirstAudio) {
                    tFirstAudio = Math.round(performance.now() - t0);
                    tPlayStart = tFirstAudio;
                    setMetrics(m => ({
                      ...m,
                      firstTextMs: tFirstText,
                      firstSentenceMs: tFirstSentence,
                      firstAudioMs: tFirstAudio,
                      playStartMs: tPlayStart,
                      ttsEngine: voiceMode === 'local' ? 'local-speech-synthesis' : 'cloud-stream'
                    }));
                  }
                });
              }
            }
          }
        }
      }

      const remainingChunks = chunker.flush();
      for (const chunk of remainingChunks) {
        if (chunk.length > 0 && !controller.signal.aborted) {
          enqueueSpeech(chunk, () => {
            if (!tFirstAudio) {
              tFirstAudio = Math.round(performance.now() - t0);
              tPlayStart = tFirstAudio;
            }
          });
        }
      }

      const totalMs = Math.round(performance.now() - t0);
      setMetrics(m => ({
        ...m,
        firstTextMs: tFirstText,
        firstSentenceMs: tFirstSentence,
        firstAudioMs: tFirstAudio,
        playStartMs: tPlayStart,
        totalMs,
        ttsEngine: m?.ttsEngine || (voiceMode === 'local' ? 'local-speech-synthesis' : 'cloud-stream')
      }));
    } catch (e: any) {
      clearTimeout(networkTimeout);
      if (!controller.signal.aborted) {
        const errMsg = String(e?.message || e);
        setError(errMsg);
        setMessages(old => old.map((m, i) => (i === old.length - 1 ? {...m, content: `Chat response unavailable: ${errMsg}. Please try again.`} : m)));
      }
    } finally {
      setBusy(false);
    }
  }

  // Handle command speech recorded via offline wake detector
  async function handleWakeCommandAudio(blob: Blob) {
    if (!token && !mobilePaired) return;
    // Hard Echo Gate: Never transcribe if audio playing or ended within 1200ms
    if (isAudioPlayingRef.current || Date.now() - lastSpeechEndTimeRef.current < 1200) {
      console.warn('[ECHO GATE: Discarded audio recorded during or immediately after assistant speech]');
      return;
    }

    try {
      setBusy(true);
      const base64 = await blobToBase64(blob);
      const res = await request('/stt', {
        method: 'POST',
        body: JSON.stringify({
          audio: base64,
          mime: blob.type.split(';')[0]
        })
      });
      if (res?.text) {
        const heard = res.text.trim();
        if (!heard || heard.length < 2) return;

        const normHeard = heard.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. HARD ANTI-ECHO GATE A: Drop if matches any known self-greeting phrase
        const selfPhrases = [
          'yesiamlistening',
          'iamlistening',
          'listening',
          'onlinesir',
          'howmayiassistyou',
          'atyourservice',
          'jarvisonline',
          'whatcanidoforyou',
          'processing',
          'hellohowmayiassist'
        ];
        if (selfPhrases.some(p => normHeard.includes(p) || (normHeard.length >= 6 && p.includes(normHeard)))) {
          console.warn('[ECHO GATE: Rejected self-greeting echo]', heard);
          return;
        }

        // 2. HARD ANTI-ECHO GATE B: Drop if matches any recently spoken assistant text from last 60 seconds
        const matchesRecent = recentSpokenPhrasesRef.current.some(recent => {
          if (recent.length < 4) return false;
          return normHeard.includes(recent) || recent.includes(normHeard) ||
                 (normHeard.length >= 8 && recent.includes(normHeard.slice(0, 10)));
        });
        if (matchesRecent) {
          console.warn('[ECHO GATE: Rejected recent assistant speech echo]', heard);
          return;
        }

        // 3. Extract the directive (strip leading wake word prefixes)
        const cleanDirective = heard.replace(/^(?:hey\s+jarvis|okay\s+jarvis|jarvis|computer|hello\s+jarvis)[,\s]*/i, '').trim();

        if (!cleanDirective || cleanDirective.length < 2) {
          // User said wake phrase only; remain in standby without looping self-speech
          addTelemetry('[WAKE SENSOR: LISTENING FOR DIRECTIVE]');
          return;
        }

        // User spoke a valid directive (e.g. "open calculator" or "what time is it")
        addTelemetry(`[VOICE DIRECTIVE DISPATCHED: "${cleanDirective}"]`);
        void send(cleanDirective);
      }
    } catch (err) {
      console.warn('[Wake command transcription error]', err);
    } finally {
      setBusy(false);
    }
  }

  async function startMic() {
    if (!token) {
      setError('Configure APP_TOKEN in Settings before microphone transcription.');
      return;
    }
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Error('Microphone not supported');
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      ctx = new AudioContext();
      audioCtx.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 64;
      src.connect(node);
      analyser.current = node;

      const rec = new MediaRecorder(stream, {mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'});
      recorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        setRecording(false);
        const blob = new Blob(chunks.current, {type: rec.mimeType});
        try {
          const base64 = await blobToBase64(blob);
          const result = await request('/stt', {method: 'POST', body: JSON.stringify({audio: base64, mime: blob.type.split(';')[0]})});
          if (result?.text) void send(result.text);
        } catch (e) {
          setError(String(e));
        } finally {
          stream?.getTracks().forEach(t => t.stop());
          void ctx?.close();
        }
      };
      rec.start();
      setRecording(true);
      setError('');
    } catch (e) {
      setRecording(false);
      setError(String(e));
    }
  }

  function mic() {
    if (isAndroid()) {
      void nativeCall<{text: string}>('speech')
        .then(r => {
          if (r.text) void send(r.text);
        })
        .catch(e => setError(String(e)));
      return;
    }
    if (recording) {
      if (recorder.current?.state === 'recording') recorder.current.stop();
    } else void startMic();
  }

  useEffect(() => {
    if (isAndroid()) {
      setIsMobileApp(true);
      void nativeCall<{paired: boolean}>('session')
        .then(r => setMobilePaired(r.paired))
        .catch(() => {});
      const onPair = (e: Event) => setMobilePaired(Boolean((e as CustomEvent).detail?.paired));
      const onSpeech = (e: Event) => {
        const heard = (e as CustomEvent).detail?.text;
        if (heard) void send(heard);
      };
      window.addEventListener('irfan-paired', onPair);
      window.addEventListener('irfan-speech', onSpeech);
      return () => {
        window.removeEventListener('irfan-paired', onPair);
        window.removeEventListener('irfan-speech', onSpeech);
      };
    }
    void window.irfan?.listTools().then(setToolList).catch(() => {});
    void window.irfan
      ?.loadSettings?.()
      .then(v => {
        if (v.isDev) setIsDevMode(true);
        if (v.status === 'loaded' || v.token) {
          if (v.token) setToken(v.token);
          if (v.isDev) {
            setApiUrl(DEFAULT_API);
          } else if (v.apiUrl) {
            setApiUrl(v.apiUrl);
          }
        }
      })
      .catch(() => {});

    // In-window keyboard shortcut
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'm') || (e.ctrlKey && e.code === 'Space')) {
        e.preventDefault();
        mic();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Electron Global Push-to-Talk shortcut listener across all of Windows
    const cleanupGlobalPtt = window.irfan?.onGlobalPtt?.(() => {
      mic();
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cleanupGlobalPtt?.();
      stop.current?.abort();
      streamerRef.current?.stop();
    };
  }, []);

  async function tryTool() {
    try {
      if (!window.irfan) throw Error('Local tools require Electron');
      const out = await window.irfan.propose(toolName, JSON.parse(toolArgs));
      if (out.status === 'confirmation_required') setPending({id: out.id, tool: out.tool, args: out.args});
      else setToolResult(JSON.stringify(out));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function decideTool(approved: boolean) {
    if (!pending || !window.irfan) return;
    try {
      setToolResult(JSON.stringify(await window.irfan.decide(pending.id, approved)));
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }

  function maximizeDesktop() {
    if (typeof window !== 'undefined' && window.irfan?.maximizeWindow) {
      void window.irfan.maximizeWindow();
    }
  }

  function minimizeDesktop() {
    if (typeof window !== 'undefined' && window.irfan?.minimizeWindow) {
      void window.irfan.minimizeWindow();
    }
  }

  return (
    <main className={low ? 'low min-h-screen gridbg relative p-4 lg:p-6 w-full max-w-full overflow-x-hidden' : 'min-h-screen gridbg relative p-4 lg:p-6 w-full max-w-full overflow-x-hidden'}>
      <div className="scan absolute inset-0" />
      
      {/* Header bar */}
      <header className="flex flex-wrap justify-between items-center gap-3 mb-5 border-b border-cyan-900/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-cyan-950 border border-cyan-400 flex items-center justify-center shadow-[0_0_15px_rgba(0,234,255,0.4)]">
            <span className="text-cyan-300 font-extrabold text-sm tracking-tighter">J</span>
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-extrabold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 glow">
              FAHAD&apos;S STUDIO <span className="text-xs text-cyan-300 font-normal px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700/60 ml-2">JARVIS v3.0</span>
            </h1>
            <p className="text-[11px] text-cyan-400/80 tracking-wider">Windows Desktop &amp; Android Neural Assistant • Complete Studio</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Window control buttons */}
          {typeof window !== 'undefined' && window.irfan && (
            <div className="flex gap-1 mr-2 border-r border-cyan-900/60 pr-2">
              <button className="px-2 py-1 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-300 text-xs border border-cyan-800" onClick={minimizeDesktop} title="Minimize JARVIS Window">
                🗕
              </button>
              <button className="px-2 py-1 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-300 text-xs border border-cyan-800" onClick={maximizeDesktop} title="Maximize JARVIS Window">
                🗖
              </button>
            </div>
          )}

          <nav className="flex gap-1.5 flex-wrap">
            <button className={`btn text-xs ${tab === 'console' ? 'border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(0,234,255,0.3)]' : ''}`} onClick={() => setTab('console')}>
              Console
            </button>
            <button className={`btn text-xs ${tab === 'personas' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('personas')}>
              Personas
            </button>
            <button className={`btn text-xs ${tab === 'scheduler' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('scheduler')}>
              Scheduler
            </button>
            <button className={`btn text-xs ${tab === 'email' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('email')}>
              Email
            </button>
            {!isMobileApp && (
              <button className={`btn text-xs ${tab === 'whatsapp' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('whatsapp')}>
                WhatsApp
              </button>
            )}
            <button className={`btn text-xs ${tab === 'video' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('video')}>
              Video Studio
            </button>
            {isMobileApp ? (
              <button className={`btn text-xs ${tab === 'android' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('android')}>
                Android
              </button>
            ) : (
              <button className={`btn text-xs ${tab === 'devices' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('devices')}>
                Devices
              </button>
            )}
            <button className={`btn text-xs ${tab === 'devtools' ? 'border-cyan-400 text-cyan-200' : ''}`} onClick={() => setTab('devtools')}>
              Win32 Tools
            </button>
            <button
              className={`btn text-xs ${tab === 'settings' ? 'border-cyan-400 text-cyan-200' : ''}`}
              onClick={() => {
                setTab('settings');
                void reload();
              }}
            >
              Settings
            </button>
          </nav>
        </div>
      </header>

      {/* Latency & diagnostics banner */}
      {metrics && tab === 'console' && (
        <div className="mb-4 p-2.5 bg-cyan-950/40 border border-cyan-800/60 rounded-lg text-xs font-mono flex flex-wrap gap-4 text-cyan-200">
          <span className="text-cyan-400 font-semibold">⚡ TELEMETRY:</span>
          {metrics.firstTextMs !== undefined && (
            <span>First Text: <strong className="text-white">{metrics.firstTextMs}ms</strong></span>
          )}
          {metrics.firstAudioMs !== undefined && (
            <span>First Audio: <strong className="text-white">{metrics.firstAudioMs}ms</strong></span>
          )}
          {metrics.utteranceIntervalMs !== undefined && (
            <span>Utterance Gap: <strong className="text-emerald-400">{metrics.utteranceIntervalMs}ms</strong></span>
          )}
          {metrics.totalMs !== undefined && (
            <span>Total: <strong className="text-white">{(metrics.totalMs / 1000).toFixed(2)}s</strong></span>
          )}
          <span className="text-cyan-400">Engine: <strong className="text-white">{metrics.ttsEngine}</strong></span>
          {metrics.voiceName && <span className="text-cyan-400">Voice: <strong className="text-white">{metrics.voiceName}</strong></span>}
        </div>
      )}

      {/* Main content body */}
      {tab === 'personas' ? (
        <PersonaManager request={request} currentPersona={persona} onSelectPersona={id => setPersona(id)} />
      ) : tab === 'scheduler' ? (
        <SchedulerPanel request={request} />
      ) : tab === 'whatsapp' ? (
        <WhatsAppPanel native={typeof window === 'undefined' ? undefined : window.irfan} onSpeak={s => void play(s)} draft={waDraft} />
      ) : tab === 'android' ? (
        <AndroidPanel request={request} />
      ) : tab === 'devices' ? (
        <DevicesPanel request={request} desktop={typeof window === 'undefined' ? undefined : window.irfan} />
      ) : tab === 'email' ? (
        <EmailPanel
          request={request}
          openExternal={url => {
            if (isAndroid()) void nativeCall('tools.run', {name: 'open_website', args: {url}});
            else if (window.irfan) void window.irfan.openExternal(url);
            else window.open(url, '_blank', 'noopener,noreferrer');
          }}
          onSpeak={s => void play(s)}
        />
      ) : tab === 'video' ? (
        <VideoPanel request={request} engine={engine} setEngine={setEngine} native={typeof window === 'undefined' ? undefined : window.irfan} mobile={isMobileApp} />
      ) : tab === 'devtools' ? (
        /* Win32 Tools & Manual Diagnostics (Kept neat in dedicated tab) */
        <div className="glass rounded-xl p-5 space-y-4">
          <h2 className="text-cyan-300 text-xl font-bold">WINDOWS RUNTIME TOOL INSPECTOR</h2>
          <p className="text-xs text-cyan-400/80">Execute native Win32 tools, inspect process states, and test security permissions.</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-cyan-300">Tool Selection</label>
              <select className="input w-full" value={toolName} onChange={e => setToolName(e.target.value)}>
                {toolList.map(t => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.risk})
                  </option>
                ))}
              </select>
              <label className="block text-xs font-semibold text-cyan-300">Tool Arguments (JSON)</label>
              <textarea className="input w-full text-xs font-mono" value={toolArgs} onChange={e => setToolArgs(e.target.value)} rows={3} />
              <button className="btn" onClick={() => void tryTool()}>
                Execute Tool
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-cyan-300">Execution Output</label>
              <pre className="p-3 bg-black/60 border border-cyan-900 rounded-lg text-xs font-mono text-cyan-300 min-h-[120px] max-h-60 overflow-auto">
                {toolResult || '// Awaiting tool execution...'}
              </pre>
            </div>
          </div>
        </div>
      ) : tab === 'console' ? (
        /* Cinematic Primary Console */
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[300px_1fr_300px] gap-5 items-start">
          
          {/* Left Side: System Telemetry & Always-Listening Wake Word */}
          <aside className="glass rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-cyan-900/60 pb-2">
              <h2 className="text-cyan-300 font-bold tracking-widest text-xs uppercase">System HUD</h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${
                busy ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse' :
                recording ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 animate-pulse' :
                speaking ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse' :
                'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              }`}>
                {busy ? 'PROCESSING' : recording ? 'LISTENING' : speaking ? 'SPEAKING' : 'STANDBY'}
              </span>
            </div>

            {/* Always-Listening Wake Word Hub */}
            {!isMobileApp && (
              <WakeWord
                paused={speaking}
                onCommand={command => void send(command)}
                onCommandAudio={blob => void handleWakeCommandAudio(blob)}
                onGreeting={(startCapture) => {
                  addTelemetry('[WAKE SENSOR TRIGGERED: "HEY JARVIS"]');
                  if (typeof window !== 'undefined') {
                    if ((window as any).irfan?.maximizeWindow) void (window as any).irfan.maximizeWindow();
                    if ((window as any).irfan?.showAndFocus) void (window as any).irfan.showAndFocus();
                  }
                  // Professional spoken acknowledgment
                  const greetings = ['Yes, I am listening.', 'Online, sir.', 'At your service.'];
                  const ack = greetings[Math.floor(Math.random() * greetings.length)];
                  void playWithCallback(ack, () => {
                    // Allow speaker decay / room reverberation 300ms to settle before microphone opens
                    setTimeout(() => {
                      startCapture?.();
                    }, 300);
                  });
                }}
                language={language === 'ur' ? 'ur-PK' : language === 'hi' ? 'hi-IN' : 'en-US'}
              />
            )}

            {/* Quick Actions (Instant Hollywood Directives) */}
            <div className="space-y-1.5 border-t border-cyan-900/60 pt-3">
              <span className="text-[11px] font-semibold text-cyan-400/80 uppercase tracking-wider block mb-1">Quick Directives</span>
              <button className="btn w-full text-xs justify-start py-1.5 text-left" onClick={() => void send('Play Kesariya on YouTube')}>
                ▶ Play Kesariya on YouTube
              </button>
              <button className="btn w-full text-xs justify-start py-1.5 text-left" onClick={() => void send('Open Calculator')}>
                🔢 Open Calculator
              </button>
              <button className="btn w-full text-xs justify-start py-1.5 text-left" onClick={() => void send('Open WhatsApp Web')}>
                💬 Open WhatsApp Web
              </button>
              <button className="btn w-full text-xs justify-start py-1.5 text-left" onClick={() => void send('Open Gmail')}>
                ✉️ Open Gmail
              </button>
              <button className="btn w-full text-xs justify-start py-1.5 text-left" onClick={() => void send('Open Windows Settings')}>
                ⚙️ Open Windows Settings
              </button>
            </div>

            {/* System Status Metrics */}
            <div className="space-y-1 text-xs border-t border-cyan-900/60 pt-3 text-cyan-300/80 font-mono">
              <div className="flex justify-between">
                <span>PERSONA:</span>
                <strong className="text-white">{persona.toUpperCase()}</strong>
              </div>
              <div className="flex justify-between">
                <span>VOICE:</span>
                <strong className="text-white">{gender.toUpperCase()} ({voiceMode.toUpperCase()})</strong>
              </div>
              <div className="flex justify-between">
                <span>BACKEND:</span>
                <strong className="text-white">{isLocalWorker ? 'LOCAL:8787' : 'REMOTE'}</strong>
              </div>
            </div>
          </aside>

          {/* Center Column: Hollywood Core + Live Telemetry Ticker + Chat Timeline */}
          <section className="glass rounded-xl p-4 flex flex-col min-h-[75vh] relative overflow-hidden">
            {/* Holographic scanner beam */}
            {busy && <div className="telemetry-beam" />}

            {/* 3D Arc Reactor Core */}
            <div className="h-56 relative flex items-center justify-center">
              <Core level={recording || speaking ? 0.65 : 0.15} low={low} />
            </div>

            {/* Real-Time Waveform */}
            <Wave analyser={streamerRef.current?.getAnalyser() || analyser.current} low={low} playing={recording || speaking} />

            {/* Hollywood Diagnostic Telemetry Ticker */}
            <div className="my-2 p-2 rounded bg-black/60 border border-cyan-900/80 font-mono text-[11px] text-cyan-400 space-y-0.5 overflow-hidden">
              <div className="text-[10px] text-cyan-600 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                <span>LIVE TELEMETRY FEED</span>
              </div>
              {telemetryLogs.map((lg, idx) => (
                <div key={idx} className="truncate tracking-wide">
                  <span className="text-cyan-600">&gt;</span> {lg}
                </div>
              ))}
            </div>

            {/* Persistent Chat Timeline */}
            <div className="flex-1 overflow-y-auto border-t border-cyan-900/70 p-3 space-y-3.5 max-h-[380px]" aria-live="polite">
              <div className="flex justify-between items-center text-[11px] text-cyan-500 border-b border-cyan-950 pb-1 mb-2">
                <span>CONVERSATION HISTORY ({messages.length} directives)</span>
                <button
                  type="button"
                  className="hover:text-cyan-200 underline cursor-pointer"
                  onClick={clearChatHistory}
                >
                  Clear History
                </button>
              </div>

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                      m.role === 'user'
                        ? 'bg-gradient-to-br from-cyan-950/80 to-blue-950/90 border border-cyan-600/60 text-cyan-100 shadow-[0_0_12px_rgba(0,234,255,0.12)]'
                        : 'bg-gradient-to-br from-slate-900/90 to-cyan-950/40 border border-cyan-800/50 text-white shadow-[0_0_15px_rgba(0,180,216,0.1)]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold tracking-wider">
                      <span className={m.role === 'user' ? 'text-sky-300' : 'text-cyan-400 glow'}>
                        {m.role === 'user' ? 'YOU' : 'JARVIS'}
                      </span>
                      {m.time && <span className="text-slate-500 font-normal">{m.time}</span>}
                    </div>
                    <div className="leading-relaxed whitespace-pre-wrap">{m.content}</div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Pending Tool Approval Card */}
            {pending && (
              <div role="alert" className="border border-orange-400/80 bg-orange-950/40 p-3 rounded-lg space-y-2 mt-2">
                <div className="text-xs font-bold text-orange-300 flex items-center gap-2">
                  <span>⚠️ ACTION CONFIRMATION REQUIRED:</span>
                  <span className="text-white uppercase">{pending.tool}</span>
                </div>
                <pre className="text-[11px] text-orange-200/90 font-mono break-all">{JSON.stringify(pending.args, null, 2)}</pre>
                <div className="flex gap-2">
                  <button className="btn text-xs bg-emerald-900 border-emerald-500 text-emerald-200" onClick={() => void decideTool(true)}>
                    Approve
                  </button>
                  <button className="btn text-xs bg-red-950 border-red-600 text-red-200" onClick={() => void decideTool(false)}>
                    Deny
                  </button>
                </div>
              </div>
            )}

            {/* Input Bar */}
            <form
              className="flex gap-2 mt-4 pt-3 border-t border-cyan-900/60"
              onSubmit={e => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                aria-label="Your message"
                className="input flex-1 text-sm placeholder:text-cyan-600"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Give JARVIS a directive (or say “Hey Jarvis”)..."
              />
              <button className="btn text-xs px-4" disabled={busy || (!token && !mobilePaired)}>
                Send
              </button>
              <button className="btn text-xs px-3" type="button" onClick={mic} title="Push-to-Talk (Alt+M / Ctrl+Space)">
                {recording ? 'Stop' : 'Mic'}
              </button>
              <button className="btn text-xs px-3 text-red-300 border-red-800" type="button" onClick={interrupt} title="Interrupt active speech">
                Halt
              </button>
            </form>
          </section>

          {/* Right Column: Voice & Persona Settings */}
          <aside className="glass rounded-xl p-4 space-y-4">
            <h2 className="text-cyan-300 tracking-widest font-bold text-xs uppercase border-b border-cyan-900/60 pb-2">VOICE &amp; PERSONA</h2>
            
            <label className="block text-xs font-semibold text-cyan-300">
              Voice Mode
              <select
                className="input w-full text-xs mt-1"
                value={voiceMode}
                onChange={e => {
                  const m = e.target.value as 'local' | 'cloud';
                  setVoiceMode(m);
                  try {
                    localStorage.setItem('irfan_voice_mode', m);
                  } catch {}
                }}
              >
                <option value="local">⚡ Local Windows (&lt;150ms latency)</option>
                <option value="cloud">☁️ Cloud Gemini (High-Fidelity)</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-cyan-300">
              Persona Tone
              <select className="input w-full text-xs mt-1" value={persona} onChange={e => changePersona(e.target.value)}>
                {['calm', 'energetic', 'romantic', 'jarvis', 'friendly', 'creative'].map(p => (
                  <option key={p} value={p}>{p.toUpperCase()}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-cyan-300">
              Voice Gender
              <select className="input w-full text-xs mt-1" value={gender} onChange={e => changeGender(e.target.value as 'male' | 'female')}>
                <option value="male">MALE (JARVIS)</option>
                <option value="female">FEMALE</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-cyan-300">
              Language
              <select className="input w-full text-xs mt-1" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="auto">Auto-Detect</option>
                <option value="en">English</option>
                <option value="ur">Urdu</option>
                <option value="hi">Hindi</option>
              </select>
            </label>

            <label className="flex gap-2 items-center text-xs text-cyan-300/90 pt-2 border-t border-cyan-900/60 cursor-pointer">
              <input type="checkbox" checked={low} onChange={e => setLow(e.target.checked)} />
              <span>Low-GPU Mode (Performance)</span>
            </label>
          </aside>
        </div>
      ) : (
        /* Settings Tab */
        <div className="glass rounded-xl p-5 space-y-5">
          <h2 className="text-cyan-300 text-xl font-bold">SECURITY, BACKEND &amp; MEMORY</h2>
          {!isMobileApp && (
            <>
              <div className="p-3 bg-cyan-950/40 border border-cyan-800 rounded-lg space-y-2">
                <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">Active Target Backend</span>
                <div className="flex gap-2">
                  <button type="button" className={`btn text-xs ${isLocalWorker ? 'border-emerald-500 text-emerald-300' : ''}`} onClick={() => setApiUrl('http://127.0.0.1:8787')}>
                    Use Local Dev (127.0.0.1:8787)
                  </button>
                  <button type="button" className={`btn text-xs ${!isLocalWorker ? 'border-cyan-500 text-cyan-300' : ''}`} onClick={() => setApiUrl('https://fahad-s-studio.notxfahad.workers.dev')}>
                    Use Production Cloud
                  </button>
                </div>
              </div>

              <label className="block text-xs font-semibold text-cyan-300">
                Backend URL
                <input className="input block w-full mt-1" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://127.0.0.1:8787" />
              </label>
              <label className="block text-xs font-semibold text-cyan-300">
                API Access Token (Desktop only)
                <input type="password" className="input block w-full mt-1" value={token} onChange={e => setToken(e.target.value)} placeholder="Enter backend APP_TOKEN" />
              </label>
              <button
                className="btn text-xs"
                onClick={async () => {
                  try {
                    if (window.irfan?.saveSettings) {
                      await window.irfan.saveSettings(apiUrl, token);
                      alert('Settings saved to Windows credential storage');
                    }
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Save to Windows Credentials
              </button>
              <DesktopPermissions />
              <DiagnosticsPanel request={request} native={typeof window === 'undefined' ? undefined : window.irfan} mobile={isMobileApp} />
            </>
          )}

          <div className="space-y-3 border-t border-cyan-900 pt-4">
            <h3 className="text-cyan-300 font-bold text-sm uppercase">Long-Term Memory</h3>
            <div className="flex gap-2">
              <input className="input flex-1 text-xs" value={fact} onChange={e => setFact(e.target.value)} placeholder="Store a durable fact about you..." />
              <button
                className="btn text-xs"
                onClick={async () => {
                  try {
                    await request('/memories', {method: 'POST', body: JSON.stringify({fact, importance: 3})});
                    setFact('');
                    void reload();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Remember
              </button>
            </div>
            <ul className="space-y-1.5 text-xs">
              {memories.map(m => (
                <li key={m.id} className="flex justify-between items-center bg-cyan-950/20 border border-cyan-900/40 p-2 rounded">
                  <span>{m.fact}</span>
                  <button
                    className="text-red-400 hover:text-red-300 ml-2"
                    onClick={async () => {
                      try {
                        await request('/memories/' + m.id, {method: 'DELETE'});
                        void reload();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 p-3 border border-red-500/80 bg-red-950/40 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}
    </main>
  );
}
