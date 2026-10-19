# Phase 2 — Windows controls

## Scope and design
Windows actions run ONLY in Electron main via IPC (never from the Cloudflare Worker). Inputs are Zod-validated. The registry exposes risk levels. CONFIRM actions are initially queued with a random one-time ID, a 60-second expiry and a renderer origin binding; the renderer displays the full arguments and requires explicit approval. Every proposed, denied, completed and errored action is appended to the local user-data `tool-audit.jsonl`. macOS returns marked MOCK results. The PowerShell helper reads JSON from standard input; untrusted values are not concatenated into executable commands. **This is an early implementation awaiting real Windows 10/11 testing, not a signed production agent.**

### Files
- `apps/desktop/src/local-tools.ts`: schemas, descriptions, risks, platform mock, worker process.
- `apps/desktop/src/local-agent.ts`: local approvals, audit.
- `apps/desktop/scripts/tools.ps1`: Windows APIs and fixed commands.
- `apps/desktop/src/main.ts`, `preload.ts`: isolated IPC bridge.
- `apps/ui/app/page.tsx`: tool test panel and confirmation controls.

## Manual Windows acceptance matrix

| Tool | Risk | Test on Windows 10 and 11 | Notes |
|---|---|---|---|
| list_installed_apps | SAFE | Compare with Start list; Microsoft Store and classic apps | Start menu apps not necessarily all installed apps |
| open_app | SAFE | Open Notepad, Calculator and Chrome, ambiguous names | Fuzzy matching currently substring/prefix based, not full fuzzy distance |
| list_running_apps | SAFE | Compare with Task Manager; expect only visible windows | Background tasks intentionally omitted |
| close_app | CONFIRM | Open unsaved Notepad and request close; confirm Save prompt appears | No force kill |
| window_control | CONFIRM | Minimize/maximize/restore/focus/snap each visible window | Foreground focus restrictions and DPI can cause failures |
| window_control monitor_next | CONFIRM | Move test window between two monitors | Depends on monitor configuration, scaling and per-app placement restrictions |
| window_control minimize_all | SAFE | Minimize all and restore manually | Shell behavior |
| open_website | SAFE | HTTPS site opens in default browser; file/javascript schemes rejected | URL schema restricts scheme |
| youtube_search | SAFE | Search cats and confirm browser results | Play-first not implemented: no YouTube API, no fake autoplay |
| system_volume | CONFIRM | Up/down/mute then inspect system tray | Simulated multimedia keys can be flaky |
| screen_brightness | CONFIRM | Change built-in laptop panel brightness | External monitors typically unsupported |
| system_radio Wi-Fi | CONFIRM | On test PC with admin permissions toggle off then back on | Requires elevation in many configurations; no silent elevation attempted |
| system_radio Bluetooth/airplane | CONFIRM | Confirm corresponding Windows Settings panel opens for manual control | Native WinRT radio control deferred |
| dark_mode | CONFIRM | Toggle dark then light; inspect Settings and app theme | No admin; per-user; some apps need restart |
| lock_screen | SAFE | Lock desktop; unlock with user credentials | No admin |
| sleep_pc | CONFIRM | Save work, issue sleep, verify wake | Hibernate/power settings may change outcome |
| open_folder | SAFE | Open known existing directory; reject missing | Absolute validated by Windows filesystem |
| find_file | SAFE | Find document in Documents; intentionally missing filename | Recursive search can be slow, 30-result cap |
| open_file | SAFE | Open .txt file, reject missing | Default file association needed |
| move_file | CONFIRM | Create temp file, deny once, approve once; inspect destination | File only; no directories |
| delete_file | CONFIRM | Deny once then move sample file to Recycle Bin | Recycle Bin availability varies |
| screenshot | CONFIRM | Capture two monitors; inspect output in Pictures | May be black for secure/protected content |
| clipboard_read | CONFIRM | Copy test text; approve; verify value | Clipboard could contain secrets, never auto-read |
| clipboard_write | CONFIRM | Deny then approve a string; paste in Notepad | Existing clipboard overwritten |
| ui_automation | BLOCKED | Any request must refuse without executing | Sidecar not added |

## Known limitations / security and follow-up work
- Phase 1's Cloudflare model does not yet emit native structured tool requests; no LLM-to-PC remote execution is wired. Manual Electron tool console works only on local desktop; do not promise conversational Windows control yet.
- All window operations currently require confirmation, including close. Fine-grained SAFE actions can be separated after Windows acceptance tests.
- Tool schemas include explicit JSON properties for planning; Zod parses complete schemas again at execution.
- PowerShell helper is unsigned. Packaging and Windows PowerShell execution need real PC acceptance testing.
- The installation of applications is not supported. No admin-rights bypass, no arbitrary executable path, no arbitrary commands.
- Wi-Fi adapter toggling usually needs admin; it will fail explicitly without privilege.
- Volume uses Win32 multimedia key events; sleep uses a legacy Win32 command. Both may behave differently across machines.
- Native UI Automation via C# using `System.Windows.Automation` and Win32 is preferable to Python initially, because adding pywinauto would introduce a Python runtime, packaging, and architecture overhead. We **will not add a Python sidecar without owner approval**. UIA should be a last-resort, high-risk tool and require per-action consent.
- End-to-end LLM function calling, selecting apps by ambiguity, multi-monitor window moves and YouTube first-video playback remain incomplete.

## Verification
Run GitHub Actions `Phase 2 checks` on Windows and Linux. CI verifies compilation and Windows installer build; it cannot confirm actual desktop effects in a headless hosted runner. Execute every row above on the client's Windows 10/11 PC before release.
