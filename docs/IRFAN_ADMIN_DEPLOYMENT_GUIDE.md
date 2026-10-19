# Irfan's Studio — administrator deployment, secrets, backups and release

## Infrastructure
- GitHub repo: fahad-aslam8743/Fahad-s-Studio. Current candidate branch: phase-5-6-android-polish (based on phase-1-4-completion). Production Cloudflare deployment was previously configured to watch phase-1-foundation. DO NOT switch production until explicitly authorized and CI is green.
- Cloudflare Worker: fahad-s-studio.notxfahad.workers.dev; routes /health, /chat, /tts, /stt, /memories, /email, /video, /devices and /relay. Backend access is one single-client APP_TOKEN for Windows and separate revocable hashed device tokens on Android.
- Supabase project: iqqszfuyyhagdovfzzqd, Singapore. private tables for memory, Gmail, video, device pairing and queues; anon/authenticated denied.
- Video paid jobs: fal.ai optional. Gmail: Google OAuth single-client restricted scope. Android: APK bundles Next.js static UI from apps/ui/out; no public Next.js hosting required.

## Server-only runtime variables (never in app/CI source)
APP_TOKEN, GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL.
AI usage cap: GEMINI_DAILY_REQUEST_LIMIT (Plaintext integer, default 500 per linked account/day). This is an atomic request-count limit, not an actual invoice ceiling; configure Gemini provider billing too.
Gmail: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OAUTH_ENCRYPTION_KEY (base64 AES-256).
Paid video: FAL_KEY, FAL_DAILY_LIMIT_USD.
YouTube first video: YOUTUBE_API_KEY.
Runtime Secrets vs Build vars must be distinguished. Read docs/PHASE3_GMAIL_SETUP_TESTS.md and docs/PHASE4_VIDEO_SETUP_TESTS.md for setup.

## Database
Run all SQL migrations in supabase/migrations, including phase5_devices_relay_rate and earlier budget reservation. Confirm RLS. Device code hash, device bearer token hash and task results are private. Rotate a compromised device token by revoking and re-pairing; rotating OAUTH_ENCRYPTION_KEY requires decrypt/re-encrypt Gmail ciphertext or user reauthorization.

## Rate limits, cost, logs and safety
The /devices and /relay routes use atomic per-minute RPC counters; the AI routes use a separate atomic daily RPC counter; limit defaults to 6/min for pairing redeem and 120/min other device paths. Phase 4 cost approval atomically reserves estimated USD per day. Also set account-level fal budgets; our estimates are not a provider-level spending cap.
Windows error metadata (redacted) is stored in userData/desktop-errors.jsonl; audit files in Windows userData/tool-audit.jsonl contain filenames and tool metadata. Secure local profile. Supabase memories/summaries and Gmail/video records may contain private data, so restrict retention and backup access.

## Backup and recovery
Regularly back up the Supabase database with the provider backup feature or an administrator-run pg_dump in a trusted environment, encrypt the backup and retain it securely off-device; on free tiers backups may not be automatic. Retain a separate encrypted copy of OAUTH_ENCRYPTION_KEY and signing keystores, NEVER in the same unencrypted backup. Test restore to a non-production project with restricted access. Document rotation dates, keys and recovery contacts securely outside the app. Back up only required metadata; generated fal videos should be downloaded separately because result links can expire.

## GitHub CI
Phase 5+6 workflow builds Worker, Windows NSIS and sideloadable Android debug APK. CI copies apps/ui/out directly into apps/android/app/src/main/assets so both platforms use the same UI.
Explicit Signed Client Release workflow runs only after a GitHub Release is published and repository variable SIGNED_RELEASE_ENABLED=true, with secrets:
WIN_CSC_LINK (PFX/base64 or other recognized signing input), WIN_CSC_KEY_PASSWORD,
ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.
Keep publisher subject stable for authenticated auto-update. Electron updater uses signed public GitHub Releases; untrusted or unsigned versions must not be installed by the updater.

## Acceptance before go-live
1. Green backend, Windows and Android build results. Review current branch and open PR.
2. Add all needed credentials to Cloudflare **runtime** only, then deliberately promote GitHub branch to production.
3. Confirm /health HTTP 200 and unauthenticated protected routes return 401, not 503; test authorized chat, memory, voice.
4. Pair Android with Windows, test revocation, rate limit, remote approve/deny, phone and PC foreground/lock behavior.
5. Test Gmail OAuth and adversarial email. Paid fal job only with owner approval. Confirm account spending caps.
6. Hardware-test Windows and Android on target devices, code sign installers/APKs with owner secrets, then publish.
7. Verify update, rollback and encrypted backup restore. Preserve test logs without secrets.

## Known operational limitations
No commercial WhatsApp adapter is chosen yet. Foreground relay only, not an always-connected background desktop daemon. Android sideload debug APK is for testing. No verified Play Store policy approval. Accessibility and radios are best-effort under current Android APIs. Production backend still needs credentials and authorized release promotion.
