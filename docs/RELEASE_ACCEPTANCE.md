# Release Acceptance Gate — October 27, 2026

## Status

**Not yet accepted for public or production distribution.** The workflow can run owner-authenticated backend checks and can produce signed release artifacts when the owner supplies signing material. Missing credentials are blockers; the workflow must not report a live pass without them.

## Windows Authenticode signing

In the GitHub repository, open Settings → Secrets and variables → Actions and add these as repository secrets:

- WINDOWS_CERTIFICATE_BASE64 — base64 encoding of the owner's trusted code-signing PFX file.
- WINDOWS_CERTIFICATE_PASSWORD — the PFX password.

The workflow signs the Windows installer and verifies that Get-AuthenticodeSignature reports Valid. Without a trusted certificate, the installer remains an unsigned test artifact. Do not distribute it as a signed release. Keep an encrypted backup of the certificate; never commit it, paste it into chat, or print it in logs.

## Android release signing

Add these repository secrets from an owner-controlled Android release keystore:

- ANDROID_KEYSTORE_BASE64 — base64 content of the JKS or keystore file.
- ANDROID_KEYSTORE_PASSWORD
- ANDROID_KEY_ALIAS
- ANDROID_KEY_PASSWORD

The workflow validates the keystore and alias, builds the release APK, runs apksigner verification, and publishes the signed release artifact. Without these secrets, only the debug/sideload APK is available for testing. Keep a secure offline backup of the keystore and passwords; losing the key can prevent future updates from installing over the same app.

If no key exists, create one in a secure local environment and keep it outside the repository. Example command: keytool -genkeypair -v -keystore jarvis-owner-release.jks -alias jarvis-release -keyalg RSA -keysize 3072 -validity 10000. Store the file and passwords in the owner's secure password manager, then base64-encode the file when adding the GitHub secret.

## Run live backend acceptance

1. Add the same owner APP_TOKEN expected by the Cloudflare Worker as the GitHub Actions secret JARVIS_APP_TOKEN. Never paste it into chat, source code, or PR comments.
2. Optionally add the repository variable JARVIS_BASE_URL. It defaults to https://fahad-s-studio.notxfahad.workers.dev.
3. Open Actions → Jarvis Release Acceptance → Run workflow on the repository's default branch (main). Check `run_live_acceptance` and run it. This dispatcher checks out the current `client-handoff-windows-android` candidate to execute the script, without requiring PR #7 to be merged.
4. Download the jarvis-live-acceptance-report artifact or read the workflow summary. Resolve every FAIL and BLOCKED item before sign-off.

The live check uses the owner token, verifies access control, sends one small diagnostic prompt to Gemini without saving a test conversation, creates and immediately revokes a temporary pairing record, verifies code replay is rejected and the revoked token fails, and probes Gmail without returning mailbox contents. It never sends an email or launches paid video. The check requires live network access and consumes a small amount of Gemini usage.

## Configure external services

Set these as Cloudflare Worker runtime secrets or runtime variables only. Never add them to source or ordinary build variables.

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI — must exactly match the redirect URL configured in Google Cloud Console.
- OAUTH_ENCRYPTION_KEY — base64-encoded 32 random bytes for AES-GCM token encryption.
- FAL_KEY — only if the owner approves paid fal.ai video.
- FAL_DAILY_LIMIT_USD — set an explicit daily maximum approved by the owner.
- YOUTUBE_API_KEY — optional, for YouTube first-result playback.

The existing core Worker bindings are APP_TOKEN, GEMINI_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY. The Gmail diagnostic verifies OAuth settings and, if a Gmail connection exists, refreshes the token and lists at most one message ID; it does not return mailbox content. The video diagnostic checks key presence and budget settings only. It makes no provider call and creates no paid job.

## Mandatory manual acceptance checklist

- [ ] Windows: verify the signed installer's signature, install on Windows 10/11, launch, check OS-backed credential storage, and verify local app control.
- [ ] Gemini: test real chat in the packaged desktop UI. Test speech-to-text and text-to-speech with the target microphone and speaker.
- [ ] Gmail: complete OAuth on the owner's account and wait until diagnostics report Gmail API PASS. Any acceptance send/reply/trash must show the full recipient, subject, and body and require confirmation; use an owner-controlled test address only.
- [ ] Android: install the owner-signed release APK, verify it launches, and confirm a future update signed with the same key installs over it.
- [ ] Device pairing: use a fresh three-minute one-time code on the physical phone; confirm reuse fails and revocation prevents future requests.
- [ ] Wake word: configure the owner's Picovoice key/license when required, grant microphone permission, test “Hey Jarvis” on physical hardware, confirm exactly one command is handled, then stop the listener and confirm the microphone indicator stops.
- [ ] Paid video: only after approving the displayed estimate and budget, run one small paid generation in the app and verify its job status/result. Check cancelling a prepared job does not submit it. This test may incur a real provider charge.
- [ ] Recovery: test network interruption/recovery, app restart, expired confirmations, and a revoked device token on physical hardware.

The workflow's automated checks are not full release acceptance. Do not merge PR #7 or label this a production release while mandatory signing or integration checks remain blocked.
