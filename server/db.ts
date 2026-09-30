/**
 * Data access for Supabase.
 *
 * Everything goes through the narrow `Db` interface below rather than calling
 * supabase-js inline. Two reasons: the sync engine's compare-and-swap logic is
 * the part most likely to be wrong and hardest to debug in the field, so it
 * has to be testable without a network; and it keeps the one dangerous secret
 * (the service_role key) confined to a single constructor.
 *
 * SECURITY: `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It must
 * only ever exist in this server process. The phone talks to /api/sync and
 * never sees a Supabase credential, which is why db/schema.sql enables RLS
 * with no policies -- the anon key is denied everything by default.
 *
 * TRANSACTIONS: PostgREST has no multi-statement transaction, so the previous
 * `withTransaction` wrapper is gone. A single `casUpdate` is still atomic
 * because it is one UPDATE with a version predicate. Multi-row writes
 * (encounter + observations + symptoms + triage) are no longer all-or-nothing;
 * they are made idempotent instead, so a retry after a partial failure
 * converges on the same result. See applyCreateEncounter.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    const raw = readFileSync(join(here, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // .env is optional; a real deployment injects the environment directly.
  }
}

loadDotEnv();

export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const SYNC_PORT = Number(process.env.SYNC_PORT ?? 4000);
export const API_TOKEN_SECRET = process.env.API_TOKEN_SECRET ?? 'jeevacare-dev-secret';

export const TABLES = [
  'worker',
  'device',
  'patient',
  'encounter',
  'observation',
  'symptom',
  'triage',
  'audit_log',
  'sync_receipt',
] as const;

export type Row = Record<string, unknown>;

export interface SelectOptions {
  eq?: Record<string, unknown>;
  /** SQL IN (...) -- PostgREST needs .in() for a list, .eq() for a scalar */
  in?: Record<string, unknown[]>;
  /** columns that must be NULL; this is how soft deletes are excluded */
  isNull?: string[];
  gte?: Record<string, string>;
  limit?: number;
  order?: { column: string; ascending: boolean };
  count?: boolean;
}

/** Every list of live clinical rows has to exclude soft-deleted records. */
export const LIVE: { isNull: string[] } = { isNull: ['deleted_at'] };

/**
 * The tables that actually carry a `deleted_at` column.
 *
 * Only patient and encounter are soft-deleted. Applying the filter
 * unconditionally broke every other table at runtime with
 * "column worker.deleted_at does not exist", which took down login entirely.
 * The in-memory test backend tolerated the phantom column, so 4000+ assertions
 * passed while the real database refused every request.
 */
const SOFT_DELETE_TABLES = new Set(['patient', 'encounter']);

/** Columns to require to be NULL for a row to count as live on this table. */
function liveFilterFor(table: string): string[] {
  return SOFT_DELETE_TABLES.has(table) ? LIVE.isNull : [];
}

export interface Db {
  selectOne<T extends Row>(table: string, id: string): Promise<T | null>;
  selectMany<T extends Row>(table: string, opts?: SelectOptions): Promise<T[]>;
  count(table: string, opts?: SelectOptions): Promise<number>;
  /** plain insert; the row carries its own id (or the table has a serial) */
  insert(table: string, rows: Row[]): Promise<void>;
  /** insert, silently ignoring rows whose primary key already exists */
  insertIgnore(table: string, rows: Row[]): Promise<void>;
  /** insert-or-replace, used by the seed script only */
  upsert(table: string, rows: Row[]): Promise<void>;
  /**
   * Atomic compare-and-swap. Applies `fields` only if the stored `version`
   * still equals `baseVersion`, and returns the new row, or null if the
   * predicate did not match (someone else wrote first).
   */
  casUpdate(table: string, id: string, baseVersion: number, fields: Row): Promise<Row | null>;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

class SupabaseDb implements Db {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async selectOne<T extends Row>(table: string, id: string): Promise<T | null> {
    let q = this.client.from(table).select('*').eq('id', id);
    for (const k of liveFilterFor(table)) q = q.is(k, null);
    const r = await q.limit(1);
    const rows = unwrap<Row[]>(r, `select ${table}`);
    return (rows[0] as T) ?? null;
  }

  async selectMany<T extends Row>(table: string, opts: SelectOptions = {}): Promise<T[]> {
    let q = this.client.from(table).select('*');
    for (const [k, v] of Object.entries(opts.eq ?? {})) q = q.eq(k, v);
    for (const [k, vs] of Object.entries(opts.in ?? {})) q = q.in(k, vs as never[]);
    for (const k of opts.isNull ?? []) q = q.is(k, null);
    for (const [k, v] of Object.entries(opts.gte ?? {})) q = q.gte(k, v);
    if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending });
    if (opts.limit) q = q.limit(opts.limit);
    return unwrap<Row[]>(await q, `select ${table}`) as T[];
  }

  async count(table: string, opts: SelectOptions = {}): Promise<number> {
    let q = this.client.from(table).select('*', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(opts.eq ?? {})) q = q.eq(k, v);
    for (const [k, vs] of Object.entries(opts.in ?? {})) q = q.in(k, vs as never[]);
    for (const k of opts.isNull ?? []) q = q.is(k, null);
    for (const [k, v] of Object.entries(opts.gte ?? {})) q = q.gte(k, v);
    const r = await q;
    if (r.error) throw new Error(`count ${table}: ${r.error.message}`);
    return r.count ?? 0;
  }

  async insert(table: string, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const r = await this.client.from(table).insert(rows);
    if (r.error) throw new Error(`insert ${table}: ${r.error.message}`);
  }

  async insertIgnore(table: string, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const r = await this.client
      .from(table)
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (r.error) throw new Error(`insert ${table}: ${r.error.message}`);
  }

  async upsert(table: string, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const r = await this.client.from(table).upsert(rows, { onConflict: 'id' });
    if (r.error) throw new Error(`upsert ${table}: ${r.error.message}`);
  }

  async casUpdate(table: string, id: string, baseVersion: number, fields: Row): Promise<Row | null> {
    // The version predicate is what makes this safe. The client library cannot
    // express `version = version + 1`, so the new value is computed here, and
    // the equality filter guarantees nobody else can land on that version.
    const r = await this.client
      .from(table)
      .update({ ...fields, version: baseVersion + 1, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('version', baseVersion)
      .select();
    const rows = unwrap<Row[]>(r, `cas ${table}`);
    return rows[0] ?? null;
  }
}

let db: Db | null = null;
let raw: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  raw ??= createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return raw;
}

export function getDb(): Db {
  db ??= new SupabaseDb(getClient());
  return db;
}

/** Test seam. */
export function __setDb(next: Db | null): void {
  db = next;
}

export function configProblem(): string | null {
  if (!SUPABASE_URL) return 'SUPABASE_URL is not set';
  if (!SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY is not set';
  if (/^your-|^<|replace|changeme/i.test(SUPABASE_SERVICE_ROLE_KEY)) {
    return 'SUPABASE_SERVICE_ROLE_KEY still holds a placeholder value';
  }
  return null;
}

export const TABLES_MISSING: string[] = [];

/**
 * A client cannot run DDL, so db/schema.sql must be pasted into the Supabase
 * SQL editor once. This checks the result and says exactly what is missing
 * instead of failing later with an opaque PostgREST 404.
 */
let schemaCache: { at: number; missing: string[] } | null = null;
const SCHEMA_TTL_MS = 60_000;

export async function verifySchema(force = false): Promise<string[]> {
  // Nine round-trips to Supabase is fine once at boot and wasteful on every
  // /api/health, which the home screen polls each time it gains focus.
  if (!force && schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) {
    return schemaCache.missing;
  }
  const missing: string[] = [];
  for (const t of TABLES) {
    const r = await getClient().from(t).select('*', { count: 'exact', head: true }).limit(1);
    if (r.error) missing.push(`${t} (${r.error.code === '42P01' || /not exist/i.test(r.error.message) ? 'missing' : r.error.message})`);
  }
  TABLES_MISSING.length = 0;
  TABLES_MISSING.push(...missing);
  schemaCache = { at: Date.now(), missing: [...missing] };
  return missing;
}

export async function audit(entry: {
  deviceId?: string | null;
  workerId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  outcome: 'applied' | 'conflict' | 'rejected' | 'auth';
  versionBefore?: number | null;
  versionAfter?: number | null;
  detail?: unknown;
}): Promise<void> {
  // Goes through Db, not the raw client, so a test run does not attempt real
  // network writes and an injected store records the audit trail.
  try {
    await getDb().insert('audit_log', [
      {
        device_id: entry.deviceId ?? null,
        worker_id: entry.workerId ?? null,
        action: entry.action,
        entity: entry.entity ?? null,
        entity_id: entry.entityId ?? null,
        outcome: entry.outcome,
        version_before: entry.versionBefore ?? null,
        version_after: entry.versionAfter ?? null,
        detail: entry.detail ?? null,
      },
    ]);
  } catch (e) {
    // An audit write must never take down the sync it is recording, but it is
    // logged loudly because a silent audit gap is a compliance problem.
    console.error('[audit] threw:', e instanceof Error ? e.message : e);
  }
}
