# JARVIS Windows Assistant — Complete Setup and Operational Guide
**System Name:** Fahad's Studio / JARVIS  
**Platform:** Windows 10 / Windows 11 (64-bit)  
**Last Updated:** November 4, 2026

---

## 1. System Prerequisites

Before starting, ensure the following are available on your Windows PC:

1. **Operating System:** Windows 10 (Build 19041+) or Windows 11 64-bit.
2. **Node.js:** Node.js v22.0.0 or later (v24.x recommended). Verify with `node -v`.
3. **Package Manager:** `pnpm` (install via `npm install -g pnpm` or `corepack enable pnpm`).
4. **Google Chrome:** Installed in standard Windows location (`C:\Program Files\Google\Chrome\Application\chrome.exe` or `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`). Used by Puppeteer for persistent browser automation and WhatsApp Web.
5. **PowerShell:** PowerShell 5.1 or PowerShell 7 (standard in Windows 10/11). Execution policy should allow local scripts (`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`).
6. **Physical Microphone:** Required for voice activation and speech-to-text.

---

## 2. Environment Configuration

### Backend Secrets (`services/worker/.dev.vars`)
Create or edit `services/worker/.dev.vars` (never commit this file to source control):

```ini
# Application Authentication (32+ hex characters)
APP_TOKEN=your-random-32-char-app-token-here-1234567890abcdef

# Google Gemini API Key (Required for chat, STT, TTS, and edit planner)
# Obtain free from: https://aistudio.google.com/
GEMINI_API_KEY=AIzaSy...

# Supabase Configuration (Required for memories, custom personas, and scheduler)
# Create a free project at: https://supabase.com/
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...

# Google OAuth Credentials (Optional — needed for Gmail features)
# Create at: https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/email/oauth/callback
OAUTH_ENCRYPTION_KEY=your-32-char-aes-encryption-key-12345

# fal.ai Key (Optional — needed only if using paid cloud video generation)
# Obtain from: https://fal.ai/
FAL_KEY=fal-...
```

---

## 3. Microphone & Wake-Word Configuration

JARVIS features a transcript-based keyword spotting engine built into the user interface:

1. **Permissions:**
   - On first launch, Windows / Chromium will ask for microphone permission. Click **Allow**.
   - If permission was denied, go to Windows **Settings > Privacy & Security > Microphone** and ensure "Let desktop apps access your microphone" is toggled **On**.
2. **Always-Listening Wake Word:**
   - Default wake phrase: **"Hey Jarvis"**.
   - Supported built-in presets: "Hey Jarvis", "Jarvis", "Computer", "Assistant".
   - You can configure a custom phrase in the **Wake-Word Setup** panel in the HUD.
3. **Echo Gate & Interruption:**
   - While JARVIS is speaking a response, the detector enters **Echo Shield** state (`suspended`). This prevents the assistant from hearing its own voice through the speakers.
   - When speech stops, a 1.5-second acoustic drain grace period elapses before the microphone re-arms.
4. **Push-to-Talk Shortcut:**
   - At any time across Windows, press **`Alt+M`** or **`Ctrl+Space`** to instantly restore the JARVIS window and begin capturing your voice command.

---

## 4. Optional Workstation Tooling

### FFmpeg Local Video Production
To enable local video trimming, merging, vertical reel conversion, and audio mixing:

```powershell
winget install Gyan.FFmpeg
```

After installation, restart your terminal and verify:
```powershell
ffmpeg -version
ffprobe -version
```
JARVIS will automatically detect the installation via `apps/desktop/src/video-engine.ts#diagnoseFfmpegEnvironment`.

### WhatsApp Web Pairing
1. In JARVIS, say or type: **"Open WhatsApp"** or click the WhatsApp tab in Settings.
2. A terminal QR code and a visual QR card will be displayed.
3. Open WhatsApp on your phone: **Settings > Linked Devices > Link a Device**.
4. Scan the QR code.
5. Session data is saved locally to `apps/desktop/whatsapp-session` so you do not need to scan again on subsequent launches.

---

## 5. Running the Application in Development

### Step 1: Start the Cloudflare Worker Backend
In terminal 1:
```powershell
cd services/worker
pnpm dev
# Or with wrangler:
npx wrangler dev --port 8787
```
The backend will be available at `http://127.0.0.1:8787`.

### Step 2: Build the Desktop Transpilation
In terminal 2:
```powershell
node scripts/build-desktop.mjs
```

### Step 3: Start the Next.js UI
In terminal 3:
```powershell
cd apps/ui
pnpm dev
```
The UI dev server will be available at `http://localhost:3001`.

### Step 4: Launch the Electron Desktop App
In terminal 4:
```powershell
cd apps/desktop
$env:IRFAN_DEV="1"
npx electron dist/main.js
```

---

## 6. Building the Packaged Windows Installer

To build an offline, standalone Windows NSIS installer (`.exe`):

1. Export the Next.js static interface:
   ```powershell
   cd apps/ui
   pnpm build
   # Static assets will be generated in apps/ui/out/
   ```

2. Transpile desktop TypeScript sources:
   ```powershell
   node scripts/build-desktop.mjs
   ```

3. Run `electron-builder` from `apps/desktop`:
   ```powershell
   cd apps/desktop
   pnpm dist:win
   ```
   The installer will be generated in `apps/desktop/release/`:
   `Irfan's Studio Setup 0.1.0.exe`

4. Verify packaged assets:
   - Tray icon: `apps/desktop/assets/tray-icon.png` is packaged inside the ASAR.
   - PowerShell tools: `apps/desktop/scripts/tools.ps1` is packaged under `resources/scripts/`.
   - UI assets: `apps/ui/out` is packaged under `resources/ui/`.

---

## 7. Troubleshooting Common Issues

| Problem | Root Cause | Solution |
|---|---|---|
| **"Web Speech API is not available"** | Running in a non-Chromium browser or speech recognition disabled in WebView. | Use Google Chrome or the packaged Electron app. Alternatively, use Push-to-Talk (**`Alt+M`**). |
| **"Microphone permission denied"** | Windows privacy toggle blocking desktop apps. | Windows Settings > Privacy & Security > Microphone > Enable "Let desktop apps access your microphone". |
| **"FFmpeg binary not installed"** | `ffmpeg.exe` is not found in the system `PATH`. | Run `winget install Gyan.FFmpeg` and restart terminal. |
| **"Another instance is already active"** | Single-instance lock prevents duplicate processes. | Check Windows System Tray for existing JARVIS icon or terminate stray processes via Task Manager (`irfan.exe` / `electron.exe`). |
| **Scheduled reminders not popping up** | Electron notification permission or credentials unconfigured. | Open JARVIS Settings, verify Backend URL (`http://127.0.0.1:8787`) and Access Token are saved. Ensure Windows notifications are not in "Focus assist / Do not disturb" mode. |
| **Autoplay blocked on YouTube** | Chrome blocks audio autoplay on new tabs without prior user interaction. | JARVIS will truthfully report that the video opened but autoplay was blocked; click the video once in Chrome to allow playback. |
