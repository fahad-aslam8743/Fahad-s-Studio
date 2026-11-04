export interface SchedulerTaskIdentity {
  id: string;
  next_run_at?: string | null;
  pending_run_id?: string | null;
  retry_count?: number | null;
}

/**
 * One scheduled occurrence keeps one logical run ID across all retry backoffs.
 * The database persists pending_run_id until the occurrence succeeds.
 */
export function getTaskRunId(task: SchedulerTaskIdentity): string {
  if (typeof task.pending_run_id === 'string' && task.pending_run_id.trim()) {
    return task.pending_run_id;
  }
  if (!task.next_run_at) {
    throw new Error(`Scheduled task ${task.id} has no next_run_at`);
  }
  const scheduledAt = new Date(task.next_run_at);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error(`Scheduled task ${task.id} has an invalid next_run_at`);
  }
  return `${task.id}:${scheduledAt.toISOString()}`;
}

export function getTaskAttemptId(task: SchedulerTaskIdentity): string {
  const numericRetryCount = Number(task.retry_count);
  const retryCount = Number.isFinite(numericRetryCount) ? Math.max(0, Math.floor(numericRetryCount)) : 0;
  return `${getTaskRunId(task)}:attempt:${retryCount}`;
}
