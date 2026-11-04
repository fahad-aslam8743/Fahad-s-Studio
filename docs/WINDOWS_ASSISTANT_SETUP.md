# Windows Assistant Setup & Architecture Guide

**Product:** Fahad's Studio / JARVIS for Windows  
**Release Target:** Windows 10 / Windows 11 (x64)  
**Process Runtime:** Electron 38 with Isolated Context, Node.js v24, PowerShell Automation  

---

## 1. Overview & Application Lifecycle

JARVIS operates as an always-available Windows desktop AI assistant.

### Lifecycle Behaviors
1. **Single-Instance Lock:** Enforced at process initialization (`app.requestSingleInstanceLock()`). If a second instance is started, the primary instance is restored and brought to the foreground, preventing duplicate microphone capture and race conditions.
2. **Background Minimize-to-Tray:** Clicking the window minimize button minimizes the window without interrupting wake listening. Closing the window (`[X]`) hides the assistant to the Windows system tray when background mode is active.
3. **Tray Interaction:**
   - Single click or double click on the tray icon restores and focuses the assistant.
   - Context menu provides:
     - Open / Hide JARVIS
     - Status readout (Listening / Processing / Speaking / Muted)
     - Mute / Enable Microphone toggle
     - Run in Background toggle
     - Start with Windows checkbox (`app.setLoginItemSettings`)
     - Explicit **Quit JARVIS** action (stops background audio processing and terminates all child processes cleanly).
4. **Power & Device State Recovery:**
   - Listens to Windows `powerMonitor.on('suspend')`: Safely suspends microphone capture and frees audio resources before sleep.
   - Listens to Windows `powerMonitor.on('resume')`: Automatically re-arms the acoustic wake-word listener upon wake.
5. **Global Push-to-Talk Shortcut:**
   - `Alt+M` or `CommandOrControl+Space` is globally registered to restore, focus, and immediately trigger microphone recording from anywhere in Windows.

---

## 2. Windows Development Setup

### Prerequisites
- Windows 10 or 11 (64-bit)
- Node.js `v20+` or `v24+` installed
- Google Chrome or Microsoft Edge installed (for browser automation)
- PowerShell 5.1+ (built into Windows)

### Running in Development
1. Start the local API Worker:
   ```powershell
   cd services/worker
   node scripts/dev-server.mjs
   ```
2. Start the UI:
   ```powershell
   cd apps/ui
   node ./node_modules/next/dist/bin/next dev -p 3001
   ```
3. Build the desktop main and preload scripts:
   ```powershell
   node scripts/build-desktop.mjs
   ```
4. Start the Electron desktop runtime:
   ```powershell
   cd apps/desktop
   node ./node_modules/electron/cli.js .
   ```

---

## 3. Configuration & Credentials

All sensitive configuration is read from environment variables or encrypted local storage (`credentials.enc` using Windows DPAPI via Electron `safeStorage`).

Example `.env` placeholders:
```env
# Gemini AI
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash

# Backend Token (min 32 characters)
APP_TOKEN=your_secure_random_app_token_here

# Optional: fal.ai
FAL_KEY=
FAL_DAILY_LIMIT_USD=5

# Optional: Google OAuth for Gmail
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/email/oauth/callback
```
