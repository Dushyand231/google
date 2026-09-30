/**
 * Sync engine.
 *
 * The rule that matters: an offline device must never silently overwrite a
 * clinical record that changed while it was disconnected. Every op carries the
 * `version` the device last saw. The server applies it only if that version is
 * still current; otherwise it answers 409 and hands back the server's copy so
 * the health worker can reconcile.
 *
 * Last-write-wins was the original idea and it is wrong for patient records.
 */

import { audit, getDb, type Db, type Row } from './db.ts';

export interface SyncOp {
  opId: string;
  kind: 'create_patient' | 'create_encounter' | 'update_patient';
  entityId: string;
  /** version the device last saw; 0 for a brand new record */
  baseVersion: number;
  deviceId: string;
  workerId: string;
  payload: Record<string, unknown>;
}

export interface OpResult {
  opId: string;
  kind: SyncOp['kind'];
  entityId: string;
  status: 'applied' | 'conflict' | 'rejected';
  serverVersion?: number;
  serverRecord?: Record<string, unknown>;
  reason?: string;
}

export interface SyncResult {
  results: OpResult[];
  applied: number;
  conflicts: number;
  rejected: number;
}

const PATIENT_COLUMNS = ['name', 'age', 'sex', 'village', 'phone', 'abha', 'consent_given'] as const;

const ENCOUNTER_FIELDS = [
  'id', 'patientId', 'workerId', 'deviceId', 'takenAt', 'lang', 'transcript',
  'asrConfidence', 'observations', 'symptoms', 'triage',
] as const;

/**
 * Reject any field the server does not understand.
 *
 * A sync endpoint that silently ignores what it does not recognise is how
 * "age_years" became "age is always null" and nobody noticed until a record was
 * read. A loud rejection is recoverable; a silently dropped clinical field is
 * not. This is the check that turns a wire disagreement into a visible error.
 */
function unknownFields(payload: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(payload).filter((k) => !allowed.includes(k));
}

function pickPatientFields(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of PATIENT_COLUMNS) {
    if (payload[c] !== undefined) out[c] = payload[c];
  }
  return out;
}

async function currentVersion(
  db: Db,
  table: 'patient' | 'encounter',
  id: string
): Promise<{ version: number; record: Row } | null> {
  const record = await db.selectOne<Row>(table, id);
  if (!record) return null;
  return { version: Number(record.version ?? 0), record };
}

async function applyCreatePatient(db: Db, op: SyncOp): Promise<OpResult> {
  const existing = await currentVersion(db, 'patient', op.entityId);
  if (existing) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'applied',
      serverVersion: existing.version,
      reason: 'already-present',
    };
  }
  const stray = unknownFields(op.payload, PATIENT_COLUMNS);
  if (stray.length > 0) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'rejected',
      reason: `unknown field(s): ${stray.join(', ')}`,
    };
  }
  const f = pickPatientFields(op.payload);
  if (typeof f.name !== 'string' || !f.name.trim()) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'rejected',
      reason: 'name is required',
    };
  }
  // id is device-generated, so a replayed op collides on the primary key and
  // insertIgnore turns it into a no-op instead of a duplicate patient.
  await db.insertIgnore('patient', [
    {
      id: op.entityId,
      worker_id: op.workerId,
      name: f.name,
      age: f.age ?? null,
      sex: f.sex ?? null,
      village: f.village ?? null,
      phone: f.phone ?? null,
      abha: f.abha ?? null,
      consent_given: f.consent_given ?? false,
      version: 1,
    },
  ]);
  const after = await currentVersion(db, 'patient', op.entityId);
  return {
    opId: op.opId,
    kind: op.kind,
    entityId: op.entityId,
    status: 'applied',
    serverVersion: after?.version ?? 1,
  };
}

async function applyUpdatePatient(db: Db, op: SyncOp): Promise<OpResult> {
  const current = await currentVersion(db, 'patient', op.entityId);
  if (!current) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'rejected',
      reason: 'patient does not exist on server',
    };
  }
  if (op.baseVersion !== current.version) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'conflict',
      serverVersion: current.version,
      serverRecord: current.record,
      reason: `device had v${op.baseVersion}, server is at v${current.version}`,
    };
  }
  const stray = unknownFields(op.payload, PATIENT_COLUMNS);
  if (stray.length > 0) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'rejected',
      reason: `unknown field(s): ${stray.join(', ')}`,
    };
  }
  const f = pickPatientFields(op.payload);
  if (Object.keys(f).length === 0) {
    return { opId: op.opId, kind: op.kind, entityId: op.entityId, status: 'applied', serverVersion: current.version, reason: 'no changes' };
  }
  // casUpdate does the version check and the write in one statement, so a
  // supervisor editing at the same moment cannot be clobbered.
  const updated = await db.casUpdate('patient', op.entityId, current.version, f);
  if (!updated) {
    const now = await currentVersion(db, 'patient', op.entityId);
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'conflict',
      serverVersion: now?.version,
      serverRecord: now?.record,
      reason: 'lost race: another device wrote first',
    };
  }
  return {
    opId: op.opId,
    kind: op.kind,
    entityId: op.entityId,
    status: 'applied',
    serverVersion: Number(updated.version),
  };
}

async function applyCreateEncounter(db: Db, op: SyncOp): Promise<OpResult> {
  const existing = await currentVersion(db, 'encounter', op.entityId);
  if (existing) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'applied',
      serverVersion: existing.version,
      reason: 'already-present',
    };
  }
  const p = op.payload;
  const stray = unknownFields(p, ENCOUNTER_FIELDS);
  if (stray.length > 0) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'rejected',
      reason: `unknown field(s): ${stray.join(', ')}`,
    };
  }
  const patientId = String(p.patientId ?? '');
  if (!(await db.selectOne('patient', patientId))) {
    return {
      opId: op.opId,
      kind: op.kind,
      entityId: op.entityId,
      status: 'rejected',
      reason: 'unknown patient',
    };
  }

  // PostgREST has no multi-statement transaction, so these four writes are
  // not atomic. They are idempotent instead: every id is derived from
  // op.entityId, so replaying the batch after a mid-way failure converges on
  // exactly the same rows. That is what makes a dropped connection safe.
  await db.insertIgnore('encounter', [
    {
      id: op.entityId,
      patient_id: patientId,
      worker_id: op.workerId,
      device_id: op.deviceId,
      lang: String(p.lang ?? 'en'),
      transcript: p.transcript ?? null,
      asr_confidence: p.asrConfidence ?? null,
      version: 1,
    },
  ]);

  await db.insertIgnore(
    'observation',
    ((p.observations ?? []) as Row[]).map((o, i) => {
      const status = String(o.status ?? (o.preliminary === false ? 'final' : 'preliminary'));
      return {
        // Never trust a client-supplied id. Deriving it from the encounter id
        // and the position means a batch can never collide with itself, which
        // is what previously dropped every reading after the first.
        id: `${op.entityId}-obs-${i}`,
        encounter_id: op.entityId,
        loinc_code: String(o.loinc),
        display: String(o.display),
        value_quantity: o.value ?? null,
        // The diastolic half of a blood pressure. Losing this turns 150/90
        // into 150, which is not a small error.
        secondary_value: o.secondaryValue ?? null,
        unit: o.unit ?? null,
        ucum_code: o.ucumCode ?? null,
        source: String(o.source ?? 'voice'),
        status,
        // Only a confirmed reading has a confirmer. Preliminary voice data is
        // explicitly not yet human-verified, so naming the worker here would
        // assert a confirmation that never happened.
        confirmed_by: status === 'final' ? op.workerId : null,
        version: 1,
      };
    })
  );

  await db.insertIgnore(
    'symptom',
    ((p.symptoms ?? []) as Row[]).map((x, i) => ({
      id: `${op.entityId}-sym-${i}`,
      encounter_id: op.entityId,
      code: String(x.code),
      icon: String(x.icon ?? x.code),
      source: String(x.source ?? 'voice'),
      duration_value: x.durationValue ?? null,
      duration_unit: x.durationUnit ?? null,
      negative: x.negative ?? false,
    }))
  );

  await db.insertIgnore(
    'triage',
    ((p.triage ?? []) as Row[]).map((t, i) => ({
      id: `${op.entityId}-tri-${i}`,
      encounter_id: op.entityId,
      label: String(t.label),
      severity: String(t.severity),
      detail: t.detail ?? null,
    }))
  );

  return { opId: op.opId, kind: op.kind, entityId: op.entityId, status: 'applied', serverVersion: 1 };
}

export async function processOps(ops: SyncOp[], db: Db = getDb()): Promise<SyncResult> {
  const results: OpResult[] = [];

  for (const op of ops) {
    try {
      let r: OpResult;
      switch (op.kind) {
        case 'create_patient':
          r = await applyCreatePatient(db, op);
          break;
        case 'update_patient':
          r = await applyUpdatePatient(db, op);
          break;
        case 'create_encounter':
          r = await applyCreateEncounter(db, op);
          break;
        default:
          r = {
            opId: op.opId,
            kind: op.kind,
            entityId: op.entityId,
            status: 'rejected',
            reason: 'unknown op kind',
          };
      }
      results.push(r);
      await audit({
        deviceId: op.deviceId,
        workerId: op.workerId,
        action: op.kind,
        entity:
          op.kind === 'create_patient' || op.kind === 'update_patient' ? 'patient' : 'encounter',
        entityId: op.entityId,
        outcome: r.status === 'applied' ? 'applied' : r.status === 'conflict' ? 'conflict' : 'rejected',
        versionBefore: op.baseVersion,
        versionAfter: r.serverVersion ?? null,
        detail: r.reason ? { reason: r.reason } : null,
      });
    } catch (e) {
      results.push({
        opId: op.opId,
        kind: op.kind,
        entityId: op.entityId,
        status: 'rejected',
        reason: e instanceof Error ? e.message : 'server error',
      });
    }
  }

  return {
    results,
    applied: results.filter((r) => r.status === 'applied').length,
    conflicts: results.filter((r) => r.status === 'conflict').length,
    rejected: results.filter((r) => r.status === 'rejected').length,
  };
}
