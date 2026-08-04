# Lakoku — Anti-Abuse & Credit Entitlement Implementation Plan v1.0

**Status:** Implementation-ready proposal  
**Scope:** Account-level free-story entitlement, welcome-credit protection, paid story starts, chapter-credit reservation, and bounded multi-account abuse controls  
**Target product rules:** 3 starter chapters free, 20 welcome credits once per new account, 8 credits per paid chapter unlock  
**Primary goal:** Prevent free-story farming and credit abuse without adding unnecessary friction for legitimate readers  
**Related architecture:** `ARCHITECTURE_v1.1.md`, `IMPLEMENTATION_PLAN.md`, `NARRATIVE_CONSISTENCY_SPEC.md`, `NARRATIVE_TRACEABILITY_MATRIX.md`

---

## 0. Executive Summary

Lakoku currently has a commercial-risk pattern if “3 free chapters” is interpreted per story:

```text
Account A
├─ Story 1 → Bab 1–3 free
├─ Story 2 → Bab 1–3 free
├─ Story 3 → Bab 1–3 free
└─ ... unlimited free generation
```

The target policy changes the free entitlement from **per-story** to **per-account**:

```text
NEW ACCOUNT
├─ 20 welcome credits — granted once
└─ 1 Starter Story
   ├─ Bab 1 free
   ├─ Bab 2 free
   └─ Bab 3 free

Starter Story Bab 4+
└─ 8 credits / chapter

Story baru setelah Starter Story
└─ proposed default: 24 credits to start
   ├─ includes story contract / bootstrap
   ├─ Bab 1
   ├─ Bab 2
   └─ Bab 3

Bab 4+ pada semua story berbayar
└─ 8 credits / chapter
```

The anti-abuse boundary must be enforced **server-side before expensive generation begins**, not only when prose is displayed.

The implementation must preserve Lakoku’s existing hard rules:

1. Entitlement is server-authoritative.
2. Client input never grants credits or access.
3. Duplicate requests, retries, queue delivery, or workflow resumes must not double-charge.
4. A chapter that never successfully publishes must not consume chapter credits.
5. Deleting a story must not restore starter entitlement or welcome-credit eligibility.
6. Generation must not start when the user lacks the required entitlement/credit authorization.
7. Anti-abuse decisions must be auditable and privacy-conscious.

---

# 1. Product Policy to Lock Before Release

## 1.1 Locked values

Use one server-owned commercial-policy module/table; do not scatter these constants across routes.

```ts
WELCOME_CREDITS = 20
STARTER_FREE_CHAPTERS = 3
CHAPTER_UNLOCK_COST = 8
ADDITIONAL_STORY_START_COST = 24
```

`ADDITIONAL_STORY_START_COST = 24` is the recommended default because it maps cleanly to 3 × 8 credits and prevents a user from using the 20 welcome credits alone to farm a second story.

The value must remain configurable server-side so product can A/B test it later without changing the fundamental entitlement model.

## 1.2 Starter entitlement

A user may claim **one Starter Story for the lifetime of the account**.

Rules:

- The first eligible private/personalized story becomes `starter_story_id`.
- Only `starter_story_id` receives free access for Chapters 1–3.
- Deleting, archiving, abandoning, or resetting that story does not restore the starter entitlement.
- Story 2+ does not receive Chapters 1–3 for free merely because its chapter number is ≤ 3.
- The entitlement is based on durable account state, never on “does the user currently have a story?”

## 1.3 Welcome credits

Welcome credits are:

- exactly 20 credits;
- granted at most once per user lifetime;
- granted by a server-owned idempotent command;
- recorded in the credit ledger;
- never granted from a client callback;
- never re-granted because a story was deleted;
- never re-granted because the user retries onboarding.

Recommended grant trigger:

```text
verified account
+
first successful Starter Story claim / activation
→ grant 20 welcome credits once
```

This is safer than granting credits repeatedly from generic “story created” or client onboarding events.

If current product behavior grants the credits earlier, keep the UX but still route the grant through the same once-per-user server command.

## 1.4 Additional story start

Recommended policy:

```text
Story #1:
Starter entitlement → no story-start credit cost

Story #2+:
24 credits to start
```

The 24 credits purchase a **new-story starter package**, not three separate chapter debits.

Recommended user-facing framing:

> Mulai Cerita Baru · 24 kredit

Do not expose AI-generation cost, story-contract cost, token cost, or internal infrastructure terminology.

## 1.5 Optional free restart

A free restart can be added later, but it should **not** be part of P0 unless explicitly approved.

If enabled in P1, recommended constraints:

- at most once per account;
- only for the Starter Story;
- only before any welcome credit has been spent;
- only before any paid purchase;
- original starter entitlement remains consumed;
- restart replaces the same starter slot instead of granting another free slot.

Default for P0: **OFF**.

---

# 2. Threat Model

## 2.1 P0 — Per-story free-chapter farming

Attack:

```text
create story
→ consume Bab 1–3 free
→ create another story
→ repeat
```

Control:

- free entitlement keyed by `user_id`, not `story_id`;
- durable `starter_story_id`;
- Story 2+ requires a paid story-start authorization.

## 2.2 P0 — Delete-and-recreate farming

Attack:

```text
claim starter
→ delete story
→ system sees no story
→ claim starter again
```

Control:

- starter claim is an immutable/lifetime commercial event;
- story deletion does not delete entitlement history.

## 2.3 P0 — Concurrent double starter claim

Attack:

Two create-story requests race and both see the account as eligible.

Control:

- one database transaction;
- lock account commercial row;
- unique/primary-key invariant on `user_id`;
- `starter_story_id` can transition from NULL to one ID exactly once.

## 2.4 P0 — Credit double spend

Attack:

Two generation requests spend the same 8 credits concurrently.

Control:

- credit authorization/reservation under database lock;
- available balance excludes active reservations;
- one reservation per logical chapter-generation operation.

## 2.5 P0 — Retry / duplicate debit

Attack:

- user double taps;
- request is retried;
- worker resumes;
- queue redelivers;
- publish is replayed.

Control:

- idempotency key;
- reservation reused across retries;
- atomic capture on publish;
- unique debit/capture identity.

## 2.6 P0 — Expensive generation without entitlement

Attack:

User triggers prose generation despite insufficient credits, then simply does not unlock/read the result.

Control:

**generation authorization occurs before provider calls.**

No authorization:

```text
selected choice may be persisted
BUT
no generation job/provider call starts
```

## 2.7 P0 — Failed generation consumes credits

Attack/failure:

Credits are debited when work starts, then prose/choices/continuity generation fails.

Control:

- use credit reservation, not final debit, before generation;
- capture only after successful atomic publication;
- terminal failure releases reservation.

## 2.8 P1 — Multi-account welcome-credit farming

Attack:

```text
Account A → +20
Account B → +20
Account C → +20
...
```

Control:

- account-level entitlement first;
- privacy-safe device/velocity signals;
- risk scoring;
- stronger verification only for suspicious patterns;
- do not hard-ban solely by IP.

## 2.9 P1 — Payment / first-purchase bonus replay

Attack:

Same payment event or checkout callback grants credits/bonus multiple times.

Control:

- verified server webhook only;
- unique provider event ID;
- idempotent credit grant;
- first-purchase bonus has a durable “already granted” proof.

---

# 3. Commercial Invariants

These invariants are non-negotiable.

## INV-C1 — One Starter Story per account

```text
starter_story_id:
NULL → STORY_ID

STORY_ID → another STORY_ID
forbidden in P0
```

Deletion does not revert it to NULL.

## INV-C2 — Welcome credits exactly once

For one `user_id`, cumulative ledger events with reason `WELCOME_CREDIT` must equal:

```text
0 or exactly one +20 event
```

Never two grants.

## INV-C3 — Free Chapters 1–3 require Starter Story identity

This is forbidden:

```ts
if (chapterNumber <= 3) return FREE
```

Required semantic:

```ts
if (
  story.id === commercialState.starterStoryId &&
  chapterNumber <= 3
) {
  return FREE_STARTER_CHAPTER
}
```

## INV-C4 — Additional stories need authorization

Any non-starter personalized/private story creation must have a valid paid start authorization unless explicitly grandfathered/admin-granted.

## INV-C5 — Paid chapter generation requires 8-credit authorization

For Chapter 4+:

```text
no free-start entitlement
+
no valid credit reservation
=
no provider generation
```

## INV-C6 — No charge for unpublished chapter

A chapter reservation is captured only in the same authoritative success boundary as publication, or via a transactionally equivalent fenced publication path.

If publication never succeeds:

```text
reservation → RELEASED
user debit → 0
```

## INV-C7 — Retry does not create a second reservation

Logical identity should include stable identifiers such as:

```text
user_id
story_id
target_chapter
trigger_choice_id / generation operation identity
```

## INV-C8 — Client never chooses price or free eligibility

Client may request an operation.

Server decides:

- starter/free status;
- chapter price;
- story-start price;
- welcome eligibility;
- current balance;
- reservation/capture result.

## INV-C9 — Auditability

Every grant, reservation, release, and capture must retain:

- `user_id`;
- reason;
- amount;
- operation identity;
- story/chapter where relevant;
- correlation/job ID where relevant;
- timestamp;
- actor/source.

---

# 4. Phase 0 — Audit Existing Commercial Model Before Schema Changes

**Do not begin by creating duplicate wallet/ledger tables.**

First inspect the actual repository and production schema for existing:

- credit/wallet balance;
- credit ledger;
- purchase orders;
- payment events;
- first-purchase bonus;
- chapter unlock;
- story-creation entitlement;
- idempotency records;
- story ownership;
- generation jobs;
- publication RPCs.

## T0.1 Existing-schema inventory

Produce:

```text
current table/RPC
→ ownership
→ mutation authority
→ idempotency behavior
→ whether reusable for anti-abuse
```

## T0.2 Existing-route inventory

Trace:

```text
signup
→ welcome credit

story create / story contract lock
→ chapter generation

chapter choice
→ next chapter kickoff

chapter unlock
→ credit debit

payment success
→ credit grant
```

## T0.3 Production read-only audit

Before migration, report:

- number of users;
- users with zero stories;
- users with 1 story;
- users with >1 story;
- users who already received welcome credits;
- users where welcome-credit provenance cannot be determined;
- count of free Chapters 1–3 already published per user;
- any account that has multiple likely “starter” stories.

**Exit gate:** architecture map approved. No mutation before this inventory is complete.

---

# 5. Data Model

Reuse existing wallet/ledger structures wherever possible. The following names are conceptual contracts.

## 5.1 `reader_commercial_state`

One row per user.

```sql
user_id                    uuid primary key
starter_story_id           text/uuid null
starter_claimed_at         timestamptz null

welcome_credit_granted_at  timestamptz null
welcome_credit_event_id    uuid null

first_purchase_at          timestamptz null

free_restart_used_at       timestamptz null -- P1 optional

risk_state                 text not null default 'NORMAL'
created_at                 timestamptz not null
updated_at                 timestamptz not null
```

Constraints:

- `starter_claimed_at IS NULL` iff `starter_story_id IS NULL` unless legacy state requires explicit migration marker;
- welcome event unique;
- only server/RPC mutation;
- user cannot clear `starter_story_id`.

If an equivalent profile/entitlement table already exists, extend it rather than adding this table.

## 5.2 Credit ledger

Preferred model:

```text
credit account balance
+
append-only credit ledger
```

Ledger reasons should include at least:

```text
WELCOME_CREDIT
PURCHASE_BASE
FIRST_PURCHASE_BONUS
NORMAL_PURCHASE_BONUS
ADMIN_GRANT
STORY_START_CAPTURE
CHAPTER_UNLOCK_CAPTURE
REFUND
REVERSAL
```

Each ledger event must have a stable idempotency identity.

Do not encode balance changes only in mutable profile fields without an append-only audit trail.

## 5.3 `credit_reservations`

Required if an equivalent hold/reservation mechanism does not exist.

```sql
id                    uuid primary key
user_id               uuid not null
amount                 integer not null check (amount > 0)

purpose                text not null
-- CHAPTER_UNLOCK | STORY_START

story_id               text/uuid null
chapter_number          integer null

operation_key           text not null
correlation_id          uuid/text null
generation_job_id       uuid null

status                  text not null
-- ACTIVE | CAPTURED | RELEASED | EXPIRED

created_at              timestamptz not null
captured_at             timestamptz null
released_at             timestamptz null
expires_at              timestamptz null
```

Critical uniqueness:

```text
unique(user_id, operation_key)
```

An ACTIVE reservation reduces available balance even though it has not yet become a final debit.

## 5.4 Optional commercial origin on story

If useful for audit, add/derive:

```text
STARTER_FREE
PAID_START
LEGACY_GRANDFATHERED
ADMIN_GRANTED
```

Do not use this field alone for authority; account commercial state + ledger/reservation remain canonical.

---

# 6. Database Commands / RPCs

All commercial state changes must go through explicit transaction boundaries.

## 6.1 `claim_starter_story_v1`

Input:

```text
authenticated user_id
proposed story_id
idempotency_key
```

Behavior:

1. Lock commercial-state row.
2. If starter already points to this story → idempotent success.
3. If starter already points elsewhere → `STARTER_ALREADY_CLAIMED`.
4. Otherwise set `starter_story_id` once.
5. Append audit event.
6. Optionally invoke/coordinate welcome-credit grant if not already granted.

Must be race-safe.

## 6.2 `grant_welcome_credit_v1`

Input:

```text
authenticated/verified user identity
server operation identity
```

Behavior:

1. Lock commercial state.
2. If welcome grant already exists → return original result.
3. Append exactly `+20`.
4. Store ledger event ID on commercial state.
5. Return new balance.

Never accept amount from client.

## 6.3 `reserve_story_start_credit_v1`

For Story 2+.

Server-owned amount:

```text
24 credits
```

Behavior:

1. Verify user does not have free starter entitlement for the new story.
2. Check available balance.
3. Create/reuse reservation.
4. Return `AUTHORIZED | INSUFFICIENT_CREDITS`.

Do not start story-contract generation before authorization succeeds.

## 6.4 `reserve_chapter_credit_v1`

Server-owned amount:

```text
8 credits
```

Behavior:

1. Verify ownership.
2. Check whether target chapter is free via Starter Story identity.
3. If free → return `FREE_STARTER_CHAPTER`.
4. Otherwise reserve 8 credits.
5. Return stable authorization ID.

## 6.5 `capture_credit_reservation_v1`

Must be called only from a trusted server publication/completion boundary.

For chapter:

```text
ACTIVE
→ CAPTURED
→ append -8 ledger event
```

For additional story start:

```text
ACTIVE
→ CAPTURED
→ append -24 ledger event
```

Repeated call returns same captured result.

## 6.6 `release_credit_reservation_v1`

Used for terminal failure/cancellation.

```text
ACTIVE → RELEASED
```

Captured reservations cannot be released without an explicit refund/reversal operation.

---

# 7. Story Creation Flow

## 7.1 First story

Target:

```text
POST create story
↓
authenticate
↓
lock commercial row
↓
starter not claimed?
YES
↓
atomically claim starter_story_id
↓
grant/reuse welcome +20
↓
start story contract / opening generation
```

Starter chapters:

```text
Bab 1 → FREE_STARTER
Bab 2 → FREE_STARTER
Bab 3 → FREE_STARTER
```

No chapter-credit debit.

## 7.2 Additional story

Target:

```text
POST create story
↓
starter already claimed
↓
quote server policy = 24 credits
↓
reserve 24
↓
create story / generate contract + Bab 1
↓
publication success
↓
capture 24
↓
Story Bab 1–3 carry PAID_START_INCLUDED access
```

If contract or Bab 1 terminally fails:

```text
release 24-credit reservation
```

Do not charge the user for a story that never becomes usable.

## 7.3 Why 24 is charged as a starter package

It covers the creation of another full story setup and included Chapters 1–3.

It also closes this abuse path:

```text
welcome bonus 20
→ create free Story #2
```

Because:

```text
20 < 24
```

A fresh account cannot use welcome credits alone to spawn a second full starter package.

---

# 8. Chapter Choice → Generation → Unlock Flow

The anti-abuse gate must sit **before provider generation**.

## 8.1 Free Starter Chapter

Example: selected choice at end of Bab 1, target Bab 2.

```text
accept choice
↓
target is starter story Bab 2
↓
authorization = FREE_STARTER_CHAPTER
↓
enqueue generation
↓
publish
```

## 8.2 Welcome-credit chapter

Example: end Bab 3 → target Bab 4.

```text
accept choice
↓
target Bab 4
↓
not free
↓
reserve 8
↓
welcome balance 20 → available 12
↓
enqueue
↓
publish
↓
capture 8
```

Then Bab 5:

```text
20 - 8 - 8 = 4 remaining
```

Bab 6:

```text
requires 8
available 4
→ INSUFFICIENT_CREDITS
```

## 8.3 Insufficient credits

Recommended state machine:

```text
CHOICE_SELECTED
→ WAITING_FOR_CREDITS
```

Important:

- preserve the exact selected choice;
- do not ask the reader to choose again;
- do not start prose generation;
- do not call a provider;
- after top-up, resume the same generation operation with the same trigger choice.

This gives the paywall strong narrative context without giving away free compute.

## 8.4 Payment then resume

```text
WAITING_FOR_CREDITS
↓
payment webhook grants credits
↓
user taps continue / server resumes safely
↓
reserve 8
↓
generation job
```

Use one stable logical operation identity so retries cannot generate or charge twice.

---

# 9. Generation Worker / Publication Integration

## 9.1 Generation job contract

Generation execution for a paid chapter must carry or reference:

```text
credit_authorization_id
reservation_id
commercial_policy_version
```

Do not trust amount passed in the job. Re-read/validate server state.

## 9.2 Provider-call guard

Immediately before any first provider call:

```ts
assertGenerationCommercialAuthorization(...)
```

It must prove one of:

```text
FREE_STARTER_CHAPTER
PAID_START_INCLUDED_CHAPTER
ACTIVE_CREDIT_RESERVATION
ADMIN/LEGACY explicit entitlement
```

Otherwise:

```text
NO provider call
NO chapter generation
```

## 9.3 Atomic publish + capture

Preferred:

```text
valid chapter artifact
+ expected story/job/lease identity
+ ACTIVE reservation
↓
single fenced transaction
↓
publish chapter
+ state deltas
+ checkpoint PUBLISHED
+ job SUCCEEDED
+ capture reservation / debit ledger
```

If current publication RPC cannot include credit capture safely, implement an equivalent transactionally fenced contract before enabling paid generation.

Avoid:

```text
publish chapter
COMMIT
then debit credit
```

and avoid:

```text
debit credit
COMMIT
then publish chapter
```

Both create inconsistent failure states.

## 9.4 Retry

A worker retry:

- reuses the same reservation;
- never creates a new 8-credit reservation;
- never captures twice.

## 9.5 Terminal failure

```text
FAILED
FAILED_REVIEW_REQUIRED
CANCELLED
```

must release an ACTIVE chapter reservation unless the operation can still resume using the same durable artifact.

Do not release prematurely during retryable states.

---

# 10. Delete / Archive / Reset Semantics

## 10.1 Delete Starter Story

Deletion does not restore:

- starter entitlement;
- welcome credit eligibility;
- previously consumed credits;
- first-purchase bonus eligibility.

Commercial-state row survives.

## 10.2 Delete paid story

No automatic refund of the 24-credit story-start fee after successful creation.

If product later wants goodwill refunds, use explicit audited refund rules, never deletion-triggered automatic restoration.

## 10.3 Account deletion

Follow privacy/data-retention requirements, but anti-fraud/payment records may require a separately documented minimal-retention policy.

Do not silently retain story prose merely for anti-abuse.

---

# 11. Multi-Account Abuse — P1 Risk Layer

P0 closes unlimited free stories **inside one account**.

P1 handles multiple accounts while keeping friction low.

## 11.1 Privacy-safe device identity

For web:

- create random opaque device/browser ID;
- store in signed/secure cookie where practical;
- server stores only opaque identifier/hash;
- do not perform invasive canvas/font fingerprinting in P1.

For native app later:

- use a privacy-reviewed installation identifier, not advertising ID as primary authority.

Device signal is a risk signal, not entitlement authority.

## 11.2 IP signal

Use IP only for velocity/risk.

Recommended:

- store a keyed hash or privacy-reduced prefix for a bounded window;
- rotate/delete according to retention policy;
- never hard-block only because several legitimate users share an IP.

## 11.3 Suggested risk signals

```text
+2  same device gets >2 welcome grants in 30 days
+2  same device creates >3 accounts in 24 hours
+2  same device repeatedly consumes starter Bab 1–3 then abandons
+1  unusually high story-creation velocity
+1  many new accounts share device + short-lived sessions
+1  repeated failed payment / promo cycling
-2  successful verified payment
-1  account age / normal reading history
```

Numbers are initial heuristics only. Tune from telemetry.

## 11.4 Risk actions

### NORMAL

No extra friction.

### WATCH

- stricter rate limit;
- no extra promotional rescue bonus;
- enhanced logging.

### CHALLENGE

- require verified email if not already;
- optionally require stronger verification in future;
- withhold *welcome bonus grant* until challenge passes.

### BLOCK

Only for high-confidence automated abuse, with auditable reason.

Do not block a household just because several accounts use one Wi-Fi network.

---

# 12. Rate Limits

Recommended starting values; keep server-configurable.

## 12.1 Unpaid/new account

```text
active story-generation operations: 1
story-create attempts: max 2 / 24h
starter claim: 1 lifetime
welcome grant: 1 lifetime
```

## 12.2 Device velocity

Initial soft thresholds:

```text
>2 new-user welcome grants / device / 30d → WATCH
>3 account activations / device / 24h → CHALLENGE
```

Do not make these irreversible bans initially.

## 12.3 Paid users

Successful payment reduces risk friction, but does not bypass:

- idempotency;
- credit balance;
- generation concurrency;
- security limits.

---

# 13. Payment & Bonus Hardening

## 13.1 Purchase credits

Only verified payment server events may grant credits.

Required identity:

```text
provider
provider_event_id
order_id
user_id
package_id
commercial_policy_version
```

Unique provider event ID prevents replay.

## 13.2 First-purchase bonus

The server determines whether it is the first successful purchase.

Do not accept:

```json
{
  "firstPurchase": true,
  "bonusCredits": 100
}
```

from client as authority.

Instead:

```text
first successful paid order?
YES → apply configured first-purchase bonus exactly once
NO  → normal package policy
```

## 13.3 Welcome vs first-purchase bonus

These are distinct entitlements:

```text
WELCOME_CREDIT
→ new-user acquisition reward

FIRST_PURCHASE_BONUS
→ commercial conversion reward
```

They must have separate ledger reasons and separate once-only proofs.

---

# 14. API Changes

Exact routes must follow the current repo after Phase 0 audit.

Conceptual contracts:

## `GET /credits/status`

Reader-safe:

```json
{
  "balance": 4,
  "chapterUnlockCost": 8
}
```

Do not expose anti-fraud score or internal rules.

## `POST /stories`

Server response may return:

```json
{
  "status": "CREATED"
}
```

or:

```json
{
  "status": "CREDITS_REQUIRED",
  "requiredCredits": 24,
  "currentCredits": 20
}
```

No client-selected price.

## Choice / continuation response

When selected choice is accepted but next generation is blocked:

```json
{
  "status": "WAITING_FOR_CREDITS",
  "requiredCredits": 8,
  "currentCredits": 4
}
```

The selected choice remains canonical and is not lost.

---

# 15. Reader UX Rules

## 15.1 After Bab 3

Do not show a hard purchase wall immediately if the user still has the 20 welcome credits.

Show:

> Mulai Bab 4 · 8 kredit

and use welcome credits normally.

## 15.2 First natural purchase moment

After:

```text
Bab 4 → -8
Bab 5 → -8
balance = 4
```

Before Bab 6:

> Kamu masih punya 4 kredit.  
> Bab berikutnya membutuhkan 8 kredit.

Then multi-step purchase flow.

## 15.3 Additional story

If user has fewer than 24 credits:

> Mulai cerita baru membutuhkan 24 kredit.

Do not say “biaya generate AI”.

## 15.4 Starter copy

Avoid:

> Setiap cerita mendapat 3 bab gratis.

Prefer:

> Mulai perjalananmu dengan 3 bab gratis.

or:

> Nikmati 3 bab pertama gratis saat memulai Lakoku.

---

# 16. Legacy / Existing User Migration

This is a high-risk part and must be audit-first.

## 16.1 Do not infer blindly

Do not automatically:

- grant every existing user another +20;
- reset all starter entitlements;
- charge existing stories retroactively.

## 16.2 Read-only migration report

For each existing user classify:

```text
A. no story, welcome never granted
B. no story, welcome already granted
C. one story
D. multiple stories
E. ambiguous welcome-credit history
F. existing paid user
```

## 16.3 Proposed grandfathering

Recommended starting policy:

- existing published stories remain accessible according to their current state;
- no retroactive story-start charge;
- no automatic regeneration;
- existing user does not receive a duplicate welcome grant if historical evidence says it was already granted;
- starter entitlement is backfilled only using a deterministic approved rule.

Candidate deterministic rule:

```text
earliest eligible private/personalized story
→ starter_story_id
```

But apply only after a production report shows the consequence is acceptable.

Users with ambiguous state must not be mutated automatically.

## 16.4 Migration must be forward-only

Use:

```text
expand schema
→ backfill proven states
→ deploy compatible code
→ enable feature flag
```

Do not rewrite historical migrations.

---

# 17. Feature Flags / Policy Versioning

Recommended server configuration:

```text
ANTI_ABUSE_COMMERCIAL_V1=off
ACCOUNT_SCOPED_STARTER=off
CREDIT_RESERVATIONS_V1=off
ADDITIONAL_STORY_CREDIT_GATE=off
DEVICE_RISK_V1=off
```

Commercial policy object:

```json
{
  "version": 1,
  "welcomeCredits": 20,
  "starterFreeChapters": 3,
  "chapterUnlockCredits": 8,
  "additionalStoryStartCredits": 24
}
```

Every reservation/grant should record policy version.

This enables safe rollout and later pricing tests without ambiguous historical accounting.

---

# 18. Observability

## 18.1 Commercial metrics

Track:

```text
welcome_credit_granted_count
welcome_credit_duplicate_prevented_count

starter_story_claim_count
starter_story_duplicate_claim_denied_count

additional_story_start_attempt_count
additional_story_credit_required_count
additional_story_start_conversion_rate

credit_reservation_created_count
credit_reservation_capture_count
credit_reservation_release_count
credit_reservation_expired_count

chapter_waiting_for_credits_count
welcome_credit_exhausted_to_purchase_rate

first_purchase_conversion_rate
repeat_purchase_rate
```

## 18.2 Abuse metrics

```text
free_story_farming_attempt_rate
delete_recreate_attempt_rate
multi_account_device_watch_count
multi_account_challenge_count
abuse_block_count
false_positive_support_rate
```

## 18.3 Cost metrics

Required business metrics:

```text
free_generation_cost_per_activated_account
starter_story_generation_cost
paid_chapter_cost
provider_calls_per_published_chapter
retry_cost_per_published_chapter
cost_per_payer
```

Never expose provider/model/token terminology to reader UI.

---

# 19. Tests

## 19.1 Starter entitlement

### Test A — first story free

```text
user with starter_story_id NULL
→ create Story A
→ A becomes starter
→ Bab 1–3 free
```

### Test B — second story not free

```text
same user
→ create Story B
→ requires 24-credit authorization
```

### Test C — delete/recreate

```text
delete Story A
→ create Story C
→ still requires 24
```

### Test D — race

Two simultaneous first-story requests:

```text
only one becomes starter
the other receives paid-start requirement/conflict
```

## 19.2 Welcome credits

- grant +20 once;
- duplicate request returns original result;
- onboarding retry does not grant another +20;
- story deletion does not grant another +20.

## 19.3 Credit reservation

### Chapter success

```text
balance 20
→ reserve 8
→ available 12
→ publish succeeds
→ capture
→ balance 12
```

### Chapter failure

```text
balance 20
→ reserve 8
→ terminal generation failure
→ release
→ balance remains 20
```

### Duplicate worker

Two workers/retries cannot produce two captures.

### Concurrent chapter/story operations

Available balance cannot become negative.

## 19.4 Generation provider guard

A critical integration test:

```text
user balance = 4
target chapter requires 8

EXPECT:
WAITING_FOR_CREDITS
provider call count = 0
generation job not started
```

Mutation test:

Remove commercial authorization check.

Expected:

```text
test FAILS
```

This prevents future regressions where UI is gated but expensive generation remains free.

## 19.5 Paid story start

```text
balance 20
Story #2 requires 24
→ no story generation provider call
```

With balance 30:

```text
reserve 24
→ story contract/Bab1 succeeds
→ capture 24
→ Chapters 1–3 included
```

If bootstrap fails:

```text
→ release 24
```

## 19.6 Payment replay

Same webhook delivered multiple times:

```text
one purchase grant
one first-purchase bonus
```

## 19.7 Security

- user A cannot spend user B credits;
- client cannot override amount;
- client cannot mark a story as Starter;
- client cannot submit fake “first purchase”;
- admin grants require explicit audited role.

---

# 20. Rollout Plan

## Stage 0 — Audit only

- map existing tables/routes;
- production DB read-only report;
- no credit mutation;
- no entitlement change.

**Gate:** approved data model.

## Stage 1 — Schema + pure policy

- additive schema;
- commercial policy module;
- starter/free eligibility pure functions;
- credit-reservation pure logic;
- tests.

Feature flags OFF.

## Stage 2 — DB RPC hardening

Implement:

- starter claim;
- welcome grant;
- reservation;
- capture;
- release;
- read-only commercial status.

Run concurrency tests and DB tests.

Feature flags OFF.

## Stage 3 — Generation integration

Wire:

```text
choice
→ commercial authorization
→ generation
→ atomic publish/capture
```

Add provider-zero-call negative tests.

Staging only.

## Stage 4 — Story creation gate

Wire additional story creation:

```text
starter already used
→ reserve 24
→ bootstrap
→ capture/release
```

Staging only.

## Stage 5 — Legacy backfill

Run approved deterministic backfill after report review.

No automatic duplicate welcome credits.

## Stage 6 — Production soft enable

Suggested order:

1. enable account-scoped Starter entitlement;
2. observe;
3. enable chapter reservations;
4. observe;
5. enable 24-credit additional-story gate;
6. observe;
7. enable P1 device risk only after baseline data exists.

Do not enable everything simultaneously.

## Stage 7 — P1 multi-account risk

After enough production data:

- device velocity;
- privacy-safe IP velocity;
- WATCH/CHALLENGE rules;
- support workflow;
- false-positive monitoring.

---

# 21. Rollback

Commercial rollback must never delete ledger history.

If a rollout problem occurs:

```text
disable feature flag
→ stop new gated operations
→ preserve existing reservations/ledger
→ reconcile ACTIVE reservations
→ forward-fix code/schema
```

Provide an admin reconciliation command for stranded ACTIVE reservations:

- capture only if publication proof exists;
- otherwise release;
- all actions audited.

Never “fix” balance through an unaudited direct SQL update.

---

# 22. Release Gates

Production enable is **NO-GO** unless all are true:

- [ ] account-level starter entitlement proven race-safe;
- [ ] welcome +20 proven exactly-once;
- [ ] delete/recreate regression passes;
- [ ] Story #2 cannot receive free Bab 1–3;
- [ ] insufficient credits produces zero provider calls;
- [ ] chapter failure releases reservation;
- [ ] chapter publication captures exactly once;
- [ ] queue/job retry cannot double-charge;
- [ ] payment replay cannot double-grant;
- [ ] first-purchase bonus exactly once;
- [ ] cross-user credit access denied;
- [ ] legacy production data classified;
- [ ] feature flags provide rollback;
- [ ] metrics/dashboard available;
- [ ] staging E2E passes.

---

# 23. Definition of Done

P0 anti-abuse is complete when this exact sequence is proven:

```text
New user
→ Starter Story A claimed exactly once
→ +20 welcome credits exactly once
→ Bab 1–3 free only in Story A
→ Bab 4 reserves/captures 8
→ Bab 5 reserves/captures 8
→ balance = 4
→ Bab 6 choice persists but generation waits for credits
→ provider is NOT called

User attempts Story B
→ requires 24 credits
→ 4 credits insufficient
→ provider is NOT called

User deletes Story A
→ Starter entitlement remains consumed
→ Story C still requires 24 credits

User purchases credits
→ verified webhook grants package + first-purchase bonus once
→ Bab 6 resumes from the exact selected choice
→ one 8-credit reservation
→ successful publish captures exactly once
```

And the following abuse sequence must fail:

```text
create free story
→ consume 3 free chapters
→ delete
→ create free story
→ repeat
```

Expected result after first Starter Story:

```text
NO second free starter
NO duplicate +20 welcome grant
NO unpaid provider generation
```

---

# 24. Explicit Non-Goals for P0

Do not bundle these into the first anti-abuse release:

- invasive browser fingerprinting;
- phone verification for every user;
- machine-learning fraud scoring;
- permanent IP bans;
- complex coupon system;
- spin-wheel promotions;
- automatic refund policy;
- free restart unless separately approved;
- changing narrative generation behavior;
- changing the 50-chapter story structure.

P0 should solve the economically dangerous loopholes with **deterministic server-side entitlement + idempotent credit accounting first**.

---

# 25. Recommended Implementation Order for Agent

```text
1. AUDIT existing commercial schema/routes
2. WRITE tests for current farming exploit
3. ADD account-scoped starter commercial state
4. ADD idempotent welcome-credit proof
5. ADD credit reservation abstraction
6. GATE generation before provider calls
7. CAPTURE reservation atomically with publication
8. ADD 24-credit Story #2+ authorization
9. ADD delete/recreate + race + retry regressions
10. ADD legacy classification/backfill
11. ADD observability
12. STAGING E2E
13. PRODUCTION soft rollout
14. ONLY THEN consider multi-account device-risk P1
```

The agent must stop and report instead of guessing if the current wallet/payment schema contradicts this plan. Existing authoritative ledger and payment primitives should be extended, not duplicated.
