-- Fahad's Studio / JARVIS: Atomic Task Claiming, Execution Safety & Recurrence Integrity
-- Migration: 20261104_scheduler_claim_atomic.sql
-- Additive migration: Preserves existing data, tables, and policies
-- Features:
--   1. Stable run identity (run_id) and distinct attempt identity (attempt_id / idempotency_key).
--   2. Attempt retryability with exponential backoff and max retry limits.
--   3. Strict lease ownership and stale completion rejection (preventing prior executions from modifying newer claims).
--   4. Single-row history update per attempt, respecting unique idempotency index.
--   5. Consistent row-lock ordering (tasks -> history) preventing deadlocks.
--   6. Single authority for recurrence and run counts (jarvis_advance_schedule).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend jarvis_task_history with idempotency_key, run_id, attempt_id
-- ─────────────────────────────────────────────────────────────────────────────

-- Add idempotency_key, run_id, attempt_id columns if not present
ALTER TABLE public.jarvis_task_history
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS attempt_id text,
  ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 0;

-- Update CHECK constraint to permit full execution lifecycle states
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jarvis_task_history_status_check'
      AND conrelid = 'public.jarvis_task_history'::regclass
  ) THEN
    ALTER TABLE public.jarvis_task_history
      DROP CONSTRAINT jarvis_task_history_status_check;
  END IF;

  ALTER TABLE public.jarvis_task_history
    ADD CONSTRAINT jarvis_task_history_status_check
    CHECK (status IN (
      'claimed',
      'running',
      'completed',
      'failed',
      'skipped',
      'cancelled',
      'missed',
      'retrying',
      'stale'
    ));
END $$;

-- Create unique index: one execution record per task + attempt idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS jarvis_task_history_idempotency_idx
  ON public.jarvis_task_history (task_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Fast index for looking up completions by logical run_id
CREATE INDEX IF NOT EXISTS jarvis_task_history_run_id_idx
  ON public.jarvis_task_history (task_id, run_id, status)
  WHERE run_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add lease and current attempt tracking columns to jarvis_scheduled_tasks
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.jarvis_scheduled_tasks
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS current_run_id text,
  ADD COLUMN IF NOT EXISTS current_attempt_id text;

-- Fast index for discovering due active tasks
CREATE INDEX IF NOT EXISTS jarvis_tasks_due_idx
  ON public.jarvis_scheduled_tasks (status, next_run_at, execution_target)
  WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atomic Task Claim Procedure (RPC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_claim_task(
  p_task_id uuid,
  p_device_id text,
  p_idempotency_key text,
  p_lease_seconds integer DEFAULT 300,
  p_run_id text DEFAULT NULL,
  p_attempt_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_now timestamptz := now();
  v_lease_expiry timestamptz;
  v_existing_claim record;
  v_attempt_id text;
  v_run_id text;
  v_completed_exists boolean := false;
BEGIN
  -- Determine attempt_id and logical run_id
  v_attempt_id := COALESCE(p_attempt_id, p_idempotency_key);
  IF v_attempt_id IS NULL OR v_attempt_id = '' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'missing_attempt_identity');
  END IF;

  v_run_id := COALESCE(p_run_id, split_part(v_attempt_id, ':attempt:', 1), v_attempt_id);

  -- A. Row-level lock on the task row first (consistent lock order: tasks -> history)
  SELECT * INTO v_task
  FROM jarvis_scheduled_tasks
  WHERE id = p_task_id
  FOR UPDATE;

  -- 1. Validate task existence
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'task_not_found');
  END IF;

  -- 2. Validate task status
  IF v_task.status <> 'active' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'task_not_active', 'status', v_task.status);
  END IF;

  -- 3. Guarantee: A successful occurrence must never execute twice!
  SELECT EXISTS (
    SELECT 1 FROM jarvis_task_history
    WHERE task_id = p_task_id
      AND (run_id = v_run_id OR idempotency_key LIKE v_run_id || '%')
      AND status = 'completed'
  ) INTO v_completed_exists;

  IF v_completed_exists THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'already_completed',
      'run_id', v_run_id
    );
  END IF;

  -- 4. Validate maximum retries limit
  IF COALESCE(v_task.retry_count, 0) >= COALESCE(v_task.max_retries, 3) THEN
    UPDATE jarvis_scheduled_tasks
    SET status = 'failed',
        updated_at = v_now
    WHERE id = p_task_id;
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'max_retries_exceeded',
      'retry_count', v_task.retry_count,
      'max_retries', v_task.max_retries
    );
  END IF;

  -- 5. Validate task is due (reject future tasks; allow 10s clock skew)
  IF v_task.next_run_at IS NOT NULL AND v_task.next_run_at > (v_now + interval '10 seconds') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'task_not_due',
      'next_run_at', v_task.next_run_at
    );
  END IF;

  -- 6. Validate device is authorized for execution_target
  IF v_task.execution_target <> 'any' AND v_task.execution_target <> p_device_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'target_mismatch',
      'execution_target', v_task.execution_target,
      'device_id', p_device_id
    );
  END IF;

  -- 7. Check if this specific attempt identity was already claimed
  SELECT * INTO v_existing_claim
  FROM jarvis_task_history
  WHERE task_id = p_task_id AND idempotency_key = v_attempt_id;

  IF FOUND THEN
    -- If claimed by same device and lease is active, return idempotent claim confirmation
    IF v_existing_claim.status = 'claimed' AND v_task.claimed_by = p_device_id AND v_task.claim_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'claimed', true,
        'already_claimed', true,
        'task_id', p_task_id,
        'run_id', v_run_id,
        'attempt_id', v_attempt_id,
        'claim_expires_at', v_task.claim_expires_at
      );
    END IF;

    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'already_claimed',
      'existing_status', v_existing_claim.status
    );
  END IF;

  -- 8. Check active unexpired lease (prevents concurrent claims by another worker or attempt)
  IF v_task.claim_expires_at IS NOT NULL AND v_task.claim_expires_at > v_now THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'lease_active',
      'claimed_by', v_task.claimed_by,
      'claim_expires_at', v_task.claim_expires_at
    );
  END IF;

  -- 9. Calculate new lease expiry (default 5 minutes)
  v_lease_expiry := v_now + (COALESCE(p_lease_seconds, 300) || ' seconds')::interval;

  -- 10. Update task lease and active attempt tracking
  UPDATE jarvis_scheduled_tasks
  SET claimed_at = v_now,
      claim_expires_at = v_lease_expiry,
      claimed_by = p_device_id,
      current_run_id = v_run_id,
      current_attempt_id = v_attempt_id,
      updated_at = v_now
  WHERE id = p_task_id;

  -- 11. Insert unique attempt claim record into execution history
  INSERT INTO jarvis_task_history (
    task_id,
    status,
    idempotency_key,
    run_id,
    attempt_id,
    attempt_number,
    started_at,
    result
  ) VALUES (
    p_task_id,
    'claimed',
    v_attempt_id,
    v_run_id,
    v_attempt_id,
    COALESCE(v_task.retry_count, 0),
    v_now,
    jsonb_build_object(
      'claimed_by', p_device_id,
      'claim_expires_at', v_lease_expiry,
      'title', v_task.title,
      'action_type', v_task.action_type,
      'run_id', v_run_id,
      'attempt_id', v_attempt_id
    )
  );

  RETURN jsonb_build_object(
    'claimed', true,
    'task_id', p_task_id,
    'run_id', v_run_id,
    'attempt_id', v_attempt_id,
    'claim_expires_at', v_lease_expiry
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Atomic Task Completion Procedure (RPC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_complete_task(
  p_task_id uuid,
  p_device_id text,
  p_idempotency_key text,
  p_success boolean,
  p_outcome text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_run_id text DEFAULT NULL,
  p_attempt_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_history record;
  v_now timestamptz := now();
  v_status text := CASE WHEN p_success THEN 'completed' ELSE 'failed' END;
  v_attempt_id text;
  v_run_id text;
  v_new_retry_count integer;
  v_backoff_seconds integer;
BEGIN
  v_attempt_id := COALESCE(p_attempt_id, p_idempotency_key);
  IF v_attempt_id IS NULL OR v_attempt_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_attempt_identity');
  END IF;

  v_run_id := COALESCE(p_run_id, split_part(v_attempt_id, ':attempt:', 1), v_attempt_id);

  -- 1. Row-level lock on task first (consistent lock order: tasks -> history)
  SELECT * INTO v_task
  FROM jarvis_scheduled_tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'task_not_found');
  END IF;

  -- 2. Locate existing execution history row for this attempt
  SELECT * INTO v_history
  FROM jarvis_task_history
  WHERE task_id = p_task_id AND idempotency_key = v_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'execution_not_found');
  END IF;

  -- 3. Idempotent check: if already completed or failed, return success without re-modifying task
  IF v_history.status IN ('completed', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', v_history.status,
      'already_completed', true
    );
  END IF;

  -- 4. Strict Ownership & Stale Execution Validation (Fix 3.B)
  -- A previous execution must NEVER complete, fail, reschedule, or clear the lease belonging to a newer execution!

  -- Check A: Device identity validation
  IF v_task.claimed_by IS NOT NULL AND v_task.claimed_by <> p_device_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'device_mismatch',
      'claimed_by', v_task.claimed_by
    );
  END IF;

  -- Check B: Lease expiration validation
  IF v_task.claim_expires_at IS NULL OR v_task.claim_expires_at < v_now THEN
    -- Lease expired! Mark history row stale, but DO NOT touch task state or newer leases
    UPDATE jarvis_task_history
    SET status = 'stale',
        completed_at = v_now,
        result = jsonb_build_object('stale', true, 'reason', 'lease_expired', 'claimed_by', v_history.result->>'claimed_by')
    WHERE id = v_history.id;

    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'lease_expired',
      'claim_expires_at', v_task.claim_expires_at
    );
  END IF;

  -- Check C: Active attempt matching validation (reject stale attempts)
  IF v_task.current_attempt_id IS NOT NULL AND v_task.current_attempt_id <> v_attempt_id THEN
    -- Stale execution from an older attempt! Record in history, but DO NOT modify task
    UPDATE jarvis_task_history
    SET status = 'stale',
        completed_at = v_now,
        result = jsonb_build_object('stale', true, 'reason', 'stale_attempt', 'current_attempt_id', v_task.current_attempt_id)
    WHERE id = v_history.id;

    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'stale_execution',
      'current_attempt_id', v_task.current_attempt_id
    );
  END IF;

  -- 5. Valid current claim! Update the single history record for this attempt
  UPDATE jarvis_task_history
  SET status = v_status,
      completed_at = v_now,
      result = jsonb_build_object(
        'claimed_by', v_history.result->>'claimed_by',
        'completed_by', p_device_id,
        'success', p_success,
        'outcome', p_outcome,
        'error', p_error,
        'run_id', v_run_id,
        'attempt_id', v_attempt_id
      )
  WHERE id = v_history.id;

  -- 6. Clear lease state from task
  UPDATE jarvis_scheduled_tasks
  SET claimed_by = NULL,
      claim_expires_at = NULL,
      current_run_id = NULL,
      current_attempt_id = NULL,
      last_run_at = v_now,
      updated_at = v_now
  WHERE id = p_task_id;

  -- 7. Handle recurrence vs retry policy
  IF p_success THEN
    -- On success: reset retry_count to 0, advance schedule (single authority: jarvis_advance_schedule)
    UPDATE jarvis_scheduled_tasks
    SET retry_count = 0,
        updated_at = v_now
    WHERE id = p_task_id;

    PERFORM public.jarvis_advance_schedule(p_task_id);

    RETURN jsonb_build_object(
      'ok', true,
      'task_id', p_task_id,
      'status', 'completed',
      'run_id', v_run_id,
      'attempt_id', v_attempt_id
    );
  ELSE
    -- On failure: increment retry count, evaluate max retries, schedule exponential backoff
    v_new_retry_count := COALESCE(v_task.retry_count, 0) + 1;

    IF v_new_retry_count >= COALESCE(v_task.max_retries, 3) THEN
      UPDATE jarvis_scheduled_tasks
      SET retry_count = v_new_retry_count,
          status = 'failed',
          updated_at = v_now
      WHERE id = p_task_id;

      RETURN jsonb_build_object(
        'ok', true,
        'task_id', p_task_id,
        'status', 'failed',
        'retry_count', v_new_retry_count,
        'max_retries_reached', true
      );
    ELSE
      -- Exponential backoff: base 30s * 2^(retry_count - 1), capped at 300s
      v_backoff_seconds := LEAST(300, 30 * (2 ^ (v_new_retry_count - 1)));

      UPDATE jarvis_scheduled_tasks
      SET retry_count = v_new_retry_count,
          next_run_at = v_now + (v_backoff_seconds || ' seconds')::interval,
          updated_at = v_now
      WHERE id = p_task_id;

      RETURN jsonb_build_object(
        'ok', true,
        'task_id', p_task_id,
        'status', 'retrying',
        'retry_count', v_new_retry_count,
        'next_retry_at', (v_now + (v_backoff_seconds || ' seconds')::interval)
      );
    END IF;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.jarvis_claim_task FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_claim_task TO service_role;

REVOKE ALL ON FUNCTION public.jarvis_complete_task FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_complete_task TO service_role;
