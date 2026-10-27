# IRFAN'S STUDIO — CLIENT HANDOFF (Windows + Android)
_Last updated October 19, 2026. Candidate branch: `client-handoff-windows-android`._

## What the client receives

Two installation artifacts from one successful GitHub Actions **Client Handoff — Windows and Android** run:

1. `irfan-client-windows-unsigned-nsis` — unzip the GitHub Actions artifact; run its Windows NSIS `.exe` to install the holographic Windows Jarvis application.
2. `irfan-client-android-sideload-debug-apk` — unzip the artifact; sideload `app-debug.apk` on Android 8+.

**Important:** The Windows candidate is unsigned (Windows SmartScreen may warn) and the Android debug APK is signed with a temporary CI debug key (updates may require uninstall/reinstall, losing app-private pairing). These are suitable for *private acceptance testing by a client who understands the warnings*, not a signed store/enterprise release. The Windows signing certificate and a permanent Android signing keystore are still needed for durable distribution. Do not call the debug APK a production-signed release.

GitHub source/PR: `client-handoff-windows-android`. As of 2026-10-27, Cloudflare Workers Builds production is configured to track this candidate branch. Candidate commit `89d5c52f431bf22906b3f323973df20a2c744a21` was deployed after adding the required `SUPABASE_URL` runtime variable. Production smoke checks confirm `/health` returns HTTP 200 and unauthenticated protected routes return HTTP 401; this does not prove authenticated Gemini chat or external integrations are working.

## Before first use — administrator's one-time backend activation

Jarvis is designed for a single owner and a shared Cloudflare Worker + Supabase. **It will not chat, pair, use Gmail or generate AI video with missing backend credentials.** A public `/health` returning HTTP 200 does not prove authenticated services are ready. We previously observed protected backend requests return 503. Do not hand the product over as fully operational before this is fixed.

1. The current candidate deployment has its core runtime bindings configured in Cloudflare: `APP_TOKEN` (secret), `GEMINI_API_KEY` (secret), `SUPABASE_URL` (non-secret URL), and `SUPABASE_SERVICE_ROLE_KEY` (secret). For future rotations or redeploys, configure credentials only as Worker runtime secrets—never in GitHub source or unmasked Workers Builds environment variables. Verify the names and configuration in the Cloudflare dashboard without displaying secret values.
2. Review and promote this candidate's Worker code to the configured production deployment branch. Verify database migrations including device pairing, Gmail tables, video budget and atomic daily AI counters.
3. Production smoke checks verified `GET /health` returns 200 and unauthenticated requests to `/memories` and `/personas` return 401 (not 503). Still verify an owner-authenticated `GET /personas` or `/memories` with the client's token during private acceptance. **Do not expose `APP_TOKEN` in screenshots or logs.**
4. Configure Gmail/Google OAuth only when the client supplies Google Cloud authorization: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `OAUTH_ENCRYPTION_KEY`; use the documented exact production redirect and Gmail restricted-scope testing rules.
5. Configure optional `FAL_KEY` and daily estimate cap in the Worker if paid AI video is approved; provider billing limits must be managed separately. Optional `YOUTUBE_API_KEY` enables play-first YouTube via official API.
6. The Windows app prompts for the approved Worker URL and `APP_TOKEN`; use **Save access securely on this PC** (Windows OS storage). Android never receives the owner `APP_TOKEN`.

## Windows installation and initial acceptance

1. Install on Windows 10/11 64-bit. Keep Chrome or Microsoft Edge installed for WhatsApp Web.
2. Open **Settings → Client Readiness Check**. The packaged UI, Windows credential protection, Chrome/Edge and FFmpeg should be reported separately.
3. Enter the backend HTTPS URL (normally `https://fahad-s-studio.notxfahad.workers.dev`) and owner APP_TOKEN; save securely. **Run checks again**. Protected backend authentication must pass.
4. Try typed chat, audio playback, push-to-talk and opt-in Hey Jarvis. Speech recognition depends on Windows/Chromium microphone provider, network and OS permissions.
5. Test app control (Calculator/Notepad), browser open, running app list, window actions, and manual confirmations; do not grant administrator privileges unnecessarily.
6. Open Video Studio. To use free editing, install FFmpeg through the app's consent-gated process and provide a **local** video path. Verify short render/export. Whisper subtitles additionally require a separately trusted local speech executable/model.
7. Open Gmail tab, connect the single client's Google account (OAuth), read inbox and send a test message only after inspecting the full email confirmation.
8. Open WhatsApp tab → Connect → scan QR on the **dedicated Jarvis number** in WhatsApp → Linked devices. Click Refresh chats, inspect one conversation and send a controlled test to the owner's number **only after full recipient/body confirmation**. If library breaks after a WhatsApp Web change, stop/reconnect; do not bypass WhatsApp restrictions.
9. Enable Windows device encryption (BitLocker/Device Encryption) if available. WhatsApp LocalAuth is a local Chrome browser profile **not fully encrypted by this application**. Never share the `whatsapp-local-auth` directory.
10. Keep the Windows Jarvis app **running** for phone-to-PC requests; remotely queued tasks require explicit approval in the on-screen PC overlay.

## Android installation, pairing and checks

1. Transfer the APK to the client's Android phone. Open **Settings → Install unknown apps** and temporarily allow installation from the chosen Files or browser app. Install it. Optionally disable the installation permission afterwards.
2. Open the Android app. The Next.js Jarvis interface is bundled in the APK and can render without a network connection, but Gemini, Gmail, fal and device pairing need the live backend.
3. On the Windows Jarvis **Devices** tab create a one-time pairing code. Enter it into Android **Pair**. Code expires in three minutes and is single use; the phone receives its own encrypted/revocable device token.
4. Open Android **Settings → Client Readiness Check**. Confirm pairing, native bridge and authenticated backend. Run chat and voice tests.
5. Enable Android microphone/flashlight/brightness/DND/notifications/Accessibility **only as needed**. SMS and calls require a native system composer/dialer action; Android cannot silently toggle Wi-Fi/Bluetooth on current versions.
6. Try a phone-to-PC request while the Windows app is open. Approve/deny from the Windows overlay; confirm no action occurs on denial. Try PC-to-phone actions while Android app is in the foreground.
7. Test WhatsApp from Android: **Android tab → WhatsApp through your paired PC**. The phone only queues a draft. The Windows user must open the draft and separately confirm actual sending. It cannot send personal WhatsApp through the phone silently.
8. Enable optional Android Porcupine wake listening only after obtaining the client's own Picovoice AccessKey and applicable license; check the persistent microphone notification, then disable it.
9. Test Internet interruption, airplane/offline and revoked pairing; UI should explain temporary connection failures.

## Known unsupported/conditional behaviors

- Gmail restricted scopes and OAuth require the client account's authorization; Google may limit unverified apps.
- `whatsapp-web.js` is **unofficial**; bans/restrictions and breaking Web updates are possible. The client acknowledges this risk.
- The phone is not a heavy FFmpeg workstation. It submits director jobs to the fal backend or requests PC rendering.
- Android Settings and Accessibility controls are best effort; permissions and OEM restrictions apply. No silent system-radio bypass.
- Signed updates require owner-supplied Windows Authenticode and permanent Android signing keys. GitHub Actions artifacts are not durable software-update channels.
- A successful CI run is not a substitute for a real client's Google OAuth/WhatsApp login, Windows audio hardware, Android permissions, or a paid fal charge.
- Sensitive operations require confirmation even when requested by voice or a paired device.

## Client troubleshooting

- **Cloud API 503 or chat unavailable:** the backend secrets or deployed Worker are not configured. Contact the developer; don't paste credentials into chat.
- **WhatsApp QR not appearing:** open WhatsApp on Windows, install Edge/Chrome, click Reconnect; ensure outbound Internet access.
- **WhatsApp disconnected:** verify dedicated number remains active, use Reconnect. Never copy the local browser profile to untrusted hosting.
- **Android unable to pair:** confirm code is recent, one-time and the Worker is deployed; check Internet/phone time and generate a new code.
- **Can't update APK:** the Android debug signing key changes across CI runs. Uninstall/reinstall for testing or use a stable client-signed production APK once a keystore is provided.
- **PC video says FFmpeg unavailable:** install using Video Studio or place a trusted FFmpeg executable on PATH, then restart Jarvis.
- **Windows installer warning:** expected for an unsigned test build. Avoid distributing the candidate broadly; arrange code signing.

## Developer reference

Source and build: `.github/workflows/client-handoff.yml`, `apps/desktop/scripts/verify-package.cjs`, `apps/ui/components/DiagnosticsPanel.tsx`, `services/worker/tests/devices.test.mjs`.

Existing detailed setup: `docs/PHASE1-4_RELEASE_READINESS.md`, `docs/PHASE5_ANDROID_SETUP_TESTS.md`, `docs/PHASE6_WHATSAPP_WEB_SETUP_TESTS.md`, `docs/IRFAN_ADMIN_DEPLOYMENT_GUIDE.md`.

**Handoff definition:** client-testable installer/APK + compiled security tests + package-content verification + emulator smoke when possible, WITH remaining external activation requirements explicitly documented. Do not claim live production works until the server and client credentials are connected and physical device acceptance passes.
