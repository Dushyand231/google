/**
 * One in-memory backend satisfying both sides of the wire.
 *
 *  - the client `KeyValueStore` contract (get/set/remove/keys/clear)
 *  - the server `Db` contract (selectOne/selectMany/count/insertIgnore/upsert/casUpdate)
 *
 * Tests wire the real client code into the real server code through this, so a
 * disagreement about the payload shape shows up as a failing assertion instead
 * of a column that quietly arrives empty in production.
 */
/**
 * The columns each table actually has, mirroring db/schema.sql.
 *
 * This exists because the fake used to accept any column name. A real
 * Postgres rejects an unknown column outright, so a query filtering
 * worker.deleted_at -- a column only patient and encounter have -- raised
 * "column does not exist" and took login down completely, while every one of
 * the 4000+ in-memory assertions passed. A test double that is more
 * permissive than reality hides exactly the bugs it exists to find.
 */
const SCHEMA = {
  worker: ['id', 'name', 'created_at'],
  device: ['id', 'worker_id', 'platform', 'last_seen_at', 'revoked_at'],
  patient: [
    'id', 'worker_id', 'name', 'age', 'sex', 'village', 'phone',
    'consent_given', 'lang', 'version', 'created_at', 'updated_at', 'deleted_at',
  ],
  encounter: [
    'id', 'patient_id', 'worker_id', 'device_id', 'lang', 'transcript',
    'asr_confidence', 'status', 'started_at', 'version', 'created_at', 'updated_at', 'deleted_at',
  ],
  observation: [
    'id', 'encounter_id', 'loinc_code', 'display', 'value_quantity', 'secondary_value',
    'unit', 'ucum_code', 'source', 'status', 'confirmed_by', 'version', 'created_at', 'deleted_at',
  ],
  symptom: [
    'id', 'encounter_id', 'code', 'icon', 'source', 'duration_value', 'duration_unit',
    'negative', 'version', 'created_at', 'deleted_at',
  ],
  triage: ['id', 'encounter_id', 'label', 'severity', 'detail', 'version', 'created_at', 'deleted_at'],
  audit_log: ['id', 'worker_id', 'device_id', 'entity_type', 'entity_id', 'action', 'at', 'detail'],
  sync_receipt: ['batch_id', 'worker_id', 'device_id', 'op_count', 'received_at'],
};

/** Only patient and encounter are soft-deleted; the rest have no such column. */
export const SOFT_DELETE_TABLES = new Set(['patient', 'encounter', 'observation', 'symptom', 'triage']);

function assertColumns(table, columns) {
  const known = SCHEMA[table];
  if (!known) throw new Error(`unknown table ${table}`);
  for (const c of columns) {
    if (c && !known.includes(c)) {
      // The same class of error PostgREST returns, so a bug like this fails
      // here instead of only in production.
      throw new Error(`column ${table}.${c} does not exist`);
    }
  }
}

export class MemoryBackend {
  constructor() {
    this.tables = new Map();
    this.kv = new Map();
  }

  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name);
  }

  // ---- client KeyValueStore ----
  async get(key) {
    const raw = this.kv.get(key);
    return raw === undefined ? null : structuredClone(raw);
  }
  async set(key, value) {
    this.kv.set(key, structuredClone(value));
  }
  async remove(key) {
    this.kv.delete(key);
  }
  async keys(prefix = '') {
    return [...this.kv.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async clear() {
    this.kv.clear();
  }

  // ---- server Db ----
  /** Matches SupabaseDb: a soft-deleted row reads as absent. */
  async selectOne(table, id) {
    const cols = SOFT_DELETE_TABLES.has(table) ? ['deleted_at'] : [];
    assertColumns(table, cols);
    const r = this.table(table).get(id);
    if (!r) return null;
    if (r.deleted_at !== null && r.deleted_at !== undefined) return null;
    return structuredClone(r);
  }

  async selectMany(table, opts = {}) {
    assertColumns(table, [
      ...Object.keys(opts.eq ?? {}),
      ...Object.keys(opts.in ?? {}),
      ...Object.keys(opts.gte ?? {}),
      ...(opts.isNull ?? []),
      ...(opts.order ? [opts.order.column] : []),
    ]);
    let rows = [...this.table(table).values()].map((r) => structuredClone(r));
    for (const [k, v] of Object.entries(opts.eq ?? {})) {
      rows = Array.isArray(v) ? rows.filter((r) => v.includes(r[k])) : rows.filter((r) => r[k] === v);
    }
    for (const [k, vs] of Object.entries(opts.in ?? {})) {
      const list = Array.isArray(vs) ? vs : [vs];
      rows = rows.filter((r) => list.includes(r[k]));
    }
    for (const k of opts.isNull ?? []) {
      rows = rows.filter((r) => r[k] === null || r[k] === undefined);
    }
    for (const [k, v] of Object.entries(opts.gte ?? {})) {
      rows = rows.filter((r) => r[k] !== null && r[k] >= v);
    }
    if (opts.order) {
      const { column, ascending } = opts.order;
      rows.sort((a, b) =>
        ascending ? String(a[column]).localeCompare(String(b[column])) : String(b[column]).localeCompare(String(a[column]))
      );
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async count(table, opts = {}) {
    return (await this.selectMany(table, opts)).length;
  }

  async insert(table, rows) {
    const t = this.table(table);
    for (const r of rows) t.set(r.id ?? `serial-${t.size + 1}`, structuredClone(r));
  }

  async insertIgnore(table, rows) {
    const t = this.table(table);
    for (const r of rows) if (!t.has(r.id)) t.set(r.id, structuredClone(r));
  }

  async upsert(table, rows) {
    const t = this.table(table);
    for (const r of rows) t.set(r.id, structuredClone(r));
  }

  /** Mirrors PostgREST: one UPDATE guarded by an equality predicate. */
  async casUpdate(table, id, baseVersion, fields) {
    const t = this.table(table);
    const row = t.get(id);
    if (!row || row.version !== baseVersion) return null;
    const next = { ...row, ...fields, version: baseVersion + 1, updated_at: 'now' };
    t.set(id, next);
    return structuredClone(next);
  }
}

let pass = 0;
let fail = 0;
export function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name} :: ${detail}`);
  }
}
export function tally() {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}
