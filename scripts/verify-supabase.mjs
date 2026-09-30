/**
 * Proves the Supabase project is wired correctly, without ever printing a key.
 *
 *   node scripts/verify-supabase.mjs
 *
 * The check that matters most is the RLS one. Supabase serves PostgREST from a
 * public hostname and the anon key ships inside the Expo bundle by design, so
 * if RLS is not actually denying the anon role, anyone can read the `patient`
 * table: every name, age, village and phone number. That failure is silent --
 * the app works perfectly and the data is simply public. So it is asserted
 * here rather than trusted.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '..', '.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const URL = process.env.SUPABASE_URL ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} :: ${detail}`); }
};
/** Describes a value without revealing it: only its shape, never its content. */
const describe = (v) => {
  if (v.length === 0) return 'empty';
  if (/your-|replace|changeme/i.test(v)) return 'still the placeholder from .env.example';
  return `set (${v.length} chars)`;
};
const isPlaceholder = (v) => v.length === 0 || /your-|replace|changeme/i.test(v);

console.log('\n=== configuration (values are never printed) ===');
check('SUPABASE_URL is set', !isPlaceholder(URL), describe(URL));
check('service role key is set', !isPlaceholder(SERVICE), describe(SERVICE));
check('anon key is set', !isPlaceholder(ANON), describe(ANON));
if (isPlaceholder(URL) || isPlaceholder(SERVICE)) {
  console.log('\nFill in .env first. Nothing below can run without them.\n');
  process.exit(1);
}

const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

console.log('\n=== schema ===');
const TABLES = [
  'worker', 'device', 'patient', 'encounter',
  'observation', 'symptom', 'triage', 'audit_log', 'sync_receipt',
];
// A real query, not a HEAD/count request. The HEAD variant was observed
// returning no error against a project with no tables at all, so it reported
// an empty database as fully migrated. A check that passes when there is
// nothing to check is worse than no check, because it is trusted.
const missing = [];
for (const t of TABLES) {
  const { error } = await service.from(t).select('*').limit(1);
  if (error) missing.push(`${t} (${error.message.replace(/\s+/g, ' ').slice(0, 60)})`);
}
check(
  'all 9 tables exist',
  missing.length === 0,
  missing.length ? `${missing.length} missing:\n    - ${missing.join('\n    - ')}` : 'ok'
);
if (missing.length > 0) {
  console.log('\n  Paste db/schema.sql into Supabase -> SQL Editor and run it.\n');
}

console.log('\n=== row level security ===');
// service_role must work, otherwise the sync server cannot write at all.
const svcRead = await service.from('patient').select('id').limit(1);
check('service role can read patient', !svcRead.error, svcRead.error?.message ?? 'ok');

// anon must NOT. This is the whole point of the RLS block in schema.sql.
const anonRead = await anon.from('patient').select('id').limit(1);
if (anonRead.error) {
  const denied =
    /row-level security|not authorized|permission denied|401|403/i.test(anonRead.error.message);
  check('anon is denied on patient', denied, `unexpected error: ${anonRead.error.message}`);
} else {
  const rows = anonRead.data ?? [];
  // A 200 with zero rows is correct deny-by-default under RLS.
  check('anon is denied on patient', rows.length === 0, `anon read ${rows.length} patient rows`);
}

for (const t of ['worker', 'encounter', 'observation', 'symptom', 'audit_log']) {
  const r = await anon.from(t).select('id').limit(1);
  const denied = r.error ? /row-level security|not authorized|permission denied/i.test(r.error.message) : (r.data ?? []).length === 0;
  check(`anon is denied on ${t}`, denied, r.error ? r.error.message : `anon read ${(r.data ?? []).length} rows`);
}

console.log('\n=== required columns ===');
for (const [table, column] of [
  ['observation', 'secondary_value'],
  ['observation', 'source'],
  ['symptom', 'duration_unit'],
  ['patient', 'version'],
  ['patient', 'deleted_at'],
]) {
  const { data, error } = await service.from(table).select(column).limit(1);
  check(`${table}.${column} exists`, !error, error?.message ?? 'ok');
  void data;
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log('\nNote: this checks structure and access control only. It does not');
console.log('prove the sync engine end to end; scripts/contract.test.mjs covers that.\n');
process.exit(fail === 0 ? 0 : 1);
