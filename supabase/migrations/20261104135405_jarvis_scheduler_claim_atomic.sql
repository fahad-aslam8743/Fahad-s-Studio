-- JARVIS scheduler reliability and execution ownership.
-- Additive: preserves existing task/history rows and introduces durable occurrence identity.

ALTER TABLE public.jarvis_task_history
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS attempt_id text,
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 0;

ALTER TABLE public.jarvis_task_history
  DROP CONSTRAINT IF EXISTS jarvis_task_history_status_check;

ALTER TABLE public.jarvis_task_history
  ADD CONSTRAINT jarvis_task_history_status_check
  CHECK (status IN (
    'claimed', 'running', 'completed', 'failed', 'skipped',
    'cancelled', 'missed', 'retrying', 'stale'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS jarvis_task_history_idempotency_idx
  ON public.jarvis_task_history (task_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS jarvis_task_history_run_id_idx
  ON public.jarvis_task_history (task_id, run_id, status)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.jarvis_scheduled_tasks
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS current_run_id text,
  ADD COLUMN IF NOT EXISTS current_attempt_id text,
  ADD COLUMN IF NOT EXISTS pending_run_id text;

CREATE INDEX IF NOT EXISTS jarvis_tasks_due_idx
  ON public.jarvis_scheduled_tasks (status, next_run_at, execution_target)
  WHERE status = 'active';

-- One authority advances recurrence. A logical run ID is cleared only when
-- the occurrence has actually succeeded and recurrence is advanced.
CREATE OR REPLACE FUNCTION public.jarvis_advance_schedule(p_task_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_task record;
  v_next timestamptz;
BEGIN
  SELECT *
    INTO v_task
    FROM public.jarvis_scheduled_tasks
   WHERE id = p_task_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_task.schedule_type = 'once'
     OR (v_task.max_runs IS NOT NULL AND COALESCE(v_task.run_count, 0) + 1 >= v_task.max_runs) THEN
    UPDATE public.jarvis_scheduled_tasks
       SET status = 'completed',
           run_count = COALESCE(run_count, 0) + 1,
           last_run_at = pg_catalog.now(),
           next_run_at = NULL,
           pending_run_id = NULL,
           updated_at = pg_catalog.now()
     WHERE id = p_task_id;
    RETURN NULL;
  END IF;

  v_next := CASE v_task.schedule_type
    WHEN 'daily' THEN COALESCE(v_task.next_run_at, pg_catalog.now()) + interval '1 day'
    WHEN 'weekly' THEN COALESCE(v_task.next_run_at, pg_catalog.now()) + interval '7 days'
    WHEN 'monthly' THEN COALESCE(v_task.next_run_at, pg_catalog.now()) + interval '1 month'
    ELSE COALESCE(v_task.next_run_at, pg_catalog.now()) + interval '1 day'
  END;

  UPDATE public.jarvis_scheduled_tasks
     SET run_count = COALESCE(run_count, 0) + 1,
         last_run_at = pg_catalog.now(),
         next_run_at = v_next,
         pending_run_id = NULL,
         updated_at = pg_catalog.now()
   WHERE id = p_task_id;

  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.jarvis_advance_schedule(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_advance_schedule(uuid) TO service_role;

-- Atomic claim. The task row is always locked before a history row.
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
SET search_path = pg_catalog
AS $function$
DECLARE
  v_task record;
  v_existing record;
  v_now timestamptz := pg_catalog.now();
  v_lease_expiry timestamptz;
  v_run_id text;
  v_attempt_id text;
  v_expected_attempt_id text;
  v_new_retry_count integer;
  v_backoff_seconds integer;
  v_max_retries integer;
BEGIN
  IF p_device_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_device_id)) = 0 THEN
    RETURN pg_catalog.jsonb_build_object('claimed', false, 'reason', 'missing_device_id');
  END IF;

  SELECT *
    INTO v_task
    FROM public.jarvis_scheduled_tasks
   WHERE id = p_task_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('claimed', false, 'reason', 'task_not_found');
  END IF;

  IF v_task.status <> 'active' THEN
    RETURN pg_catalog.jsonb_build_object('claimed', false, 'reason', 'task_not_active', 'status', v_task.status);
  END IF;

  v_max_retries := COALESCE(v_task.max_retries, 3);

  -- Recover a crashed execution even if its old completion endpoint already marked
  -- the history row stale. This is the only place an expired lease consumes a retry.
  IF v_task.current_attempt_id IS NOT NULL
     AND (v_task.claim_expires_at IS NULL OR v_task.claim_expires_at <= v_now) THEN
    UPDATE public.jarvis_task_history
       SET status = 'stale',
           completed_at = v_now,
           result = pg_catalog.jsonb_build_object(
             'stale', true,
             'reason', 'lease_expired',
             'attempt_id', v_task.current_attempt_id
           )
     WHERE task_id = p_task_id
       AND idempotency_key = v_task.current_attempt_id
       AND status = 'claimed';

    v_new_retry_count := COALESCE(v_task.retry_count, 0) + 1;

    IF v_new_retry_count > v_max_retries THEN
      UPDATE public.jarvis_scheduled_tasks
         SET retry_count = v_new_retry_count,
             status = 'failed',
             claimed_at = NULL,
             claim_expires_at = NULL,
             claimed_by = NULL,
             current_run_id = NULL,
             current_attempt_id = NULL,
             pending_run_id = NULL,
             updated_at = v_now
       WHERE id = p_task_id;

      RETURN pg_catalog.jsonb_build_object(
        'claimed', false,
        'reason', 'max_retries_exceeded',
        'retry_count', v_new_retry_count,
        'max_retries', v_max_retries
      );
    END IF;

    v_backoff_seconds := LEAST(300, (30 * pg_catalog.power(2::numeric, GREATEST(0, v_new_retry_count - 1)))::integer);

    UPDATE public.jarvis_scheduled_tasks
       SET retry_count = v_new_retry_count,
           next_run_at = v_now + pg_catalog.make_interval(secs => v_backoff_seconds),
           claimed_at = NULL,
           claim_expires_at = NULL,
           claimed_by = NULL,
           current_run_id = NULL,
           current_attempt_id = NULL,
           updated_at = v_now
     WHERE id = p_task_id;

    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'lease_expired_retry_scheduled',
      'retry_count', v_new_retry_count,
      'next_run_at', v_now + pg_catalog.make_interval(secs => v_backoff_seconds)
    );
  END IF;

  IF COALESCE(v_task.retry_count, 0) > v_max_retries THEN
    UPDATE public.jarvis_scheduled_tasks
       SET status = 'failed',
           pending_run_id = NULL,
           updated_at = v_now
     WHERE id = p_task_id;

    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'max_retries_exceeded',
      'retry_count', v_task.retry_count,
      'max_retries', v_max_retries
    );
  END IF;

  IF v_task.next_run_at IS NOT NULL AND v_task.next_run_at > v_now + interval '10 seconds' THEN
    RETURN pg_catalog.jsonb_build_object('claimed', false, 'reason', 'task_not_due', 'next_run_at', v_task.next_run_at);
  END IF;

  IF v_task.execution_target <> 'any' AND v_task.execution_target <> p_device_id THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'target_mismatch',
      'execution_target', v_task.execution_target,
      'device_id', p_device_id
    );
  END IF;

  v_run_id := COALESCE(
    v_task.pending_run_id,
    NULLIF(pg_catalog.btrim(p_run_id), ''),
    v_task.id::text || ':' || pg_catalog.to_char(
      COALESCE(v_task.next_run_at, v_task.created_at) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
  v_expected_attempt_id := v_run_id || ':attempt:' || COALESCE(v_task.retry_count, 0)::text;
  v_attempt_id := COALESCE(NULLIF(p_attempt_id, ''), NULLIF(p_idempotency_key, ''), v_expected_attempt_id);

  IF v_attempt_id <> v_expected_attempt_id OR p_idempotency_key IS DISTINCT FROM v_attempt_id THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'attempt_identity_mismatch',
      'run_id', v_run_id,
      'expected_attempt_id', v_expected_attempt_id,
      'retry_count', COALESCE(v_task.retry_count, 0)
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.jarvis_task_history h
     WHERE h.task_id = p_task_id
       AND h.run_id = v_run_id
       AND h.status = 'completed'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('claimed', false, 'reason', 'already_completed', 'run_id', v_run_id);
  END IF;

  IF v_task.claim_expires_at IS NOT NULL AND v_task.claim_expires_at > v_now THEN
    IF v_task.claimed_by = p_device_id
       AND v_task.current_attempt_id = v_attempt_id
       AND v_task.current_run_id = v_run_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'claimed', true,
        'already_claimed', true,
        'task_id', p_task_id,
        'run_id', v_run_id,
        'attempt_id', v_attempt_id,
        'claim_expires_at', v_task.claim_expires_at
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'lease_active',
      'claimed_by', v_task.claimed_by,
      'claim_expires_at', v_task.claim_expires_at
    );
  END IF;

  SELECT *
    INTO v_existing
    FROM public.jarvis_task_history
   WHERE task_id = p_task_id
     AND idempotency_key = v_attempt_id
   FOR UPDATE;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'attempt_already_recorded',
      'existing_status', v_existing.status
    );
  END IF;

  v_lease_expiry := v_now + pg_catalog.make_interval(secs => LEAST(3600, GREATEST(30, COALESCE(p_lease_seconds, 300))));

  UPDATE public.jarvis_scheduled_tasks
     SET pending_run_id = COALESCE(pending_run_id, v_run_id),
         claimed_at = v_now,
         claim_expires_at = v_lease_expiry,
         claimed_by = p_device_id,
         current_run_id = v_run_id,
         current_attempt_id = v_attempt_id,
         updated_at = v_now
   WHERE id = p_task_id;

  INSERT INTO public.jarvis_task_history (
    task_id, status, idempotency_key, run_id, attempt_id,
    attempt_number, started_at, result
  ) VALUES (
    p_task_id, 'claimed', v_attempt_id, v_run_id, v_attempt_id,
    COALESCE(v_task.retry_count, 0) + 1, v_now,
    pg_catalog.jsonb_build_object(
      'claimed_by', p_device_id,
      'claim_expires_at', v_lease_expiry,
      'title', v_task.title,
      'action_type', v_task.action_type,
      'run_id', v_run_id,
      'attempt_id', v_attempt_id
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'claimed', true,
    'task_id', p_task_id,
    'run_id', v_run_id,
    'attempt_id', v_attempt_id,
    'claim_expires_at', v_lease_expiry
  );
END;
$function$;

-- Atomic completion. An old device/attempt may never clear a newer lease or advance recurrence.
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
SET search_path = pg_catalog
AS $function$
DECLARE
  v_task record;
  v_history record;
  v_now timestamptz := pg_catalog.now();
  v_run_id text;
  v_attempt_id text;
  v_success boolean := COALESCE(p_success, false);
  v_new_retry_count integer;
  v_backoff_seconds integer;
  v_max_retries integer;
BEGIN
  v_attempt_id := COALESCE(NULLIF(p_attempt_id, ''), NULLIF(p_idempotency_key, ''));

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing_attempt_identity');
  END IF;

  IF p_idempotency_key IS DISTINCT FROM v_attempt_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'attempt_identity_mismatch');
  END IF;

  SELECT *
    INTO v_task
    FROM public.jarvis_scheduled_tasks
   WHERE id = p_task_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'task_not_found');
  END IF;

  SELECT *
    INTO v_history
    FROM public.jarvis_task_history
   WHERE task_id = p_task_id
     AND idempotency_key = v_attempt_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'execution_not_found');
  END IF;

  IF v_history.status IN ('completed', 'failed') THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'status', v_history.status,
      'already_completed', true
    );
  END IF;

  IF v_history.status = 'stale' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'stale_execution');
  END IF;

  v_run_id := COALESCE(NULLIF(p_run_id, ''), v_history.run_id);

  IF v_task.claimed_by IS DISTINCT FROM p_device_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'device_mismatch', 'claimed_by', v_task.claimed_by);
  END IF;

  IF v_task.current_attempt_id IS DISTINCT FROM v_attempt_id
     OR v_task.current_run_id IS DISTINCT FROM v_run_id THEN
    UPDATE public.jarvis_task_history
       SET status = 'stale',
           completed_at = v_now,
           result = pg_catalog.jsonb_build_object(
             'stale', true,
             'reason', 'stale_execution',
             'current_attempt_id', v_task.current_attempt_id
           )
     WHERE id = v_history.id
       AND status IN ('claimed', 'running');

    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'stale_execution', 'current_attempt_id', v_task.current_attempt_id);
  END IF;

  IF v_task.claim_expires_at IS NULL OR v_task.claim_expires_at <= v_now THEN
    UPDATE public.jarvis_task_history
       SET status = 'stale',
           completed_at = v_now,
           result = pg_catalog.jsonb_build_object('stale', true, 'reason', 'lease_expired')
     WHERE id = v_history.id
       AND status IN ('claimed', 'running');

    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'lease_expired', 'claim_expires_at', v_task.claim_expires_at);
  END IF;

  UPDATE public.jarvis_task_history
     SET status = CASE WHEN v_success THEN 'completed' ELSE 'failed' END,
         completed_at = v_now,
         result = pg_catalog.jsonb_build_object(
           'claimed_by', v_history.result->>'claimed_by',
           'completed_by', p_device_id,
           'success', v_success,
           'outcome', p_outcome,
           'error', p_error,
           'run_id', v_run_id,
           'attempt_id', v_attempt_id
         )
   WHERE id = v_history.id;

  UPDATE public.jarvis_scheduled_tasks
     SET claimed_at = NULL,
         claim_expires_at = NULL,
         claimed_by = NULL,
         current_run_id = NULL,
         current_attempt_id = NULL,
         last_run_at = v_now,
         updated_at = v_now
   WHERE id = p_task_id;

  IF v_success THEN
    UPDATE public.jarvis_scheduled_tasks
       SET retry_count = 0,
           pending_run_id = NULL,
           updated_at = v_now
     WHERE id = p_task_id;

    PERFORM public.jarvis_advance_schedule(p_task_id);

    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'task_id', p_task_id,
      'status', 'completed',
      'run_id', v_run_id,
      'attempt_id', v_attempt_id
    );
  END IF;

  v_new_retry_count := COALESCE(v_task.retry_count, 0) + 1;
  v_max_retries := COALESCE(v_task.max_retries, 3);

  IF v_new_retry_count > v_max_retries THEN
    UPDATE public.jarvis_scheduled_tasks
       SET retry_count = v_new_retry_count,
           status = 'failed',
           pending_run_id = NULL,
           updated_at = v_now
     WHERE id = p_task_id;

    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'task_id', p_task_id,
      'status', 'failed',
      'retry_count', v_new_retry_count,
      'max_retries_reached', true
    );
  END IF;

  v_backoff_seconds := LEAST(300, (30 * pg_catalog.power(2::numeric, GREATEST(0, v_new_retry_count - 1)))::integer);

  UPDATE public.jarvis_scheduled_tasks
     SET retry_count = v_new_retry_count,
         next_run_at = v_now + pg_catalog.make_interval(secs => v_backoff_seconds),
         updated_at = v_now
   WHERE id = p_task_id;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', 'retrying',
    'retry_count', v_new_retry_count,
    'next_retry_at', v_now + pg_catalog.make_interval(secs => v_backoff_seconds)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.jarvis_claim_task(uuid, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_claim_task(uuid, text, text, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.jarvis_complete_task(uuid, text, text, boolean, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_complete_task(uuid, text, text, boolean, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
