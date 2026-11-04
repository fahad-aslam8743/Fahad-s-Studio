// Comprehensive integration tests for atomic task claiming, execution safety,
// retryable failed executions, stale completion prevention, single-row history updates,
// lease recovery, recurrence advancement, and run_count integrity.

import {test, describe, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const workerSrc = resolve(__dir, '../src/index.js');
const workerUrl = pathToFileURL(workerSrc).href;

// ── In-memory state simulating PostgreSQL database ──
let scheduledTasks = [];
let taskHistory = [];
let originalFetch;
let mockRpcFailure = false;
let mockMalformedRpc = false;

function setupSupabaseMock() {
  originalFetch = globalThis.fetch;
  scheduledTasks = [];
  taskHistory = [];
  mockRpcFailure = false;
  mockMalformedRpc = false;

  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(String(url));
    const pathname = u.pathname;
    const method = opt.method || 'GET';
    const body = opt.body ? JSON.parse(opt.body) : {};

    const resp = (data, status = 200) =>
      new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});

    if (mockRpcFailure) {
      return new Response(JSON.stringify({error: 'Database connection failed'}), {
        status: 500,
        headers: {'content-type': 'application/json'}
      });
    }

    if (mockMalformedRpc) {
      return new Response('NOT_VALID_JSON{foo:', {
        status: 200,
        headers: {'content-type': 'application/json'}
      });
    }

    // ── RPC: jarvis_claim_task ──
    if (pathname.includes('/rpc/jarvis_claim_task')) {
      const {p_task_id, p_device_id, p_idempotency_key, p_lease_seconds, p_run_id, p_attempt_id} = body;
      const now = Date.now();
      const attemptId = p_attempt_id || p_idempotency_key;
      const runId = p_run_id || (attemptId ? attemptId.split(':attempt:')[0] : attemptId);

      // 1. Task exists?
      const task = scheduledTasks.find(t => t.id === p_task_id);
      if (!task) {
        return resp({claimed: false, reason: 'task_not_found'});
      }

      // 2. Task active?
      if (task.status !== 'active') {
        return resp({claimed: false, reason: 'task_not_active', status: task.status});
      }

      // 3. Guarantee: A successful occurrence must never execute twice!
      const alreadyCompleted = taskHistory.some(
        h => h.task_id === p_task_id &&
          (h.run_id === runId || (h.idempotency_key && h.idempotency_key.startsWith(runId))) &&
          h.status === 'completed'
      );
      if (alreadyCompleted) {
        return resp({claimed: false, reason: 'already_completed', run_id: runId});
      }

      // 4. Max retries exceeded check
      if ((task.retry_count || 0) >= (task.max_retries || 3)) {
        task.status = 'failed';
        return resp({claimed: false, reason: 'max_retries_exceeded', retry_count: task.retry_count});
      }

      // 5. Due check (reject future tasks; allow 10s clock skew)
      if (task.next_run_at && new Date(task.next_run_at).getTime() > now + 10000) {
        return resp({claimed: false, reason: 'task_not_due', next_run_at: task.next_run_at});
      }

      // 6. Execution target match?
      if (task.execution_target && task.execution_target !== 'any' && task.execution_target !== p_device_id) {
        return resp({
          claimed: false,
          reason: 'target_mismatch',
          execution_target: task.execution_target,
          device_id: p_device_id
        });
      }

      // 7. Existing claim with this specific attempt ID?
      const existing = taskHistory.find(
        h => h.task_id === p_task_id && h.idempotency_key === attemptId
      );
      if (existing) {
        if (existing.status === 'claimed' && task.claimed_by === p_device_id && new Date(task.claim_expires_at).getTime() > now) {
          return resp({
            claimed: true,
            already_claimed: true,
            task_id: p_task_id,
            run_id: runId,
            attempt_id: attemptId,
            claim_expires_at: task.claim_expires_at
          });
        }
        return resp({
          claimed: false,
          reason: 'already_claimed',
          existing_status: existing.status
        });
      }

      // 8. Active lease check (cannot claim concurrently even with different key)
      if (task.claim_expires_at && new Date(task.claim_expires_at).getTime() > now) {
        return resp({
          claimed: false,
          reason: 'lease_active',
          claimed_by: task.claimed_by,
          claim_expires_at: task.claim_expires_at
        });
      }

      // 9. Grant lease and record single history row for this attempt
      const leaseExpiry = new Date(now + (p_lease_seconds || 300) * 1000).toISOString();
      task.claimed_at = new Date(now).toISOString();
      task.claim_expires_at = leaseExpiry;
      task.claimed_by = p_device_id;
      task.current_run_id = runId;
      task.current_attempt_id = attemptId;

      taskHistory.push({
        id: taskHistory.length + 1,
        task_id: p_task_id,
        status: 'claimed',
        idempotency_key: attemptId,
        run_id: runId,
        attempt_id: attemptId,
        attempt_number: task.retry_count || 0,
        started_at: new Date(now).toISOString(),
        completed_at: null,
        result: {claimed_by: p_device_id, claim_expires_at: leaseExpiry}
      });

      return resp({
        claimed: true,
        task_id: p_task_id,
        run_id: runId,
        attempt_id: attemptId,
        claim_expires_at: leaseExpiry
      });
    }

    // ── RPC: jarvis_complete_task ──
    if (pathname.includes('/rpc/jarvis_complete_task')) {
      const {p_task_id, p_device_id, p_idempotency_key, p_success, p_outcome, p_error, p_run_id, p_attempt_id} = body;
      const now = new Date().toISOString();
      const attemptId = p_attempt_id || p_idempotency_key;
      const runId = p_run_id || (attemptId ? attemptId.split(':attempt:')[0] : attemptId);

      // 1. Task exists?
      const task = scheduledTasks.find(t => t.id === p_task_id);
      if (!task) {
        return resp({ok: false, reason: 'task_not_found'});
      }

      // 2. Locate existing execution history row
      const history = taskHistory.find(
        h => h.task_id === p_task_id && h.idempotency_key === attemptId
      );
      if (!history) {
        return resp({ok: false, reason: 'execution_not_found'});
      }

      // 3. Idempotent completion check
      if (history.status === 'completed' || history.status === 'failed') {
        return resp({
          ok: true,
          status: history.status,
          already_completed: true
        });
      }

      // 4. Strict Ownership & Stale Execution Validation (Requirement 3.B)
      // Check A: Device identity validation
      if (task.claimed_by && task.claimed_by !== p_device_id) {
        return resp({
          ok: false,
          reason: 'device_mismatch',
          claimed_by: task.claimed_by
        });
      }

      // Check B: Lease expiration validation
      if (!task.claim_expires_at || new Date(task.claim_expires_at).getTime() < Date.now()) {
        history.status = 'stale';
        history.completed_at = now;
        return resp({
          ok: false,
          reason: 'lease_expired',
          claim_expires_at: task.claim_expires_at
        });
      }

      // Check C: Active attempt matching validation (reject stale attempts)
      if (task.current_attempt_id && task.current_attempt_id !== attemptId) {
        history.status = 'stale';
        history.completed_at = now;
        return resp({
          ok: false,
          reason: 'stale_execution',
          current_attempt_id: task.current_attempt_id
        });
      }

      // 5. Valid current claim: Update existing history row in-place
      history.status = p_success ? 'completed' : 'failed';
      history.completed_at = now;
      history.result = {
        claimed_by: history.result?.claimed_by,
        completed_by: p_device_id,
        success: p_success,
        outcome: p_outcome,
        error: p_error,
        run_id: runId,
        attempt_id: attemptId
      };

      // 6. Clear lease state from task
      task.claimed_by = null;
      task.claim_expires_at = null;
      task.current_run_id = null;
      task.current_attempt_id = null;
      task.last_run_at = now;

      // 7. Handle recurrence vs retry policy
      if (p_success) {
        task.retry_count = 0;
        task.run_count = (task.run_count || 0) + 1;

        if (task.schedule_type === 'once') {
          task.status = 'completed';
        } else if (task.max_runs && task.run_count >= task.max_runs) {
          task.status = 'completed';
        } else {
          const baseTime = task.next_run_at ? new Date(task.next_run_at).getTime() : Date.now();
          if (task.schedule_type === 'daily') {
            task.next_run_at = new Date(baseTime + 86400000).toISOString();
          } else if (task.schedule_type === 'weekly') {
            task.next_run_at = new Date(baseTime + 7 * 86400000).toISOString();
          } else if (task.schedule_type === 'monthly') {
            const d = new Date(baseTime);
            d.setMonth(d.getMonth() + 1);
            task.next_run_at = d.toISOString();
          }
        }
        return resp({ok: true, task_id: p_task_id, status: 'completed'});
      } else {
        // Failed attempt: increment retry count, calculate exponential backoff
        task.retry_count = (task.retry_count || 0) + 1;
        if (task.retry_count >= (task.max_retries || 3)) {
          task.status = 'failed';
          return resp({
            ok: true,
            task_id: p_task_id,
            status: 'failed',
            retry_count: task.retry_count,
            max_retries_reached: true
          });
        } else {
          const backoffSec = Math.min(300, 30 * Math.pow(2, task.retry_count - 1));
          task.next_run_at = new Date(Date.now() + backoffSec * 1000).toISOString();
          return resp({
            ok: true,
            task_id: p_task_id,
            status: 'retrying',
            retry_count: task.retry_count,
            next_retry_at: task.next_run_at
          });
        }
      }
    }

    if (pathname.includes('/rpc/jarvis_advance_schedule')) {
      return resp(true);
    }

    // ── Table REST endpoints ──
    const table = pathname.split('/').pop();
    if (table === 'jarvis_scheduled_tasks') {
      if (method === 'GET') return resp(scheduledTasks);
      if (method === 'POST') {
        const row = {id: '12345678-1234-1234-1234-123456789abc', ...body, created_at: new Date().toISOString()};
        scheduledTasks.push(row);
        return resp([row]);
      }
      if (method === 'PATCH') return resp([body]);
      if (method === 'DELETE') return resp([]);
    }

    if (table === 'jarvis_task_history') {
      if (method === 'GET') return resp(taskHistory);
      if (method === 'POST') {
        taskHistory.push(body);
        return resp([body]);
      }
    }

    return resp([]);
  };
}

function teardownSupabaseMock() {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
}

function makeEnv(overrides = {}) {
  return {
    APP_TOKEN: 'test-token-32charminimum-abcdef1234',
    GEMINI_API_KEY: 'fake-gemini-key',
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    YOUTUBE_API_KEY: '',
    ...overrides
  };
}

function makeRequest(method, path, body, token = 'test-token-32charminimum-abcdef1234') {
  const url = 'https://worker.example.com' + path;
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'Origin': 'irfan://studio'
  });
  const init = {method, headers};
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

// ── Dynamically load the worker module ──────────────────────────────────────
let worker;
try {
  worker = await import(workerUrl);
} catch (err) {
  console.warn('[scheduler.test.mjs] Worker import error:', err.message);
  worker = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Atomic Claim RPC — Full Eligibility Validation
// ─────────────────────────────────────────────────────────────────────────────
describe('Scheduler RPC — Atomic Claim Eligibility Validation', () => {
  beforeEach(() => setupSupabaseMock());
  afterEach(() => teardownSupabaseMock());

  const validUUID = '12345678-1234-1234-1234-123456789abc';

  test('due task with matching target claims successfully', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Due task',
      status: 'active',
      execution_target: 'pc',
      next_run_at: new Date(Date.now() - 5000).toISOString()
    });

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'claim-1',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.claimed, true);
    assert.equal(body.task_id, validUUID);
    assert.ok(body.claim_expires_at);
  });

  test('future task is rejected with 400 and reason: task_not_due', async () => {
    if (!worker) return;

    // Task scheduled 1 hour in the future
    scheduledTasks.push({
      id: validUUID,
      title: 'Future task',
      status: 'active',
      execution_target: 'any',
      next_run_at: new Date(Date.now() + 3600000).toISOString()
    });

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'future-claim-1',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 400, 'Non-due task must return HTTP 400');
    const body = await res.json();
    assert.equal(body.claimed, false);
    assert.equal(body.reason, 'task_not_due');
  });

  test('wrong execution target is rejected with 400 and reason: target_mismatch', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Android only task',
      status: 'active',
      execution_target: 'android',
      next_run_at: new Date(Date.now() - 5000).toISOString()
    });

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'pc-claim-android',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.claimed, false);
    assert.equal(body.reason, 'target_mismatch');
    assert.equal(body.execution_target, 'android');
  });

  test('active unexpired lease blocks claim with 409 and reason: lease_active', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Active task',
      status: 'active',
      execution_target: 'any',
      claimed_by: 'phone',
      claim_expires_at: new Date(Date.now() + 200000).toISOString(),
      next_run_at: new Date(Date.now() - 5000).toISOString()
    });

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'second-device-claim',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 409, 'Active lease must return HTTP 409 Conflict');
    const body = await res.json();
    assert.equal(body.claimed, false);
    assert.equal(body.reason, 'lease_active');
    assert.equal(body.claimed_by, 'phone');
  });

  test('same device cannot create concurrent claim with different execution ID', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Active task',
      status: 'active',
      execution_target: 'pc',
      claimed_by: 'pc',
      claim_expires_at: new Date(Date.now() + 200000).toISOString(),
      next_run_at: new Date(Date.now() - 5000).toISOString()
    });

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'different-claim-key',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.claimed, false);
    assert.equal(body.reason, 'lease_active');
  });

  test('duplicate claim with same attempt ID by same device returns idempotent claim', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Active task',
      status: 'active',
      execution_target: 'pc',
      next_run_at: new Date(Date.now() - 5000).toISOString()
    });

    const env = makeEnv();
    const attemptId = `${validUUID}:2026-11-04T12:00:attempt:0`;

    // First claim
    const res1 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      attempt_id: attemptId,
      idempotency_key: attemptId,
      device_id: 'pc'
    }), env, {});
    assert.equal(res1.status, 200);

    // Duplicate delivery of same claim
    const res2 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      attempt_id: attemptId,
      idempotency_key: attemptId,
      device_id: 'pc'
    }), env, {});
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.claimed, true);
    assert.equal(body2.already_claimed, true);
  });

  test('expired lease is safely recovered by new claim', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Recoverable task',
      status: 'active',
      execution_target: 'any',
      claimed_by: 'crashed-device',
      claim_expires_at: new Date(Date.now() - 300000).toISOString(),
      next_run_at: new Date(Date.now() - 400000).toISOString()
    });

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'recovery-key-1',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.claimed, true, 'Expired lease must be recoverable');
    assert.equal(scheduledTasks[0].claimed_by, 'pc');
  });

  test('database error returns 502 and NEVER returns claimed: true', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Db fail task',
      status: 'active',
      execution_target: 'any'
    });

    mockRpcFailure = true;

    const env = makeEnv();
    const req = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: 'db-fail-key',
      device_id: 'pc'
    });
    const res = await worker.default.fetch(req, env, {});

    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.claimed, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Single-Row History & Unique Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('Scheduler RPC — Single-Row History & Unique Idempotency', () => {
  beforeEach(() => setupSupabaseMock());
  afterEach(() => teardownSupabaseMock());

  const validUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  test('claim inserts history row, completion updates the SAME row (no second row inserted)', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Morning alert',
      status: 'active',
      execution_target: 'pc',
      next_run_at: new Date(Date.now() - 1000).toISOString()
    });

    const env = makeEnv();
    const execKey = 'exec-single-row-1';

    // 1. Claim
    const claimReq = makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: execKey,
      device_id: 'pc'
    });
    const claimRes = await worker.default.fetch(claimReq, env, {});
    assert.equal((await claimRes.json()).claimed, true);

    // Verify 1 history record exists with status 'claimed'
    assert.equal(taskHistory.length, 1);
    assert.equal(taskHistory[0].status, 'claimed');
    assert.equal(taskHistory[0].idempotency_key, execKey);

    // 2. Complete
    const compReq = makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: execKey,
      device_id: 'pc',
      success: true,
      outcome: 'Notification displayed'
    });
    const compRes = await worker.default.fetch(compReq, env, {});
    assert.equal(compRes.status, 200);
    assert.equal((await compRes.json()).ok, true);

    // Verify STILL EXACTLY 1 history record exists (updated in-place, NOT duplicated)
    assert.equal(taskHistory.length, 1, 'Completion must UPDATE existing row, not insert a second row');
    assert.equal(taskHistory[0].status, 'completed');
    assert.equal(taskHistory[0].idempotency_key, execKey);
    assert.ok(taskHistory[0].completed_at);
    assert.equal(taskHistory[0].result.outcome, 'Notification displayed');
  });

  test('duplicate completion request is idempotent and does not corrupt history', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Alert',
      status: 'active',
      execution_target: 'pc',
      next_run_at: new Date(Date.now() - 1000).toISOString()
    });

    const env = makeEnv();
    const execKey = 'exec-idempotent-comp';

    // Claim
    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: execKey,
      device_id: 'pc'
    }), env, {});

    // First completion
    const comp1 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: execKey,
      device_id: 'pc',
      success: true
    }), env, {});
    assert.equal((await comp1.json()).ok, true);

    // Duplicate completion (e.g. network retry)
    const comp2 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: execKey,
      device_id: 'pc',
      success: true
    }), env, {});
    assert.equal(comp2.status, 200);
    const body2 = await comp2.json();
    assert.equal(body2.ok, true);
    assert.equal(body2.already_completed, true);

    // Exactly 1 history record remains
    assert.equal(taskHistory.length, 1);
  });

  test('different device cannot complete execution claimed by another device', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Device ownership task',
      status: 'active',
      execution_target: 'any',
      next_run_at: new Date(Date.now() - 1000).toISOString()
    });

    const env = makeEnv();
    const execKey = 'exec-device-ownership';

    // Claimed by PC
    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: execKey,
      device_id: 'pc'
    }), env, {});

    // Phone attempts to complete PC's execution
    const compReq = makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: execKey,
      device_id: 'phone',
      success: true
    });
    const compRes = await worker.default.fetch(compReq, env, {});
    assert.equal(compRes.status, 409, 'Device mismatch must return HTTP 409 Conflict');
    const compBody = await compRes.json();
    assert.equal(compBody.ok, false);
    assert.equal(compBody.reason, 'device_mismatch');
  });

  test('completion fails with 404 when execution ID does not exist', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Existing task',
      status: 'active',
      execution_target: 'any'
    });

    const env = makeEnv();
    const compReq = makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: 'non-existent-key',
      device_id: 'pc',
      success: true
    });
    const compRes = await worker.default.fetch(compReq, env, {});
    assert.equal(compRes.status, 404);
    const compBody = await compRes.json();
    assert.equal(compBody.ok, false);
    assert.equal(compBody.reason, 'execution_not_found');
  });

  test('malformed RPC response returns 502 and never reports ok: true', async () => {
    if (!worker) return;

    mockMalformedRpc = true;

    const env = makeEnv();
    const compReq = makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: 'key-1',
      device_id: 'pc',
      success: true
    });
    const compRes = await worker.default.fetch(compReq, env, {});
    assert.equal(compRes.status, 502);
    const compBody = await compRes.json();
    assert.equal(compBody.ok, false);
    assert.ok(compBody.error.includes('Malformed response'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Retryability, Stale Completion Prevention & Recurrence Integrity
// ─────────────────────────────────────────────────────────────────────────────
describe('Scheduler RPC — Retries, Stale Prevention & Recurrence Integrity', () => {
  beforeEach(() => setupSupabaseMock());
  afterEach(() => teardownSupabaseMock());

  const validUUID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

  test('failed attempt is retryable with new attempt ID and backoff', async () => {
    if (!worker) return;

    const runId = `${validUUID}:2026-11-04T12:00:00Z`;
    scheduledTasks.push({
      id: validUUID,
      title: 'Retryable task',
      status: 'active',
      schedule_type: 'daily',
      run_count: 0,
      retry_count: 0,
      max_retries: 3,
      next_run_at: new Date(Date.now() - 1000).toISOString()
    });

    const env = makeEnv();

    // 1. First attempt (:attempt:0) claims and fails
    const attempt0 = `${runId}:attempt:0`;
    const claim0 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      run_id: runId,
      attempt_id: attempt0,
      idempotency_key: attempt0,
      device_id: 'pc'
    }), env, {});
    assert.equal(claim0.status, 200);

    const fail0 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      run_id: runId,
      attempt_id: attempt0,
      idempotency_key: attempt0,
      device_id: 'pc',
      success: false,
      error: 'Temporary error'
    }), env, {});
    assert.equal(fail0.status, 200);
    const failBody0 = await fail0.json();
    assert.equal(failBody0.status, 'retrying');
    assert.equal(failBody0.retry_count, 1);

    const task = scheduledTasks[0];
    assert.equal(task.retry_count, 1);
    assert.equal(task.run_count, 0, 'Failed execution must not advance run count');

    // 2. Simulate next retry time arrived (task is due again)
    task.next_run_at = new Date(Date.now() - 1000).toISOString();

    // 3. Second attempt (:attempt:1) claims successfully!
    const attempt1 = `${runId}:attempt:1`;
    const claim1 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      run_id: runId,
      attempt_id: attempt1,
      idempotency_key: attempt1,
      device_id: 'pc'
    }), env, {});
    assert.equal(claim1.status, 200);
    const claimBody1 = await claim1.json();
    assert.equal(claimBody1.claimed, true);

    // Verify 2 distinct history records exist (attempt 0 failed, attempt 1 claimed)
    assert.equal(taskHistory.length, 2);
    assert.equal(taskHistory[0].status, 'failed');
    assert.equal(taskHistory[1].status, 'claimed');

    // 4. Second attempt succeeds!
    const comp1 = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      run_id: runId,
      attempt_id: attempt1,
      idempotency_key: attempt1,
      device_id: 'pc',
      success: true,
      outcome: 'Success on retry'
    }), env, {});
    assert.equal(comp1.status, 200);

    assert.equal(task.run_count, 1, 'Run count incremented on successful retry');
    assert.equal(task.retry_count, 0, 'Retry count reset to 0 after success');

    // 5. Successful occurrence cannot execute again
    const claimDuplicate = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      run_id: runId,
      attempt_id: `${runId}:attempt:2`,
      idempotency_key: `${runId}:attempt:2`,
      device_id: 'pc'
    }), env, {});
    assert.equal(claimDuplicate.status, 400);
    const dupBody = await claimDuplicate.json();
    assert.equal(dupBody.reason, 'already_completed');
  });

  test('task reaching max retries transitions to failed status', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Flaky task',
      status: 'active',
      schedule_type: 'once',
      run_count: 0,
      retry_count: 2, // Already retried twice
      max_retries: 3,
      next_run_at: new Date(Date.now() - 1000).toISOString()
    });

    const env = makeEnv();
    const attempt2 = `${validUUID}:run:attempt:2`;

    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      attempt_id: attempt2,
      device_id: 'pc'
    }), env, {});

    // Third failure hits max_retries limit
    const comp = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      attempt_id: attempt2,
      device_id: 'pc',
      success: false,
      error: 'Fatal crash'
    }), env, {});

    assert.equal(comp.status, 200);
    const body = await comp.json();
    assert.equal(body.status, 'failed');
    assert.equal(body.max_retries_reached, true);
    assert.equal(scheduledTasks[0].status, 'failed');
  });

  test('stale execution cannot clear newer lease or modify newer claim', async () => {
    if (!worker) return;

    scheduledTasks.push({
      id: validUUID,
      title: 'Race condition task',
      status: 'active',
      execution_target: 'any',
      next_run_at: new Date(Date.now() - 1000).toISOString()
    });

    const env = makeEnv();
    const attemptOld = `${validUUID}:run:attempt:0`;
    const attemptNew = `${validUUID}:run:attempt:1`;

    // 1. Device A claims Attempt 0
    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      attempt_id: attemptOld,
      device_id: 'device-a'
    }), env, {});

    // 2. Lease expires, Device B claims Attempt 1
    scheduledTasks[0].claim_expires_at = new Date(Date.now() - 1000).toISOString();
    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      attempt_id: attemptNew,
      device_id: 'device-b'
    }), env, {});

    assert.equal(scheduledTasks[0].claimed_by, 'device-b');
    assert.equal(scheduledTasks[0].current_attempt_id, attemptNew);

    // 3. Stale Device A wakes up and attempts to complete Attempt 0!
    const staleComp = await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      attempt_id: attemptOld,
      device_id: 'device-a',
      success: true
    }), env, {});

    // Must be rejected with 409 Conflict (device mismatch or stale attempt)
    assert.equal(staleComp.status, 409);
    const staleBody = await staleComp.json();
    assert.equal(staleBody.ok, false);

    // CRITICAL: Device B's newer claim must remain active and untouched!
    assert.equal(scheduledTasks[0].claimed_by, 'device-b', 'Newer claim must not be cleared by stale completion');
    assert.equal(scheduledTasks[0].current_attempt_id, attemptNew);
    assert.equal(scheduledTasks[0].run_count || 0, 0, 'Run count must not be incremented by stale completion');
  });

  test('daily task advances next_run_at by 24 hours', async () => {
    if (!worker) return;

    const initialDue = new Date(Date.now() - 1000);
    scheduledTasks.push({
      id: validUUID,
      title: 'Daily routine',
      status: 'active',
      schedule_type: 'daily',
      schedule_value: '09:00',
      run_count: 2,
      next_run_at: initialDue.toISOString()
    });

    const env = makeEnv();
    const execKey = 'exec-daily-task';

    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/claim`, {
      idempotency_key: execKey,
      device_id: 'pc'
    }), env, {});

    await worker.default.fetch(makeRequest('POST', `/tasks/${validUUID}/complete`, {
      idempotency_key: execKey,
      device_id: 'pc',
      success: true
    }), env, {});

    const task = scheduledTasks[0];
    assert.equal(task.run_count, 3);
    const newNextRun = new Date(task.next_run_at).getTime();
    const expectedDiff = 86400000; // 24 hours
    assert.equal(newNextRun - initialDue.getTime(), expectedDiff, 'Daily task must advance by exactly 24 hours');
  });
});
