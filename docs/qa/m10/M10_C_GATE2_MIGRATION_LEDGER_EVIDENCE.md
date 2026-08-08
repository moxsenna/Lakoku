# Gate 2 — production migration-ledger evidence (read-only, authorized)

**Authorization:** reviewer/decision-maker ledger Entry 8, Gate-2 **Option 1
APPROVED** — a narrow production exception for **one** purpose: reading migration
history. SELECT against `supabase_migrations.schema_migrations` only.

**What was executed:** `supabase migration list --linked`. That command's only
remote operation is a read of `supabase_migrations.schema_migrations`, joined
client-side against local migration filenames. It performs no DDL, no
INSERT/UPDATE/DELETE, no `db push`, no `migration repair`, no mutating RPC, no
canary, no activation. Nothing was written to production.

**Not recorded here (by rule):** project ref, host, connection string, password,
service-role key, or any story/reader identifier. Only migration version numbers
appear below.

---

## Result

```text
total local migration files          65
versions applied on production        60
remote-only versions (unknown to repo) 0
version mismatches (local vs remote)   0
```

Applied history is a clean prefix: production's newest applied version is
**`20260805010000`**. Every local file at or below it is applied; every local file
above it is not.

Range the reviewer named (`20260805010000` .. `20260805040000`):

```text
local=20260805010000  remote=20260805010000
local=20260805015000  remote=(NOT APPLIED)
local=20260805020000  remote=(NOT APPLIED)
local=20260805021000  remote=(NOT APPLIED)
local=20260805025000  remote=(NOT APPLIED)
local=20260805030000  remote=(NOT APPLIED)
```

The reviewer's hypothetical ledger (`015000 living_canon` / `020000 living_canon` /
`021000 story_creation_request_job_binding` present on production) **did not
materialize**. None of those versions exist in production's applied history.

---

## What this settles about `bb3287a`

`bb3287a` ("forward-only migration repair — unique versions + rerun-safe duplicate")
touched exactly:

```text
supabase/migrations/20260805020000_living_canon_publication_primitives.sql        (+52 / -21)
supabase/migrations/20260805020000_story_creation_request_job_binding.sql
  -> renamed 20260805021000_story_creation_request_job_binding.sql                (0 / 0)
docs/qa/m10/M10_GOVERNANCE_LEDGER.md                                             (+43)
```

Both migration versions it edited or renamed — `20260805020000` and the resulting
`20260805021000` — are **NOT APPLIED on production**. Therefore:

- the content change to `20260805020000_living_canon_publication_primitives.sql` is
  **not** a rewrite of applied history; that version has never run on production;
- the rename `20260805020000 -> 20260805021000` cannot desynchronize production's
  ledger, because production holds no row for either version;
- there are **zero remote-only versions**, so production has not applied anything
  the repo lacks — no orphan row is created or hidden by the rename;
- the applied set is a contiguous prefix with zero mismatches, so no environment
  drift is visible in the authoritative ledger.

The earlier report's claim that `20260805020000` was "APPLIED" was wrong about
production. It was applied only in local/isolated QA databases, which is precisely
why the reviewer refused to treat that as application-history authority.

**Residual risk, stated rather than hidden:** this proves the state of *production*
only. If some other deployed environment exists that this repo is not linked to and
that had applied `20260805020000`, its history would diverge. No such environment is
known, and the reviewer's own instruction was that a shared/staging ledger would be
authoritative if one existed — none does. Ratification of `bb3287a` remains the
reviewer's call; this document supplies the evidence they asked for.

## Scope compliance

- Command performed a read of `supabase_migrations.schema_migrations` and nothing
  else. Production rows unchanged; no schema object created, altered, or dropped.
- No reader/story/auth table was read.
- `SUPABASE_DB_PASSWORD` was passed as a process-local env var read from
  `.env.local`; it is not present in this document, in any artifact, or in any
  commit.
- No activation, no canary, no worker run against production.
