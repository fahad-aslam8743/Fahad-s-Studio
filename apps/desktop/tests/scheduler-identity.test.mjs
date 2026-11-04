import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getTaskRunId, getTaskAttemptId} from '../src/scheduler-identity.ts';

test('retry backoff preserves the scheduled occurrence identity', () => {
  const firstAttempt = {id:'task-1', next_run_at:'2026-11-04T10:00:00.000Z', retry_count:0};
  const runId = getTaskRunId(firstAttempt);
  assert.equal(getTaskAttemptId(firstAttempt), 'task-1:2026-11-04T10:00:00.000Z:attempt:0');
  const retry = {...firstAttempt, pending_run_id:runId, next_run_at:'2026-11-04T10:00:30.000Z', retry_count:1};
  assert.equal(getTaskRunId(retry), runId);
  assert.equal(getTaskAttemptId(retry), runId + ':attempt:1');
});

test('a new recurring occurrence uses its new scheduled timestamp', () => {
  const nextOccurrence = {id:'task-1', next_run_at:'2026-11-05T10:00:00.000Z', pending_run_id:null, retry_count:0};
  assert.equal(getTaskRunId(nextOccurrence), 'task-1:2026-11-05T10:00:00.000Z');
  assert.equal(getTaskAttemptId(nextOccurrence), 'task-1:2026-11-05T10:00:00.000Z:attempt:0');
});

test('missing or invalid scheduled timestamps fail closed', () => {
  assert.throws(() => getTaskRunId({id:'task-1'}), /no next_run_at/);
  assert.throws(() => getTaskRunId({id:'task-1', next_run_at:'not-a-date'}), /invalid next_run_at/);
});
