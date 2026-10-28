# Phase 6: messaging options, wake word, safety, signed releases

## WhatsApp — OWNER SELECTED OPTION C FOR A DEDICATED JARVIS NUMBER
1. OFFICIAL WhatsApp Business Platform / Cloud API: suitable for business numbers, templates, business messaging and consent, usage-based charges/Meta restrictions. This is not a general connector to an ordinary personal WhatsApp inbox.
2. PERSONAL-account Android NotificationListenerService + Android RemoteInput notification quick reply: limited to notifications exposed by WhatsApp when the phone is unlocked/permissions enabled. Quick reply only when a RemoteInput action is present, older chats and arbitrary new outgoing messages may not be accessible. Requires notification access and user confirmation. No silent access to encrypted chat history. This is recommended ONLY when the client's goal is personal WhatsApp and they accept notification-only limits.
3. UNOFFICIAL WhatsApp Web automation via whatsapp-web.js: fragile, not supported or guaranteed by Meta and may risk account restriction or bans; NOT recommended, not built.
The owner chose **Option C (whatsapp-web.js)** specifically for a dedicated Jarvis-only number. The Windows-only implementation is on `phase-6-whatsapp-web`; it requires a live WhatsApp QR scan before use. Every outbound message displays the exact recipient and complete body and requires a one-time explicit approval. See `docs/PHASE6_WHATSAPP_WEB_SETUP_TESTS.md` for source, setup, test checklist and account-ban/security limitations.

## Wake word
- Android: Porcupine Android SDK 4.0.2 uses built-in 'Jarvis', or the user may import their own .ppn model trained in Picovoice Console. Requires personal Picovoice AccessKey; stored in Android Keystore, never in the repo or WebView. Foreground microphone service is enabled manually, with persistent notification; stops when requested. Android 14+ mic foreground service starts from visible Activity; no hidden boot auto-start. On detection, prompts Android's system speech recognizer when app is visible. Background detection may surface a notification; launching speech recognition from a hidden app is not guaranteed. Licensing: verify current Picovoice developer/commercial pricing and usage caps with provider.
- Windows: Phase 1 browser SpeechRecognition opt-in fallback while Electron is open; no equivalent native Porcupine Windows listening service yet. Offline OS-wide custom wake word is NOT certified across PC power states.

## Windows release and auto-updates
electron-builder packages NSIS installer, and electron-updater is wired for public GitHub Releases with publisher signature checking. Candidate workflow uses --publish never and does NOT publish unsigned builds. Signed releases are triggered only by manually publishing a GitHub release when repository variable SIGNED_RELEASE_ENABLED=true and required GitHub Secrets exist. The application checks for updates at user request; it never silently installs. Downloaded updates require explicit user click to install/restart. Keep signature verification on; do not configure insecure bypass.
Windows signer options: CA-issued PFX Authenticode OV/EV (env WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD), or managed cloud signing requiring separate provider integration. SmartScreen reputation may still require time; unsigned debug installer will show warnings.

Android release uses owner-generated Android app signing keystore (ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD) only in GitHub Secrets. Never lose the keystore: future updates must use the same signing identity. Release script uploads the APK to the GitHub release. For the first client, debug APK can be sideloaded for testing.

## Reliability
- Android HTTPS native client has connect/read timeouts, explicit errors; device foreground relay polls at 10-second interval. PC overlay checks at 7.5 seconds. Messages expire after 5 minutes, no forced silent device execution.
- Backend per-minute atomic device/relay rate limiter in Supabase RPC; Phase 4 has atomic USD estimate reservation daily limit. Actual fal billing can differ; configure billing limit in fal dashboard.
- Electron local tools generate append-only local audit (clipboard contents redacted). Native Android does not forward notification text unless the owner explicitly requests to read it. Cloudflare Worker error responses do not include backend credentials.
- Signed updates require GitHub Releases availability; offline errors must not discard user content. UI should show visible, concise errors; OS speech may fail offline.

## Security inventory
| Location | Secret/personal data | Protection |
|---|---|---|
| Cloudflare Worker Runtime Secrets | Gemini, Supabase service-role, APP_TOKEN, Gmail OAuth client, FAL_KEY, optional YouTube API | Server-side only, never in app binaries; only runtime bindings |
| Supabase jarvis_email_accounts | Gmail refresh token | AES-256-GCM ciphertext encrypted with server-only OAUTH_ENCRYPTION_KEY |
| Supabase memories/conversations | User memory and conversations | RLS (service_role only); owner should limit retention and backup access |
| Supabase device table | Android auth tokens | SHA-256 hash only; revocable; RLS |
| Android Keystore + private preferences | Device bearer token, Porcupine AccessKey | AndroidKeyStore AES-256-GCM, app backups disabled |
| Android NotificationListenerService | Visible notification title and text | In-memory capped buffer (40), no backend sync; system revocable |
| Windows app userData | APP_TOKEN, API address | Electron safeStorage / Windows DPAPI encrypted |
| Windows userData/tool-audit.jsonl | Action arguments, filenames and outcomes | Local user directory; clipboard content redacted; protect with OS login/backups |
| fal.ai storage/result URL | Generated prompts, uploaded images/videos | Provider infrastructure, billed usage; generated media URL can expire |
| GitHub CI release secrets | Windows signing PFX and Android keystore | GitHub Secrets only; never commit or print to logs |

## Potential Play Store publication risks
Google Play has strict requirements for AccessibilityService APIs, foreground service types and sensitive user-data disclosures; non-accessibility automated controls can be rejected under Play policy. SMS/Call Log permission access is restricted; this companion deliberately uses ACTION_DIAL / ACTION_SENDTO instead. Notification listener access is especially sensitive and requires disclosure and user choice. Publishing later requires a new policy review, data safety form, privacy policy and device testing; sideloading does not make restricted system actions technically possible.

## Phase 6 final checks
- [x] Owner selected Option C for a dedicated Jarvis number; code added on phase-6-whatsapp-web.
- [ ] Scan dedicated number's QR on target Windows PC; manually verify sends/replies, account restrictions and session security.
- [ ] Built-in Jarvis Porcupine starts/stops only after microphone permission and AccessKey. Test custom .ppn.
- [ ] Revoke device token, test malformed pairing and relay confirmation.
- [ ] Set Android tool SAFE/CONFIRM/BLOCKED; high-risk tools cannot be SAFE. Same on desktop.
- [ ] Check offline/reconnect behavior, rate limiting and rejected paid requests.
- [ ] CI Windows installer and APK builds pass. Verify actual Android device and Windows PC before client release.
- [ ] When owner signing secrets arrive, run explicit signed release workflow; verify Authenticode publisher and Android signature, then test update.
