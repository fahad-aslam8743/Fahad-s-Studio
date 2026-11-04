# Fahad's Studio — Manual Acceptance Test Plan

This document provides structured, numbered test procedures for validating Fahad's Studio across Windows 10/11 and Android devices.

---

## Suite 1: Authentication & Connection

### TC-01: Health & Authentication Barrier
- **Prerequisites:** Cloudflare Worker deployed or local development server running.
- **Steps:**
  1. Send unauthenticated `GET /health` to the backend URL.
  2. Send unauthenticated `GET /memories`.
  3. Send request `GET /memories` with header `Authorization: Bearer <APP_TOKEN>`.
- **Expected Results:**
  - Step 1 returns `HTTP 200` with JSON `{ "ok": true }`.
  - Step 2 returns `HTTP 401 Unauthorized`.
  - Step 3 returns `HTTP 200` with array of memory records.
- **Status:** PASS / FAIL

### TC-02: Windows Desktop Credential Storage (DPAPI)
- **Prerequisites:** Windows Desktop application installed.
- **Steps:**
  1. Open Settings tab.
  2. Enter backend Worker URL and `APP_TOKEN`.
  3. Click **Save access securely on this PC**.
  4. Restart the application.
  5. Check if backend URL and token are automatically reloaded.
- **Expected Results:** Status reports saved via OS credential store. Token is encrypted via Windows DPAPI (`safeStorage`).
- **Status:** PASS / FAIL

---

## Suite 2: Core Assistant & Voice Pipeline

### TC-03: Streaming Chat & History Management
- **Prerequisites:** Desktop connected and authenticated.
- **Steps:**
  1. Type "Hello Jarvis, introduce yourself in two sentences." and press Send.
  2. Verify text streams smoothly in real-time.
  3. Type "What was my previous question?" and press Send.
- **Expected Results:** Assistant streams reply incrementally; correctly references the previous question from conversational history.
- **Status:** PASS / FAIL

### TC-04: Push-to-Talk (STT) and Audio Output (TTS)
- **Prerequisites:** Microphone and speakers/headphones connected.
- **Steps:**
  1. Press **Mic** button. Status should display `LISTENING`.
  2. Speak clearly: "What is the capital of France?"
  3. Wait 1.5 seconds or press **Stop**.
- **Expected Results:** Audio waveform responds to voice; status changes to `THINKING` then `SPEAKING`. Text displays "The capital of France is Paris", and synthesized audio plays clearly.
- **Status:** PASS / FAIL

### TC-05: Task Interruption
- **Prerequisites:** System is in the middle of speaking a long response.
- **Steps:**
  1. Ask: "Explain the theory of relativity in detail."
  2. While the assistant is speaking, click the **Interrupt** button.
- **Expected Results:** Audio stops immediately. Status returns to `STANDBY`. No further audio chunks are enqueued.
- **Status:** PASS / FAIL

### TC-06: Configurable Wake Word (Desktop)
- **Prerequisites:** Quiet environment with active microphone.
- **Steps:**
  1. Click **Change** next to Wake Word in Console.
  2. Select preset **Computer** or type custom phrase.
  3. Click **Enable "Computer"**.
  4. Say: "Computer, what is the time?"
- **Expected Results:** System recognizes invocation phrase, stops listening loop, displays transcribed command, and responds with current time.
- **Status:** PASS / FAIL

---

## Suite 3: Personas & Multilingual Interaction

### TC-07: Persona Switching & Voice Variation
- **Prerequisites:** Settings connected.
- **Steps:**
  1. Open **Personas** tab.
  2. Select preset **Creative Director**.
  3. Return to Console and ask: "Critique a short video idea about a watch."
  4. Switch persona to **Energetic** and ask the same question.
- **Expected Results:** Responses reflect designated persona tone (analytical/aesthetic vs upbeat/action-oriented). Synthesized voice pitch and speaker change accordingly.
- **Status:** PASS / FAIL

### TC-08: Custom Persona Creation
- **Prerequisites:** Personas tab open.
- **Steps:**
  1. Click **+ New Persona**.
  2. Name: "Tech Guru", Tone: "expert", Instructions: "Provide technical, architecture-level answers with bullet points."
  3. Select Male Voice: `Fenrir`.
  4. Click **Save Persona**.
  5. Select "Tech Guru" as active and chat with JARVIS.
- **Expected Results:** New persona is persisted in Supabase; responses adhere to bulleted architectural format; audio uses Fenrir voice.
- **Status:** PASS / FAIL

### TC-09: Multilingual Propagation (Urdu / Hindi)
- **Prerequisites:** Controls sidebar visible.
- **Steps:**
  1. Set Language dropdown to **Urdu**.
  2. Type or speak: "Aaj ka mausam kaisa hai?" (Roman Urdu) or Urdu script.
  3. Send request.
- **Expected Results:** JARVIS responds in natural Urdu. Text displays correctly; TTS pronounces the words accurately.
- **Status:** PASS / FAIL

---

## Suite 4: Long-Term Memory (pgvector)

### TC-10: Explicit Fact Storing & Recall
- **Prerequisites:** Connected to Supabase backend.
- **Steps:**
  1. Open **Settings** tab.
  2. In "Remember a fact", enter: "I prefer working exclusively with TypeScript and PostgreSQL."
  3. Click **Store**. Verify fact appears in the memories list.
  4. Return to Console and start a fresh session: "What database stack should we choose for our next backend?"
- **Expected Results:** Assistant explicitly references user's stored preference for TypeScript and PostgreSQL.
- **Status:** PASS / FAIL

### TC-11: Memory Deletion
- **Prerequisites:** Stored memory from TC-10.
- **Steps:**
  1. Open Settings tab.
  2. Click **Delete** next to the stored preference. Confirm prompt.
  3. Refresh memories to verify removal.
  4. Ask the assistant again: "What database stack should we choose?"
- **Expected Results:** Deleted memory is no longer injected into context or referenced.
- **Status:** PASS / FAIL

---

## Suite 5: Windows Desktop Controls

### TC-12: Application Launching & Ambiguity Handling
- **Prerequisites:** Running inside packaged or dev Electron desktop app.
- **Steps:**
  1. In Console, ask: "Open Calculator."
  2. Verify Windows Calculator opens.
  3. Ask: "Open visual studio."
- **Expected Results:** Calculator opens automatically (safe action). For ambiguous requests matching multiple apps (e.g. Visual Studio vs VS Code), JARVIS prompts for clarification with exact choices.
- **Status:** PASS / FAIL

### TC-13: Window Manipulation & Safe Confirmation
- **Prerequisites:** Notepad is open on the desktop.
- **Steps:**
  1. Ask: "Minimize Notepad."
  2. Confirmation card appears: `Confirm window_control?`
  3. Click **Approve**.
- **Expected Results:** Action executes only after user approval; Notepad window minimizes smoothly.
- **Status:** PASS / FAIL

### TC-14: System Volume & Settings
- **Prerequisites:** Audio device connected.
- **Steps:**
  1. In Windows Tool Console, select `system_volume` with args `{"action": "up"}`.
  2. Approve the confirmation.
- **Expected Results:** Windows master audio volume increments by 2 steps.
- **Status:** PASS / FAIL

---

## Suite 6: Video Studio Workstation

### TC-15: FFmpeg Diagnostics
- **Prerequisites:** Open Video Studio tab.
- **Steps:**
  1. Inspect the Readiness Check panel.
  2. Verify FFmpeg and FFprobe status are green.
- **Expected Results:** Detected executable and version are reported honestly. If missing, the app offers the consent-gated winget installer.
- **Status:** PASS / FAIL

### TC-16: Local Video Editing Pipeline
- **Prerequisites:** A sample 10-second test MP4 file.
- **Steps:**
  1. Select **Local FFmpeg (Free)** engine.
  2. Provide input path and output path.
  3. Add operations: Trim (0s to 5s), Convert to Vertical Reel (9:16), Apply Cinematic filter.
  4. Click **Render Video**.
- **Expected Results:** Progress updates through each step ("Rendering trim", "Rendering aspect", "Rendering filter"). Final MP4 renders successfully to the destination path without errors.
- **Status:** PASS / FAIL

---

## Suite 7: Android Companion

### TC-17: Secure Single-Use Device Pairing
- **Prerequisites:** Windows JARVIS running; Android APK installed on test phone.
- **Steps:**
  1. On PC, open **Devices** tab and click **Create Pairing Code**.
  2. Note the 32-character code (valid for 3 minutes).
  3. On Android phone, tap **Pair**, enter the code, and tap submit.
- **Expected Results:** Phone exchanges code for device token stored in Keystore. Both PC and phone display connected/paired status. Reusing the same code fails.
- **Status:** PASS / FAIL

### TC-18: Remote Task Delegation (Phone to PC)
- **Prerequisites:** Android phone paired with PC; both apps open.
- **Steps:**
  1. On Android phone, say: "Send WhatsApp message to +1234567890 saying hello from mobile."
  2. Check the Windows PC screen.
- **Expected Results:** Android queues a draft. Nothing is sent automatically. The Windows PC displays a remote confirmation card showing recipient and message body. PC owner must explicitly approve the send.
- **Status:** PASS / FAIL
