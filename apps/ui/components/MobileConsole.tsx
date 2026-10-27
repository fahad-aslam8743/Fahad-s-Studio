'use client';

import dynamic from 'next/dynamic';

const Core = dynamic(() => import('./Core'), { ssr: false });
type Line = { role: 'user' | 'assistant'; content: string };

type Props = {
  messages: Line[];
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  recording: boolean;
  speaking: boolean;
  onMic: () => void;
  onInterrupt: () => void;
  persona: string;
  setPersona: (value: string) => void;
  gender: 'male' | 'female';
  setGender: (value: 'male' | 'female') => void;
  language: string;
  setLanguage: (value: string) => void;
  low: boolean;
  setLow: (value: boolean) => void;
  onDemo: () => void;
  error: string;
  connected: boolean;
};

export default function MobileConsole({
  messages, input, setInput, onSend, busy, recording, speaking, onMic, onInterrupt,
  persona, setPersona, gender, setGender, language, setLanguage, low, setLow,
  onDemo, error, connected
}: Props) {
  const status = busy ? 'THINKING' : recording ? 'LISTENING' : speaking ? 'SPEAKING' : connected ? 'READY' : 'PAIR PHONE';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-3">
      <section className="glass rounded-2xl p-3">
        <div className="flex items-center gap-3">
          <div className="h-20 w-20 shrink-0 sm:h-24 sm:w-24">
            <Core level={recording || speaking ? 0.5 : busy ? 0.3 : 0.12} low={low} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-sm font-semibold tracking-[.16em] text-cyan-300">J.A.R.V.I.S</h2>
              <span className={busy ? 'text-xs text-amber-300' : recording ? 'text-xs text-red-300' : 'text-xs text-cyan-500'}>{status}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">PERSONA · {persona.toUpperCase()} · {gender.toUpperCase()}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn min-h-10 px-3 py-2 text-sm" type="button" onClick={onMic} disabled={busy && !recording}>
                {recording ? 'Stop listening' : 'Voice input'}
              </button>
              <button className="btn min-h-10 px-3 py-2 text-sm" type="button" onClick={onDemo} disabled={busy}>Test chat</button>
            </div>
          </div>
        </div>
      </section>

      <section className="glass rounded-2xl p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 border-b border-cyan-900 pb-3">
          <h2 className="text-base font-semibold text-cyan-200">Conversation</h2>
          <span className="text-xs text-slate-500">{messages.length} messages</span>
        </div>

        <div className="min-h-[34vh] max-h-[52vh] space-y-3 overflow-y-auto py-4 pr-1" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
              <p className="text-sm text-cyan-200">Good evening. I'm ready.</p>
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-500">Type a message below or tap Voice input to speak a command.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={message.role === 'user'
                ? 'max-w-[88%] rounded-2xl rounded-br-sm border border-cyan-500/40 bg-cyan-950/90 px-3 py-2 text-sm leading-relaxed text-cyan-50'
                : 'max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-sm leading-relaxed text-slate-100'}>
                <p className="mb-1 text-[10px] font-semibold tracking-widest text-cyan-500">{message.role === 'user' ? 'YOU' : 'JARVIS'}</p>
                <p className="whitespace-pre-wrap break-words">{message.content || (busy && index === messages.length - 1 ? 'Thinking…' : '')}</p>
              </div>
            </div>
          ))}
          {busy && messages[messages.length - 1]?.content !== 'Thinking…' && (
            <p className="text-xs text-cyan-500 animate-pulse">JARVIS is processing your request…</p>
          )}
        </div>

        {error && <p role="alert" className="mb-2 break-words rounded-lg border border-red-900/70 bg-red-950/40 p-2 text-xs text-red-200">{error}</p>}

        <form className="sticky bottom-0 z-20 mt-2 flex items-end gap-2 border-t border-cyan-900 bg-[#030815]/95 pt-3" onSubmit={event => { event.preventDefault(); if (!busy && input.trim()) onSend(); }}>
          <textarea
            aria-label="Message JARVIS"
            className="input min-h-12 min-w-0 flex-1 resize-none text-base"
            rows={1}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busy && input.trim()) onSend(); } }}
            placeholder="Message JARVIS…"
            autoComplete="off"
          />
          <button className="btn min-h-12 shrink-0 px-4" type="submit" disabled={busy || !connected || !input.trim()}>Send</button>
        </form>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">Shift + Enter for a new line</p>
          <button className="text-xs text-cyan-400 underline" type="button" onClick={onInterrupt}>Interrupt</button>
        </div>
      </section>

      <details className="glass rounded-xl p-3">
        <summary className="cursor-pointer text-sm font-medium text-cyan-200">Voice & response settings</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-400">Persona
            <select className="input mt-1 w-full" value={persona} onChange={event => setPersona(event.target.value)}>
              {['calm', 'energetic', 'romantic', 'jarvis', 'friendly', 'creative'].map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-400">Voice
            <select className="input mt-1 w-full" value={gender} onChange={event => setGender(event.target.value as 'male' | 'female')}>
              <option value="female">Female</option><option value="male">Male</option>
            </select>
          </label>
          <label className="block text-xs text-slate-400">Language
            <select className="input mt-1 w-full" value={language} onChange={event => setLanguage(event.target.value)}>
              <option value="auto">Auto detect</option><option value="en">English</option><option value="ur">Urdu</option><option value="hi">Hindi</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={low} onChange={event => setLow(event.target.checked)} />
            Performance mode
          </label>
        </div>
        <button className="btn mt-3 w-full" type="button" onClick={onDemo} disabled={busy}>Test assistant connection</button>
      </details>
    </div>
  );
}
