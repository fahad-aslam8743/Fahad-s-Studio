# Phase 5: Irfan Android companion — setup, tools and acceptance

## Delivery and architecture
Kotlin Android native app at apps/android/app/; Android WebView displays the exact Next.js static export bundled at APK build time, via WebViewAssetLoader https://appassets.androidplatform.net/ . JavaScript interface is exposed ONLY to this bundled site. All external resources/subframes are denied; external links open Android's browser. Android allows no insecure HTTP, file:// access or universal file access. The bridge returns async JSON results, never raw Android Keystore secrets.

Android Keystore AES-256-GCM encrypts the device's random bearer token and Picovoice AccessKey in app-private preferences. No APP_TOKEN, Gmail client secret, Supabase service-role key, Gemini key or FAL_KEY is ever shipped to Android. Native HTTPS proxy calls the same Cloudflare Worker, sharing Supabase memory, chat and persona with PC.

Windows creates a three-minute random pairing code; phone redeems it once over HTTPS, receiving its own revocable access token. Pairing and relay tables have RLS and only service_role access. Device token is SHA-256-hashed server-side; only token hash is persisted. Phone requests are scoped; backend tracks device ID, enforces atomic request counters on relay and device routes.

## Install one-client sideload APK
1. Download irfan-companion-android-debug-apk from a successful Phase 5–6 GitHub Actions run. Debug APK uses the standard Android debug key; it is NOT a permanent signed production identity. Preserve the final client signing keystore once configured.
2. On Android 8 or newer: Settings > Apps > Special app access > Install unknown apps > allow for browser or Files app temporarily. Install APK. Disable the install privilege afterwards if preferred.
3. Connect to the Internet, open companion. No login or APP_TOKEN should be pasted into the WebView. On PC open Jarvis > Devices > Create pairing code. Enter the exact code in the phone's Pair button or Android tab. Code expires in 3 minutes and can be used once. The PC must reach the same Worker after it has been deployed.
4. Test changing persona, chat and memory from PC and phone; both should show the same cloud records. Mobile uses system native voice recognition/TTS and the same AI backend.
5. Optional: enable permissions below individually from the Android permission screen. No Accessibility or Notification access is on by default.

## User-granted permissions and system controls
| Tool | Minimum risk | Required action | Limitations |
|---|---|---|---|
| open_app | SAFE | Installed launchable app | PackageManager can see visible launcher activities; fuzzy substring matching may be ambiguous |
| settings_panel | SAFE | None | Opens Wi-Fi, Bluetooth, airplane, display, DND or accessibility Settings panels; does NOT silently toggle radios |
| volume | CONFIRM | None | Controls STREAM_MUSIC; not call volume |
| screen_brightness | CONFIRM | Settings > Apps > Special app access > Modify system settings | OEM automatic brightness may override |
| flashlight | CONFIRM | Grant Camera permission when prompted | Hardware-dependent |
| dnd | CONFIRM | Settings > Special app access > Do Not Disturb access | System can restrict policy changes |
| call | CONFIRM | Confirm Jarvis action and then tap Call in system dialer | Does not place calls silently; no CALL_PHONE permission |
| sms | CONFIRM | Confirm full number/body, then tap Send in system SMS composer | Does not send silently; no SEND_SMS permission |
| notifications_read | CONFIRM | Settings > Apps > Special app access > Notification access > Irfan | Reads available notification title/text, max 40 in memory, only while enabled; no history server sync |
| accessibility_click | CONFIRM | Settings > Accessibility > Installed apps > Jarvis > Allow | Click only visible user-specified label; app layout/OEM-dependent, not guaranteed |
| open_website | SAFE | None | HTTPS only, launches default browser |
| video_download | CONFIRM | DownloadManager system confirmation/notification | HTTPS fal.ai/fal.media links only, time-limited download URLs |

Modern Android restricts programmatic Wi-Fi toggling and Bluetooth enable()/disable() from ordinary apps targeting current SDKs; AccessibilityService cannot override all OEM panels and may be disabled by the system. This app intentionally opens supported Settings panels. For sideloaded apps on Android 13+, Accessibility/Notification service permissions may be under *Restricted settings*: Settings > Apps > Irfan Companion > menu > Allow restricted settings, then enable chosen service. Wording varies across OEMs.

Camera & microphone runtime permissions are requested only when needed. Microphone uses Android RecognizerIntent for voice. Notification listener runs only after explicit system grant. AccessibilityService is separate opt-in, inspectable from Settings and disableable at any time.

## Mobile video and pairing
The phone NEVER runs heavy local FFmpeg editing. Switch to fal.ai in Video Studio to submit backend paid jobs with full estimate/confirmation, or choose free local tools to send a typed plan to the paired Windows agent; the PC must be running, connected and explicitly approve. Polling is foreground-based and tasks expire after 5 minutes. On mobile the result can be saved to Downloads through Android DownloadManager.

## Android manual acceptance checklist
- [ ] Install debug APK on physical Android 11, 13, 14/15+ where possible.
- [ ] Confirm bundled UI renders offline (network services should show failure), no external WebView content/native-bridge exposure.
- [ ] Pair a phone once; replay old code is rejected, unknown code rejected, revoking device immediately removes backend access.
- [ ] Chat, persona, memory, email read and fal video API use the same cloud backend after pairing.
- [ ] App discovery, ambiguity prompt, app open; Settings panels do not misreport radio toggling.
- [ ] Volume, brightness with/without permission, flashlight with/without camera, DND with/without access.
- [ ] Calls and SMS show full destination/details and require BOTH Jarvis approval and final system-app tap.
- [ ] Notifications require explicit listener grant; ordinary notifications show; no stealth forwarding.
- [ ] Accessibility service disabled: action refuses. Enabled: consent and exact visible control click; reject hidden/unavailable controls.
- [ ] PC->phone/phone->PC remote actions display a target-device approval; deny gives no side effect.
- [ ] Remote task expires if device offline; reconnection does not replay a completed action.
- [ ] Mobile local rendering sends a plan to PC; PC must approve; paid fal shows estimate and needs approval.
- [ ] Ask Android to read message aloud, microphone speech-to-text, revoke speech/camera to test errors.
- [ ] Disable all special permissions and check the app fails safely.

## Android limitations
Physical hardware validation remains outstanding. This is a sideloaded single-user companion, not a Play Store-ready build. The Android debug key should not be used as a durable distribution identity. WebView content is bundled; update requires a new APK. Supported Android app APIs cannot silently toggle radios, use the dialer without user participation, or bypass accessibility restrictions. Background Android 14+ mic service must be started while the app is visible. Hosted CI builds APKs, not hardware certification.
