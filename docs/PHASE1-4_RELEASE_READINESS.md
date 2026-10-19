# Irfan's Studio — Phases 1–4 release readiness

Developer audit date: 2026-10-19. Current source: phase-1-4-completion. Production Cloudflare Git Builds use phase-1-foundation, NOT this branch. Do not treat a successful build as live acceptance.

## Phase 1 — Core Jarvis
- Existing Electron + holographic UI; Gemini chat and server-side streamed deltas; Supabase semantic pgvector memories, optional non-sensitive automatic fact extraction and asynchronous conversation summaries.
- Microphone speech-to-text; Gemini backend text-to-speech with configurable voice; opt-in Hey Jarvis recognizer while app remains open, plus push-to-talk fallback.
- Secure local Windows DPAPI / macOS Keychain storage for APP_TOKEN; no server credentials bundled. Wake word via Chromium SpeechRecognition may require network and is not an OS-wide lock-screen listener.

## Phase 2 — Windows controls
- Start-app discovery, fuzzy app name matching and clarification, running apps and window management, multi-monitor moves, browser opening, YouTube search results.
- Play-first YouTube video uses official YouTube Data API backend, enabled after YOUTUBE_API_KEY secret is supplied.
- System/volume/brightness/lock/sleep/dark-mode tools and file/clipboard/screenshot actions are validated and consent-gated. Wi-Fi adapter management may require Administrator; Bluetooth and airplane offer Windows Settings manual fallback.
- Native .NET UI Automation can inspect controls by ID, then invoke/toggle/set values with per-action consent; no Python sidecar. Mac returns mock results.

## Phase 3 — Gmail
- Server-side Gmail OAuth authorization code + PKCE, single-use state, AES-256-GCM encrypted refresh tokens and private Supabase tables.
- Inbox, search, full thread, draft, send, reply, move-to-Trash; server-confirmed one-time five-minute approval before any outbound send/reply/trash.
- HTML-only messages are converted to text; attachments are not executed. Email headers/content are delimited UNTRUSTED data for Gemini; no tool callbacks in summarization.
- Shared EmailProvider interface reserved for later Outlook/Graph.

## Phase 4 — Video
- Windows FFmpeg LocalEngine: validated argv-only tool operations, test clips for merge with missing audio, adding music to silent video, speed and audio transitions; subtitles via externally installed whisper.cpp and local model; FFmpeg winget installer with consent.
- fal.ai backend queue and director prompts, editable plan, cost preview and explicit paid approval. Supabase RPC atomically reserves estimated daily budget at confirmation. UI displays engine, fal queue polling and local edit progress. DaVinci scripting not built pending separate approval.
- Price and budget estimates are not guaranteed provider charges; do not promise premium outputs without asset review.

## Automated release gate
GitHub Actions Phases 1–4 Completion Gate has three independent jobs:
1. Worker security, MIME, anti-injection, confirmation and true SSE streaming tests plus Cloudflare Wrangler dry-run.
2. Actual synthetic media transcoding with FFmpeg and audio stream validation.
3. Windows TypeScript, Next.js build, PowerShell syntax and smoke tests, NSIS installer packaging.
A green run means the code passed those automated gates, NOT live Gmail login or real PC audio/monitor/permissions testing.

## External acceptance still required after owner provides credentials / device
- [ ] Promote the consolidated branch to the production deployment branch after review and final CI pass.
- [ ] Verify Cloudflare /health and authentication; smoke-test the newly promoted Worker.
- [ ] Connect Google OAuth app for the single client and test sending, reply, Trash, and malicious email attempts. Gmail modify is a restricted scope; Google External Testing refresh tokens can expire after seven days.
- [ ] Configure FAL_KEY and provider-side spending protections; authorize one paid job only if owner approves cost.
- [ ] Optionally enable YOUTUBE_API_KEY for the first-result video mode.
- [ ] Install trusted Windows FFmpeg and whisper.cpp/model; run the manual acceptance matrices in PHASE2_WINDOWS_TESTS.md, PHASE3_GMAIL_SETUP_TESTS.md and PHASE4_VIDEO_SETUP_TESTS.md.
- [ ] Verify real Windows 10/11 input devices, wake word, UIA, dual-monitor, radios, permissions, and sleep; CI runners cannot substitute for these.
- [ ] Arrange Windows publisher code signing for a trusted distributed installer if desired.

## Runtime settings required after promotion
Existing: APP_TOKEN Secret, GEMINI_API_KEY Secret, SUPABASE_SERVICE_ROLE_KEY Secret, SUPABASE_URL Plaintext.
Gmail: GOOGLE_CLIENT_ID Secret, GOOGLE_CLIENT_SECRET Secret, GOOGLE_REDIRECT_URI Plaintext, OAUTH_ENCRYPTION_KEY Secret (32 bytes in base64).
Video: FAL_KEY Secret (optional for paid mode), FAL_DAILY_LIMIT_USD Plaintext.
YouTube: YOUTUBE_API_KEY Secret (optional for play-first).
No secrets should appear in GitHub, screenshots or conversation text.

## Explicit limitations
A single APP_TOKEN is suitable for this single-client prototype but not multi-user access. The wake word is opt-in Chromium recognition rather than a certified offline OS service. Bluetooth and airplane remain manual Settings fallbacks. Some local editing depends on matching streams, installed fonts and CPU resources. fal queue requests and signed media URLs can need later reconciliation or download. Gmail scopes may require Google verification or a paid security assessment depending on usage. Production deployment is deliberately not performed on this uncredentialed branch.

Source files:
- services/worker/src/index.js, email.js, email-provider.js, video.js, video-models.js
- apps/desktop/src/main.ts, preload.ts, local-agent.ts, local-tools.ts, tool-schemas.ts, video-engine.ts
- apps/desktop/scripts/tools.ps1; apps/ui/app/page.tsx; apps/ui/components/EmailPanel.tsx, VideoPanel.tsx, WakeWord.tsx
- Supabase migrations in supabase/migrations; worker tests in services/worker/tests; video smoke tests in apps/desktop/tests
