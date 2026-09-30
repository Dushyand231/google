/**
 * Seed a worker, their device, and a small patient panel so the supervisor
 * view and the sync demo have something to show on first run.
 *
 *   node server/seed.ts
 */

import { configProblem, getDb, verifySchema, LIVE } from './db.ts';

const WORKER = {
  id: 'wrk-lakshmi',
  name: 'Lakshmi',
  role: 'HEALTH_WORKER',
  village: 'Honnavar',
  district: 'Uttara Kannada',
  phc: 'Honnavar PHC',
  phone: '9845000001',
};

const SUPERVISOR = {
  id: 'wrk-supervisor',
  name: 'Dr. Prakash',
  role: 'SUPERVISOR',
  village: 'Honnavar',
  district: 'Uttara Kannada',
  phc: 'Honnavar PHC',
  phone: '9845000002',
};

const PATIENTS = [
  { id: 'pat-001', name: 'Suresh Gowda', age: 58, sex: 'male', village: 'Honnavar', phone: '9845012345', abha: '14-2345-6789-1001' },
  { id: 'pat-002', name: 'Lakshmi Bai', age: 62, sex: 'female', village: 'Kumta', phone: '9845012346', abha: null },
  { id: 'pat-003', name: 'Ramesh Patil', age: 45, sex: 'male', village: 'Honnavar', phone: '9845012347', abha: null },
  { id: 'pat-004', name: 'Fatima Begum', age: 34, sex: 'female', village: 'Bhatkal', phone: '9845012348', abha: '14-2345-6789-1004' },
  { id: 'pat-005', name: 'Venkat Rao', age: 71, sex: 'male', village: 'Kumta', phone: null, abha: null },
  { id: 'pat-006', name: 'Anitha Shetty', age: 28, sex: 'female', village: 'Bhatkal', phone: '9845012349', abha: null },
];

const problem = configProblem();
if (problem) {
  console.error(`[jeevacare] ${problem}`);
  console.error('[jeevacare] copy .env.example to .env and fill in the Supabase project values');
  process.exit(1);
}

const missing = await verifySchema();
if (missing.length > 0) {
  console.error(`[jeevacare] schema incomplete, missing: ${missing.join(', ')}`);
  console.error('[jeevacare] paste db/schema.sql into the Supabase SQL editor and run it');
  process.exit(1);
}

const db = getDb();

// `--check` must never write. A verification command that mutates the database
// is worse than none: it looks like a safety check and silently reseeds prod.
if (process.argv.includes('--check')) {
  // `worker` has no deleted_at, so the soft-delete filter must not be applied
  // to it; passing LIVE there filtered on a column that does not exist.
  const [workers, patients, encounters] = await Promise.all([
    db.count('worker'),
    db.count('patient', LIVE),
    db.count('encounter', LIVE),
  ]);
  const report = { workers, patients, encounters, seeded: false };
  console.log(JSON.stringify(report, null, 2));
  if (workers === 0) {
    console.error('[jeevacare] no workers found — run `npm run db:seed`');
    process.exit(1);
  }
  process.exit(0);
}

// upsert, not insert: re-running the seed refreshes the demo panel instead of
// failing on the primary keys.
await db.upsert(
  'worker',
  [WORKER, SUPERVISOR].map((w) => ({
    id: w.id,
    name: w.name,
    role: w.role,
    village: w.village,
    district: w.district,
    phc: w.phc,
    phone: w.phone,
  }))
);

await db.upsert('device', [
  {
    id: 'dev-field-01',
    worker_id: WORKER.id,
    label: 'Lakshmi — field phone',
    app_version: '1.0.0',
  },
]);

await db.upsert(
  'patient',
  PATIENTS.map((p) => ({
    id: p.id,
    worker_id: WORKER.id,
    name: p.name,
    age: p.age,
    sex: p.sex,
    village: p.village,
    phone: p.phone,
    abha: p.abha,
    consent_given: true,
    version: 1,
  }))
);

const counts = {
  workers: await db.count('worker'),
  devices: await db.count('device'),
  patients: await db.count('patient'),
};

console.log('[jeevacare] seeded:', counts);
