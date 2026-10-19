# Irfan's Studio — single-client user guide

**PC:** Install the Windows NSIS candidate, open Irfan's Studio, enter the Cloudflare backend HTTPS URL and the owner APP_TOKEN in Settings, then select *Save access securely on this PC*. Do not share any API token. The Windows client works in the foreground and uses OS-protected credential storage.

**Talk to Jarvis:** Type in chat, press microphone for spoken recognition, or opt in to Hey Jarvis on the PC. Change persona/language/voice from the HUD. The desktop wake word is not OS-wide when the app is closed. Speech may require an Internet connection. On Android, native system speech and Porcupine wake listening are available after explicit microphone permission.

**Pair Android:** Download the APK from the GitHub Actions artifact. Allow sideloading temporarily in Android Settings, install, open app. On PC open Devices > Create pairing code. Copy the code to Android Pair. Codes expire in three minutes. Android now uses its own encrypted, revocable token; cloud memory/persona/chat are shared.

**Phone permissions:** Open Permissions in the Android top bar. Select each tool risk. Only give Accessibility, Notification access, DND, and Modify system settings if wanted; most work with none of them. Never enable Accessibility for an unknown APK. Disable/revoke the permissions later in system Settings.

**Tools:** On Windows say "open Notepad" or enter a command. The LLM may ask which app you meant. Every sensitive operation shows an approval first. On Android use native app controls and settings panels. Calls and SMS open their system apps for final manual send/call. Wi-Fi and Bluetooth are manual Settings operations, not hidden remote toggles.

**Remote actions:** Android > Ask paired PC to act (PC must be open and approve). Windows > Devices > Ask Android (phone must be in foreground and approve). Actions expire after five minutes. No remotely supplied instructions may skip confirmation.

**Gmail:** Once Google OAuth is configured, connect in Email tab and authorize your own Gmail. Read inbox/search/thread, get a spoken unread digest and create drafts. Sending, replying and moving to Trash require the full destination/subject/body review and confirmation. Mail content is not instructions to Jarvis.

**Video:** Select FREE LOCAL for Windows FFmpeg editing, provide actual file paths and review the plan before executing. Android cannot do heavy local editing and can relay plan to the paired PC. Select paid fal.ai for AI generation, inspect director prompt and estimated USD cost, then explicitly approve. Download result before provider URL expires.

**Updates:** Windows Settings > Check signed updates. Read version and explicitly Download / Install. Android APK updates must be installed from a release signed with the SAME keystore as prior production build. Do not install unverified files.

**Troubleshooting:** Backend health can respond when authenticated services are not configured. HTTP 503 means contact the administrator. Offline mode cannot use cloud chat/Gmail/fal, but the bundled Android UI still loads. Revoked phone must be paired again. To stop Android wake word, tap Wake or Disable in app and confirm the persistent microphone notification disappears. If an operation is unsupported, use the system settings panel instead.
