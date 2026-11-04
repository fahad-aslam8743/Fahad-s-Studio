# Deployment & Environment Configuration Guide

**Application:** Fahad's Studio (JARVIS)  
**Security Notice:** Never commit actual secret values to source control. Configure secrets only through Cloudflare dashboard / `wrangler secret put`, Supabase dashboard, or local `.env` files that are gitignored.

---

## 1. Environment Variables by Service

### A. Cloudflare Worker (Production Backend — `services/worker`)

Configure these via Cloudflare Dashboard or `wrangler secret put <NAME>`:

| Variable Name | Type | Purpose | Consumed By |
|---|---|---|---|
| `APP_TOKEN` | Secret | Master authentication token for Desktop owner. Min 32 random characters. | `services/worker/src/index.js` |
| `GEMINI_API_KEY` | Secret | Google Gemini API key for Chat, STT, Embeddings, and Director LLM. | `services/worker/src/index.js` |
| `GEMINI_MODEL` | Config | Primary Gemini model ID (Default: `gemini-3.8-flash`). | `services/worker/src/index.js` |
| `GEMINI_FALLBACK_MODEL` | Config | Backup Gemini model ID on transient 429/503 (Default: `gemini-3.6-flash`). | `services/worker/src/index.js` |
| `GEMINI_EMBED_MODEL` | Config | Embedding model for memories (Default: `gemini-embedding-001`). | `services/worker/src/index.js` |
| `GEMINI_STT_MODEL` | Config | Multimodal audio transcription model (Default: `gemini-3.8-flash`). | `services/worker/src/index.js` |
| `GEMINI_TTS_MODEL` | Config | Audio generation model (Default: `gemini-3.8-flash-tts`). | `services/worker/src/index.js` |
| `GEMINI_DAILY_REQUEST_LIMIT`| Config | Max AI requests allowed per subject per day (Default: `500`). | `services/worker/src/index.js` |
| `SUPABASE_URL` | Config | Public project URL (e.g. `https://xyz.supabase.co`). | `services/worker/src/index.js` |
| `SUPABASE_SERVICE_ROLE_KEY`| Secret | Supabase Service Role key for database and RPC execution. | `services/worker/src/index.js` |
| `GOOGLE_CLIENT_ID` | Config | Google OAuth Web Application Client ID for Gmail. | `services/worker/src/email.js` |
| `GOOGLE_CLIENT_SECRET` | Secret | Google OAuth Client Secret. | `services/worker/src/email.js` |
| `GOOGLE_REDIRECT_URI` | Config | OAuth callback URL (e.g. `https://<worker>.workers.dev/email/oauth/callback`). | `services/worker/src/email.js` |
| `OAUTH_ENCRYPTION_KEY` | Secret | Base64-encoded 32-byte AES-GCM key for encrypting stored refresh tokens. | `services/worker/src/email.js` |
| `FAL_KEY` | Secret | Optional. fal.ai API key for cloud text-to-video / image-to-video generation. | `services/worker/src/video.js` |
| `FAL_DAILY_LIMIT_USD` | Config | Optional. Daily spending cap in USD for fal.ai generation (Default: `5`). | `services/worker/src/video.js` |
| `YOUTUBE_API_KEY` | Secret | Optional. Google YouTube Data API v3 key for direct playback resolution. | `services/worker/src/index.js` |

### B. Windows Desktop (`apps/desktop`)

Set as local environment variables or configured in Settings HUD:

| Variable Name | Type | Purpose |
|---|---|---|
| `IRFAN_DEV` | Flag | Set to `1` during development to connect to `http://localhost:3000`. |
| `IRFAN_FFMPEG_PATH` | Path | Optional custom path to `ffmpeg.exe` (Defaults to PATH lookup). |
| `IRFAN_FFPROBE_PATH` | Path | Optional custom path to `ffprobe.exe` (Defaults to PATH lookup). |
| `IRFAN_WHISPER_PATH` | Path | Optional path to `whisper-cli.exe` for local subtitle extraction. |
| `IRFAN_WA_DAILY_SEND_LIMIT`| Number | Maximum WhatsApp outbound messages allowed per day (Default: `30`). |

### C. Web UI (`apps/ui`)

| Variable Name | Type | Purpose |
|---|---|---|
| `NEXT_PUBLIC_IRFAN_API_URL` | URL | Default backend Worker URL baked into static Next.js assets. |

---

## 2. Supabase Database Setup & Migrations

Execute the migration scripts in the Supabase SQL Editor in the following order:

1. `supabase/migrations/20261019_phase3_4.sql`:
   - `jarvis_oauth_states` (PKCE verification)
   - `jarvis_email_accounts` (Encrypted Gmail credentials)
   - `jarvis_email_pending` (Confirmation-gated message actions)
   - `jarvis_video_jobs` & `jarvis_video_usage` (Video budget tracking)
2. `supabase/migrations/20261019_phase4_atomic_budget.sql`:
   - `reserve_jarvis_video_budget()` stored procedure
3. `supabase/migrations/20261019_phase5_6_devices_limits.sql`:
   - `jarvis_device_pairs` & `jarvis_devices` (Mobile pairing tokens)
   - `jarvis_remote_tasks` (Cross-device task relay)
   - `jarvis_api_rate` with `jarvis_rate_check()` and `jarvis_daily_ai_check()`
4. `supabase/migrations/20261027_personas_scheduler.sql`:
   - `jarvis_custom_personas` (Custom system instructions & voice mappings)
   - `jarvis_scheduled_tasks` & `jarvis_task_history`
   - `jarvis_advance_schedule()` recurring calculation procedure

---

## 3. Local Development Instructions

### Prerequisites
- Node.js 22 LTS or higher
- pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- Google Chrome or Microsoft Edge (for WhatsApp Web automation)
- FFmpeg (run `winget install Gyan.FFmpeg` or install manually)

### Steps
```bash
# 1. Install all monorepo dependencies
pnpm install

# 2. Build shared contracts
pnpm --filter @irfan/shared build

# 3. Start local development servers (UI on 3000, Desktop Electron shell)
$env:IRFAN_DEV="1"
pnpm dev
```

---

## 4. Build & Distribution Commands

### Windows NSIS Installer (.exe)
```bash
# 1. Build the shared packages and UI
pnpm --filter @irfan/shared build
pnpm --filter @irfan/ui build

# 2. Package into Windows 64-bit NSIS installer
pnpm --filter @irfan/desktop dist:win
# Artifact output: apps/desktop/dist/Irfan's Studio Setup *.exe
```

### Android Companion APK (.apk)
```bash
# From apps/android directory with Android SDK configured
cd apps/android
./gradlew assembleDebug
# Artifact output: apps/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Troubleshooting & Health Verification

1. **Verify Backend Health:**
   ```bash
   curl -i https://<your-worker>.workers.dev/health
   # Expected: HTTP 200 {"ok":true,"name":"Irfan's Studio","backend":"Cloudflare Workers"}
   ```

2. **Verify Auth Barrier:**
   ```bash
   curl -i https://<your-worker>.workers.dev/memories
   # Expected: HTTP 401 {"error":"Unauthorized"}
   ```

3. **Verify Owner Access:**
   ```bash
   curl -i -H "Authorization: Bearer <APP_TOKEN>" https://<your-worker>.workers.dev/personas
   # Expected: HTTP 200 with JSON list of built-in and custom personas
   ```

4. **Audio / Microphone in Windows:**
   - Ensure microphone permission is granted in Windows Settings → Privacy & Security → Microphone.
   - Electron main process automatically approves audio capture permissions for `irfan://studio`.
