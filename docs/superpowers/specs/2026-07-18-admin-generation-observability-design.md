# Admin Generation Observability Design

**Date:** 2026-07-18

## Goal

Build a read-only, operations-first admin dashboard that records the actual provider and model used for every model call across current synchronous generation and the future durable worker path. The dashboard must combine operational health and cost visibility without storing prompts, generated content, raw provider responses, credentials, or unrestricted metadata.

## Decisions

- Primary goal: operations and cost visibility.
- Initial UI: operations-first overview with a detailed call ledger and job drill-down.
- Coverage: current synchronous generation, personalized generation, and future durable workers.
- Access: `owner` and `admin` may read sanitized detail. Configuration and future control actions remain owner-only.
- Initial release: read-only.
- Detailed-call retention: 90 days.
- Default user identity: masked email, with authorized drill-down to existing user detail.
- Cost: provider-reported actual cost when available; otherwise versioned price estimation; unavailable values remain visibly unavailable.
- Storage: a dedicated append-only provider-call table, not `story_events`, `analytics_events`, `credit_ledger`, or a summary column on `generation_job_attempts`.

## Current-State Problems

`/admin/generation` currently queries `story_events.event_name`, while the table uses `type`. Its mapper expects payload fields that emitters do not write, including `payload.user_id`, `payload.story_id`, `payload.chapter`, `payload.error`, and duration. Query errors are converted to empty output, so the page can silently show inaccurate zeroes.

The AI gateway currently emits usage to process logs only. It has provider/model/token/cost hints but no durable timestamped record tied to user, story, job, correlation ID, attempt, route version, or fallback position.

`generation_jobs` and `generation_job_attempts` are suitable for job and workflow health. They are not suitable for provider billing because one workflow attempt can invoke several model calls: contract, prose, repair, choices, and multiple fallback candidates.

## Architecture

### Data separation

Use four separate telemetry domains:

1. `generation_jobs` and `generation_job_attempts` for queue, retry, worker, lease, publication, and workflow health.
2. New `generation_provider_calls` for one sanitized row per actual model call.
3. `story_events` for narrative consistency metrics.
4. `analytics_events` and `credit_ledger` for product funnel and product-credit accounting.

### Provider-call data flow

```text
generation request
  -> provider candidate selected
  -> provider call starts
  -> response or error normalized
  -> sanitized provider-call telemetry written
  -> generation_provider_calls
  -> admin-only aggregate/detail RPCs
  -> /admin/generation
```

Instrumentation belongs at the shared provider-call boundary so the same recorder covers synchronous and durable-worker paths.

Telemetry writes are best-effort. Failure to persist telemetry must never fail user generation. Telemetry-write failures emit only a bounded internal metric or code, never request content.

## Data Model

### `generation_provider_calls`

Append-only table with explicit columns:

- `id uuid primary key`
- `provider_call_id text unique` or equivalent deterministic idempotency identity
- `user_id uuid`
- `story_id text`
- `chapter_number integer nullable`
- `generation_kind text nullable`
- `job_id uuid nullable`
- `correlation_id uuid nullable`
- `attempt_number integer nullable`
- `use_case text`
- `workflow_phase text`
- `provider_id text`
- `model_id text`
- `route_version bigint nullable`
- `fallback_index integer`
- `started_at timestamptz`
- `ended_at timestamptz`
- `elapsed_ms bigint`
- `outcome text`
- `error_code text nullable`
- `input_token_count bigint nullable`
- `output_token_count bigint nullable`
- `total_token_count bigint nullable`
- `cost_amount numeric nullable`
- `cost_currency text nullable`
- `cost_source text`: `provider_actual`, `price_estimate`, or `unavailable`
- `pricing_version_id uuid nullable`
- `created_at timestamptz`

Constraints must reject negative timing, token, or cost values; invalid timestamps; empty or oversized identifiers; unsupported outcomes and cost sources; and inconsistent total-token values when components are known.

When job identity is present, a trigger validates denormalized user/story/chapter/correlation/attempt identity against the parent job and attempt. Synchronous calls may omit job identity but must still carry user/story/use-case identity through explicit trusted server context.

No update or delete grants are given to application roles. Retention cleanup runs through a bounded service-role function.

### Pricing tables

Use a versioned pricing catalog:

- provider and model identity
- input-token price
- output-token price
- currency
- unit size
- effective start/end timestamps
- version identity
- created/changed by owner

Provider actual cost wins when valid. Otherwise calculate estimation using the pricing version effective when the call occurred. Missing pricing produces `cost_source = unavailable`; it never becomes zero.

### Daily aggregates

Retain detailed calls for 90 days. Store daily aggregates for 13 months by provider, model, use case, outcome, and generation kind. Aggregates contain no user or story identity.

## Privacy and Security

Never persist:

- prompt or system prompt
- generated prose or choices
- raw request or provider response
- raw provider usage object
- headers
- API keys, credentials, auth tokens
- raw exception text
- unrestricted metadata JSON

Allowed telemetry consists of explicit bounded identifiers, controlled error codes, numeric token/cost/timing fields, outcome, and generation identity.

Admin reads use dedicated `SECURITY DEFINER` RPCs with `search_path = ''`. Each function verifies the caller against DB-backed `admin_users` role `owner|admin`. The application does not receive direct table privileges.

Masked email is computed in DB query output, not only in React. Opening user detail uses the existing admin user authorization boundary. Detail access and exports are recorded in a separate admin audit log without copying provider payload or generation content.

## Admin Query APIs

Create bounded, admin-only RPCs:

- `admin_generation_overview_v1`
- `admin_generation_timeseries_v1`
- `admin_model_performance_v1`
- `admin_generation_provider_calls_v1`
- `admin_generation_job_detail_v1`
- `admin_generation_data_quality_v1`

Requirements:

- cursor pagination for detail calls
- bounded page size and time range
- explicit filters
- deterministic ordering
- masked email
- strict reader schemas
- no raw JSON pass-through
- stable normalized error codes

Filters:

- preset/custom time range
- provider and model
- use case and workflow phase
- outcome and error code
- cost source
- user and story
- generation kind
- job ID, correlation ID, and chapter

Filters are represented in the page URL for reproducible incident views.

## Dashboard Design

### Route

Replace the broken `story_events` implementation behind `/admin/generation`.

### Summary cards

- model calls
- tokens
- actual plus estimated cost
- success rate
- error rate
- P50 and P95 latency
- fallback rate
- active, failed, retrying, and stale jobs

Each card compares the selected period with the immediately preceding equivalent period.

### Charts

1. Cost, call, and token trend.
2. Model performance: call count, success rate, P95 latency, fallback rate, and average cost per successful call.
3. Error and fallback distribution.
4. Cost by use case, user, generation kind, provider, and model.

Initial implementation follows existing server-rendered dashboard patterns and avoids introducing a chart library unless current CSS charts cannot meet accessibility or density needs.

### Call ledger

Cursor-paginated columns:

- timestamp
- masked user
- story and chapter
- use case and workflow phase
- provider and model
- token counts
- cost and cost source
- latency
- outcome and error code
- fallback index
- job and correlation identity

### Job drill-down drawer

Shows:

- job lifecycle
- ordered provider-call timeline
- retries and fallback sequence
- attempt number
- worker, heartbeat, and lease timing
- total tokens and cost
- controlled errors
- links to authorized user and story details

The initial release has no mutation actions.

## Additional Admin Capabilities

### P0: ship with telemetry

- model performance comparison
- cost visibility
- error explorer
- job-health overview
- admin detail/export access audit
- data-quality monitor

Data-quality checks include missing token data, unavailable pricing, unknown model IDs, missing generation correlation, and invalid job/publication terminal shape.

### P1: after 7–14 days of stable data

- budget and anomaly alerts
- pricing catalog UI and version history
- saved operational views
- sanitized CSV export
- retention and cleanup health

### P2: separate control-plane design

- disable model route
- edit fallbacks
- set budgets
- retry or cancel jobs
- suspend user generation
- force recovery
- override provider

P2 requires confirmation, operator reason, audit trail, owner/admin RBAC, and idempotency. It is out of scope for this read-only release.

## Failure Handling

- Provider success/failure remains authoritative even when telemetry persistence fails.
- Duplicate completion uses provider-call idempotency and creates one row.
- Missing provider token/cost data stays nullable and visibly unavailable.
- Admin aggregate queries surface partial-data counters.
- RPC errors use stable codes; raw DB/provider errors remain server-side.
- Retention cleanup is batched and retryable with `SKIP LOCKED`.

## Testing

### Schema and privacy

- forbidden columns and generic payload fields absent
- identifiers, error codes, and values bounded
- no direct anon/authenticated/admin table grants
- parent identity trigger rejects forged job identity
- RLS/function ACL and fixed search path verified

### Instrumentation

- success, provider failure, timeout, abort, repair, and fallback
- synchronous and durable-worker context
- telemetry-write failure does not fail generation
- duplicate completion is idempotent
- actual selected provider/model recorded rather than configured primary only

### Cost

- actual cost overrides estimation
- correct effective pricing version selected
- unavailable pricing remains unavailable
- negative and inconsistent token/cost values rejected

### Admin security

- non-admin denied
- admin and owner allowed
- email masked in DB result
- filters cannot expose unauthorized raw data
- detail access/export audited

### Dashboard

- loading, empty, error, partial-data, and large-data states
- URL filters stable
- cursor pagination has no duplicates or omissions
- P50/P95, costs, fallback, and period comparisons verified
- job timeline ordered and joined correctly

## Rollout

1. Add provider-call and pricing schema, admin RPCs, retention, and tests.
2. Instrument provider boundary in shadow mode for all existing generation paths.
3. Validate data quality privately before exposing UI.
4. Enable read-only `/admin/generation`.
5. Observe for 7–14 days.
6. Add P1 alerts, saved views, pricing UI, export, and retention health.
7. Design P2 controls separately.

## Non-Goals

- storing or displaying prompts or generated content
- replacing story consistency telemetry
- treating product credits as provider cost
- changing production generation orchestration
- adding worker process or API cutover
- mutation controls in the first dashboard release
