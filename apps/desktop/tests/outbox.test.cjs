// Unit tests for DurableOutbox (crash-safe local completion persistence)
// Verifies persistence, crash recovery, corruption quarantine, exponential backoff, and idempotent removal.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Require transpiled DurableOutbox from dist
const {DurableOutbox} = require('../dist/scheduler-outbox.js');

test.describe('DurableOutbox — Crash Safety & Reconciliation', () => {
  let tmpDir;
  let outboxPath;

  test.beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-outbox-test-'));
    outboxPath = path.join(tmpDir, 'scheduler-outbox.json');
  });

  test.afterEach(async () => {
    try {
      await fs.rm(tmpDir, {recursive: true, force: true});
    } catch {}
  });

  test('persists record to disk on enqueue before network delivery', async () => {
    const outbox = new DurableOutbox(outboxPath);
    await outbox.load();

    const payload = {
      idempotency_key: 'task-1:attempt:0',
      run_id: 'task-1:run-1',
      attempt_id: 'task-1:attempt:0',
      device_id: 'pc',
      success: true,
      outcome: 'Notification displayed',
      error: null
    };

    await outbox.enqueue('task-1:attempt:0', 'task-1', 'task-1:run-1', 'pc', payload);

    assert.equal(outbox.size(), 1);
    assert.equal(outbox.has('task-1:attempt:0'), true);

    // Verify file actually exists on disk and contains the record
    const content = await fs.readFile(outboxPath, 'utf8');
    const records = JSON.parse(content);
    assert.equal(Array.isArray(records), true);
    assert.equal(records.length, 1);
    assert.equal(records[0].taskId, 'task-1');
    assert.equal(records[0].payload.outcome, 'Notification displayed');
  });

  test('recovers pending records from disk after simulated application restart', async () => {
    const outbox1 = new DurableOutbox(outboxPath);
    await outbox1.load();

    const payload = {
      idempotency_key: 'task-reboot:attempt:0',
      run_id: 'task-reboot:run-1',
      attempt_id: 'task-reboot:attempt:0',
      device_id: 'pc',
      success: true,
      outcome: 'Action done before crash',
      error: null
    };

    await outbox1.enqueue('task-reboot:attempt:0', 'task-reboot', 'task-reboot:run-1', 'pc', payload);

    // Simulate crash/reboot: instantiate a fresh DurableOutbox on the same file path
    const outbox2 = new DurableOutbox(outboxPath);
    await outbox2.load();

    assert.equal(outbox2.size(), 1, 'Records must be recovered on startup');
    assert.equal(outbox2.has('task-reboot:attempt:0'), true);

    const pending = outbox2.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].payload.outcome, 'Action done before crash');
  });

  test('removes record permanently from disk upon server confirmation', async () => {
    const outbox = new DurableOutbox(outboxPath);
    await outbox.load();

    const payload = {
      idempotency_key: 'task-done:attempt:0',
      run_id: 'task-done:run-1',
      attempt_id: 'task-done:attempt:0',
      device_id: 'pc',
      success: true,
      outcome: 'Done',
      error: null
    };

    await outbox.enqueue('task-done:attempt:0', 'task-done', 'task-done:run-1', 'pc', payload);
    assert.equal(outbox.size(), 1);

    // Server acknowledged completion -> remove
    const removed = await outbox.remove('task-done:attempt:0');
    assert.equal(removed, true);
    assert.equal(outbox.size(), 0);
    assert.equal(outbox.has('task-done:attempt:0'), false);

    // Disk file must now have 0 records
    const content = await fs.readFile(outboxPath, 'utf8');
    const records = JSON.parse(content);
    assert.equal(records.length, 0);
  });

  test('calculates exponential backoff on retry failure', async () => {
    const outbox = new DurableOutbox(outboxPath);
    await outbox.load();

    const payload = {
      idempotency_key: 'task-retry:attempt:0',
      run_id: 'task-retry:run-1',
      attempt_id: 'task-retry:attempt:0',
      device_id: 'pc',
      success: true,
      outcome: 'Done',
      error: null
    };

    await outbox.enqueue('task-retry:attempt:0', 'task-retry', 'task-retry:run-1', 'pc', payload);

    const t0 = Date.now();
    await outbox.recordFailure('task-retry:attempt:0', '502 Bad Gateway');

    const record = outbox.getAll()[0];
    assert.equal(record.attemptCount, 1);
    assert.equal(record.lastError, '502 Bad Gateway');
    // First backoff is 2000ms (2s)
    assert.ok(record.nextRetryAt >= t0 + 1900 && record.nextRetryAt <= t0 + 2500);

    // Immediately after failure, it should NOT be in getPending() (since nextRetryAt is in future)
    const pendingNow = outbox.getPending();
    assert.equal(pendingNow.length, 0, 'Backoff must prevent immediate tight-loop retry');
  });

  test('quarantines corrupted file safely and starts fresh without crashing', async () => {
    // Write invalid, corrupted data to outbox path
    await fs.writeFile(outboxPath, 'MALFORMED_GARBAGE_JSON{{{{', 'utf8');

    const outbox = new DurableOutbox(outboxPath);
    // Should NOT throw!
    await outbox.load();

    assert.equal(outbox.size(), 0);

    // Check that a quarantined backup file was created
    const files = await fs.readdir(tmpDir);
    const quarantine = files.find(f => f.includes('scheduler-outbox.json.corrupted.'));
    assert.ok(quarantine, 'Corrupted file must be quarantined with timestamp');
  });
});
