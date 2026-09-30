/**
 * Storage abstraction.
 *
 * expo-sqlite in SDK 57 exposes openDatabaseAsync + execAsync/runAsync/getAllAsync
 * and has no key/value module (the old expo-sqlite/kv-store is gone), so the
 * local store is a real SQL table behind a small promise interface. Web gets an
 * in-memory adapter because expo-sqlite's web implementation is still alpha.
 *
 * Deliberately NOT claimed: this module provides no encryption. SQLCipher needs
 * a config plugin and a development build, so the app must not describe local
 * records as encrypted until that is wired and verified on a real handset.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** every key currently held, for op-log replay on cold start */
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(prefix = ''): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

interface SqliteLike {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
  getFirstAsync: <T>(sql: string, params?: unknown[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
}

export class SqliteStore implements KeyValueStore {
  private db: SqliteLike;

  private constructor(db: SqliteLike) {
    this.db = db;
  }

  static async open(name = 'jeevacare.db'): Promise<SqliteStore> {
    const { openDatabaseAsync } = await import('expo-sqlite');
    const db = (await openDatabaseAsync(name)) as unknown as SqliteLike;
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    return new SqliteStore(db);
  }

  async get<T>(key: string): Promise<T | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      [key]
    );
    return row === null ? null : (JSON.parse(row.value) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)]
    );
  }

  async remove(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
  }

  async keys(prefix = ''): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ key: string }>(
      'SELECT key FROM kv WHERE key LIKE ? ORDER BY key',
      [`${prefix}%`]
    );
    return rows.map((r) => r.key);
  }

  async clear(): Promise<void> {
    await this.db.execAsync('DELETE FROM kv');
  }
}

export const isWeb = (): boolean =>
  typeof document !== 'undefined' || process.env.EXPO_OS === 'web';

let store: KeyValueStore | null = null;

export async function getStore(): Promise<KeyValueStore> {
  if (store) return store;
  if (isWeb()) {
    store = new MemoryStore();
    return store;
  }
  try {
    store = await SqliteStore.open();
  } catch {
    // A device without the native module still gets a working session; it just
    // will not survive a restart, which the sync screen reports honestly.
    store = new MemoryStore();
  }
  return store;
}

/** Test seam: inject a store without touching native modules. */
export function __setStore(next: KeyValueStore | null): void {
  store = next;
}
