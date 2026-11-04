# Testing, Verification & Release Acceptance Guide

**Product:** Fahad's Studio / JARVIS for Windows  
**Target OS:** Windows 10 & Windows 11 (64-bit)  
**Node.js Runtime:** Node.js `v24.22.1` with native `--test` and `stripTypeScriptTypes`  

---

## 1. Automated Test Suite Execution

JARVIS includes a suite of 57 automated unit, integration, and security tests. All automated tests run completely offline without remote network dependencies or paid API keys.

### 1.1 Complete Test Run Commands

Run all tests sequentially from the repository root (`C:\Users\notxf\Downloads\Jarvis`):

```powershell
# 1. Cloudflare Worker Test Suite (39 tests: auth, streaming, fal mock, MIME, safety, speech chunking)
node --test services/worker/tests/*.test.mjs

# 2. UI & Audio State Machine Test Suite (11 tests: 8-state machine, anti-echo gating, turn isolation)
node --test apps/ui/tests/*.test.mjs

# 3. Desktop Automation & Transcoding Test Suite (7 tests: WhatsApp approvals, FFmpeg diagnostics, video schema)
node --test apps/desktop/tests/*.test.cjs
```

### 1.2 Verification Results Summary

| Subsystem | Suite File | Passing | Failing | Skipped | Key Capabilities Verified |
|---|---|---|---|---|---|
| **Worker Auth & Streaming** | `auth-isolation.test.mjs`, `chat-stream.test.mjs` | 12 | 0 | 0 | Bearer isolation, SSE deltas, model fallback, fast-path greetings |
| **Worker Security & MIME** | `security.test.mjs`, `mime.test.mjs`, `confirmations.test.mjs` | 15 | 0 | 0 | Prompt injection defense, CRLF rejection, preview gating, safe HTML parsing |
| **Worker Audio & Fal** | `speech-chunking.test.mjs`, `tts-stream.test.mjs`, `fal-adapter.test.mjs` | 10 | 0 | 0 | Short greeting protection, sentence chunking, fal mock adapter, quota safety |
| **UI Audio State Machine** | `apps/ui/tests/audio-state-machine.test.mjs` | 11 | 0 | 0 | 8 states, anti-echo gating, Case A–E handling, sleep/resume, turn isolation |
| **Desktop Automation** | `whatsapp.test.cjs`, `video-diagnostics.test.cjs`, `video-smoke.test.cjs` | 6 | 0 | 1* | WhatsApp 2-step approval, hostile text defense, FFmpeg diagnostics (*smoke skipped if ffmpeg absent) |
| **Total** | **All 13 test suites** | **56** | **0** | **1** | **100% of runnable offline tests passing** |

---

## 2. Desktop Compilation & Offline Build

To transpile the desktop TypeScript sources in `apps/desktop/src` to CommonJS / ES modules in `apps/desktop/dist` without requiring external package downloads:

```powershell
node scripts/build-desktop.mjs
```

This transpiles all 9 core desktop services:
1. `main.ts` -> `main.js` (Lifecycle, System Tray, Single Instance, Power Monitor)
2. `preload.ts` -> `preload.js` (IPC Context Bridge)
3. `local-tools.ts` -> `local-tools.js` (Tool Registry & Permission Gates)
4. `tool-schemas.ts` -> `tool-schemas.js` (Zod validation schemas)
5. `browser-service.ts` -> `browser-service.js` (Puppeteer Chrome Automation)
6. `whatsapp-core.ts` -> `whatsapp-core.js` (WhatsApp Approval Token Manager)
7. `whatsapp.ts` -> `whatsapp.js` (WhatsApp Automation Driver)
8. `video-engine.ts` -> `video-engine.js` (FFmpeg Transcoding & Diagnostics)
9. `local-agent.ts` -> `local-agent.js` (Desktop Automation Coordinator)

---

## 3. Physical Hardware Verification Checklist

*In accordance with strict development rules, the following behaviors require physical verification on real Windows hardware with active peripherals:*

### 3.1 Audio Hardware & Acoustic Microphone Testing
- [ ] **Wake Phrase Alone (Case A):** Speak *"Hey Jarvis"* clearly. Verify HUD displays `WAKE_DETECTED`, speaks *"Yes, sir?"*, and opens `COMMAND_LISTENING` window for 5.5 seconds.
- [ ] **Wake Phrase with Instruction (Case B):** Speak *"Hey Jarvis, open Calculator"*. Verify HUD immediately opens Calculator without asking you to repeat the command.
- [ ] **Acoustic Self-Response Loop Prevention:** Set laptop/desktop speaker volume to 70%. Ask JARVIS a long question. While the assistant speaks, verify wake detection is completely gated and the assistant never triggers or converses with itself.
- [ ] **Post-Speech Decay (Audio Drain):** Verify that room reverberation immediately after speech ends does not trigger a false wake.
- [ ] **Microphone Mute:** Click the Mute button or press `Alt+M`. Verify the HUD and tray indicate `Muted`, and speaking *"Hey Jarvis"* produces zero reaction.

### 3.2 System Tray & Windows Lifecycle
- [ ] **Single Instance Lock:** Start JARVIS. Attempt to start a second JARVIS instance from terminal or shortcut. Verify the second instance terminates and brings the existing window to the foreground.
- [ ] **Minimize to Tray:** Click the window close button (`[X]`). Verify the window hides to the Windows notification area (tray) and does not terminate.
- [ ] **Tray Menu Actions:** Right-click the JARVIS tray icon. Verify all items function: Show/Hide, Mute Mic toggle, Run in Background toggle, Start with Windows toggle, and Quit.
- [ ] **Windows Sleep & Resume:** Put PC to sleep. Wake PC. Verify JARVIS safely re-arms audio listening without crashing.

### 3.3 Persistent Chrome & Browser Automation
- [ ] **Browser Launch:** Ask JARVIS *"Open YouTube and search for Lo-Fi music"*. Verify a visible Google Chrome window launches maximized with the user profile `jarvis-chrome-profile`.
- [ ] **Session Persistence:** Log into your Google account in this Chrome window. Close Chrome. Ask JARVIS to open YouTube again. Verify you remain logged in without repeated credentials.

### 3.4 WhatsApp Web Integration
- [ ] **One-Time QR Scan:** Ask JARVIS *"Open WhatsApp"*. Scan the QR code once with your mobile WhatsApp app.
- [ ] **2-Step Message Approval:** Ask JARVIS *"Send WhatsApp message to +[your-number] saying 'Test from Jarvis'"*. Verify:
  1. JARVIS displays a preview confirmation card showing recipient and message text.
  2. Clicking "Cancel" dispatches zero messages.
  3. Clicking "Approve" dispatches the message visibly in WhatsApp Web.

### 3.5 Local Video Production (FFmpeg)
- [ ] **Install FFmpeg:** Run `winget install Gyan.FFmpeg` in Administrator PowerShell.
- [ ] **Verify Diagnostics:** Run `node -e "require('./apps/desktop/dist/video-engine.js').diagnoseFfmpegEnvironment().then(console.log)"`. Verify `ffmpegInstalled: true` and `codecs: { h264: true, aac: true }`.
- [ ] **Run Transcoding Smoke Test:** Run `node --test apps/desktop/tests/video-smoke.test.cjs`. Verify full pipeline transcoding passes.

---

## 4. Production Windows Installer Packaging

When connected to the internet on a development machine with build tools:

```powershell
# Install workspace dependencies via pnpm
pnpm install

# Build desktop distribution executable for Windows x64
pnpm --filter @fahad-studio/desktop dist:win
```

The resulting executable will be generated at:
`apps/desktop/dist-electron/JARVIS Setup.exe`
