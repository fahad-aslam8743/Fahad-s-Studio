-- Fahad's Studio: Custom Personas and Task Scheduler
-- Applied 2026-10-27

-- ────────────────────────────────────────────────────
-- Custom personas (user-defined; built-in ones are in code)
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jarvis_custom_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  tone text NOT NULL DEFAULT 'professional' CHECK(length(tone) BETWEEN 1 AND 40),
  prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 2000),
  voice_male text NOT NULL DEFAULT 'Puck',
  voice_female text NOT NULL DEFAULT 'Kore',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jarvis_custom_personas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jarvis_custom_personas FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_custom_personas TO service_role;

-- ────────────────────────────────────────────────────
-- Scheduled tasks
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jarvis_scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description text CHECK(description IS NULL OR length(description) <= 2000),
  schedule_type text NOT NULL CHECK(schedule_type IN ('once','daily','weekly','monthly','cron')),
  schedule_value text NOT NULL CHECK(length(schedule_value) BETWEEN 1 AND 200),
  timezone text NOT NULL DEFAULT 'UTC' CHECK(length(timezone) BETWEEN 1 AND 60),
  action_type text NOT NULL CHECK(action_type IN ('reminder','tool','chat','video','email_summary','app_launch','custom')),
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_target text NOT NULL DEFAULT 'any' CHECK(execution_target IN ('any','pc','android','cloud')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','cancelled','failed')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  run_count integer NOT NULL DEFAULT 0,
  max_runs integer,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jarvis_tasks_active_idx
  ON public.jarvis_scheduled_tasks(next_run_at, status)
  WHERE status = 'active';

ALTER TABLE public.jarvis_scheduled_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jarvis_scheduled_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_scheduled_tasks TO service_role;

-- ────────────────────────────────────────────────────
-- Task execution history
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jarvis_task_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid REFERENCES public.jarvis_scheduled_tasks(id) ON DELETE SET NULL,
  status text NOT NULL CHECK(status IN ('completed','failed','skipped','cancelled','missed')),
  result jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.jarvis_task_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jarvis_task_history FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_task_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.jarvis_task_history_id_seq TO service_role;

-- ────────────────────────────────────────────────────
-- Function to compute next run time for recurring tasks
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_advance_schedule(p_task_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_task record;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_task FROM jarvis_scheduled_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Once: mark completed
  IF v_task.schedule_type = 'once' THEN
    UPDATE jarvis_scheduled_tasks SET status = 'completed', run_count = run_count + 1,
      last_run_at = now(), updated_at = now() WHERE id = p_task_id;
    RETURN NULL;
  END IF;

  -- Check max_runs
  IF v_task.max_runs IS NOT NULL AND v_task.run_count + 1 >= v_task.max_runs THEN
    UPDATE jarvis_scheduled_tasks SET status = 'completed', run_count = run_count + 1,
      last_run_at = now(), updated_at = now() WHERE id = p_task_id;
    RETURN NULL;
  END IF;

  -- Compute next run
  v_next := CASE v_task.schedule_type
    WHEN 'daily' THEN COALESCE(v_task.next_run_at, now()) + interval '1 day'
    WHEN 'weekly' THEN COALESCE(v_task.next_run_at, now()) + interval '7 days'
    WHEN 'monthly' THEN COALESCE(v_task.next_run_at, now()) + interval '1 month'
    ELSE COALESCE(v_task.next_run_at, now()) + interval '1 day'
  END;

  UPDATE jarvis_scheduled_tasks SET
    run_count = run_count + 1, last_run_at = now(),
    next_run_at = v_next, updated_at = now()
  WHERE id = p_task_id;

  RETURN v_next;
END $$;

REVOKE EXECUTE ON FUNCTION public.jarvis_advance_schedule(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_advance_schedule(uuid) TO service_role;
