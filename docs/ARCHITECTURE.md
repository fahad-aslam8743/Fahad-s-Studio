# Fahad's Studio — Architecture Reference

**System Name:** Fahad's Studio (Internal branding: JARVIS / Irfan's Studio)  
**Target Platforms:** Windows 10/11 64-bit Desktop & Android 8.0+ Mobile  
**Core Technologies:** Electron, Next.js, Cloudflare Workers, Supabase (PostgreSQL + pgvector), Google Gemini, fal.ai, FFmpeg

---

## 1. High-Level System Overview

```
                      ┌────────────────────────────────────────┐
                      │             USER INTERFACES            │
                      ├───────────────────┬────────────────────┤
                      │  Windows Desktop  │  Android Companion │
                      │   (Electron +     │    (Native Kotlin  │
                      │   Next.js UI)     │    + WebView UI)   │
                      └─────────┬─────────┴──────────┬─────────┘
                                │                    │
             ┌──────────────────┴────────────────────┴───────────────────┐
             │                                                           │
             │ HTTPS / WSS / Bearer Token                                │
             ▼                                                           ▼
┌─────────────────────────────┐                         ┌─────────────────────────────────┐
│     LOCAL WORKSTATION       │                         │       CLOUDFLARE WORKER         │
│  (Electron Main & Helpers)  │                         │       (Production Backend)      │
├─────────────────────────────┤                         ├─────────────────────────────────┤
│ • Win32 / PowerShell Tools  │                         │ • Streaming Gemini Chat (SSE)   │
│ • Local FFmpeg Video Engine │◄────── Relay Tasks ────►│ • Gemini STT / Gemini TTS       │
│ • WhatsApp Web (Chromium)   │                         │ • Long-Term Memory / Embeddings │
│ • SafeStorage (DPAPI)       │                         │ • Gmail OAuth & Proxy           │
└─────────────────────────────┘                         │ • fal.ai Video Dispatch & Queue │
                                                        │ • Device Pairing & Relay Store  │
                                                        │ • Task Scheduler & Crons        │
                                                        └───────────────┬─────────────────┘
                                                                        │
                                                                        ▼
                                                        ┌─────────────────────────────────┐
                                                        │       SUPABASE POSTGRES         │
                                                        ├─────────────────────────────────┤
                                                        │ • pgvector Embeddings (768d)    │
                                                        │ • Long-Term Memories & Summaries│
                                                        │ • Device Pairings & Tokens      │
                                                        │ • Scheduled Tasks & History     │
                                                        │ • Video Jobs & Daily Quotas     │
                                                        │ • Tool Auditing Logs            │
                                                        └─────────────────────────────────┘
```

---

## 2. Workspace Layout

The repository is structured as a pnpm monorepo:

| Path | Purpose | Runtime |
|---|---|---|
| `apps/desktop` | Windows Electron shell, native process orchestration, WhatsApp Web, FFmpeg wrapper | Node.js 22+ / Electron 35 |
| `apps/ui` | Holographic HUD interface, Next.js 14 static export (`out/` loaded via `irfan://studio` or `appassets.androidplatform.net`) | React 18, Tailwind CSS |
| `apps/android` | Android companion app, native tools, accessibility, notification listener, Picovoice wake word | Android SDK 26–35, Kotlin 2.0 |
| `services/worker` | Production serverless backend handling AI, auth, media budgets, and database operations | Cloudflare Workers (V8) |
| `services/api` | Fastify local development backend (used during Phase 1 prototyping) | Node.js / Fastify |
| `packages/shared` | Shared TypeScript contracts, tool schemas, and Zod validations | ESM TypeScript |
| `supabase/migrations` | SQL schema definitions, pgvector functions, and Row-Level Security policies | PostgreSQL 15+ |

---

## 3. Data & Communication Pipelines

### A. Voice & Conversation Flow
1. **Input:** User presses Mic button (Push-to-Talk) or triggers the configurable Wake Word ("Hey Jarvis", "Computer", etc.).
2. **Audio Capture:** In Electron/Web, `MediaRecorder` captures audio as Opus/WebM or AAC/MP4. On Android, `RecognizerIntent` or `AudioRecord` handles microphone input.
3. **STT:** Audio buffer is base64-encoded and sent to `/stt`. The Cloudflare Worker invokes `gemini-3.8-flash` to transcribe verbatim while preserving the source language.
4. **Context Assembly:**
   - Vector recall queries Supabase RPC `match_irfan_memories` via `gemini-embedding-001` (768 dimensions).
   - Recent conversation summaries (`conversation_summaries`) are queried for continuity.
   - Active persona prompt (built-in or custom) and selected language instructions are injected.
5. **LLM Generation:** Request streams from `gemini-3.8-flash` over Server-Sent Events (`/chat` SSE stream).
6. **TTS Synthesis:** Generated text is forwarded to `/tts`. The Worker queries the Gemini Interactions API (`gemini-3.8-flash-tts`) specifying the persona's designated voice (`Puck`, `Kore`, `Charon`, `Aoede`, `Fenrir`, or `Zephyr`).
7. **Audio Playback:** Raw 24kHz PCM is packaged into a standard RIFF WAV buffer in client memory and played through the Web Audio API.

### B. Windows Automation & Desktop Tools
- **Tool Catalog:** 22 specialized tools defined in `apps/desktop/src/local-tools.ts` covering window control, running processes, volume, brightness, display, filesystem navigation, and UI automation.
- **Planner vs Executor:** Cloudflare Worker `/tools/plan` acts strictly as an AI planner—it identifies tool name and validated arguments from user text. It never executes code directly.
- **Local Dispatcher:** Electron IPC handler `local:propose` inspects the tool policy (`SAFE`, `CONFIRM`, `BLOCKED`). Reversible or safe tools run immediately; sensitive actions display an interactive confirmation card.
- **PowerShell Interop:** Executed via `apps/desktop/scripts/tools.ps1` through a dedicated hidden PowerShell subprocess with strict timeout limits and JSON stdin/stdout pipes.

### C. Android Native Bridge
- **WebView Isolation:** Next.js static assets load securely over `https://appassets.androidplatform.net/` using `WebViewAssetLoader`. Local file URLs and arbitrary origins are blocked.
- **JavascriptInterface:** `window.IrfanNative.post(json)` exposes bi-directional communication between JavaScript and Kotlin.
- **Native Tools:** 14 device tools including app launching, system panels, volume, flashlight, DND toggle, dialer, SMS composer, notification reading, notification dismissal, screen accessibility clicking, and UI element inspection.
- **Cross-Device Relay:** Android companion polls `/relay/poll` for queued tasks submitted by the PC, and submits phone-to-PC tasks (e.g. WhatsApp drafts or PC app launching) via `/relay/submit`.

### D. Video Studio Engine
- **Local Workstation Editing:** `apps/desktop/src/video-engine.ts` executes multi-step FFmpeg pipelines on the user's PC: trimming, concatenating, cropping (9:16 vertical reels, 16:9 widescreen), speed ramping, audio normalization (EBU R128), text drawing, and color grading.
- **Creative Director:** Cloudflare Worker `/video/director` uses Gemini to produce structured creative briefs, scene-by-scene storyboards, and platform-optimized prompts.
- **fal.ai Generation:** Optional paid text-to-video and image-to-video dispatch with strict pre-confirmation cost estimation, atomic daily budget reservations (`reserve_jarvis_video_budget`), and queue status polling.

---

## 4. Security & Trust Architecture

1. **Authentication:**
   - Desktop owner uses a cryptographically secure `APP_TOKEN` (32+ chars) persisted in Windows OS Credential Manager via `safeStorage` (DPAPI).
   - Android devices pair via single-use, 3-minute pairing codes that generate an encrypted device token stored in the hardware-backed Android Keystore.
2. **Untrusted Data Boundaries:**
   - Emails, retrieved memories, notifications, and web content are wrapped in explicit boundary markers (e.g. `[UNTRUSTED_STORED_FACTS]`, `[BEGIN_UNTRUSTED_EMAIL_DATA]`).
   - System prompts explicitly instruct Gemini to never execute destructive, financial, or communication tools based on untrusted inputs.
3. **Confirmation Gates:**
   - All email sending, email deletion, WhatsApp messaging, file deletion, and paid video generation require explicit human approval via structured confirmation cards.
4. **Audit Trail:**
   - Every local tool execution is recorded with timestamps, argument hashes, outcomes, and credential redactions in `tool-audit.jsonl`.
