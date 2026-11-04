// Comprehensive test suite for OfflineWakeDetector & pure phrase-matching logic.
// Tests run in Node.js with native --test runner.

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

// Helper: Setup browser stubs for tests that instantiate OfflineWakeDetector
function setupBrowserStubs(opts = {}) {
  const g = globalThis;
  g.window = g;

  if (opts.noSpeechAPI) {
    delete g.SpeechRecognition;
    delete g.webkitSpeechRecognition;
  } else {
    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart = null;
      onresult = null;
      onerror = null;
      onend = null;
      _started = false;
      _stopped = false;

      start() {
        this._started = true;
        this._stopped = false;
        setTimeout(() => {
          if (this._started && !this._stopped) {
            this.onstart?.();
          }
        }, 0);
      }

      stop() {
        this._started = false;
        this._stopped = true;
      }

      fireResult(transcript, confidence, isFinal = true) {
        const item = {transcript};
        if (confidence !== undefined) item.confidence = confidence;
        const event = {
          resultIndex: 0,
          results: [{0: item, length: 1, isFinal}]
        };
        event.results[0][Symbol.iterator] = function*() { yield item; };
        this.onresult?.(event);
      }

      fireError(code) {
        this.onerror?.({error: code});
      }

      fireEnd() {
        this.onend?.();
      }
    }
    g.SpeechRecognition = FakeSpeechRecognition;
    g.webkitSpeechRecognition = FakeSpeechRecognition;
  }

  g.AudioContext = class {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        type: 'sine',
        frequency: {setValueAtTime() {}, exponentialRampToValueAtTime() {}},
        connect() {},
        start() {},
        stop() {}
      };
    }
    createGain() {
      return {
        gain: {setValueAtTime() {}, exponentialRampToValueAtTime() {}},
        connect() {}
      };
    }
    close() {}
  };
  g.webkitAudioContext = g.AudioContext;

  g.MediaRecorder = class {
    constructor(_stream, _opts) {}
    ondataavailable = null;
    onstop = null;
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
    static isTypeSupported() { return true; }
  };

  try {
    Object.defineProperty(g, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [{stop: () => {}}]
          })
        }
      },
      configurable: true,
      writable: true
    });
  } catch {}
}

function teardownBrowserStubs() {
  const g = globalThis;
  delete g.window;
  delete g.SpeechRecognition;
  delete g.webkitSpeechRecognition;
  delete g.AudioContext;
  delete g.webkitAudioContext;
  delete g.MediaRecorder;
}

// ── Load module with stubs active ───────────────────────────────────────────
setupBrowserStubs();
const {OfflineWakeDetector, matchWakePhrase, normalizePhrase} = await import('../lib/offline-wake-detector.ts');
teardownBrowserStubs();

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Pure Phrase Matching (Fix 1 verification)
// ─────────────────────────────────────────────────────────────────────────────
describe('Pure Phrase Matching — matchWakePhrase', () => {
  test('matches exact configured phrase "Hey Jarvis"', () => {
    const res = matchWakePhrase('hey jarvis', 'Hey Jarvis');
    assert.equal(res.detected, true);
    assert.equal(res.matchedPhrase, 'hey jarvis');
    assert.equal(res.commandAfter, '');
  });

  test('extracts inline command after configured wake phrase', () => {
    const res = matchWakePhrase('hey jarvis what time is it', 'Hey Jarvis');
    assert.equal(res.detected, true);
    assert.equal(res.commandAfter, 'what time is it');
  });

  test('normalizes punctuation and irregular spacing without breaking match', () => {
    const res = matchWakePhrase('  Hey,   Jarvis!   Open the calculator.  ', 'Hey Jarvis');
    assert.equal(res.detected, true);
    assert.equal(res.commandAfter, 'open the calculator');
  });

  test('custom phrase "Computer" triggers on "Computer"', () => {
    const res = matchWakePhrase('computer open youtube', 'Computer');
    assert.equal(res.detected, true);
    assert.equal(res.matchedPhrase, 'computer');
    assert.equal(res.commandAfter, 'open youtube');
  });

  test('CRITICAL: old default "Hey Jarvis" does NOT trigger when custom phrase is "Computer"', () => {
    const res = matchWakePhrase('hey jarvis open youtube', 'Computer');
    assert.equal(res.detected, false, 'Hey Jarvis must not trigger a custom phrase');
    assert.equal(res.matchedPhrase, '');
  });

  test('CRITICAL: standalone "Jarvis" does NOT trigger when custom phrase is "Computer"', () => {
    const res = matchWakePhrase('jarvis what is the weather', 'Computer');
    assert.equal(res.detected, false, 'Standalone Jarvis must not trigger custom Computer phrase');
  });

  test('unrelated speech does not trigger wake detection', () => {
    const phrases = [
      'good morning everyone',
      'can you hear me now',
      'this computer is very fast',
      'the weather in new york is rainy',
      'testing one two three'
    ];
    for (const p of phrases) {
      const res = matchWakePhrase(p, 'Hey Jarvis');
      assert.equal(res.detected, false, `"${p}" must not trigger "Hey Jarvis"`);
    }
  });

  test('word boundary precision: words containing target as substring do not trigger', () => {
    // "computerized" contains "computer", but should NOT trigger "Computer"
    const res1 = matchWakePhrase('we need computerized systems', 'Computer');
    assert.equal(res1.detected, false, '"computerized" must not trigger "Computer"');

    // "jarvises" contains "jarvis", but should NOT trigger "Jarvis"
    const res2 = matchWakePhrase('the jarvises are arriving', 'Jarvis');
    assert.equal(res2.detected, false, '"jarvises" must not trigger "Jarvis"');
  });

  test('explicitly configured aliases work alongside main phrase', () => {
    const res1 = matchWakePhrase('assistant what is the time', 'Jarvis', ['assistant']);
    assert.equal(res1.detected, true);
    assert.equal(res1.matchedPhrase, 'assistant');
    assert.equal(res1.commandAfter, 'what is the time');

    const res2 = matchWakePhrase('jarvis what is the time', 'Jarvis', ['assistant']);
    assert.equal(res2.detected, true);
    assert.equal(res2.matchedPhrase, 'jarvis');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Single-Shot Command Execution (Fix 2 verification)
// ─────────────────────────────────────────────────────────────────────────────
describe('OfflineWakeDetector — Single-shot turn execution', () => {
  test('when text recognition succeeds, mediaRecorder audio is NOT emitted', async () => {
    setupBrowserStubs();

    let textCallCount = 0;
    let audioCallCount = 0;
    let receivedText = '';

    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => {},
      onCommandText: (text) => {
        textCallCount++;
        receivedText = text;
      },
      onCommandCaptured: () => {
        audioCallCount++;
      }
    });

    await detector.start();
    detector.startCommandCapture();

    // Grab the active command recognition instance
    const cmdRec = globalThis.SpeechRecognition;
    assert.ok(cmdRec);

    // Simulate speech recognition delivering a transcript
    const activeInstances = [];
    // Access the command recognition instance on detector
    const commandRec = detector['commandRecognition'];
    assert.ok(commandRec, 'Command recognition should be initialized');

    // Add dummy audio chunks to recorder to simulate active recording
    detector['commandChunks'] = [new Blob(['test-audio'], {type: 'audio/webm'})];

    // Fire text result
    commandRec.fireResult('open the browser');

    // Verify text callback was invoked
    assert.equal(textCallCount, 1, 'onCommandText must fire exactly once');
    assert.equal(receivedText, 'open the browser');

    // Verify audio chunks were cleared and onCommandCaptured was NOT called
    assert.equal(audioCallCount, 0, 'onCommandCaptured must NOT fire when text recognition succeeded');
    assert.equal(detector['commandChunks'].length, 0, 'Command chunks must be emptied to prevent late audio emission');

    detector.stop();
    teardownBrowserStubs();
  });

  test('when text recognition produces no transcript, audio blob fallback is emitted exactly once', async () => {
    setupBrowserStubs();

    let textCallCount = 0;
    let audioCallCount = 0;

    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => {},
      onCommandText: () => { textCallCount++; },
      onCommandCaptured: () => { audioCallCount++; }
    });

    await detector.start();
    detector.startCommandCapture();

    const commandRec = detector['commandRecognition'];
    assert.ok(commandRec);

    // Simulate recorder capturing chunks
    detector['commandChunks'] = [new Blob(['audio-bytes'], {type: 'audio/webm'})];

    // Simulate text recognition failing / ending with no transcript
    commandRec.fireError('no-speech');

    // Finish capture (e.g. timeout or silence threshold)
    detector.finishCommandCapture();

    // Verify audio fallback fired once, text did not fire
    assert.equal(textCallCount, 0, 'onCommandText must not fire on silence/error');
    assert.equal(audioCallCount, 1, 'onCommandCaptured must fire exactly once as fallback');

    detector.stop();
    teardownBrowserStubs();
  });

  test('cancelCommandCapture discards chunks and prevents any callback from firing', async () => {
    setupBrowserStubs();

    let textCallCount = 0;
    let audioCallCount = 0;

    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => {},
      onCommandText: () => { textCallCount++; },
      onCommandCaptured: () => { audioCallCount++; }
    });

    await detector.start();
    detector.startCommandCapture();

    detector['commandChunks'] = [new Blob(['audio-bytes'], {type: 'audio/webm'})];

    // User cancels capture
    detector.cancelCommandCapture();

    assert.equal(textCallCount, 0, 'onCommandText must not fire on cancel');
    assert.equal(audioCallCount, 0, 'onCommandCaptured must not fire on cancel');
    assert.equal(detector['commandChunks'].length, 0);

    detector.stop();
    teardownBrowserStubs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Wake Lifecycle & Error Handling
// ─────────────────────────────────────────────────────────────────────────────
describe('OfflineWakeDetector — Lifecycle & Error States', () => {
  test('transitions to api_unavailable when SpeechRecognition is missing', async () => {
    setupBrowserStubs({noSpeechAPI: true});

    let state = 'disabled';
    let errorMsg = '';

    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => {},
      onCommandCaptured: () => {},
      onStateChange: (s) => { state = s; },
      onError: (err) => { errorMsg = err; }
    });

    await detector.start();

    assert.equal(state, 'api_unavailable');
    assert.ok(errorMsg.includes('Push-to-Talk') || errorMsg.includes('unavailable'));

    teardownBrowserStubs();
  });

  test('cooldown prevents duplicate wake triggers within cooldown window', async () => {
    setupBrowserStubs();

    let wakeCount = 0;
    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => { wakeCount++; },
      onCommandCaptured: () => {}
    });

    await detector.start();

    // Trigger first detection
    detector['triggerWakeDetected']('');
    assert.equal(wakeCount, 1);

    // Immediate second trigger within cooldown
    const rec = detector['recognition'];
    if (rec) {
      rec.fireResult('hey jarvis');
      // Should still be 1 because lastWakeTime prevents second trigger
      assert.equal(wakeCount, 1, 'Duplicate detection in cooldown must be suppressed');
    }

    detector.stop();
    teardownBrowserStubs();
  });

  test('suspend() transitions to suspended and stops all recognition', async () => {
    setupBrowserStubs();

    let currentState = 'disabled';
    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => {},
      onCommandCaptured: () => {},
      onStateChange: (s) => { currentState = s; }
    });

    await detector.start();
    detector.suspend();

    assert.equal(currentState, 'suspended');
    assert.equal(detector['isSuspended'], true);

    detector.stop();
    teardownBrowserStubs();
  });

  test('resumeWithGrace resumes listening after grace period', async () => {
    setupBrowserStubs();

    let currentState = 'disabled';
    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: () => {},
      onCommandCaptured: () => {},
      onStateChange: (s) => { currentState = s; }
    });

    await detector.start();
    detector.suspend();
    assert.equal(currentState, 'suspended');

    detector.resumeWithGrace(50);
    assert.equal(currentState, 'suspended', 'Must remain suspended during grace period');

    await new Promise(r => setTimeout(r, 120));
    assert.ok(['listening', 'initializing'].includes(currentState), 'Should resume after grace period');

    detector.stop();
    teardownBrowserStubs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Complete Recognition-to-Callback Integration Path (Bug 1 verification)
// ─────────────────────────────────────────────────────────────────────────────
describe('OfflineWakeDetector — End-to-End Recognition Integration', () => {
  test('speech event triggers onWakeDetected, extracts inline command, enforces single cooldown and phrase change', async () => {
    setupBrowserStubs();

    let wakeDetectedCalls = [];
    let commandTextCalls = [];

    const detector = new OfflineWakeDetector({
      wakePhrase: 'Hey Jarvis',
      onWakeDetected: (phrase, _startCapture) => {
        wakeDetectedCalls.push(phrase);
      },
      onCommandText: (cmd) => {
        commandTextCalls.push(cmd);
      },
      onCommandCaptured: () => {}
    });

    // 1. Start detector
    await detector.start();
    const rec = detector['recognition'];
    assert.ok(rec, 'SpeechRecognition instance must be created');

    // 2. Fire speech recognition result containing configured phrase with inline command
    rec.fireResult('Hey Jarvis open the calculator');

    // 3. Verify onWakeDetected fired exactly once
    assert.equal(wakeDetectedCalls.length, 1, 'onWakeDetected must fire exactly once on wake phrase');
    assert.equal(wakeDetectedCalls[0], 'Hey Jarvis');

    // 4. Verify inline command extraction worked through the callback path
    assert.equal(commandTextCalls.length, 1, 'onCommandText must receive the inline command');
    assert.equal(commandTextCalls[0], 'open the calculator');

    // 5. Verify a second activation within cooldown is suppressed
    rec.fireResult('Hey Jarvis open the browser');
    assert.equal(wakeDetectedCalls.length, 1, 'Second wake trigger within cooldown must be suppressed');
    assert.equal(commandTextCalls.length, 1);

    // 6. Advance past cooldown window (manually adjust lastWakeTime to simulate cooldown expiration)
    detector['lastWakeTime'] = Date.now() - 4000;

    // Fire again after cooldown
    rec.fireResult('Hey Jarvis what time is it');
    assert.equal(wakeDetectedCalls.length, 2, 'Activation must succeed again after cooldown window');
    assert.equal(commandTextCalls.length, 2);
    assert.equal(commandTextCalls[1], 'what time is it');

    // 7. Verify changing the configured phrase changes the actual trigger
    detector.setWakePhrase('Computer');
    detector['lastWakeTime'] = Date.now() - 4000;

    // Speaking the old phrase "Hey Jarvis" must NOT trigger
    rec.fireResult('Hey Jarvis open settings');
    assert.equal(wakeDetectedCalls.length, 2, 'Old phrase "Hey Jarvis" must not trigger after changing to "Computer"');

    // Speaking the new phrase "Computer" must trigger
    rec.fireResult('Computer turn volume up');
    assert.equal(wakeDetectedCalls.length, 3, 'New phrase "Computer" must trigger successfully');
    assert.equal(wakeDetectedCalls[2], 'Computer');
    assert.equal(commandTextCalls[2], 'turn volume up');

    detector.stop();
    teardownBrowserStubs();
  });
});
