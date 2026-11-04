# JARVIS — Master Manual QA Test Checklist
**Version:** 0.1.0 (Windows & Android)  
**Last Updated:** November 4, 2026

Use this checklist to perform physical real-world verification of JARVIS on your Windows PC and Android companion device.

---

## Section 1: Voice Activation and Audio Feedback Loop (Windows PC)

| Step # | Test Description | Expected Result | Pass/Fail | Notes |
|---|---|---|---|---|
| **1.1** | **Quiet Room Wake-Word:** Speak "Hey Jarvis" at normal conversational volume (approx. 1 meter from microphone). | HUD activates, listening chime sounds, state displays `CAPTURING VOICE DIRECTIVE...`, window comes to foreground. | [ ] | |
| **1.2** | **Custom Phrase Enforcement:** In Wake-Word Setup, change phrase to "Computer". Speak "Hey Jarvis". Then speak "Computer". | "Hey Jarvis" does NOT trigger activation. "Computer" activates immediately. | [ ] | |
| **1.3** | **Single-Shot Directive Execution:** Speak "Computer, open Calculator". Observe command execution. | Calculator opens ONCE. Verify in network/logs that audio blob is NOT submitted to `/stt` after text recognition resolves. | [ ] | |
| **1.4** | **Self-Voice Echo Loop:** Set speaker volume to 70%. Ask JARVIS: "Tell me a long story about space exploration." Observe the HUD while JARVIS is speaking. | Wake detector state displays `ECHO SHIELD (JARVIS SPEAKING)` (`suspended`). JARVIS's voice does NOT trigger a wake activation or create repeated echo responses. | [ ] | |
| **1.5** | **Post-Playback Audio Drain:** After JARVIS finishes speaking, immediately remain silent for 3 seconds. | Detector enters acoustic drain period and smoothly transitions back to `ALWAYS LISTENING`. No phantom triggers occur. | [ ] | |
| **1.6** | **Single-Gate Wake Cooldown:** Speak "Hey Jarvis" to activate the HUD. Immediately speak "Hey Jarvis" again within 1 second. Wait 3 seconds, then speak "Hey Jarvis" once more. | The first wake activates immediately. The rapid second utterance within the 2.5s cooldown is suppressed. The third utterance after cooldown expires activates normally. | [ ] | |
| **1.7** | **User Interruption:** While JARVIS is speaking, press the UI interrupt button or press `Alt+M`. | Active speech immediately stops, audio buffer clears, and assistant switches to listening state. | [ ] | |
| **1.8** | **Global Push-to-Talk Shortcut:** Minimize JARVIS or switch to another application (e.g. Notepad). Press `Alt+M` or `Ctrl+Space`. | JARVIS window instantly restores, gains focus, and begins microphone capture. | [ ] | |
| **1.9** | **Microphone Disconnection:** Unplug the USB microphone or disable the default audio input while JARVIS is running. | State displays `SENSOR MUTED` or `unavailable` with a clear diagnostic message. Reconnecting the microphone restores listening mode without app crash. | [ ] | |
| **1.10** | **Sleep and Resume Recovery:** Put the Windows PC to sleep (`Win+X > U > S`), wait 10 seconds, then wake the PC. | Audio engine transitions safely through suspend and re-initializes speech recognition on resume. | [ ] | |

---

## Section 2: Windows Desktop Automation (22 Tools)

| Step # | Directive Spoken or Typed | Expected Result | Pass/Fail | Notes |
|---|---|---|---|---|
| **2.1** | "Open Calculator" | Windows Calculator (`calc.exe`) launches and comes to the front. | [ ] | |
| **2.2** | "Open Notepad" | Notepad (`notepad.exe`) launches and gains foreground focus. | [ ] | |
| **2.3** | "Maximize Notepad" | Notepad window maximizes across the screen. | [ ] | |
| **2.4** | "Minimize Notepad" | Notepad window minimizes to the Windows taskbar. | [ ] | |
| **2.5** | "Close Notepad" | An interactive confirmation card appears: "Please confirm closing Notepad." Clicking "Confirm" safely closes Notepad. | [ ] | |
| **2.6** | "Mute system volume" | Windows master volume is muted. | [ ] | |
| **2.7** | "Volume up" | Windows master volume increases. | [ ] | |
| **2.8** | "Open Windows sound settings" | Windows Settings app opens to `ms-settings:sound`. | [ ] | |
| **2.9** | "Take a screenshot" | Screen snapshot is captured and stored in user temp directory. | [ ] | |
| **2.10** | "Open Downloads folder" | File Explorer opens to the user's `Downloads` folder. | [ ] | |

---

## Section 3: Browser Automation & Truthful Reporting

| Step # | Directive Spoken or Typed | Expected Result | Pass/Fail | Notes |
|---|---|---|---|---|
| **3.1** | "Open YouTube" | Google Chrome opens with `https://www.youtube.com`. | [ ] | |
| **3.2** | "Search YouTube for lo-fi beats" | Chrome navigates to YouTube search results for "lo-fi beats". JARVIS replies: "Found YouTube results for 'lo-fi beats'." | [ ] | |
| **3.3** | "Play bohemian rhapsody on youtube" | Chrome navigates to the first video result. If autoplay starts, JARVIS announces: "Now playing Bohemian Rhapsody on YouTube." If autoplay was blocked by Chrome, JARVIS truthfully reports: "Opened 'Bohemian Rhapsody' on YouTube. Autoplay may be blocked — please click play." | [ ] | |
| **3.4** | "Search Google for latest tech news" | Chrome opens Google search results for "latest tech news". | [ ] | |
| **3.5** | "Open WhatsApp Web" | Chrome navigates to `https://web.whatsapp.com` using the persistent profile. | [ ] | |

---

## Section 4: Scheduled Tasks & Background Execution

| Step # | Test Description | Expected Result | Pass/Fail | Notes |
|---|---|---|---|---|
| **4.1** | **Create Task:** Open the Scheduler tab in JARVIS. Click "New Task", title: "Stand up and stretch", type: "once", set time 2 minutes in the future, action: "reminder". | Task appears in the active tasks list with status `active`. | [ ] | |
| **4.2** | **Desktop Execution:** Minimize JARVIS to the system tray and wait 2 minutes. | A native Windows desktop notification pops up from the system tray: "JARVIS Reminder: Stand up and stretch". | [ ] | |
| **4.3** | **Execution History:** Re-open JARVIS and check the Scheduler panel. | Task history records `completed` with timestamp and `triggered_by: pc`. | [ ] | |
| **4.4** | **Duplicate Protection:** Monitor the task for another 2 minutes. | The task does NOT fire a second time. Idempotency key prevents double execution. | [ ] | |
| **4.5** | **Offline Reconciliation Queue:** Disconnect PC internet immediately after a scheduled action executes on desktop. Reconnect internet 30 seconds later. | Desktop poller retains the completion payload in `pendingCompletions`, does NOT re-execute the action on the next poll, and flushes completion to the worker upon network restoration. | [ ] | |
| **4.6** | **Process Crash Recovery (Durable Outbox):** With network disconnected, let a scheduled task execute locally. Check `scheduler-outbox.json` in `%APPDATA%\JARVIS\` to confirm pending attempt record. Force-kill the JARVIS process via Task Manager (`taskkill /F /IM electron.exe`). Re-launch JARVIS and reconnect network. | On startup, JARVIS reads `scheduler-outbox.json`, recovers the uncommitted completion without re-running the action, flushes the completion to the worker, and deletes the record only after HTTP confirmation. | [ ] | |

---

## Section 5: Electron Lifecycle & Tray Packaging

| Step # | Test Description | Expected Result | Pass/Fail | Notes |
|---|---|---|---|---|
| **5.1** | **Single Instance:** With JARVIS running, attempt to launch a second instance from the command line or executable. | Second instance does not spawn; the first instance window is restored and focused. | [ ] | |
| **5.2** | **Close to Tray:** Click the "X" button on the JARVIS window. | Window disappears from taskbar, but remains running in the Windows System Tray (notification area). | [ ] | |
| **5.3** | **Tray Icon & Menu:** Right-click the JARVIS icon in the system tray. | Context menu appears showing: "Open JARVIS", current voice status, and "Exit JARVIS". Tray icon renders cleanly (not blank). | [ ] | |
| **5.4** | **Tray Restore:** Click "Open JARVIS" or double-click the tray icon. | JARVIS window restores and gains focus. | [ ] | |
| **5.5** | **Clean Exit:** Right-click tray icon and select "Exit JARVIS". | Process terminates cleanly. No orphaned background Node or PowerShell processes remain. | [ ] | |

---

## Section 6: Android Companion (Physical Phone)

| Step # | Test Description | Expected Result | Pass/Fail | Notes |
|---|---|---|---|---|
| **6.1** | **Pairing:** In JARVIS desktop Settings, generate a pairing code. In the Android companion app, enter the 32-character code. | Phone pairs successfully. Single-use code is consumed. Phone appears in the paired devices list. | [ ] | |
| **6.2** | **Remote Notification:** On Android, trigger a task targeted for mobile. | Notification appears in Android notification shade. | [ ] | |
| **6.3** | **Permission Enforcement:** From Android, attempt to trigger a dangerous PC action (e.g. `delete_file`). | Action is rejected by the worker with status `403 Forbidden`. Paired phones cannot delete PC files. | [ ] | |
| **6.4** | **Unpair:** In desktop Settings, click "Revoke" next to the paired phone. | Phone's token is deleted from Supabase. Subsequent requests from phone return `401 Unauthorized`. | [ ] | |
