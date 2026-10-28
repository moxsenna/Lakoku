# Catalog Plan 3 — Admin QC & Publish Dashboard

**Status:** Implemented & verified locally 2026-10-28. Production migration push and VPS deploy still require PM approval.

**Goal:** Give the platform owner a mobile-first admin surface to review every chapter unit of a catalog novel, edit prose and choice labels, approve or request a rewrite, publish to Beranda only when every unit is approved, and archive a novel without revoking access from readers who already bought it.

**Depends on:** Catalog Plan 1 (reader foundation), already merged in `29d10f4`.

## Model

A catalog novel is 62 review units:

- **Spine:** Bab 1–44 in `chapters`, review key `variantKey = 'spine'`.
- **Ending variants:** Bab 45–50 for each of the 3 endings in `catalog_ending_chapters`, review key `variantKey = <ending_key>`.

Review state is per unit in `catalog_chapter_reviews`, keyed `(story_id, chapter_number, variant_key)`.

```text
catalog_chapter_reviews
  story_id       text      -> stories(id) on delete cascade
  chapter_number integer   1..50
  variant_key    text      'spine' | ending key
  status         text      pending | approved | rewrite_requested
  note           text      optional reviewer note (max 2000 chars)
  reviewed_by    uuid      admin user id
  created_at / updated_at timestamptz
  primary key (story_id, chapter_number, variant_key)
```

## Publish gate

`canPublish` requires all blockers to be absent:

| Blocker | Condition |
|---|---|
| `CONTRACT_MISSING` / `CONTRACT_INVALID` | `catalog_stories.contract_json` missing or fails `CatalogContractSnapshotSchema` |
| `SPINE_INCOMPLETE` | Any of Bab 1–44 absent |
| `ENDING_VARIANTS_INCOMPLETE` | Any ending lacks Bab 45–50, or the contract has no endings |
| `CHAPTERS_MISSING` | Zero review units |
| `UNITS_NOT_APPROVED` | Any unit is `pending` or `rewrite_requested` |

Publishing sets `catalog_stories.status = 'published'`, `published_at`, `published_by`, and `stories.visibility = 'public'`.

Editing chapter text through the admin API resets that unit's review to `pending` in the same request, so old approval can never certify new prose.

## Files

```text
neon/migrations/20261028120000_catalog_admin_review.sql
lib/supabase/db-types.ts                         # CatalogChapterReviews type + registration
lib/catalog/admin.server.ts                     # Pure derivation + DB operations + publish gate
lib/catalog/admin-http.server.ts                # Admin guard + error-to-status mapping
lib/credits/access-resolver.server.ts           # Closed-catalog purchase block (STORY_PENDING)
app/api/admin/catalog/route.ts                  # GET list
app/api/admin/catalog/[id]/route.ts             # GET detail
app/api/admin/catalog/[id]/review/route.ts      # POST review status
app/api/admin/catalog/[id]/chapter/route.ts     # PATCH title/paragraphs/choices
app/api/admin/catalog/[id]/publish/route.ts     # POST publish (409 when not ready)
app/api/admin/catalog/[id]/archive/route.ts     # POST archive
app/admin/katalog/page.tsx                      # List screen
app/admin/katalog/[id]/page.tsx                 # Detail, variant tabs, per-unit QC, edit, publish, archive
components/admin/admin-sidebar.tsx              # "Katalog" nav entry
```

## Admin API contracts

All routes call `guardCatalogAdmin()`: unauthenticated → 401, authenticated non-admin → 403.

- `GET /api/admin/catalog` → `{ stories: CatalogAdminSummary[] }`
- `GET /api/admin/catalog/{id}` → `{ story: CatalogAdminDetail }` or 404
- `POST /api/admin/catalog/{id}/review` body `{ chapterNumber, variantKey, status, note? }`
- `PATCH /api/admin/catalog/{id}/chapter` body `{ chapterNumber, variantKey, title?, paragraphs?, choices? }`
- `POST /api/admin/catalog/{id}/publish` → `{ status: 'published', story }`; 409 `NOT_READY` while blocked
- `POST /api/admin/catalog/{id}/archive` → `{ status: 'archived' }`

Error mapping: `NOT_FOUND`/`CHAPTER_NOT_FOUND` → 404, `NOT_CATALOG`/`INVALID_INPUT` → 400, `NOT_READY` → 409, unexpected → 500 with a reader-safe message.

Input validation rejects non-integer chapter numbers, non-string paragraphs, unknown review statuses, and choice arrays that are not `{ id: string, label: string }[]`. Content limits: title 1–200 chars, 1–40 paragraphs of ≤6000 chars, 2–4 choices with ≤160-char labels.

## Archive semantics

Archive sets `catalog_stories.status = 'archived'` and deliberately leaves `stories.visibility = 'public'`.

- The novel disappears from Explore because the listing requires `catalog_stories.status = 'published'`.
- Guests and new buyers get `STORY_PENDING` with `cost: 0`, so no new purchase starts and no credits are charged.
- Free chapters (Bab 1–3) remain readable.
- Any reader with a chapter ledger ref (`unlock:{story}:{chapter}:{user}`) or bundle ref (`bundle:{story}:{user}`) keeps access.
- A missing `catalog_stories` row is treated as legacy data: purchase still quotes the fallback 5 Lakoin instead of blocking.

Archive confirmation in the UI is a two-step inline control (`Tarik` → `Yakin tarik novel`), not a blocking `window.confirm`, so it works on mobile and is testable.

## Verification

Gates live in `GATES.catalog-plan-3.md` and all six are met. Oracle runner: `scripts/catalog-plan3-verify.mjs` (`static`, `typecheck`, `lint`, `unit`, `live`).

- **Static:** migration DDL, db types, exported admin operations, six guarded routes, sidebar entry, page controls, resolver closed-catalog branch, migration version uniqueness.
- **Typecheck:** full project `tsc --noEmit --incremental false`.
- **Lint:** all Plan 3 files, including both admin pages.
- **Unit/route:** 55 tests across `catalog-admin`, `catalog-admin-routes`, `catalog-access-resolver`, `catalog-ending-lock`.
- **Live DB:** applies the migration to the loopback fixture DB, reseeds `catalog:bayang-tak-bertuan`, proves publish is refused with `NOT_READY` at 0/62, review upsert is idempotent, text edit resets approval, all 62 approvals unlock publish, Explore lists the novel after publish, archive removes it from Explore, guest gets `STORY_PENDING` cost 0, and a ledger buyer still reads Bab 10 (`LEDGER_UNLOCKED`).
- **Browser (Reticle):** login → `/admin/katalog` list → detail → read text → approve Bab 1 → publish disabled → aproval to 62/62 → publish → Explore shows novel → two-step archive → Explore hides novel. All assertions returned `verified: "yes"` except one malformed predicate that was immediately re-asserted correctly.

## Operational notes

- The migration is **not** applied to production yet. Production DB writes require explicit PM approval.
- Plan 2 (novel generator) is still pending; until it lands, catalog rows for real novels must be produced by the generation pipeline and appear in this dashboard as `draft`/`generating`/`review`.
- Bulk approval is intentionally a per-unit endpoint loop; no bulk RPC exists, so a 62-unit approval is 62 requests (or a server-side script using `saveChapterReview`).
- `listCatalogStoriesForAdmin` derives progress per story, which is N+1 on the admin list. Acceptable for an owner-only screen with few novels; revisit if the catalog grows past a few dozen titles.
