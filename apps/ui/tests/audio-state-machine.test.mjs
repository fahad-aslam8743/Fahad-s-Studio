import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioStateMachine} from '../lib/audio-state-machine.ts';

test('Initial state is IDLE_LISTENING and accepts microphone input', () => {
  const sm = new AudioStateMachine();
  assert.equal(sm.getState(), 'IDLE_LISTENING');
  assert.equal(sm.isListening(), true);
  assert.equal(sm.canAcceptMicrophoneInput(), true);
  assert.equal(sm.isSpeakingOrDraining(), false);
});

test('Case A: Wake phrase alone triggers WAKE_DETECTED then acknowledgment SPEAKING then COMMAND_LISTENING', () => {
  const transitions = [];
  const sm = new AudioStateMachine({
    onStateTransition: (from, to, turnId) => transitions.push({from, to, turnId})
  });

  // User says "Hey Jarvis"
  const parsed = sm.parseTranscript('Hey Jarvis');
  assert.equal(parsed.hasWakeWord, true);
  assert.equal(parsed.isWakeOnly, true);
  assert.equal(parsed.cleanCommand, '');

  const res = sm.onWakeDetected();
  assert.equal(res.accepted, true);
  assert.ok(res.turnId.length > 0);
  assert.equal(sm.getState(), 'WAKE_DETECTED');

  // Assistant begins playing acknowledgment "Yes, sir?"
  const speakOk = sm.onSpeakingStart('Yes, sir?', res.turnId);
  assert.equal(speakOk, true);
  assert.equal(sm.getState(), 'SPEAKING');
  assert.equal(sm.canAcceptMicrophoneInput(), false); // Mic gated during speech!

  // Acknowledgment completes
  sm.onAcknowledgmentComplete(res.turnId);
  assert.equal(sm.getState(), 'COMMAND_LISTENING');
  assert.equal(sm.canAcceptMicrophoneInput(), true);

  // User speaks command: "Open Notepad"
  const cmdOk = sm.onCommandSubmitted('Open Notepad', res.turnId);
  assert.equal(cmdOk, true);
  assert.equal(sm.getState(), 'PROCESSING');
});

test('Case B: Wake phrase with instruction executes immediately without asking user to repeat', () => {
  const sm = new AudioStateMachine();

  // User says "Hey Jarvis, open Chrome"
  const parsed = sm.parseTranscript('Hey Jarvis, open Chrome');
  assert.equal(parsed.hasWakeWord, true);
  assert.equal(parsed.isWakeOnly, false);
  assert.equal(parsed.cleanCommand, 'open Chrome');

  const res = sm.onWakeDetected(parsed.cleanCommand);
  assert.equal(res.accepted, true);
  assert.equal(res.inlineCommand, 'open Chrome');
  assert.equal(sm.getState(), 'PROCESSING'); // Directly processing!
});

test('Case C: Multi-stage interaction executes and transitions through AUDIO_DRAIN to IDLE_LISTENING', async () => {
  const sm = new AudioStateMachine({
    drainDurationMs: 40 // short drain for test speed
  });

  // Step 1: Wake phrase
  const res = sm.onWakeDetected();
  assert.equal(res.accepted, true);

  // Step 2: Ack playback
  sm.onSpeakingStart('At your service.', res.turnId);
  sm.onAcknowledgmentComplete(res.turnId);
  assert.equal(sm.getState(), 'COMMAND_LISTENING');

  // Step 3: User directive
  sm.onCommandSubmitted('Open YouTube and search for relaxing music', res.turnId);
  assert.equal(sm.getState(), 'PROCESSING');

  // Step 4: Assistant speaks result
  sm.onSpeakingStart('Opened YouTube with relaxing music.', res.turnId);
  assert.equal(sm.getState(), 'SPEAKING');

  // Step 5: Speech completes -> enters AUDIO_DRAIN
  sm.onSpeakingComplete(res.turnId);
  assert.equal(sm.getState(), 'AUDIO_DRAIN');
  assert.equal(sm.canAcceptMicrophoneInput(), false);

  // Wait for drain to settle
  await new Promise(r => setTimeout(r, 60));
  assert.equal(sm.getState(), 'IDLE_LISTENING');
  assert.equal(sm.canAcceptMicrophoneInput(), true);
});

test('Case D: Wake phrase without instruction times out gracefully without looping', async () => {
  let timedOutTurn = null;
  const sm = new AudioStateMachine({
    commandTimeoutMs: 50,
    onTimeout: (turnId) => { timedOutTurn = turnId; }
  });

  const res = sm.onWakeDetected();
  sm.onSpeakingStart('Online, sir.', res.turnId);
  sm.onAcknowledgmentComplete(res.turnId);
  assert.equal(sm.getState(), 'COMMAND_LISTENING');

  // User remains silent -> timeout fires
  await new Promise(r => setTimeout(r, 80));
  assert.equal(timedOutTurn, res.turnId);
  assert.equal(sm.getState(), 'IDLE_LISTENING');
});

test('Self-Response Loop Elimination: Gating during SPEAKING and AUDIO_DRAIN', () => {
  const sm = new AudioStateMachine({cooldownMs: 0});

  const res = sm.onWakeDetected();
  sm.onSpeakingStart('Playing Kesariya on YouTube', res.turnId);

  // Assistant speaker is playing. Microphone hears acoustic energy that resembles "Hey Jarvis"
  const blockedWake1 = sm.onWakeDetected();
  assert.equal(blockedWake1.accepted, false); // BLOCKED!

  // Speech completes -> entering AUDIO_DRAIN
  sm.onSpeakingComplete(res.turnId);
  assert.equal(sm.getState(), 'AUDIO_DRAIN');

  // Room reverberation still ringing
  const blockedWake2 = sm.onWakeDetected();
  assert.equal(blockedWake2.accepted, false); // BLOCKED in drain!
});

test('Self-Response Loop Elimination: Acoustic speech echo rejection', () => {
  const sm = new AudioStateMachine();

  // Record an assistant speech event
  const res = sm.onWakeDetected();
  sm.onSpeakingStart('Now playing Kesariya on YouTube', res.turnId);
  sm.onSpeakingComplete(res.turnId);

  // If mic transcribes the assistant's own speech:
  assert.equal(sm.isEcho('Now playing Kesariya on YouTube'), true);
  assert.equal(sm.isEcho('Playing Kesariya on YouTube'), true);
  assert.equal(sm.isEcho('Kesariya on YouTube'), true);

  // Built-in acknowledgments are also detected as echo:
  assert.equal(sm.isEcho('Yes, sir.'), true);
  assert.equal(sm.isEcho('Yes I am listening'), true);
  assert.equal(sm.isEcho('Online, sir.'), true);

  // Legitimate user commands are NOT echos:
  assert.equal(sm.isEcho('Open calculator'), false);
  assert.equal(sm.isEcho('What is the weather in Lahore?'), false);
  assert.equal(sm.isEcho('Turn down the volume'), false);
});

test('Turn isolation: Stale turn events are safely ignored', () => {
  const sm = new AudioStateMachine();

  const res1 = sm.onWakeDetected();
  sm.onSpeakingStart('First response', res1.turnId);
  sm.onSpeakingComplete(res1.turnId);

  // Rapidly reset/advance turn
  sm.reset();
  const res2 = sm.onWakeDetected();

  // Delayed callback from turn 1 cannot hijack turn 2
  const staleCmd = sm.onCommandSubmitted('Old command', res1.turnId);
  assert.equal(staleCmd, false);

  const staleSpeak = sm.onSpeakingStart('Stale speak', res1.turnId);
  assert.equal(staleSpeak, false);
});

test('Interruption cleanly halts speaking and drains audio', async () => {
  const sm = new AudioStateMachine({drainDurationMs: 40});

  const res = sm.onWakeDetected();
  sm.onSpeakingStart('Long response that gets cancelled...', res.turnId);
  assert.equal(sm.getState(), 'SPEAKING');

  sm.interrupt();
  assert.equal(sm.getState(), 'AUDIO_DRAIN');

  await new Promise(r => setTimeout(r, 60));
  assert.equal(sm.getState(), 'IDLE_LISTENING');
});

test('Mute toggle disables listening and blocks wake detection', () => {
  const sm = new AudioStateMachine();
  sm.setMuted(true);
  assert.equal(sm.getState(), 'MUTED');
  assert.equal(sm.canAcceptMicrophoneInput(), false);

  const wake = sm.onWakeDetected();
  assert.equal(wake.accepted, false);

  sm.setMuted(false);
  assert.equal(sm.getState(), 'IDLE_LISTENING');
  assert.equal(sm.canAcceptMicrophoneInput(), true);
});

test('Windows sleep and resume lifecycle handling', () => {
  const sm = new AudioStateMachine();
  sm.onSystemSuspend();
  assert.equal(sm.getState(), 'MUTED');

  sm.onSystemResume();
  assert.equal(sm.getState(), 'IDLE_LISTENING');
});
