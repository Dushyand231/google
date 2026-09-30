-- JeevaCare schema for Supabase (PostgreSQL 15+).
--
-- HOW TO APPLY
--   Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   The sync server cannot run DDL itself: the Supabase client only speaks
--   PostgREST, so this is a one-time manual step. `npm run server` verifies
--   the result on boot and names any table that is still missing.
--
--   Do NOT wrap this in BEGIN/COMMIT. The SQL editor already runs the script
--   as one transaction, and an explicit nested BEGIN only produces a warning.
--
-- ROW LEVEL SECURITY -- read this before exposing the project URL
--   Supabase puts PostgREST on a public hostname, and the `anon` key ships
--   inside every client app. Without RLS, anyone holding that key could read
--   every patient's name, age, village and phone. So RLS is enabled on every
--   table below and NO policies are created: `anon` and `authenticated` are
--   denied by default, and only the `service_role` key (which the sync server
--   holds, and never the phone) bypasses RLS.
--
--   If direct device access is ever added, write a policy deliberately and
--   re-review it. Do not add a permissive policy to make a query work.
--
-- Sync contract, per PSN006 §13: never blindly overwrite a clinical record.
-- Every syncable row carries `version` and `updated_at`. The device sends the
-- version it last saw; the server compares and answers 409 with its own copy
-- when they diverge, so a supervisor edit is never silently clobbered by a
-- stale offline device and vice versa.
--
-- `deleted_at` is a soft delete. A hard delete would break the audit trail that
-- DPDP and any clinical review depend on.

CREATE TABLE IF NOT EXISTS worker (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'HEALTH_WORKER'
              CHECK (role IN ('HEALTH_WORKER', 'SUPERVISOR', 'ADMIN')),
  village     TEXT,
  district    TEXT,
  phc         TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device (
  id            TEXT PRIMARY KEY,
  worker_id     TEXT NOT NULL REFERENCES worker (id) ON DELETE CASCADE,
  label         TEXT,
  last_seen_at  TIMESTAMPTZ,
  app_version   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient (
  id            TEXT PRIMARY KEY,
  worker_id     TEXT NOT NULL REFERENCES worker (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  age           INTEGER CHECK (age IS NULL OR (age >= 0 AND age <= 130)),
  sex           TEXT CHECK (sex IS NULL OR sex IN ('male', 'female', 'other')),
  village       TEXT,
  phone         TEXT,
  abha          TEXT,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_worker  ON patient (worker_id);
CREATE INDEX IF NOT EXISTS idx_patient_abha    ON patient (abha) WHERE abha IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_village ON patient (village);

CREATE TABLE IF NOT EXISTS encounter (
  id             TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL REFERENCES patient (id) ON DELETE CASCADE,
  worker_id      TEXT NOT NULL REFERENCES worker (id) ON DELETE CASCADE,
  device_id      TEXT REFERENCES device (id) ON DELETE SET NULL,
  lang           TEXT NOT NULL DEFAULT 'en',
  transcript     TEXT,
  -- Kept verbatim. If a value is later disputed, the record of what was
  -- actually said is the only way to tell an ASR error from a clinical change.
  asr_confidence REAL,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enc_patient ON encounter (patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS observation (
  id            TEXT PRIMARY KEY,
  encounter_id  TEXT NOT NULL REFERENCES encounter (id) ON DELETE CASCADE,
  loinc_code    TEXT NOT NULL,
  display       TEXT NOT NULL,
  value_quantity REAL,
  -- Diastolic half of a blood pressure. Without this column 150/90 collapses
  -- to 150, which is not a small clinical error.
  secondary_value REAL,
  unit          TEXT,
  ucum_code     TEXT,
  source        TEXT NOT NULL DEFAULT 'voice'
                CHECK (source IN ('voice', 'tap', 'manual')),
  -- 'preliminary' when the ASR heard it but a human has not confirmed it yet.
  -- Nothing derived from uncertain voice is allowed to reach 'final'.
  status        TEXT NOT NULL DEFAULT 'preliminary'
                CHECK (status IN ('preliminary', 'final', 'amended', 'entered-in-error')),
  confirmed_by  TEXT REFERENCES worker (id) ON DELETE SET NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_enc   ON observation (encounter_id);
CREATE INDEX IF NOT EXISTS idx_obs_loinc ON observation (loinc_code);

CREATE TABLE IF NOT EXISTS symptom (
  id             TEXT PRIMARY KEY,
  encounter_id   TEXT NOT NULL REFERENCES encounter (id) ON DELETE CASCADE,
  code           TEXT NOT NULL,            -- fever | cough | vomiting | ...
  icon           TEXT NOT NULL,            -- pictogram key, mirrors the mobile grid
  source         TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'tap', 'manual')),
  duration_value INTEGER,
  duration_unit  TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('hours', 'days', 'weeks')),
  negative       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sym_enc  ON symptom (encounter_id);
CREATE INDEX IF NOT EXISTS idx_sym_code ON symptom (code);

-- Triage output. Stored separately from the observation so a rule change can
-- be re-evaluated over history without rewriting clinical measurements.
CREATE TABLE IF NOT EXISTS triage (
  id           TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL REFERENCES encounter (id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('info', 'medium', 'high')),
  detail       TEXT,
  rule_version TEXT NOT NULL DEFAULT 'v1',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triage_enc ON triage (encounter_id);

-- Append-only. Every accepted write, every rejected conflict, every login.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id      TEXT,
  worker_id      TEXT,
  action         TEXT NOT NULL,
  entity         TEXT,
  entity_id      TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('applied', 'conflict', 'rejected', 'auth')),
  version_before INTEGER,
  version_after  INTEGER,
  detail         JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_at      ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity, entity_id);

-- Idempotency. A device that uploads, loses signal, and retries must not
-- create a second encounter. Primary key is the device-generated id, so a
-- replayed batch is a no-op rather than duplicate clinical data.
CREATE TABLE IF NOT EXISTS sync_receipt (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  op_count     INTEGER NOT NULL,
  applied      INTEGER NOT NULL,
  conflicts    INTEGER NOT NULL
);

-- Deny-by-default. `alter table ... enable row level security` with no policy
-- means the anon and authenticated roles match nothing and get zero rows back
-- on every table. service_role bypasses RLS, which is how the sync server reads
-- and writes.
ALTER TABLE worker       ENABLE ROW LEVEL SECURITY;
ALTER TABLE device       ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient      ENABLE ROW LEVEL SECURITY;
ALTER TABLE encounter    ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation  ENABLE ROW LEVEL SECURITY;
ALTER TABLE symptom      ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_receipt ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
