/**
 * Automatic sync.
 *
 * The spec's requirement is that a health worker never thinks about the
 * network: they record visits all day, and the queue drains itself when a
 * connection appears. So sync is driven from four events rather than a button.
 *
 *   app start   -> drain whatever a previous session left behind
 *   app focus   -> retry, because the worker just came back to the app
 *   reachable   -> drain, only on an OFFLINE -> ONLINE edge, not every poll
 *   interval    -> periodic backstop for a link that was up but failing
 *
 * Polling `/api/health` on a fixed timer forever would drain the battery of a
 * phone that is offline for a week, which is the normal state here. The interval
 * backs off for the same reason the op queue does.
 */

import { health } from './api';
import { syncNow, pendingCount, type SyncOutcome } from './sync';

export type SyncPhase = 'idle' | 'checking' | 'syncing' | 'ok' | 'error';

export interface AutoSyncState {
  phase: SyncPhase;
  pending: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface AutoSyncConfig {
  baseUrl: string;
  token: string;
  /** Backstop interval once a successful sync has happened. */
  intervalMs?: number;
  /** Interval while the backend is unreachable. Grows with each failed poll. */
  offlineIntervalMs?: number;
  maxOfflineIntervalMs?: number;
}

type Listener = (state: AutoSyncState) => void;

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_OFFLINE_INTERVAL_MS = 30_000;
const DEFAULT_MAX_OFFLINE_INTERVAL_MS = 15 * 60_000;

export class AutoSync {
  private state: AutoSyncState = {
    phase: 'idle',
    pending: 0,
    lastError: null,
    lastSyncedAt: null,
  };

  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** A pass already in flight; a second trigger must not double-send. */
  private inflight: Promise<SyncOutcome | null> | null = null;
  private offlineStreak = 0;
  private started = false;

  private config: AutoSyncConfig;

  constructor(config: AutoSyncConfig) {
    this.config = config;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): AutoSyncState {
    return this.state;
  }

  private emit(patch: Partial<AutoSyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /**
   * Reachability check, then a drain if the backend answered.
   *
   * `previousOnline` is what makes this an edge detector: passing true just
   * re-confirms what is already known and does not spend a sync request.
   */
  async check(previousOnline: boolean): Promise<boolean> {
    this.emit({ phase: 'checking' });
    const online = await health(this.config.baseUrl);
    if (!online) {
      this.offlineStreak++;
      this.emit({ phase: 'error', lastError: 'offline' });
      this.scheduleNext();
      return false;
    }
    this.offlineStreak = 0;
    // Only act on the transition. A backend that is merely slow should not
    // turn every poll into an upload attempt.
    if (previousOnline) {
      this.emit({ phase: this.state.lastError ? 'error' : 'idle', lastError: null });
      this.scheduleNext();
      return true;
    }
    await this.drain();
    return true;
  }

  /** Drain the queue, keeping the app usable if it fails. */
  async drain(): Promise<SyncOutcome | null> {
    if (this.inflight) return this.inflight;
    // Claim the slot synchronously. Awaiting pendingCount() first would let a
    // second caller slip past this guard while the first is still resolving it,
    // and two concurrent drains would upload the same batch twice.
    this.inflight = this.runDrain();
    const out = await this.inflight;
    this.inflight = null;
    return out;
  }

  private async runDrain(): Promise<SyncOutcome | null> {
    try {
      if ((await pendingCount()) === 0) {
        this.emit({ phase: 'idle', pending: 0, lastError: null });
        return null;
      }
      this.emit({ phase: 'syncing' });
      const out = await syncNow({
        baseUrl: this.config.baseUrl,
        token: this.config.token,
      });
      this.emit({
        phase: out.applied > 0 || out.status.pending === 0 ? 'ok' : 'idle',
        pending: out.status.pending,
        lastError: out.status.lastError,
        lastSyncedAt: out.status.lastSuccessAt,
      });
      return out;
    } catch (e) {
      this.emit({ phase: 'error', lastError: e instanceof Error ? e.message : 'sync failed' });
      return null;
    } finally {
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const base = this.offlineStreak > 0 ? this.config.offlineIntervalMs ?? DEFAULT_OFFLINE_INTERVAL_MS : this.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    const max = this.config.maxOfflineIntervalMs ?? DEFAULT_MAX_OFFLINE_INTERVAL_MS;
    const wait = Math.min(base * 2 ** Math.max(this.offlineStreak - 1, 0), max);
    this.timer = setTimeout(() => {
      void this.check(false).catch(() => undefined);
    }, wait);
  }

  /** Idempotent: safe to call from every mount that cares. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.check(false).catch(() => undefined);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
