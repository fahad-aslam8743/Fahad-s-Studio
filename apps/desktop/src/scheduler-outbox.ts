import fs from 'node:fs/promises';
import path from 'node:path';

export interface OutboxPayload {
  idempotency_key: string;
  run_id: string;
  attempt_id: string;
  device_id: string;
  success: boolean;
  outcome: string | null;
  error: string | null;
}

export interface OutboxRecord {
  id: string; // attemptId
  taskId: string;
  runId: string;
  attemptId: string;
  deviceId: string;
  payload: OutboxPayload;
  attemptCount: number;
  nextRetryAt: number;
  createdAt: number;
  lastError?: string;
}

export class DurableOutbox {
  private filePath: string;
  private records: Map<string, OutboxRecord> = new Map();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async load(): Promise<void> {
    this.records.clear();
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.id && item.taskId && item.payload) {
            this.records.set(String(item.id), {
              id: String(item.id),
              taskId: String(item.taskId),
              runId: String(item.runId || item.id),
              attemptId: String(item.attemptId || item.id),
              deviceId: String(item.deviceId || 'pc'),
              payload: item.payload,
              attemptCount: Number(item.attemptCount || 0),
              nextRetryAt: Number(item.nextRetryAt || Date.now()),
              createdAt: Number(item.createdAt || Date.now()),
              lastError: item.lastError ? String(item.lastError) : undefined
            });
          }
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        // Corrupted or invalid JSON: safely quarantine and start fresh without crashing
        try {
          const backup = `${this.filePath}.corrupted.${Date.now()}`;
          await fs.rename(this.filePath, backup);
          console.warn(`[Outbox] Quarantined corrupted outbox file to ${backup}`);
        } catch {}
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const list = Array.from(this.records.values());
    const tempFile = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    try {
      await fs.mkdir(path.dirname(this.filePath), {recursive: true});
      await fs.writeFile(tempFile, JSON.stringify(list, null, 2), 'utf8');
      await fs.rename(tempFile, this.filePath);
    } catch (err) {
      try { await fs.unlink(tempFile); } catch {}
      throw err;
    }
  }

  public async enqueue(
    attemptId: string,
    taskId: string,
    runId: string,
    deviceId: string,
    payload: OutboxPayload
  ): Promise<void> {
    if (!this.loaded) await this.load();
    const existing = this.records.get(attemptId);
    const record: OutboxRecord = {
      id: attemptId,
      taskId,
      runId,
      attemptId,
      deviceId,
      payload,
      attemptCount: existing ? existing.attemptCount : 0,
      nextRetryAt: existing ? existing.nextRetryAt : Date.now(),
      createdAt: existing ? existing.createdAt : Date.now()
    };
    this.records.set(attemptId, record);
    await this.persist();
  }

  public async remove(id: string): Promise<boolean> {
    if (!this.loaded) await this.load();
    if (this.records.delete(id)) {
      await this.persist();
      return true;
    }
    return false;
  }

  public has(id: string): boolean {
    return this.records.has(id);
  }

  public getPending(): OutboxRecord[] {
    const now = Date.now();
    return Array.from(this.records.values()).filter(r => now >= r.nextRetryAt);
  }

  public getAll(): OutboxRecord[] {
    return Array.from(this.records.values());
  }

  public size(): number {
    return this.records.size;
  }

  public async recordFailure(id: string, errorMessage: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.attemptCount++;
    record.lastError = errorMessage.slice(0, 500);
    // Exponential backoff: base 2s * 2^(attempts-1), capped at 5 minutes (300,000ms)
    const backoffMs = Math.min(300_000, 2000 * Math.pow(2, Math.max(0, record.attemptCount - 1)));
    record.nextRetryAt = Date.now() + backoffMs;
    await this.persist();
  }
}
