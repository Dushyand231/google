# JeevaCare

Offline-first rural health app. A health worker records visits in a village
with no signal; the app never blocks on the network, and the queue drains
itself when a connection appears.

## How offline-first works here

```
record visit ──> SQLite op-log (append) ──> local state updates immediately
                        │
                        ├─ online  ──> POST /api/sync ──> Supabase
                        │                                    │
                        │                    confirm ────────┘
                        │                       │
                        │                  delete op  ← only here
                        │
                        └─ offline ──> op stays queued with a retry schedule
```

Three rules hold the design together:

1. **Save locally first.** Every mutation is appended to a persistent op-log in
   SQLite before any network call. The UI renders from local state, so recording
   a patient feels instant whether or not there is signal.
2. **Delete only after the server confirms.** An op is removed from the queue
   only when the backend has acknowledged it. A dropped connection, a killed
   process, or a lost response all leave the op on disk.
3. **No data is ever silently dropped.** A version conflict is parked in a
   conflicts list for the worker to resolve by hand, because a supervisor's edit
   and a field worker's edit are both clinically real and the app has no basis
   for choosing between them.

### Duplicate prevention

Every entity is keyed by a **client-generated id** that is the table's primary
key on the server. A replayed batch therefore converges on the same rows rather
than inserting a second encounter. Updates use compare-and-swap on `version`:

- the client sends the `baseVersion` it last saw;
- the server applies the change only if the stored version still matches;
- otherwise it returns `conflict` with both copies.

This is what makes the dangerous case safe: the server writes the record, the
response is lost, and the client retries. The retry is a no-op, not a duplicate.

### Retry and backoff

Failed ops are kept and rescheduled with exponential backoff — 0s, 5s, 15s,
45s, 2m, 5m, then 15m. The schedule is stored **on the op**, not in memory,
because the app is killed and relaunched constantly in the field; an in-memory
backoff resets on every cold start, which is exactly how a client ends up
hammering a server that is down.

`401`/`403` is treated as terminal for that batch rather than transient, since
retrying the same bytes with the same bad token cannot succeed. The record still
stays queued, so a later sign-in drains it.

### Batching

Pending ops are sent in batches of 20 (`DEFAULT_BATCH_SIZE` in
`src/lib/sync.ts`). A lost 2G connection then costs one batch instead of the
whole backlog. The queue drains one batch per pass and reschedules itself, so a
100-record backlog takes five passes rather than one oversized request.

### Network detection

The app treats *reachability*, not connectivity, as online. A phone can be on a
Wi-Fi access point with no working uplink, so an open socket proves nothing.
`GET /api/health` must answer before anything is uploaded, with a short timeout
so a health check never hangs on a dead link.

`AutoSync` (in `src/lib/autosync.ts`) drives syncing from four events: app
start, app focus, an OFFLINE → ONLINE transition, and a backstop interval that
backs off while the backend is unreachable. Polling on a fixed timer forever
would drain the battery of a phone that is offline for a week, which is the
normal state here.

## Setup

```bash
npm install
cp .env.example .env      # fill in Supabase keys and SYNC_PORT
npm run db:setup          # apply db/schema.sql, then seed
npm start                 # Expo dev server
npm run server            # sync API on SYNC_PORT (default 4000)
```

The phone must reach the sync server. On a USB-connected device:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4000 tcp:4000
```

## Testing

```bash
npm test                  # all unit + contract suites
npm run db:verify         # live schema and RLS checks against Supabase
npm run e2e:live          # end-to-end against real Supabase (needs .env)
```

Sync behaviour is covered in `scripts/sync.test.mjs` (backoff, batching,
auth failure, restart resumption, lost acknowledgement) and
`scripts/autosync.test.mjs` (reconnect triggering, no double-send, offline
polling discipline). Both inject a fake backend and a fake clock, so neither
sleeps or touches the network.

## API

| Method | Path          | Auth   | Purpose                                    |
| ------ | ------------- | ------ | ------------------------------------------ |
| `POST` | `/api/login`  | none    | Exchange a worker id for a device token    |
| `POST` | `/api/sync`   | bearer  | Apply a batch of ops idempotently          |
| `GET`  | `/api/health` | none    | Reachability probe used by auto-sync       |
| `GET`  | `/api/summary`| bearer  | Per-worker visit counts for the supervisor |

`POST /api/sync` answers `200` when every op applied, `207` when at least one
needs human reconciliation, and `400`/`401` for a malformed or unauthorised
request. Each op gets its own result — `applied`, `conflict`, or `rejected` —
so one bad op never fails the batch.

## Security notes

The phone talks only to the sync server; `SUPABASE_SERVICE_ROLE_KEY` stays on
the server and is never bundled into the app. Supabase has RLS enabled with no
policies, so the anon and authenticated roles match nothing and only
`service_role` (used server-side) can read or write. Tokens are per-device
HMACs, and the app ships without the service-role key.

Before field deployment, worker sign-in still needs real authentication and
local storage still needs encryption at rest — see the caveats in the handoff
notes rather than treating this as production-hardened.
