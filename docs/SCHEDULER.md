# JARVIS Task Scheduler

**Scope:** Windows desktop scheduling, durable completion reporting, atomic Supabase claims, and recurrence handling.

## Execution ownership

- The Windows Electron process is the executor for `execution_target = pc` and `any` tasks.
- The Cloudflare Worker exposes authenticated task APIs and calls Supabase RPCs. Its scheduled handler performs housekeeping only; it must never mark a task complete or advance a schedule without an executor actually running the action.
- Android or cloud executors must claim through the same RPC and use their own device identity. The Windows poller does not claim those targets.

## Execution lifecycle

1. Electron polls `GET /tasks/due?target=pc`.
2. It computes a logical occurrence ID from `pending_run_id`, or from task ID plus the original scheduled timestamp on the first attempt.
3. It computes an attempt ID as `<run_id>:attempt:<retry_count>`.
4. It calls `POST /tasks/:id/claim`. PostgreSQL locks the task row, persists `pending_run_id`, and grants a time-limited lease.
5. Electron executes only the explicitly supported action registry. Unknown actions and sensitive actions requiring interactive approval fail safely.
6. Electron persists the completion payload to its local durable outbox before sending it to the Worker.
7. The Worker calls `jarvis_complete_task`. PostgreSQL validates device, run, attempt, and lease before changing history or schedule state.

## Identity and retries

- `pending_run_id` identifies one scheduled occurrence and remains unchanged through retry backoffs.
- `retry_count` increments after a failed completion or expired lease. A new attempt ID is created for each retry; a retry is not a new scheduled occurrence.
- `max_retries` means retries after the initial attempt. A value of 3 permits one initial attempt plus up to three retries.
- Successful completion clears `pending_run_id` and advances recurrence exactly once through `jarvis_advance_schedule`.
- A stale completion cannot clear a newer lease or advance the schedule.
- An expired lease is converted to a stale history record, the lease is released, and a retry is scheduled with bounded exponential backoff.

## Cloudflare Worker responsibilities

The Worker's scheduled event only cleans expired OAuth states, pending email confirmations, video confirmations, device-pair codes, remote tasks, and rate-limit buckets. It does not write scheduler history, claim tasks, or advance recurrence. This prevents cron from falsely marking due tasks completed without executing their action.

## Safety and delivery

- Desktop action execution is separate from completion delivery. A network failure leaves the completion in the outbox; it does not rerun the local action.
- Outbox entries are removed only after acknowledged completion or a definitive stale/expired rejection.
- Claims and completions use service-role-only PostgreSQL RPCs. The RPC functions use a restricted search path and validate the active lease owner.
- The desktop poller has a single in-flight guard. Dangerous tools remain blocked from silent background execution.

## Verification checklist

- First claim creates one logical run ID and one attempt history row.
- Retry after failed completion keeps the same logical run ID and increments the attempt ID.
- Retry after a crashed/expired lease keeps the same logical run ID and increments the attempt ID.
- Concurrent claims cannot both acquire the task lease.
- A stale attempt cannot complete or clear a newer attempt's lease.
- A successful one-time task becomes completed; a recurring task advances once.
- Worker cron housekeeping never writes task history or advances task schedules.
