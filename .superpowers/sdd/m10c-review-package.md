=== FILES ===
 lib/api/personalized-choice.server.ts |  20 +-
 lib/narrative-qa/harness/capture.ts   | 850 ++++++++++++++++++++++++++++++++++
 lib/narrative-qa/harness/choice.ts    | 107 +++++
 lib/narrative-qa/harness/fixture.ts   | 283 +++++++++++
 lib/narrative-qa/harness/run-spec.ts  |  93 ++++
 lib/narrative-qa/harness/run.ts       | 304 ++++++++++++
 lib/narrative-qa/harness/seed.ts      | 297 ++++++++++++
 package.json                          |   1 +
 scripts/m10-c-harness-cli.ts          |  11 +
 scripts/m10-c-harness.ts              | 256 ++++++++++
 10 files changed, 2219 insertions(+), 3 deletions(-)

=== DIFF ===
diff --git a/lib/api/personalized-choice.server.ts b/lib/api/personalized-choice.server.ts
index fa54388..67b159c 100644
--- a/lib/api/personalized-choice.server.ts
+++ b/lib/api/personalized-choice.server.ts
@@ -151,25 +151,32 @@ async function authorizeParentWithCookieRls(userId: string, storyId: string): Pr
 
   const { data, error } = await cookieClient
     .from('stories')
     .select(STORY_AUTHORIZATION_COLUMNS)
     .eq('id', storyId)
     .maybeSingle()
   if (error) throw new PersonalizedChoiceError('INTERNAL_ERROR')
   if (!data) throw new PersonalizedChoiceError('STORY_NOT_FOUND')
 }
 
-export async function applyPersonalizedChoice(
+/**
+ * Accepted-choice core: seluruh langkah setelah otorisasi pembaca.
+ *
+ * Dipisah TANPA mengubah urutan maupun efek apa pun, supaya jalur non-HTTP yang
+ * sudah terotorisasi di layer lain (mis. harness QA terisolasi M10-C) memakai
+ * seam pilihan yang SAMA dengan produksi — bukan menulis `reader_states`
+ * langsung. Jalur HTTP tetap wajib lewat `applyPersonalizedChoice`, yang
+ * memeriksa RLS cookie lebih dulu lalu mendelegasikan ke fungsi ini.
+ */
+export async function applyPersonalizedChoiceAuthorized(
   input: ApplyPersonalizedChoiceInput,
 ): Promise<ApplyPersonalizedChoiceResult> {
-  await authorizeParentWithCookieRls(input.userId, input.storyId)
-
   const admin = createAdminClient()
   const { data: metadataData, error: metadataError } = await admin
     .from('stories')
     .select(STORY_INTERNAL_COLUMNS)
     .eq('id', input.storyId)
     .maybeSingle()
   if (metadataError) throw new PersonalizedChoiceError('INTERNAL_ERROR')
   if (!metadataData) throw new PersonalizedChoiceError('STORY_NOT_FOUND')
 
   const metadata = parseStored(StoryMetadataSchema, metadataData)
@@ -247,10 +254,17 @@ export async function applyPersonalizedChoice(
     p_jejak_entry: jejakEntry,
   })
   if (error) {
     if (error.message.includes('COMMERCIAL_INTENT_CONFLICT')) {
       throw new PersonalizedChoiceError('CHOICE_CONFLICT')
     }
     throw mapRpcError(error.message)
   }
   return parseStored(RpcResultSchema, data)
 }
+
+export async function applyPersonalizedChoice(
+  input: ApplyPersonalizedChoiceInput,
+): Promise<ApplyPersonalizedChoiceResult> {
+  await authorizeParentWithCookieRls(input.userId, input.storyId)
+  return applyPersonalizedChoiceAuthorized(input)
+}
diff --git a/lib/narrative-qa/harness/capture.ts b/lib/narrative-qa/harness/capture.ts
new file mode 100644
index 0000000..204e6cc
--- /dev/null
+++ b/lib/narrative-qa/harness/capture.ts
@@ -0,0 +1,850 @@
+/**
+ * M10-C — per-chapter canonical capture.
+ *
+ * Reads the committed canonical state produced by the production publication
+ * path and projects it into the frozen M10-B evaluator input contracts.
+ *
+ * Two hard rules:
+ *   1. Capture is READ-ONLY. It never writes, never repairs, never fills gaps.
+ *   2. A capture field that has no real runtime source is NOT fabricated. It is
+ *      reported through `CaptureBlockerV1` so the missing production wire stays
+ *      visible instead of being papered over with a plausible-looking value.
+ */
+
+import { createAdminClient } from '../../supabase/admin'
+import { debtBackedThreadId } from '@lakoku/narrative-core'
+import type { ThreadStatus } from '../../narrative/types'
+import type {
+  EvaluatorEnvelopeV1,
+  LongHorizonFindingV1,
+} from '../contracts/evaluator-contract'
+import type { BlueprintAuthorityInputV1 } from '../evaluators/blueprint-evaluator'
+import type { CanonDriftInputV1 } from '../evaluators/canon-drift-evaluator'
+import type { ChoiceHistoryInputV1 } from '../evaluators/choice-evaluator'
+import type { EndingRunwayInputV1 } from '../evaluators/ending-evaluator'
+import type { PlotDebtLifecycleInputV1 } from '../evaluators/plot-debt-evaluator'
+import type { RepetitionInputV1 } from '../evaluators/repetition-evaluator'
+import type { ThreadLifecycleInputV1 } from '../evaluators/thread-evaluator'
+import { evaluateBlueprintAuthority } from '../evaluators/blueprint-evaluator'
+import { evaluateCanonDrift } from '../evaluators/canon-drift-evaluator'
+import { evaluateChoiceHistory } from '../evaluators/choice-evaluator'
+import { evaluatePlotDebtLifecycle } from '../evaluators/plot-debt-evaluator'
+import { evaluateRepetition } from '../evaluators/repetition-evaluator'
+import { evaluateThreadLifecycle } from '../evaluators/thread-evaluator'
+import { computeSha256, sortFindings, stableStringify } from '../scoring/canonical-serializer'
+import { ACT_PLAN, CH1_FACT_PAYOFF_CHAPTER, PLOT_DEBTS, harnessFactId } from './fixture'
+
+type Admin = ReturnType<typeof createAdminClient>
+
+/**
+ * A capture input the evaluator contract requires but the production runtime
+ * does not currently expose. Recorded as evidence of a missing wire; never
+ * substituted with a synthesized value.
+ */
+export interface CaptureBlockerV1 {
+  code: string
+  evaluatorId: string
+  missingField: string
+  /** Exact production source that would have to expose it. */
+  productionSource: string
+  reason: string
+}
+
+export const CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER: CaptureBlockerV1 = {
+  code: 'CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE',
+  evaluatorId: 'context-memory',
+  missingField: 'promptLayer1a, promptLayer3',
+  productionSource: 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt -> WriterPromptParts',
+  reason:
+    'buildWriterPrompt returns only a concatenated `user` string with no per-layer field, and its sole caller is lib/ai-gateway/gateway-provider.ts (real-model path). The deterministic provider never invokes it, so writer layer 1a/3 text does not exist on the M10-C path. Populating these fields would require fabricating prompt text.',
+}
+
+export const ENDING_RESOLUTION_BEAT_BLOCKER: CaptureBlockerV1 = {
+  code: 'EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED',
+  evaluatorId: 'ending-runway',
+  missingField: 'publications[].emotionalResolutionBeatIds',
+  productionSource: 'lib/runtime/chapter-generation-checkpoint.ts :: CheckpointAuditSignalsV2 (audit_signals_json)',
+  reason:
+    'No production table or checkpoint field records an emotional-resolution beat. audit_signals_json carries only opensNewThread/opensMajorMystery/opensNewConflict/closesPlotDebts, and chapter_blueprints.mandatory_beats is pre-generation intent, not committed canon. The field is therefore left empty rather than synthesized, which makes the evaluator report CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING as a downstream consequence of this missing wire.',
+}
+
+export const ENDING_LOCK_TX_BLOCKER: CaptureBlockerV1 = {
+  code: 'ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE',
+  evaluatorId: 'ending-runway',
+  missingField: 'endingLock.committedInPublicationTxId',
+  productionSource: 'supabase/migrations/20260713060000_persist_ending_lock.sql :: persist_ending_lock_v1 (writes story_generation_contracts.ending_lock_json)',
+  reason:
+    'persist_ending_lock_v1 stores only {key,name,lockedAtChapter}; neither it nor the V3/V5 publishers persist the publication transaction id, so atomic-commit provenance cannot be read back. The lock IS written inside the publication transaction, but the harness cannot prove it from persisted state, so the field stays null and ENDING_LOCK_NOT_DURABLE is reported as a consequence of this missing wire.',
+}
+
+export const CONTEXT_MEMORY_BUDGET_BLOCKER: CaptureBlockerV1 = {
+  code: 'CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME',
+  evaluatorId: 'context-memory',
+  missingField: 'sections, prunedFactIds, budgetReport',
+  productionSource: 'lib/narrative/loader.ts :: persistRetrievalLog (wired into PersonalizedGenerationDeps, never invoked)',
+  reason:
+    'persistRetrievalLog is defined and wired into defaultDeps but has zero call sites in lib/runtime/personalized-generation.ts, so retrieval_logs stays empty for every harness chapter. The included/excluded ids and budget report computed by compileContext are dropped before persistence.',
+}
+
+export interface ChapterCaptureV1 {
+  chapterNumber: number
+  canonRevision: number
+  stateDeltaHash: string
+  baseCanonRevision: number
+  checkpointSchemaVersion: number | null
+  checkpointStatus: string | null
+  publishedTitle: string
+  choiceIds: string[]
+  acceptedChoiceId: string | null
+  /** Canonical hash of the whole per-chapter capture, provenance-normalized. */
+  captureHash: string
+}
+
+export interface HarnessCaptureBundle {
+  chapters: ChapterCaptureV1[]
+  findings: LongHorizonFindingV1[]
+  blockers: CaptureBlockerV1[]
+  actRollups: Array<{ actNumber: number; coversFromChapter: number; coversToChapter: number }>
+}
+
+interface CommitRow {
+  chapter_number: number
+  base_canon_revision: number
+  committed_canon_revision: number
+  state_delta_hash: string
+  state_delta_json: Record<string, unknown>
+}
+
+async function loadCommits(admin: Admin, storyId: string): Promise<CommitRow[]> {
+  const { data, error } = await admin
+    .from('chapter_state_commits')
+    .select('chapter_number,base_canon_revision,committed_canon_revision,state_delta_hash,state_delta_json')
+    .eq('story_id', storyId)
+    .order('chapter_number', { ascending: true })
+  if (error) throw new Error(`capture: chapter_state_commits read failed: ${error.message}`)
+  return (data ?? []) as unknown as CommitRow[]
+}
+
+function deltaOf(commit: CommitRow | undefined): Record<string, unknown> {
+  return (commit?.state_delta_json ?? {}) as Record<string, unknown>
+}
+
+function asArray(value: unknown): unknown[] {
+  return Array.isArray(value) ? value : []
+}
+
+function nested(delta: Record<string, unknown>, key: string): Record<string, unknown> {
+  const value = delta[key]
+  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
+}
+
+const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g
+const RUNTIME_FACT_ID_RE = /:fact:runtime:[a-f0-9]+/g
+
+/**
+ * Provenance normalization for the capture hash.
+ *
+ * The sync and worker clones are two DIFFERENT stories, so every canonical id
+ * the runtime derives from the story id (`<storyId>:char:hero`,
+ * `debtBackedThreadId(storyId, ...)`, `<storyId>:secret:...`) and every wall
+ * clock column differs by construction. Those are provenance, not narrative
+ * content: a parity comparison that hashed them raw could never match and would
+ * prove nothing.
+ *
+ * The substitution is textual and total — applied to every string in the
+ * payload — so a story id that leaks through a field this module does not know
+ * about is still normalized instead of silently breaking parity.
+ */
+function normalizeCaptureForHash(value: unknown, storyId: string): unknown {
+  if (typeof value === 'string') {
+    return value
+      .replaceAll(storyId, '<storyId>')
+      .replace(RUNTIME_FACT_ID_RE, ':fact:runtime:<hash>')
+      .replace(ISO_TIMESTAMP_RE, '<timestamp>')
+  }
+  if (Array.isArray(value)) return value.map((item) => normalizeCaptureForHash(item, storyId))
+  if (value && typeof value === 'object') {
+    const out: Record<string, unknown> = {}
+    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
+      out[key] = normalizeCaptureForHash(entry, storyId)
+    }
+    return out
+  }
+  return value
+}
+
+// ── canon-drift ────────────────────────────────────────────────────────────
+
+export async function captureCanonDrift(
+  admin: Admin,
+  storyId: string,
+  throughChapter: number,
+): Promise<EvaluatorEnvelopeV1<CanonDriftInputV1>> {
+  const commits = (await loadCommits(admin, storyId)).filter((c) => c.chapter_number <= throughChapter)
+
+  // `public.stories` has no `updated_at` column. Selecting one made PostgREST
+  // fail the whole row read, and the unchecked `data` then read as revision 0 —
+  // which fired CANON_SNAPSHOT_STALE on every single chapter. The read is now
+  // error-checked so a schema drift stops the run instead of poisoning findings.
+  const { data: storyRow, error: storyError } = await admin
+    .from('stories')
+    .select('canon_state_revision,created_at')
+    .eq('id', storyId)
+    .single()
+  if (storyError) throw new Error(`capture: stories read failed: ${storyError.message}`)
+
+  const { data: chapterRows, error: chapterError } = await admin
+    .from('chapters')
+    .select('number,created_at')
+    .eq('story_id', storyId)
+    .lte('number', throughChapter)
+    .order('number', { ascending: true })
+  if (chapterError) throw new Error(`capture: chapters read failed: ${chapterError.message}`)
+  const publishedAtByChapter = new Map(
+    (chapterRows ?? []).map((row) => [Number(row.number), String(row.created_at)]),
+  )
+
+  const { data: characterRows, error: characterError } = await admin
+    .from('characters')
+    .select('id')
+    .eq('story_id', storyId)
+  if (characterError) throw new Error(`capture: characters read failed: ${characterError.message}`)
+  const characterIds = (characterRows ?? []).map((r) => String(r.id))
+
+  // character_states is an append-only history keyed (character_id,
+  // as_of_chapter). The canonical CURRENT status is the row with the highest
+  // as_of_chapter; reading every row made the seeded as_of_chapter 0 row look
+  // like a live disagreement with the committed delta sequence.
+  const { data: rawStateRows, error: stateError } = characterIds.length
+    ? await admin
+        .from('character_states')
+        .select('character_id,status,as_of_chapter')
+        .in('character_id', characterIds)
+        .lte('as_of_chapter', throughChapter)
+    : { data: [] as Array<{ character_id: string; status: string; as_of_chapter: number }>, error: null }
+  if (stateError) throw new Error(`capture: character_states read failed: ${stateError.message}`)
+
+  const latestStateByCharacter = new Map<string, { status: string; as_of_chapter: number }>()
+  for (const row of rawStateRows ?? []) {
+    const id = String(row.character_id)
+    const chapter = Number(row.as_of_chapter)
+    const current = latestStateByCharacter.get(id)
+    if (!current || chapter > current.as_of_chapter) {
+      latestStateByCharacter.set(id, { status: String(row.status), as_of_chapter: chapter })
+    }
+  }
+
+  // No `story_thread_transitions`-style table exists for character status, so
+  // transitions are derived from the committed deltas themselves — the same
+  // authority the publisher wrote, not a re-simulation.
+  const characterStatusTransitions: CanonDriftInputV1['characterStatusTransitions'] = []
+  const lastStatus = new Map<string, string>()
+  for (const id of characterIds) lastStatus.set(id, 'ALIVE')
+  for (const commit of commits) {
+    for (const raw of asArray(nested(deltaOf(commit), 'characters').statusChanges)) {
+      const change = raw as { characterId?: string; to?: string }
+      if (!change.characterId || !change.to) continue
+      characterStatusTransitions.push({
+        characterId: change.characterId,
+        chapterNumber: commit.chapter_number,
+        fromStatus: (lastStatus.get(change.characterId) ?? 'ALIVE') as CanonDriftInputV1['characterStatusTransitions'][number]['fromStatus'],
+        toStatus: change.to as CanonDriftInputV1['characterStatusTransitions'][number]['toStatus'],
+      })
+      lastStatus.set(change.characterId, change.to)
+    }
+  }
+
+  const { data: secretRows } = await admin
+    .from('secrets_reveals')
+    .select('id,reveal_gate_chapter,revealed')
+    .eq('story_id', storyId)
+
+  const revealChapterById = new Map<string, number>()
+  for (const commit of commits) {
+    for (const raw of asArray(nested(deltaOf(commit), 'secrets').revealIds)) {
+      const id = String(raw)
+      if (!revealChapterById.has(id)) revealChapterById.set(id, commit.chapter_number)
+    }
+  }
+
+  const secretReveals = (secretRows ?? [])
+    .filter((row) => row.revealed === true && revealChapterById.has(String(row.id)))
+    .map((row) => ({
+      secretId: String(row.id),
+      revealedChapter: revealChapterById.get(String(row.id))!,
+      gateChapter: Number(row.reveal_gate_chapter),
+    }))
+    .sort((a, b) => a.secretId.localeCompare(b.secretId))
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'canon-drift',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'CHAPTER_LOCAL',
+    evaluatedChapter: throughChapter,
+    input: {
+      canonicalSnapshot: {
+        storyId,
+        revision: Number(storyRow?.canon_state_revision ?? 0),
+        lastCommittedChapter: commits.length ? commits[commits.length - 1].chapter_number : 0,
+        // stories carries no mutation timestamp; the newest publication is the
+        // closest honest "snapshot as of" marker the runtime persists.
+        updatedAt: String(
+          publishedAtByChapter.get(throughChapter) ?? storyRow?.created_at ?? new Date(0).toISOString(),
+        ),
+      },
+      commitLedgers: commits.map((c) => ({
+        chapterNumber: c.chapter_number,
+        revision: Number(c.committed_canon_revision),
+        committedDeltaHash: String(c.state_delta_hash),
+        // Keyed by chapter — the previous positional index silently misaligned
+        // whenever the chapter and commit lists had different lengths.
+        publishedAt: publishedAtByChapter.get(c.chapter_number) ?? new Date(0).toISOString(),
+      })),
+      publishedChapters: (chapterRows ?? []).map((row) => ({
+        chapterNumber: Number(row.number),
+        livingCanonVersion: 1 as const,
+      })),
+      characterStates: [...latestStateByCharacter.entries()]
+        .map(([characterId, state]) => ({
+          characterId,
+          status: state.status as CanonDriftInputV1['characterStates'][number]['status'],
+          statusChangedChapter: Math.max(1, state.as_of_chapter),
+        }))
+        .sort((a, b) => a.characterId.localeCompare(b.characterId)),
+      characterStatusTransitions,
+      secretReveals,
+    },
+  }
+}
+
+// ── blueprint authority ────────────────────────────────────────────────────
+
+export async function captureBlueprintAuthority(
+  admin: Admin,
+  storyId: string,
+  chapterNumber: number,
+): Promise<EvaluatorEnvelopeV1<BlueprintAuthorityInputV1>> {
+  const { data, error } = await admin
+    .from('chapter_blueprints')
+    .select('id,chapter_number,version')
+    .eq('story_id', storyId)
+    .eq('chapter_number', chapterNumber)
+    .order('version', { ascending: true })
+  if (error) throw new Error(`capture: chapter_blueprints read failed: ${error.message}`)
+
+  const rows = (data ?? []).map((row) => ({
+    blueprintId: String(row.id),
+    chapterNumber: Number(row.chapter_number),
+    version: Number(row.version),
+    reconciledFromBlueprintId: null,
+  }))
+  const authoritative = rows.length ? rows[rows.length - 1].blueprintId : null
+
+  const act = ACT_PLAN.find((a) => chapterNumber >= a.fromChapter && chapterNumber <= a.toChapter)
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'blueprint-authority',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'CHAPTER_LOCAL',
+    evaluatedChapter: chapterNumber,
+    input: {
+      blueprints: rows,
+      consumerResolutions: [
+        // The runtime resolves the blueprint through the canon snapshot; the
+        // published commit proves which policy version actually gated the delta.
+        { consumer: 'chapter-state-resolver', resolvedBlueprintId: authoritative },
+      ],
+      reachability: act
+        ? {
+            actNumber: act.actNumber,
+            actToChapter: Math.min(act.toChapter, chapterNumber),
+            checkpointChapter: chapterNumber,
+          }
+        : null,
+    },
+  }
+}
+
+// ── plot debt lifecycle ────────────────────────────────────────────────────
+
+export async function capturePlotDebtLifecycle(
+  admin: Admin,
+  storyId: string,
+  userId: string,
+  throughChapter: number,
+): Promise<EvaluatorEnvelopeV1<PlotDebtLifecycleInputV1>> {
+  const { data: progressRows } = await admin
+    .from('reader_plot_debt_progress')
+    .select('debt_id,milestone_chapter,progressed_at_chapter')
+    .eq('story_id', storyId)
+    .eq('user_id', userId)
+  const { data: closureRows } = await admin
+    .from('reader_plot_debt_closures')
+    .select('debt_id,closed_at_chapter')
+    .eq('story_id', storyId)
+    .eq('user_id', userId)
+
+  const ledgerEvents: PlotDebtLifecycleInputV1['ledgerEvents'] = []
+  for (const debt of PLOT_DEBTS) {
+    if (debt.introducedAt <= throughChapter) {
+      ledgerEvents.push({
+        debtId: debt.id,
+        kind: 'INTRODUCED',
+        chapterNumber: debt.introducedAt,
+        milestoneId: null,
+      })
+    }
+  }
+  for (const row of progressRows ?? []) {
+    const chapter = Number(row.progressed_at_chapter)
+    if (chapter > throughChapter) continue
+    ledgerEvents.push({
+      debtId: String(row.debt_id),
+      kind: 'PROGRESS',
+      chapterNumber: chapter,
+      milestoneId: `milestone:${row.milestone_chapter}`,
+    })
+  }
+  const closedIds = new Set<string>()
+  for (const row of closureRows ?? []) {
+    const chapter = Number(row.closed_at_chapter)
+    if (chapter > throughChapter) continue
+    closedIds.add(String(row.debt_id))
+    ledgerEvents.push({
+      debtId: String(row.debt_id),
+      kind: 'CLOSED',
+      chapterNumber: chapter,
+      milestoneId: null,
+    })
+  }
+
+  ledgerEvents.sort((a, b) =>
+    a.chapterNumber - b.chapterNumber || a.debtId.localeCompare(b.debtId) || a.kind.localeCompare(b.kind),
+  )
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'plot-debt-lifecycle',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'CHAPTER_LOCAL',
+    evaluatedChapter: throughChapter,
+    input: {
+      contracts: PLOT_DEBTS.map((debt) => ({
+        debtId: debt.id,
+        isMainMystery: debt.id === 'main_mystery',
+        allowedIntroductionFromChapter: 1,
+        allowedIntroductionToChapter: debt.introducedAt,
+        mustCloseByChapter: debt.mustCloseBy,
+        requiredMilestoneIds: debt.mustProgressBy.map((chapter) => `milestone:${chapter}`),
+      })),
+      ledgerEvents,
+      projectedState: PLOT_DEBTS.map((debt) => ({
+        debtId: debt.id,
+        isOpen: !closedIds.has(debt.id),
+        dueInBrief:
+          !closedIds.has(debt.id) &&
+          (debt.mustProgressBy.includes(throughChapter) || debt.mustCloseBy === throughChapter),
+      })),
+    },
+  }
+}
+
+// ── thread lifecycle ───────────────────────────────────────────────────────
+
+export async function captureThreadLifecycle(
+  admin: Admin,
+  storyId: string,
+  chapterNumber: number,
+): Promise<EvaluatorEnvelopeV1<ThreadLifecycleInputV1>> {
+  const { data: threadRows } = await admin
+    .from('story_threads')
+    .select('id,status,opened_chapter,last_touched_chapter,is_main_mystery')
+    .eq('story_id', storyId)
+    .order('id', { ascending: true })
+
+  const commits = (await loadCommits(admin, storyId)).filter((c) => c.chapter_number <= chapterNumber)
+
+  // No `story_thread_transitions` table exists. Transitions are read from the
+  // committed deltas — the exact records the publisher applied.
+  const transitions: ThreadLifecycleInputV1['transitions'] = []
+  const lastThreadStatus = new Map<string, ThreadStatus>()
+  for (const row of threadRows ?? []) lastThreadStatus.set(String(row.id), 'OPEN')
+  for (const commit of commits) {
+    for (const raw of asArray(nested(deltaOf(commit), 'threads').transitions)) {
+      const transition = raw as { threadId?: string; to?: string }
+      if (!transition.threadId || !transition.to) continue
+      transitions.push({
+        threadId: transition.threadId,
+        chapterNumber: commit.chapter_number,
+        fromStatus: lastThreadStatus.get(transition.threadId) ?? 'OPEN',
+        toStatus: transition.to as ThreadStatus,
+        approvedByCheckpointId: null,
+      })
+      lastThreadStatus.set(transition.threadId, transition.to as ThreadStatus)
+    }
+  }
+
+  const currentDelta = deltaOf(commits.find((c) => c.chapter_number === chapterNumber))
+  const previousDelta = deltaOf(commits.find((c) => c.chapter_number === chapterNumber - 1))
+  const advanced = new Set<string>([
+    ...asArray(nested(currentDelta, 'threads').touches).map(String),
+    ...asArray(nested(currentDelta, 'threads').transitions).map((t) =>
+      String((t as { threadId?: string }).threadId ?? ''),
+    ),
+  ])
+  advanced.delete('')
+
+  const previousIds = chapterNumber <= 1
+    ? (threadRows ?? []).map((row) => String(row.id))
+    : (threadRows ?? [])
+        .filter((row) => Number(row.opened_chapter) <= chapterNumber - 1)
+        .map((row) => String(row.id))
+  void previousDelta
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'thread-lifecycle',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'CHAPTER_LOCAL',
+    evaluatedChapter: chapterNumber,
+    input: {
+      threads: (threadRows ?? []).map((row) => ({
+        threadId: String(row.id),
+        isMainMystery: row.is_main_mystery === true,
+        status: String(row.status) as ThreadStatus,
+        introducedChapter: Math.max(1, Number(row.opened_chapter)),
+        lastTouchedChapter: Math.min(chapterNumber, Math.max(1, Number(row.last_touched_chapter))),
+      })),
+      transitions,
+      advancedThreadIdsThisChapter: [...advanced].sort(),
+      previousChapterThreadIds: previousIds.sort(),
+    },
+  }
+}
+
+// ── choice history ─────────────────────────────────────────────────────────
+
+export async function captureChoiceHistory(
+  admin: Admin,
+  storyId: string,
+  userId: string,
+  chapterNumber: number,
+): Promise<EvaluatorEnvelopeV1<ChoiceHistoryInputV1>> {
+  const { data: readerRow } = await admin
+    .from('reader_states')
+    .select('choice_history,route_state')
+    .eq('user_id', userId)
+    .eq('story_id', storyId)
+    .single()
+
+  const history = asArray(readerRow?.choice_history)
+    .map((raw) => raw as Record<string, unknown>)
+    .filter((entry) => Number(entry.chapterNumber) <= chapterNumber)
+
+  const acceptedChoices = history.map((entry) => ({
+    chapterNumber: Number(entry.chapterNumber),
+    choiceId: String(entry.choiceId),
+    choiceLabel: String(entry.label ?? ''),
+    branchKey: String(entry.choiceId),
+    consequence: asArray(entry.consequence).map(String).join(' ') || String(entry.label ?? ''),
+  }))
+
+  // The reader-facing bounded summary is the choice history the runtime carries
+  // in reader_states, which is exactly what the brief builder projects from.
+  const includedChapterNumbers = acceptedChoices.map((c) => c.chapterNumber)
+  const renderedText = acceptedChoices
+    .map((c) => `Bab ${c.chapterNumber}: ${c.choiceLabel} — ${c.consequence}`)
+    .join('\n')
+
+  const currentBranchKey = acceptedChoices.length
+    ? acceptedChoices[acceptedChoices.length - 1].branchKey
+    : ''
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'choice-history',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'CHAPTER_LOCAL',
+    evaluatedChapter: chapterNumber,
+    input: {
+      acceptedChoices,
+      boundedSummary: { includedChapterNumbers, renderedText },
+      currentBranchKey,
+    },
+  }
+}
+
+// ── repetition ─────────────────────────────────────────────────────────────
+
+export async function captureRepetition(
+  admin: Admin,
+  storyId: string,
+  throughChapter: number,
+): Promise<EvaluatorEnvelopeV1<RepetitionInputV1>> {
+  // The published prose column is `paragraphs` (jsonb array of strings); there
+  // is no `content` column on public.chapters.
+  const { data, error } = await admin
+    .from('chapters')
+    .select('number,paragraphs,choices')
+    .eq('story_id', storyId)
+    .lte('number', throughChapter)
+    .order('number', { ascending: true })
+  if (error) throw new Error(`capture: chapters read failed: ${error.message}`)
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'repetition',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'HORIZON',
+    horizon: { fromChapter: 1, toChapter: throughChapter },
+    input: {
+      chapters: (data ?? []).map((row) => ({
+        chapterNumber: Number(row.number),
+        text: asArray(row.paragraphs).map(String).join('\n\n'),
+        choiceLabels: asArray(row.choices).map((c) =>
+          String((c as { label?: string })?.label ?? ''),
+        ),
+      })),
+    },
+  }
+}
+
+// ── ending runway (FINAL_HORIZON, chapter 50 only) ─────────────────────────
+
+export async function captureEndingRunway(
+  admin: Admin,
+  storyId: string,
+  userId: string,
+): Promise<EvaluatorEnvelopeV1<EndingRunwayInputV1>> {
+  const { data: contractRow } = await admin
+    .from('story_generation_contracts')
+    .select('ending_lock_json')
+    .eq('story_id', storyId)
+    .single()
+  const lockJson = (contractRow?.ending_lock_json ?? {}) as Record<string, unknown>
+
+  // `public.chapters` has no is_ending/ending_key column. The choice-level
+  // terminality lives in choice_outcomes, and the ending key the runtime
+  // actually committed for the finished story lives in reader_states
+  // (written by markReaderStateSelesai at the Bab 50 publication).
+  const { data: chapterRows } = await admin
+    .from('chapters')
+    .select('number,choice_prompt,choices')
+    .eq('story_id', storyId)
+    .order('number', { ascending: true })
+
+  const { data: readerRow } = await admin
+    .from('reader_states')
+    .select('locked_ending_key')
+    .eq('user_id', userId)
+    .eq('story_id', storyId)
+    .maybeSingle()
+  const finalEndingKey = readerRow?.locked_ending_key ? String(readerRow.locked_ending_key) : null
+
+  const { data: closureRows } = await admin
+    .from('reader_plot_debt_closures')
+    .select('debt_id')
+    .eq('story_id', storyId)
+    .eq('user_id', userId)
+  const closed = new Set((closureRows ?? []).map((row) => String(row.debt_id)))
+
+  const { data: threadRows } = await admin
+    .from('story_threads')
+    .select('id,status,opened_chapter')
+    .eq('story_id', storyId)
+    .order('id', { ascending: true })
+
+  const threadsOpenedAt = new Map<number, string[]>()
+  for (const row of threadRows ?? []) {
+    const opened = Number(row.opened_chapter)
+    threadsOpenedAt.set(opened, [...(threadsOpenedAt.get(opened) ?? []), String(row.id)].sort())
+  }
+
+  const publications: EndingRunwayInputV1['publications'] = (chapterRows ?? []).map((row) => {
+    const chapterNumber = Number(row.number)
+    const choices = asArray(row.choices)
+    return {
+      chapterNumber,
+      choicePrompt: row.choice_prompt === null || row.choice_prompt === undefined
+        ? null
+        : String(row.choice_prompt),
+      choiceCount: choices.length,
+      // Only the terminal chapter carries an ending key, and its only honest
+      // runtime source is the reader lock the Bab 50 path committed.
+      endingKey: chapterNumber === 50 ? finalEndingKey : null,
+      // A NEW major thread is one whose canonical opened_chapter IS this
+      // chapter. Touching or transitioning an existing thread is continuation,
+      // not a new conflict; reading the delta's transition list called every
+      // late-story payoff of the main mystery a runway breach.
+      newMajorThreadIds: threadsOpenedAt.get(chapterNumber) ?? [],
+      // No runtime source exists (ENDING_RESOLUTION_BEAT_BLOCKER). Left empty
+      // rather than fabricated.
+      emotionalResolutionBeatIds: [],
+    }
+  })
+
+  return {
+    schemaVersion: 1,
+    evaluatorId: 'ending-runway',
+    evaluatorVersion: '1.1.0',
+    storyId,
+    mode: 'FINAL_HORIZON',
+    horizon: { fromChapter: 1, toChapter: 50 },
+    input: {
+      endingLock: lockJson.key
+        ? {
+            chapterNumber: Number(lockJson.lockedAtChapter ?? 45),
+            lockedEndingKey: String(lockJson.key),
+            committedInPublicationTxId: null,
+          }
+        : null,
+      publications,
+      finalState: {
+        openDebtIds: PLOT_DEBTS.map((d) => d.id).filter((id) => !closed.has(id)).sort(),
+        unresolvedThreads: (threadRows ?? [])
+          .map((row) => ({ threadId: String(row.id), status: String(row.status) as ThreadStatus }))
+          // RESOLVED and ABANDONED_APPROVED are terminal; anything else is
+          // still open at the final horizon.
+          .filter((t) => t.status !== 'RESOLVED' && t.status !== 'ABANDONED_APPROVED')
+          .sort((a, b) => a.threadId.localeCompare(b.threadId)),
+      },
+      closureRunwayFromChapter: 35,
+    },
+  }
+}
+
+// ── per-chapter orchestration ──────────────────────────────────────────────
+
+export interface CaptureChapterInput {
+  admin: Admin
+  storyId: string
+  userId: string
+  chapterNumber: number
+  acceptedChoiceId: string | null
+}
+
+export async function captureChapter(
+  input: CaptureChapterInput,
+): Promise<{ capture: ChapterCaptureV1; findings: LongHorizonFindingV1[] }> {
+  const { admin, storyId, userId, chapterNumber } = input
+
+  const [canonDrift, blueprint, plotDebt, thread, choice, repetition] = await Promise.all([
+    captureCanonDrift(admin, storyId, chapterNumber),
+    captureBlueprintAuthority(admin, storyId, chapterNumber),
+    capturePlotDebtLifecycle(admin, storyId, userId, chapterNumber),
+    captureThreadLifecycle(admin, storyId, chapterNumber),
+    captureChoiceHistory(admin, storyId, userId, chapterNumber),
+    captureRepetition(admin, storyId, chapterNumber),
+  ])
+
+  const findings = sortFindings([
+    ...evaluateCanonDrift(canonDrift),
+    ...evaluateBlueprintAuthority(blueprint),
+    ...evaluatePlotDebtLifecycle(plotDebt),
+    ...evaluateThreadLifecycle(thread),
+    ...evaluateChoiceHistory(choice),
+    ...evaluateRepetition(repetition),
+  ])
+
+  const commits = await loadCommits(admin, storyId)
+  const commit = commits.find((c) => c.chapter_number === chapterNumber)
+  if (!commit) throw new Error(`capture: no committed state for Bab ${chapterNumber}`)
+
+  const { data: chapterRow } = await admin
+    .from('chapters')
+    .select('title,choices')
+    .eq('story_id', storyId)
+    .eq('number', chapterNumber)
+    .single()
+
+  const { data: checkpointRow } = await admin
+    .from('chapter_generation_checkpoints')
+    .select('checkpoint_schema_version,status')
+    .eq('story_id', storyId)
+    .eq('chapter_number', chapterNumber)
+    .maybeSingle()
+
+  const choiceIds = asArray(chapterRow?.choices)
+    .map((c) => String((c as { id?: string })?.id ?? ''))
+    .filter((id) => id.length > 0)
+    .sort()
+
+  const capture: ChapterCaptureV1 = {
+    chapterNumber,
+    canonRevision: Number(commit.committed_canon_revision),
+    stateDeltaHash: String(commit.state_delta_hash),
+    baseCanonRevision: Number(commit.base_canon_revision),
+    checkpointSchemaVersion: checkpointRow ? Number(checkpointRow.checkpoint_schema_version) : null,
+    checkpointStatus: checkpointRow ? String(checkpointRow.status) : null,
+    publishedTitle: String(chapterRow?.title ?? ''),
+    choiceIds,
+    acceptedChoiceId: input.acceptedChoiceId,
+    captureHash: '',
+  }
+
+  // Hash covers the canonical narrative surface only. Provenance columns
+  // (ids, timestamps, job ids) are excluded by construction, not blanket-dropped.
+  //
+  // `state_delta_hash` is DB-computed over a delta whose ids embed the story
+  // id, so it can never match across two clones. The delta CONTENT is the real
+  // evidence, so the normalized delta is hashed instead of its raw digest — no
+  // signal is dropped, only the story-scoped encoding of it.
+  const deltasThroughChapter = commits
+    .filter((c) => c.chapter_number <= chapterNumber)
+    .map((c) => ({ chapterNumber: c.chapter_number, delta: c.state_delta_json }))
+
+  capture.captureHash = computeSha256(
+    stableStringify(
+      normalizeCaptureForHash(
+        {
+          chapterNumber,
+          canonRevision: capture.canonRevision,
+          baseCanonRevision: capture.baseCanonRevision,
+          committedDeltas: deltasThroughChapter,
+          checkpointSchemaVersion: capture.checkpointSchemaVersion,
+          choiceIds,
+          acceptedChoiceId: capture.acceptedChoiceId,
+          canonDrift: {
+            ...canonDrift.input,
+            commitLedgers: canonDrift.input.commitLedgers.map((ledger) => ({
+              chapterNumber: ledger.chapterNumber,
+              revision: ledger.revision,
+            })),
+          },
+          plotDebt: plotDebt.input,
+          thread: thread.input,
+          choice: choice.input,
+          findingCodes: findings.map((f) => f.code),
+        },
+        storyId,
+      ),
+    ),
+  )
+
+  return { capture, findings }
+}
+
+export function harnessBlockers(): CaptureBlockerV1[] {
+  return [
+    CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER,
+    CONTEXT_MEMORY_BUDGET_BLOCKER,
+    ENDING_RESOLUTION_BEAT_BLOCKER,
+    ENDING_LOCK_TX_BLOCKER,
+  ]
+}
+
+export function mainMysteryThreadId(storyId: string): string {
+  return debtBackedThreadId(storyId, 'main_mystery')
+}
+
+export function loadBearingFactId(storyId: string): { factId: string; payoffChapter: number } {
+  return { factId: harnessFactId(storyId), payoffChapter: CH1_FACT_PAYOFF_CHAPTER }
+}
diff --git a/lib/narrative-qa/harness/choice.ts b/lib/narrative-qa/harness/choice.ts
new file mode 100644
index 0000000..2fc8e2f
--- /dev/null
+++ b/lib/narrative-qa/harness/choice.ts
@@ -0,0 +1,107 @@
+/**
+ * M10-C — accepted-choice driver.
+ *
+ * Plan C.2: "Every reader choice is submitted through the normal accepted-choice
+ * seam used by the harness mode." This module therefore calls
+ * `applyPersonalizedChoiceAuthorized` — the exact core the HTTP route runs after
+ * its cookie/RLS gate — and never writes `reader_states` directly.
+ *
+ * Choice ids are NOT invented here. They are read from the chapter row that the
+ * production publication path just wrote, so a run that fails to publish real
+ * choices fails loudly instead of proceeding on fabricated input.
+ */
+
+import { createAdminClient } from '../../supabase/admin'
+import {
+  applyPersonalizedChoiceAuthorized,
+  type ApplyPersonalizedChoiceResult,
+} from '../../api/personalized-choice.server'
+
+type Admin = ReturnType<typeof createAdminClient>
+
+export class HarnessChoiceError extends Error {
+  constructor(message: string) {
+    super(`HarnessChoiceError: ${message}`)
+    this.name = 'HarnessChoiceError'
+  }
+}
+
+export interface PublishedChoice {
+  id: string
+  label: string
+}
+
+export async function loadPublishedChoices(
+  admin: Admin,
+  storyId: string,
+  chapterNumber: number,
+): Promise<PublishedChoice[]> {
+  const { data, error } = await admin
+    .from('chapters')
+    .select('choices')
+    .eq('story_id', storyId)
+    .eq('number', chapterNumber)
+    .maybeSingle()
+  if (error) throw new HarnessChoiceError(`chapters read failed at Bab ${chapterNumber}: ${error.message}`)
+  if (!data) throw new HarnessChoiceError(`chapter ${chapterNumber} was not published`)
+  const raw = Array.isArray(data.choices) ? data.choices : []
+  const choices = raw
+    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
+    .map((c) => ({ id: String(c.id ?? ''), label: String(c.label ?? '') }))
+    .filter((c) => c.id.length > 0)
+  if (choices.length === 0) {
+    throw new HarnessChoiceError(`chapter ${chapterNumber} published without any choice`)
+  }
+  return choices
+}
+
+/**
+ * Deterministic choice policy for the default C run: always take the first
+ * published choice. Version-pinned in the run spec so a policy change is a
+ * visible spec change, not a silent drift.
+ */
+export function selectDeterministicChoice(choices: PublishedChoice[]): PublishedChoice {
+  const sorted = [...choices].sort((a, b) => a.id.localeCompare(b.id))
+  return sorted[0]
+}
+
+export interface SubmitChoiceInput {
+  admin: Admin
+  userId: string
+  storyId: string
+  chapterNumber: number
+  /** When omitted, the deterministic policy picks from the published choices. */
+  choiceId?: string
+}
+
+export interface SubmitChoiceResult {
+  choiceId: string
+  choiceLabel: string
+  result: ApplyPersonalizedChoiceResult
+}
+
+export async function submitHarnessChoice(input: SubmitChoiceInput): Promise<SubmitChoiceResult> {
+  const choices = await loadPublishedChoices(input.admin, input.storyId, input.chapterNumber)
+  const chosen = input.choiceId
+    ? choices.find((c) => c.id === input.choiceId)
+    : selectDeterministicChoice(choices)
+  if (!chosen) {
+    throw new HarnessChoiceError(
+      `choice "${input.choiceId}" is not among the published choices of Bab ${input.chapterNumber}`,
+    )
+  }
+
+  // Content-derived key: a replay of the same chapter+choice is idempotent by
+  // construction, which is what the production seam expects.
+  const idempotencyKey = `m10c:${input.storyId}:${input.chapterNumber}:${chosen.id}`
+
+  const result = await applyPersonalizedChoiceAuthorized({
+    userId: input.userId,
+    storyId: input.storyId,
+    chapterNumber: input.chapterNumber,
+    choiceId: chosen.id,
+    idempotencyKey,
+  })
+
+  return { choiceId: chosen.id, choiceLabel: chosen.label, result }
+}
diff --git a/lib/narrative-qa/harness/fixture.ts b/lib/narrative-qa/harness/fixture.ts
new file mode 100644
index 0000000..6d3df36
--- /dev/null
+++ b/lib/narrative-qa/harness/fixture.ts
@@ -0,0 +1,283 @@
+/**
+ * M10-C — deterministic story fixture for the isolated 50-chapter harness.
+ *
+ * Ported from the A1d.3b parity fixture and parametrized by `storyId` so the
+ * same canonical sequence can be run in sync mode, worker mode, and forked
+ * branch clones without cross-contamination.
+ *
+ * This module is pure data + pure functions. It performs no IO and holds no
+ * runtime authority: it only describes the story contract, the typed blueprint
+ * policy per chapter, and the deterministic structured state proposal per
+ * chapter. Canonical state still advances exclusively through the production
+ * publication path.
+ */
+
+import {
+  buildBaselinePolicyForChapter,
+  debtBackedThreadId,
+  runtimeFactId,
+  type AllowedChapterStatePolicyV1,
+  type StructuredStateProposalV1,
+} from '@lakoku/narrative-core'
+import type { StoryContract } from '../../story-engine/story-contract'
+
+export const HARNESS_FIXTURE_ID = 'm10c-brankas-50' as const
+export const HARNESS_TOTAL_CHAPTERS = 50 as const
+
+export const ACT_PLAN = [
+  { actNumber: 1, fromChapter: 1, toChapter: 5, goal: 'Etablish dunia + misteri utama.' },
+  { actNumber: 2, fromChapter: 6, toChapter: 12, goal: 'Eskalasi konflik + utang plot.' },
+  { actNumber: 3, fromChapter: 13, toChapter: 50, goal: 'Resolusi + kunci babak akhir.' },
+] as const
+
+export const ACT_BOUNDARY_CHAPTERS: readonly number[] = ACT_PLAN.map((act) => act.toChapter)
+
+export const PLOT_DEBTS = [
+  {
+    id: 'main_mystery',
+    question: 'Siapa yang membuka brankas rahasia di lantai basement?',
+    introducedAt: 1,
+    mustProgressBy: [12, 32, 45],
+    mustCloseBy: 48,
+    status: 'open' as const,
+  },
+  {
+    id: 'debt:a',
+    question: 'Apa isi surat yang baru ditemukan di brankas?',
+    introducedAt: 1,
+    mustProgressBy: [1, 3],
+    mustCloseBy: 8,
+    status: 'open' as const,
+  },
+]
+
+export const ENDINGS = [
+  { key: 'ending-open', name: 'Jalan Terbuka', condition: 'Surat terbaca', requiredClosure: ['debt:a'] },
+  { key: 'ending-gelap', name: 'Rahasia Terkubur', condition: 'Surat ditutup', requiredClosure: ['main_mystery'] },
+]
+
+export const REVEALS = [{ secretId: 'secret:brankas', revealGateChapter: 3 }]
+
+export const CHARACTERS = [
+  { id: 'char:hero', name: 'Aku', role: 'Protagonis', introducedChapter: 1 },
+  { id: 'char:rival', name: 'Raka', role: 'Rival', introducedChapter: 1 },
+]
+
+export const CH1_FACT_STATEMENT = 'Surat tak bernama ditemukan di balik brankas basemen.'
+
+/** Chapters whose deterministic proposal carries a LOAD_BEARING payoff. */
+export const CH1_FACT_PAYOFF_CHAPTER = 2
+
+export function harnessFactId(storyId: string, chapterNumber = 1): string {
+  return runtimeFactId({
+    storyId,
+    chapterNumber,
+    subjectCharacterId: `${storyId}:char:hero`,
+    statement: CH1_FACT_STATEMENT,
+  })
+}
+
+export function convictionThreadId(storyId: string): string {
+  return `${storyId}:thread:conviction`
+}
+
+export function buildHarnessContract(storyId: string): StoryContract {
+  const chapterTargets = Array.from({ length: HARNESS_TOTAL_CHAPTERS }, (_, i) => ({
+    chapterNumber: i + 1,
+    phase: i < 5 ? 'BABAK_1' : i < 12 ? 'BABAK_2' : 'BABAK_3',
+    goal: `Babat ${i + 1}: gerak maju misteri brankas.`,
+    mustInclude: ['beat-utama'],
+    mustNotReveal: [],
+    emotionalTurn: 'Ketegangan naik.',
+    expectedThreadMovement: ['thread:main'],
+  }))
+  return {
+    storyId,
+    totalChapters: HARNESS_TOTAL_CHAPTERS,
+    title: 'Brankas Rahasia 50 Bab',
+    genre: 'misteri',
+    tone: 'gelap',
+    styleProfile: 'lakoku_mobile_drama_v1',
+    mainCharacter: {
+      name: 'Aku',
+      role: 'penjaga brankas',
+      wound: 'kehilangan saudara',
+      desire: 'tahu isi brankas',
+    },
+    mainConflict: 'Brankas menyimpan rahasia yang mengubur masa lalu.',
+    finalQuestion: 'Siapa yang menutup surat terakhir?',
+    corePromise: 'Satu surat, satu kebenaran bab-per-bab.',
+    actPlan: ACT_PLAN.map((act) => ({ ...act })),
+    chapterTargets,
+    endingCandidates: ENDINGS,
+    plotDebts: PLOT_DEBTS,
+    revealRunway: REVEALS,
+    closureRunway: {
+      noNewMajorConflictAfter: 35,
+      noNewThreadAfter: 40,
+      endingLockChapter: 45,
+      mainMysteryResolveBy: 48,
+      emotionalResolutionChapter: 49,
+      finalEndingChapter: 50,
+    },
+  }
+}
+
+type DeepPartial<T> = {
+  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
+}
+
+function deepMerge<T>(base: T, override?: DeepPartial<T>): T {
+  if (override === undefined) return base
+  if (Array.isArray(base) || Array.isArray(override)) {
+    return (override as unknown) as T
+  }
+  if (base && typeof base === 'object' && override && typeof override === 'object') {
+    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
+    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
+      out[k] = v !== undefined ? deepMerge(out[k], v as never) : out[k]
+    }
+    return out as T
+  }
+  return (override as unknown) as T
+}
+
+export function harnessBlueprintOverrides(
+  storyId: string,
+  n: number,
+): DeepPartial<AllowedChapterStatePolicyV1> | undefined {
+  if (n === 1) {
+    return {
+      facts: { allowAdd: true, payableFactIds: [] },
+      knowledge: { allowGrants: true },
+      characters: { statusChangeCharacterIds: [`${storyId}:char:rival`] },
+      threads: {
+        touchIds: [
+          debtBackedThreadId(storyId, 'main_mystery'),
+          debtBackedThreadId(storyId, 'debt:a'),
+          convictionThreadId(storyId),
+        ],
+      },
+    }
+  }
+  if (n === 2) {
+    return {
+      facts: { allowAdd: false, payableFactIds: [harnessFactId(storyId)] },
+      threads: {
+        touchIds: [
+          debtBackedThreadId(storyId, 'main_mystery'),
+          debtBackedThreadId(storyId, 'debt:a'),
+          convictionThreadId(storyId),
+        ],
+        transitionIds: [
+          debtBackedThreadId(storyId, 'main_mystery'),
+          debtBackedThreadId(storyId, 'debt:a'),
+          convictionThreadId(storyId),
+        ],
+      },
+    }
+  }
+  if (n === 8) return { plotDebts: { closureIds: ['debt:a'] } }
+  if (n === 48) return { plotDebts: { closureIds: ['main_mystery'] } }
+  return undefined
+}
+
+export function harnessPolicyForChapter(
+  storyId: string,
+  chapterNumber: number,
+): AllowedChapterStatePolicyV1 {
+  const base = buildBaselinePolicyForChapter({
+    storyContract: buildHarnessContract(storyId),
+    chapterNumber,
+  })
+  return deepMerge(base, harnessBlueprintOverrides(storyId, chapterNumber))
+}
+
+export function harnessProposalFor(
+  storyId: string,
+  chapterNumber: number,
+): StructuredStateProposalV1 {
+  const isActBoundary = ACT_BOUNDARY_CHAPTERS.includes(chapterNumber)
+  const base: StructuredStateProposalV1 = {
+    schemaVersion: 1,
+    storyId,
+    chapterNumber,
+    facts: { add: [], markPaidOff: [] },
+    knowledge: { grants: [] },
+    secrets: { revealIds: [] },
+    timeline: { append: [] },
+    characters: { statusChanges: [] },
+    threads: { touches: [], transitions: [] },
+    plotDebts: { progress: [], closures: [] },
+    actRollup: isActBoundary ? { summary: null } : null,
+  }
+
+  if (chapterNumber === 1) {
+    return {
+      ...base,
+      facts: {
+        add: [{ statement: CH1_FACT_STATEMENT, subjectCharacterId: `${storyId}:char:hero`, salience: 0.8 }],
+        markPaidOff: [],
+      },
+      knowledge: {
+        grants: [{ characterId: `${storyId}:char:hero`, factId: harnessFactId(storyId) }],
+      },
+      timeline: {
+        append: [{
+          ordinal: 0,
+          description: 'Brankas terbuka dan surat ditemukan di lantai basement.',
+          characterId: `${storyId}:char:hero`,
+          occursAt: 10,
+          isFlashback: false,
+        }],
+      },
+      characters: { statusChanges: [{ characterId: `${storyId}:char:rival`, to: 'INACTIVE' }] },
+      threads: { touches: [convictionThreadId(storyId)], transitions: [] },
+      plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 1 }], closures: [] },
+    }
+  }
+  if (chapterNumber === 2) {
+    return {
+      ...base,
+      facts: { add: [], markPaidOff: [harnessFactId(storyId)] },
+      threads: {
+        touches: [convictionThreadId(storyId)],
+        transitions: [{ threadId: convictionThreadId(storyId), to: 'DEVELOPING' }],
+      },
+    }
+  }
+  if (chapterNumber === 3) {
+    return {
+      ...base,
+      secrets: { revealIds: [`${storyId}:secret:brankas`] },
+      plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 3 }], closures: [] },
+    }
+  }
+  if (chapterNumber === 8) {
+    return {
+      ...base,
+      plotDebts: { progress: [], closures: [{ debtId: 'debt:a', closureForm: 'RESOLVED' }] },
+    }
+  }
+  if (chapterNumber === 12 || chapterNumber === 32 || chapterNumber === 45) {
+    return {
+      ...base,
+      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: chapterNumber }], closures: [] },
+    }
+  }
+  // Bab 46-47: main_mystery already PAYOFF_DUE (final progress at Bab 45).
+  // G4 requires chapters >= 41 to advance >= 1 PAYOFF_DUE thread.
+  if (chapterNumber === 46 || chapterNumber === 47) {
+    return {
+      ...base,
+      threads: { touches: [debtBackedThreadId(storyId, 'main_mystery')], transitions: [] },
+    }
+  }
+  if (chapterNumber === 48) {
+    return {
+      ...base,
+      plotDebts: { progress: [], closures: [{ debtId: 'main_mystery', closureForm: 'RESOLVED' }] },
+    }
+  }
+  return base
+}
diff --git a/lib/narrative-qa/harness/run-spec.ts b/lib/narrative-qa/harness/run-spec.ts
new file mode 100644
index 0000000..b860be9
--- /dev/null
+++ b/lib/narrative-qa/harness/run-spec.ts
@@ -0,0 +1,93 @@
+/**
+ * M10-C — run contract for the reusable isolated 50-chapter harness.
+ *
+ * The spec is data-only: it never touches a DB and never decides policy. It
+ * exists so a harness run is fully described by a serializable value that can
+ * be hashed into the artifact manifest and replayed byte-identically.
+ *
+ * Non-negotiable (plan C.2): the harness drives PRODUCTION runtime functions.
+ * Nothing in this file may be interpreted as permission to bypass them.
+ */
+
+export const M10_HARNESS_SPEC_SCHEMA_VERSION = 1 as const
+
+export type HarnessPublicationMode = 'sync' | 'worker'
+export type HarnessResumeMode = 'same-attempt' | 'new-attempt'
+
+export interface HarnessResumeStep {
+  chapter: number
+  mode: HarnessResumeMode
+}
+
+export interface HarnessForkStep {
+  chapter: number
+  choiceIds: string[]
+}
+
+export interface M10HarnessRunSpecV1 {
+  schemaVersion: typeof M10_HARNESS_SPEC_SCHEMA_VERSION
+  storyFixtureId: string
+  routeProfile: 'high-trust' | 'low-trust' | 'mixed' | string
+  publicationMode: HarnessPublicationMode
+  /** Deterministic only. Real-model runs belong to M10-F, never to C. */
+  generationMode: 'deterministic'
+  chapters: 50
+  choicePolicyVersion: string
+  checkpointResumePlan: HarnessResumeStep[]
+  forkPlan?: HarnessForkStep[]
+}
+
+export const HARNESS_CHOICE_POLICY_VERSION = 'm10c-first-choice-v1'
+
+/**
+ * The default C run plan: one mid-story resume (<= Bab 20) and one late-story
+ * resume (>= Bab 45), as required by plan C.4.3.
+ */
+export const DEFAULT_RESUME_PLAN: HarnessResumeStep[] = [
+  { chapter: 20, mode: 'same-attempt' },
+  { chapter: 46, mode: 'same-attempt' },
+]
+
+export interface BuildRunSpecInput {
+  storyFixtureId: string
+  publicationMode: HarnessPublicationMode
+  routeProfile?: string
+  checkpointResumePlan?: HarnessResumeStep[]
+  forkPlan?: HarnessForkStep[]
+}
+
+export class HarnessSpecError extends Error {
+  constructor(message: string) {
+    super(`HarnessSpecError: ${message}`)
+    this.name = 'HarnessSpecError'
+  }
+}
+
+export function buildRunSpec(input: BuildRunSpecInput): M10HarnessRunSpecV1 {
+  const resumePlan = input.checkpointResumePlan ?? DEFAULT_RESUME_PLAN
+  for (const step of resumePlan) {
+    if (!Number.isInteger(step.chapter) || step.chapter < 1 || step.chapter > 50) {
+      throw new HarnessSpecError(`resume chapter out of range: ${step.chapter}`)
+    }
+  }
+  for (const step of input.forkPlan ?? []) {
+    if (!Number.isInteger(step.chapter) || step.chapter < 1 || step.chapter > 49) {
+      throw new HarnessSpecError(`fork chapter out of range (1..49): ${step.chapter}`)
+    }
+    if (step.choiceIds.length < 2) {
+      throw new HarnessSpecError(`fork at chapter ${step.chapter} needs >= 2 choiceIds`)
+    }
+  }
+
+  return {
+    schemaVersion: M10_HARNESS_SPEC_SCHEMA_VERSION,
+    storyFixtureId: input.storyFixtureId,
+    routeProfile: input.routeProfile ?? 'mixed',
+    publicationMode: input.publicationMode,
+    generationMode: 'deterministic',
+    chapters: 50,
+    choicePolicyVersion: HARNESS_CHOICE_POLICY_VERSION,
+    checkpointResumePlan: resumePlan,
+    ...(input.forkPlan ? { forkPlan: input.forkPlan } : {}),
+  }
+}
diff --git a/lib/narrative-qa/harness/run.ts b/lib/narrative-qa/harness/run.ts
new file mode 100644
index 0000000..5fa2b67
--- /dev/null
+++ b/lib/narrative-qa/harness/run.ts
@@ -0,0 +1,304 @@
+/**
+ * M10-C — 1→50 deterministic long-horizon harness driver.
+ *
+ * Executes the SAME production runtime entrypoints as a real reader session:
+ *   generateNextPersonalizedChapter  (sync or worker/job-fenced)
+ *   applyPersonalizedChoiceAuthorized (accepted-choice seam)
+ *
+ * The harness never writes canon, never writes reader_states, never repairs a
+ * failed chapter, and never skips one. A failure stops the run and is reported.
+ *
+ * Deterministic only: NARRATIVE_PROVIDER must not be 'gateway'. Zero model spend.
+ * Production activation and production DB access are out of scope by construction
+ * (`assertIsolatedTarget` refuses any non-local Supabase host).
+ */
+
+import { randomUUID } from 'node:crypto'
+import { createAdminClient } from '../../supabase/admin'
+import { generateNextPersonalizedChapter } from '../../runtime/personalized-generation'
+import {
+  acquireGenerationJobLease,
+  claimGenerationJobById,
+} from '../../runtime/generation-jobs'
+import { claimedJobToPartialContext } from '../../runtime/generation-job-execution'
+import type { LongHorizonFindingV1 } from '../contracts/evaluator-contract'
+import { sortFindings } from '../scoring/canonical-serializer'
+import { captureChapter, captureEndingRunway, harnessBlockers } from './capture'
+import type { CaptureBlockerV1, ChapterCaptureV1 } from './capture'
+import { evaluateEndingRunway } from '../evaluators/ending-evaluator'
+import { harnessProposalFor } from './fixture'
+import {
+  HARNESS_USER_ID,
+  assertHarnessStoryId,
+  assertIsolatedTarget,
+  cleanupHarnessStory,
+  ensureHarnessUser,
+  seedHarnessStory,
+  assertChapterUnlockPricingConfigured,
+} from './seed'
+import { loadPublishedChoices, selectDeterministicChoice, submitHarnessChoice } from './choice'
+import type { M10HarnessRunSpecV1 } from './run-spec'
+import { HARNESS_TOTAL_CHAPTERS } from './fixture'
+
+type Admin = ReturnType<typeof createAdminClient>
+
+export class HarnessRunError extends Error {
+  constructor(
+    message: string,
+    readonly chapterNumber: number,
+  ) {
+    super(`HarnessRunError: ${message}`)
+    this.name = 'HarnessRunError'
+  }
+}
+
+/** Refuses to run against the real model. M10-C is deterministic by contract. */
+export function assertDeterministicProvider(): void {
+  if (process.env.NARRATIVE_PROVIDER === 'gateway') {
+    throw new Error(
+      'HarnessRunError: NARRATIVE_PROVIDER=gateway would invoke the real model. M10-C is deterministic-only; real-model runs belong to M10-F.',
+    )
+  }
+}
+
+export interface HarnessRunResult {
+  storyId: string
+  publicationMode: M10HarnessRunSpecV1['publicationMode']
+  chapters: ChapterCaptureV1[]
+  findings: LongHorizonFindingV1[]
+  blockers: CaptureBlockerV1[]
+  finalCanonRevision: number
+  readerStatus: string
+  readerCurrentChapter: number
+  lockedEndingKey: string | null
+  resumedChapters: number[]
+}
+
+type GenerateResult = Awaited<ReturnType<typeof generateNextPersonalizedChapter>>
+
+/**
+ * One chapter attempt plus the ability to re-enter the SAME attempt identity.
+ *
+ * `replay` is what a checkpoint resume actually is in production: the very same
+ * attempt (sync `attemptId`, worker claimed job) re-entering after its outcome
+ * was lost. It is NOT a new attempt — a new attempt on an already-published
+ * chapter is a different scenario with a different (conflict) contract.
+ */
+interface ChapterAttempt {
+  result: GenerateResult
+  replay: () => Promise<GenerateResult>
+}
+
+async function runSyncChapter(
+  storyId: string,
+  chapterNumber: number,
+  attemptId: string,
+  userId: string,
+  triggerChoiceId: string | null,
+): Promise<ChapterAttempt> {
+  const invoke = () =>
+    generateNextPersonalizedChapter({
+      storyId,
+      userId,
+      chapterNumber,
+      correlationId: attemptId,
+      attemptId,
+      triggerChoiceId,
+      stateProposal: harnessProposalFor(storyId, chapterNumber),
+    })
+  return { result: await invoke(), replay: invoke }
+}
+
+async function runWorkerChapter(
+  admin: Admin,
+  storyId: string,
+  chapterNumber: number,
+  userId: string,
+  jobId: string,
+  triggerChoiceId: string | null,
+): Promise<ChapterAttempt> {
+  const { error: jobErr } = await admin.from('generation_jobs').insert({
+    id: jobId,
+    story_id: storyId,
+    chapter_number: chapterNumber,
+    user_id: userId,
+    generation_kind: 'personalized',
+    story_contract_version: 1,
+    trigger_choice_id: triggerChoiceId,
+    status: 'QUEUED',
+    max_attempts: 4,
+    deadline_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
+    publication_idempotency_key: `generation-job:${jobId}:publish:${chapterNumber}`,
+  })
+  if (jobErr) throw new HarnessRunError(`generation job insert failed: ${jobErr.message}`, chapterNumber)
+
+  const claim = await claimGenerationJobById({ jobId, workerId: 'm10c-harness-worker' })
+  if (!claim.claimed || !('job' in claim) || !claim.job) {
+    throw new HarnessRunError(`worker claim failed for job ${jobId}`, chapterNumber)
+  }
+  const job = claim.job
+  const lease = await acquireGenerationJobLease({
+    jobId: job.id,
+    workerId: job.workerId,
+    claimToken: job.claimToken,
+    ttlSeconds: 300,
+  })
+  if (!lease.ok) throw new HarnessRunError(`worker lease failed: ${lease.reason}`, chapterNumber)
+
+  const jobContext = claimedJobToPartialContext(job, lease.leaseId, new AbortController().signal)
+  const invoke = () =>
+    generateNextPersonalizedChapter({
+      storyId,
+      userId: job.userId,
+      chapterNumber,
+      correlationId: job.correlationId,
+      attemptId: job.id,
+      triggerChoiceId: job.triggerChoiceId ?? null,
+      jobContext,
+      stateProposal: harnessProposalFor(storyId, chapterNumber),
+    })
+  return { result: await invoke(), replay: invoke }
+}
+
+/**
+ * A checkpoint resume re-enters an already-published chapter through the SAME
+ * attempt. The living-canon publishers answer that with the durable commit
+ * ledger (EXACT_REPLAY), so the only correct outcome is a successful replay of
+ * the same chapter. Anything else is a real failure and must stop the run.
+ */
+function assertResumeReplayed(result: GenerateResult, chapterNumber: number): void {
+  if (result.ok && result.chapterNumber === chapterNumber) return
+  throw new HarnessRunError(`checkpoint resume failed: ${JSON.stringify(result)}`, chapterNumber)
+}
+
+export interface RunHarnessInput {
+  spec: M10HarnessRunSpecV1
+  storyId: string
+  userId?: string
+  admin?: Admin
+  /** Reseed from scratch. Default true — a run must start from a known canon. */
+  reseed?: boolean
+}
+
+export async function runHarness(input: RunHarnessInput): Promise<HarnessRunResult> {
+  assertDeterministicProvider()
+  assertIsolatedTarget()
+  assertHarnessStoryId(input.storyId)
+
+  const admin = input.admin ?? createAdminClient()
+  const userId = input.userId ?? HARNESS_USER_ID
+  const { storyId, spec } = input
+
+  await assertChapterUnlockPricingConfigured(admin)
+  await ensureHarnessUser(admin, userId)
+  if (input.reseed !== false) {
+    await cleanupHarnessStory(admin, storyId)
+    await seedHarnessStory({ admin, storyId, userId })
+  }
+
+  const resumeByChapter = new Map(spec.checkpointResumePlan.map((step) => [step.chapter, step]))
+  const chapters: ChapterCaptureV1[] = []
+  const findings: LongHorizonFindingV1[] = []
+  const resumedChapters: number[] = []
+
+  // The continuation loader is fail-closed on the REAL accepted choice: Bab N
+  // must be triggered by the choice id that Bab N-1 actually recorded in
+  // reader_states.choice_history. A synthetic trigger id fails with
+  // TRIGGER_CHOICE_NOT_FOUND, so the harness carries the accepted id forward.
+  let previousAcceptedChoiceId: string | null = null
+
+  for (let chapterNumber = 1; chapterNumber <= HARNESS_TOTAL_CHAPTERS; chapterNumber += 1) {
+    const attemptId = randomUUID()
+    const triggerChoiceId = chapterNumber > 1 ? previousAcceptedChoiceId : null
+
+    const attempt =
+      spec.publicationMode === 'worker'
+        ? await runWorkerChapter(admin, storyId, chapterNumber, userId, attemptId, triggerChoiceId)
+        : await runSyncChapter(storyId, chapterNumber, attemptId, userId, triggerChoiceId)
+
+    if (!attempt.result.ok) {
+      throw new HarnessRunError(
+        `chapter generation failed: ${JSON.stringify(attempt.result)}`,
+        chapterNumber,
+      )
+    }
+
+    // Checkpoint resume: re-enter the SAME chapter through the production path.
+    // Publication is idempotent, so a resume must not double-advance canon.
+    //
+    // A resume is the SAME attempt identity re-entering, in both modes:
+    //   sync   — the attempt id IS the checkpoint attempt id, and the V3
+    //            publisher answers a re-entry from the commit ledger.
+    //   worker — the attempt id IS the generation_jobs primary key AND the
+    //            checkpoint attempt_id/job_id (V5 requires
+    //            checkpoint.attempt_id = checkpoint.job_id = job.id, else
+    //            PROVENANCE_CONFLICT). A fresh job can therefore never resume
+    //            another job's checkpoint; the claimed job re-enters itself.
+    const resume = resumeByChapter.get(chapterNumber)
+    if (resume) {
+      const resumeResult = await attempt.replay()
+      assertResumeReplayed(resumeResult, chapterNumber)
+      resumedChapters.push(chapterNumber)
+    }
+
+    // Accepted choice through the production seam. Chapter 50 is terminal and
+    // the choice RPC is bounded to 1..49, so no choice is submitted there.
+    let acceptedChoiceId: string | null = null
+    if (chapterNumber < HARNESS_TOTAL_CHAPTERS) {
+      const published = await loadPublishedChoices(admin, storyId, chapterNumber)
+      const chosen = selectDeterministicChoice(published)
+      const submitted = await submitHarnessChoice({
+        admin,
+        storyId,
+        userId,
+        chapterNumber,
+      })
+      acceptedChoiceId = submitted.choiceId
+      if (submitted.choiceId !== chosen.id) {
+        throw new HarnessRunError(
+          `choice policy drift: expected ${chosen.id}, submitted ${submitted.choiceId}`,
+          chapterNumber,
+        )
+      }
+      previousAcceptedChoiceId = submitted.choiceId
+    }
+
+    const captured = await captureChapter({
+      admin,
+      storyId,
+      userId,
+      chapterNumber,
+      acceptedChoiceId,
+    })
+    chapters.push(captured.capture)
+    findings.push(...captured.findings)
+  }
+
+  const endingEnvelope = await captureEndingRunway(admin, storyId, userId)
+  findings.push(...evaluateEndingRunway(endingEnvelope))
+
+  const { data: storyRow } = await admin
+    .from('stories')
+    .select('canon_state_revision')
+    .eq('id', storyId)
+    .single()
+  const { data: readerRow } = await admin
+    .from('reader_states')
+    .select('status,current_chapter,locked_ending_key')
+    .eq('user_id', userId)
+    .eq('story_id', storyId)
+    .single()
+
+  return {
+    storyId,
+    publicationMode: spec.publicationMode,
+    chapters,
+    findings: sortFindings(findings),
+    blockers: harnessBlockers(),
+    finalCanonRevision: Number(storyRow?.canon_state_revision ?? 0),
+    readerStatus: String(readerRow?.status ?? ''),
+    readerCurrentChapter: Number(readerRow?.current_chapter ?? 0),
+    lockedEndingKey: readerRow?.locked_ending_key ? String(readerRow.locked_ending_key) : null,
+    resumedChapters,
+  }
+}
diff --git a/lib/narrative-qa/harness/seed.ts b/lib/narrative-qa/harness/seed.ts
new file mode 100644
index 0000000..585b179
--- /dev/null
+++ b/lib/narrative-qa/harness/seed.ts
@@ -0,0 +1,297 @@
+/**
+ * M10-C — isolated story bootstrap for the 50-chapter harness.
+ *
+ * Plan C.2 explicitly allows fixture seed helpers for INITIAL story/bootstrap
+ * setup only. After the story exists, canonical state advances exclusively
+ * through the production publication path; nothing here may be reused to patch
+ * mid-run state.
+ *
+ * Safety: `assertIsolatedTarget()` refuses to run unless the Supabase URL is a
+ * loopback/local host. The harness must never touch production or a linked DB.
+ */
+
+import { createAdminClient } from '../../supabase/admin'
+import { debtBackedThreadId } from '@lakoku/narrative-core'
+import { normalizeRouteState } from '../../story-engine/route-state'
+import {
+  CHARACTERS,
+  ENDINGS,
+  HARNESS_TOTAL_CHAPTERS,
+  PLOT_DEBTS,
+  REVEALS,
+  buildHarnessContract,
+  convictionThreadId,
+  harnessPolicyForChapter,
+} from './fixture'
+
+type Admin = ReturnType<typeof createAdminClient>
+
+export class HarnessIsolationError extends Error {
+  constructor(message: string) {
+    super(`HarnessIsolationError: ${message}`)
+    this.name = 'HarnessIsolationError'
+  }
+}
+
+const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])
+
+/**
+ * Fail-closed isolation gate. A harness run that cannot prove it is pointed at
+ * a local/isolated Supabase must abort before any write.
+ */
+export function assertIsolatedTarget(rawUrl = process.env.SUPABASE_URL): string {
+  if (!rawUrl) {
+    throw new HarnessIsolationError('SUPABASE_URL is not set; refusing to run against an unknown target')
+  }
+  let host: string
+  try {
+    host = new URL(rawUrl).hostname
+  } catch {
+    throw new HarnessIsolationError(`SUPABASE_URL is not a valid URL: ${rawUrl}`)
+  }
+  if (!LOCAL_HOSTS.has(host)) {
+    throw new HarnessIsolationError(
+      `refusing to run against non-local Supabase host "${host}". M10-C is isolated-only.`,
+    )
+  }
+  return rawUrl
+}
+
+/**
+ * Guard against colliding with real content. Harness story ids are namespaced
+ * and must never look like a production story id.
+ */
+export function assertHarnessStoryId(storyId: string): void {
+  if (!storyId.startsWith('m10c-')) {
+    throw new HarnessIsolationError(`harness story id must start with "m10c-": got "${storyId}"`)
+  }
+}
+
+/** Deterministic harness reader. Never a real reader account. */
+export const HARNESS_USER_ID = '99999999-9999-4999-9999-99999999c000'
+export const HARNESS_USER_EMAIL = 'm10c-harness@example.invalid'
+
+export async function cleanupHarnessStory(admin: Admin, storyId: string): Promise<void> {
+  assertHarnessStoryId(storyId)
+  await admin.from('commercial_generation_intents').delete().eq('story_id', storyId)
+  await admin.from('chapter_state_commits').delete().eq('story_id', storyId)
+  await admin.from('chapter_generation_checkpoints').delete().eq('story_id', storyId)
+  await admin.from('reader_plot_debt_closures').delete().eq('story_id', storyId)
+  await admin.from('reader_plot_debt_progress').delete().eq('story_id', storyId)
+  await admin.from('choice_outcomes').delete().eq('story_id', storyId)
+  await admin.from('chapters').delete().eq('story_id', storyId)
+  await admin.from('generation_jobs').delete().eq('story_id', storyId)
+  await admin.from('retrieval_logs').delete().eq('story_id', storyId)
+  await admin.from('act_rollups').delete().eq('story_id', storyId)
+  await admin.from('timeline_events').delete().eq('story_id', storyId)
+  await admin.from('knowledge_scopes').delete().eq('story_id', storyId)
+  await admin.from('facts_ledger').delete().eq('story_id', storyId)
+  await admin.from('secrets_reveals').delete().eq('story_id', storyId)
+  await admin.from('story_threads').delete().eq('story_id', storyId)
+  await admin.from('character_states').delete().in(
+    'character_id',
+    CHARACTERS.map((c) => `${storyId}:${c.id}`),
+  )
+  await admin.from('characters').delete().eq('story_id', storyId)
+  await admin.from('reader_states').delete().eq('story_id', storyId)
+  await admin.from('chapter_blueprints').delete().eq('story_id', storyId)
+  await admin.from('story_generation_contracts').delete().eq('story_id', storyId)
+  await admin.from('stories').delete().eq('id', storyId)
+}
+
+/**
+ * `apply_personalized_choice_v2` creates a commercial generation intent from
+ * chapter 4 onwards, and that RPC hard-fails with CONFIG_ERROR unless an active
+ * `chapter_unlock` price row exists. The harness verifies the precondition
+ * instead of writing one, so a missing migration surfaces as a blocker rather
+ * than being silently papered over.
+ */
+export async function assertChapterUnlockPricingConfigured(admin: Admin): Promise<void> {
+  const { data, error } = await admin
+    .from('feature_credit_costs')
+    .select('feature_key,credits_required,is_active,pricing_version')
+    .eq('feature_key', 'chapter_unlock')
+    .maybeSingle()
+  if (error) {
+    throw new HarnessIsolationError(`feature_credit_costs read failed: ${error.message}`)
+  }
+  if (!data || data.is_active !== true || Number(data.credits_required) <= 0 || !data.pricing_version) {
+    throw new HarnessIsolationError(
+      'active feature_credit_costs["chapter_unlock"] is missing; the accepted-choice seam would fail with CONFIG_ERROR',
+    )
+  }
+}
+
+export interface SeedHarnessStoryInput {
+  admin: Admin
+  storyId: string
+  userId?: string
+}
+
+export async function seedHarnessStory(input: SeedHarnessStoryInput): Promise<void> {
+  const { admin, storyId } = input
+  const userId = input.userId ?? HARNESS_USER_ID
+  assertHarnessStoryId(storyId)
+
+  const contract = buildHarnessContract(storyId)
+
+  const { error: storyError } = await admin.from('stories').insert({
+    id: storyId,
+    title: 'Brankas Rahasia 50 Bab',
+    cover: '/cover.webp',
+    tagline: 'Misteri brankas basement',
+    role: 'Protector',
+    tropes: ['misteri'],
+    total_chapters: HARNESS_TOTAL_CHAPTERS,
+    synopsis: 'Synopsis deterministik.',
+    status: 'BERJALAN',
+    current_chapter: 0,
+    owner_user_id: userId,
+    jejak: [],
+    visibility: 'private',
+    story_mode: 'personalized_ai',
+    generation_status: 'ready',
+    story_contract_version: 1,
+    living_canon_version: 1,
+    canon_state_revision: 0,
+    // Required by ensure_commercial_generation_intent_v1, which the production
+    // accepted-choice RPC invokes from chapter 4 onward.
+    commercial_origin: 'STARTER_FREE',
+  })
+  if (storyError) throw new HarnessIsolationError(`seed stories failed: ${storyError.message}`)
+
+  const { error: contractError } = await admin.from('story_generation_contracts').insert({
+    story_id: storyId,
+    mode: 'personalized_ai',
+    total_chapters: HARNESS_TOTAL_CHAPTERS,
+    contract_source: 'llm_repaired',
+    onboarding_json: { hero: 'char:hero' },
+    story_contract_json: contract,
+    route_schema_json: {},
+    plot_debts_json: PLOT_DEBTS,
+    ending_candidates_json: ENDINGS,
+    ending_lock_json: {},
+    quality_profile: 'lakoku_mobile_drama_v1',
+    story_contract_version: 1,
+  })
+  if (contractError) throw new HarnessIsolationError(`seed contract failed: ${contractError.message}`)
+
+  const blueprints = Array.from({ length: HARNESS_TOTAL_CHAPTERS }, (_, i) => {
+    const n = i + 1
+    return {
+      story_id: storyId,
+      chapter_number: n,
+      version: 1,
+      phase: n <= 5 ? 'ACT_1' : n <= 12 ? 'ACT_2' : 'ACT_3',
+      chapter_goal: `Goal ${n}`,
+      mandatory_beats: ['beat-1'],
+      forbidden_reveals: [],
+      allowed_state_delta: harnessPolicyForChapter(storyId, n),
+      introduces_characters: [],
+    }
+  })
+  const { error: blueprintError } = await admin.from('chapter_blueprints').insert(blueprints)
+  if (blueprintError) throw new HarnessIsolationError(`seed blueprints failed: ${blueprintError.message}`)
+
+  const { error: charError } = await admin.from('characters').insert(
+    CHARACTERS.map((c) => ({
+      id: `${storyId}:${c.id}`,
+      story_id: storyId,
+      canonical_name: c.name,
+      role: c.role,
+      introduced_chapter: c.introducedChapter,
+    })),
+  )
+  if (charError) throw new HarnessIsolationError(`seed characters failed: ${charError.message}`)
+
+  const { error: charStateError } = await admin.from('character_states').insert(
+    CHARACTERS.map((c) => ({
+      character_id: `${storyId}:${c.id}`,
+      status: 'ALIVE',
+      as_of_chapter: 0,
+      attributes: {},
+    })),
+  )
+  if (charStateError) throw new HarnessIsolationError(`seed character_states failed: ${charStateError.message}`)
+
+  const { error: threadError } = await admin.from('story_threads').insert([
+    {
+      id: debtBackedThreadId(storyId, 'main_mystery'),
+      story_id: storyId,
+      title: 'Misteri brankas',
+      status: 'OPEN',
+      opened_chapter: 1,
+      last_touched_chapter: 1,
+      payoff_window: 48,
+      is_main_mystery: true,
+      stale: false,
+      stale_since_chapter: null,
+    },
+    {
+      id: debtBackedThreadId(storyId, 'debt:a'),
+      story_id: storyId,
+      title: 'Surat di brankas',
+      status: 'OPEN',
+      opened_chapter: 1,
+      last_touched_chapter: 1,
+      payoff_window: 8,
+      is_main_mystery: false,
+      stale: false,
+      stale_since_chapter: null,
+    },
+    {
+      id: convictionThreadId(storyId),
+      story_id: storyId,
+      title: 'Keyakinan Raka',
+      status: 'OPEN',
+      opened_chapter: 1,
+      last_touched_chapter: 1,
+      payoff_window: null,
+      is_main_mystery: false,
+      stale: false,
+      stale_since_chapter: null,
+    },
+  ])
+  if (threadError) throw new HarnessIsolationError(`seed story_threads failed: ${threadError.message}`)
+
+  const { error: secretError } = await admin.from('secrets_reveals').insert(
+    REVEALS.map((r) => ({
+      story_id: storyId,
+      id: `${storyId}:${r.secretId}`,
+      description: `Rahasia ${r.secretId}`,
+      reveal_gate_chapter: r.revealGateChapter,
+      revealed: false,
+    })),
+  )
+  if (secretError) throw new HarnessIsolationError(`seed secrets_reveals failed: ${secretError.message}`)
+
+  // `route_state` MUST be the normalized shape, exactly like the production
+  // bootstrap in lib/api/personalized-stories.server.ts. `apply_personalized_choice`
+  // compares the caller's expected state against the stored row field-by-field;
+  // a raw `{}` here is re-hydrated with Zod defaults on read and the RPC then
+  // rejects every submission with STALE_READER_STATE.
+  const { error: readerError } = await admin.from('reader_states').insert({
+    user_id: userId,
+    story_id: storyId,
+    status: 'BERJALAN',
+    current_chapter: 1,
+    ending_name: null,
+    route_state: normalizeRouteState({}),
+    choice_history: [],
+    jejak: [],
+    locked_ending_key: null,
+    updated_at: new Date().toISOString(),
+  })
+  if (readerError) throw new HarnessIsolationError(`seed reader_states failed: ${readerError.message}`)
+}
+
+export async function ensureHarnessUser(admin: Admin, userId = HARNESS_USER_ID): Promise<void> {
+  await admin.auth.admin
+    .createUser({
+      id: userId,
+      email: HARNESS_USER_EMAIL,
+      password: `m10c-${userId}`,
+      email_confirm: true,
+    })
+    .catch(() => null)
+}
diff --git a/package.json b/package.json
index 65ba528..d4fde67 100644
--- a/package.json
+++ b/package.json
@@ -20,20 +20,21 @@
     "test:db:authoring-race-cleanup": "node scripts/run-smoke.cjs scripts/authoring-race-cleanup-failure.ts",
     "test:db:publish-v2-race": "node scripts/run-smoke.cjs scripts/publish-chapter-v2-race.ts",
     "test:db:generation-jobs": "node scripts/run-smoke.cjs scripts/runtime-baseline-sentinel.ts && pnpm exec supabase test db --local supabase/tests/runtime_lifecycle_baseline_test.sql supabase/tests/generation_jobs_schema_test.sql supabase/tests/generation_job_enqueue_test.sql supabase/tests/generation_job_worker_rpc_test.sql supabase/tests/generation_job_recovery_test.sql supabase/tests/generation_job_fencing_test.sql supabase/tests/generation_job_ending_lock_publication_test.sql supabase/tests/generation_choice_enqueue_test.sql supabase/tests/claim_generation_job_by_id_test.sql supabase/tests/checkpoint_versioning_test.sql supabase/tests/generation_checkpoint_fencing_test.sql supabase/tests/checkpoint_audit_signals_test.sql && node scripts/run-smoke.cjs scripts/generation-publication-lock-order-race.ts && node scripts/run-smoke.cjs scripts/generation-job-enqueue-race.ts && node scripts/run-smoke.cjs scripts/generation-job-claim-race.ts && node scripts/run-smoke.cjs scripts/generation-job-recovery-race.ts && node scripts/run-smoke.cjs scripts/generation-job-fencing-race.ts && node scripts/run-smoke.cjs scripts/generation-checkpoint-fencing-race.ts",
     "test:db:plot-debt-closures": "pnpm exec supabase test db --local supabase/tests/plot_debt_closures_test.sql supabase/tests/plot_debt_closures_functional_test.sql && node scripts/run-smoke.cjs scripts/plot-debt-closure-race.ts && node scripts/run-smoke.cjs scripts/plot-debt-v4-race.ts",
     "test:db:generation-checkpoints": "node scripts/run-smoke.cjs scripts/runtime-baseline-sentinel.ts && pnpm exec supabase test db --local supabase/tests/claim_generation_job_by_id_test.sql supabase/tests/checkpoint_versioning_test.sql supabase/tests/generation_checkpoint_fencing_test.sql supabase/tests/checkpoint_audit_signals_test.sql && node scripts/run-smoke.cjs scripts/generation-checkpoint-fencing-race.ts",
     "test:db:generation-publication-lock-order": "pnpm exec supabase test db --local supabase/tests/generation_job_fencing_test.sql supabase/tests/generation_job_ending_lock_publication_test.sql && node scripts/run-smoke.cjs scripts/generation-publication-lock-order-race.ts",
     "test:db:personalized": "node scripts/run-smoke.cjs scripts/personalized-db-rest-integration.ts && supabase test db --local supabase/tests/personalized_story_schema_test.sql supabase/tests/bootstrap_personalized_story_test.sql supabase/tests/personalized_story_rls_test.sql supabase/tests/publish_chapter_v2_test.sql supabase/tests/authoring_story_claim_test.sql supabase/tests/authoring_story_bible_replace_test.sql supabase/tests/premium_story_clone_test.sql && pnpm run test:integration:ownership && pnpm run test:db:authoring-race-cleanup && node scripts/run-smoke.cjs scripts/authoring-story-claim-race.ts && node scripts/run-smoke.cjs scripts/authoring-story-bible-race.ts && pnpm run test:db:publish-v2-race",
     "smoke": "pnpm run smoke:analytics && pnpm run smoke:story-setup && pnpm run smoke:taste-profile && pnpm run smoke:taste-profile-db && pnpm run smoke:contracts && pnpm run smoke:web-release && pnpm run smoke:onboarding-shimmer && pnpm run smoke:auth-config && pnpm run smoke:admin-guard && pnpm run smoke:m4 && pnpm run smoke:m5 && pnpm run smoke:authoring-model && pnpm run smoke:m7-authoring && pnpm run smoke:m7-reconcile && pnpm run smoke:m7-opening && pnpm run smoke:m8-metrics && pnpm run smoke:m8-alert && pnpm run smoke:m8-entitlement && pnpm run smoke:paycore-webhook && pnpm run smoke:paycore-client && pnpm run smoke:credits-policy && pnpm run smoke:topup-bonus && pnpm run smoke:admin-credit-grant && pnpm run smoke:generation-policy && pnpm run smoke:ai-model-routes && pnpm run smoke:admin-panel && pnpm run smoke:admin-generation-observability && pnpm run smoke:personalized-story",
     "smoke:personalized-story": "node scripts/run-smoke.cjs scripts/personalized-story-smoke.ts",
     "m10:b:qa": "node scripts/run-smoke.cjs scripts/m10-b-qa-cli.ts",
+    "m10:c:harness": "node scripts/run-smoke.cjs scripts/m10-c-harness-cli.ts",
     "replay:choice": "node scripts/run-smoke.cjs scripts/choice-replay-harness-cli.ts",
     "replay:bridge": "node scripts/run-smoke.cjs scripts/replay-bridge-cli.ts",
     "test:e2e:personalized-auth": "node scripts/run-smoke.cjs scripts/personalized-authenticated-e2e.ts",
     "smoke:contracts": "node scripts/run-smoke.cjs scripts/contracts-smoke.ts",
     "smoke:web-release": "node scripts/run-smoke.cjs scripts/web-release-smoke.ts",
     "smoke:onboarding-shimmer": "node scripts/run-smoke.cjs scripts/onboarding-shimmer-smoke.ts",
     "smoke:auth-config": "node scripts/run-smoke.cjs scripts/auth-config-smoke.ts",
     "smoke:password-recovery": "node scripts/run-smoke.cjs scripts/password-recovery-smoke.ts",
     "smoke:admin-guard": "node scripts/run-smoke.cjs scripts/admin-guard-smoke.ts",
     "smoke:m4": "node scripts/run-smoke.cjs scripts/m4-generation.ts",
diff --git a/scripts/m10-c-harness-cli.ts b/scripts/m10-c-harness-cli.ts
new file mode 100644
index 0000000..6dc93b9
--- /dev/null
+++ b/scripts/m10-c-harness-cli.ts
@@ -0,0 +1,11 @@
+/** CLI wrapper. Kept side-effect-only so the runner module stays importable by tests. */
+import { runM10CCli } from './m10-c-harness'
+
+runM10CCli()
+  .then((code) => {
+    process.exitCode = code
+  })
+  .catch((error: unknown) => {
+    console.error(error instanceof Error ? error.message : String(error))
+    process.exitCode = 1
+  })
diff --git a/scripts/m10-c-harness.ts b/scripts/m10-c-harness.ts
new file mode 100644
index 0000000..7636685
--- /dev/null
+++ b/scripts/m10-c-harness.ts
@@ -0,0 +1,256 @@
+/**
+ * M10-C — long-horizon 1→50 harness runner.
+ *
+ * Runs the deterministic 50-chapter harness twice (sync clone + worker clone)
+ * against an ISOLATED local Supabase, using the production runtime and the
+ * production accepted-choice seam, then emits the M10 artifact set.
+ *
+ * FAIL-CLOSED:
+ *   - any chapter that fails to generate/publish aborts the run (no skip, no repair);
+ *   - sync and worker must reach byte-identical per-chapter capture hashes;
+ *   - a non-empty capture blocker list forces result=BLOCKED, never PASS.
+ *
+ * Never touches production. Never invokes a real model. Requires an explicitly
+ * local Supabase target (enforced by `assertIsolatedTarget`).
+ */
+
+import { execFileSync } from 'node:child_process'
+import { mkdirSync, writeFileSync } from 'node:fs'
+import { join } from 'node:path'
+
+function bootstrapLocalSupabaseEnv(): void {
+  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return
+  try {
+    const raw = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
+      cwd: process.cwd(),
+      encoding: 'utf8',
+      stdio: ['ignore', 'pipe', 'ignore'],
+      shell: process.platform === 'win32',
+    })
+    const parsed = JSON.parse(raw.match(/{[\s\S]*}/)?.[0] ?? raw) as Record<string, string>
+    if (parsed.API_URL) process.env.SUPABASE_URL = parsed.API_URL
+    if (parsed.SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = parsed.SERVICE_ROLE_KEY
+  } catch {
+    // Left unset on purpose: assertIsolatedTarget will refuse to run and the
+    // operator gets an explicit blocker instead of a silent wrong-target run.
+  }
+}
+
+bootstrapLocalSupabaseEnv()
+
+import type { M10ArtifactManifestV1 } from '../lib/narrative-qa/contracts/evaluator-contract'
+import type { LongHorizonFindingV1 } from '../lib/narrative-qa/contracts/evaluator-contract'
+import {
+  computeFindingsHash,
+  computeSha256,
+  sortFindings,
+  stableStringify,
+} from '../lib/narrative-qa/scoring/canonical-serializer'
+import { runHarness } from '../lib/narrative-qa/harness/run'
+import type { HarnessRunResult } from '../lib/narrative-qa/harness/run'
+import { DEFAULT_RESUME_PLAN, HARNESS_CHOICE_POLICY_VERSION, buildRunSpec } from '../lib/narrative-qa/harness/run-spec'
+import { HARNESS_FIXTURE_ID, HARNESS_TOTAL_CHAPTERS } from '../lib/narrative-qa/harness/fixture'
+import { EVALUATOR_VERSIONS, M10A_CLOSURE_ANCHOR } from './m10-b-qa'
+
+/** SHA this stage actually executed from. NOT the M10-A closure anchor. */
+export const C_BASELINE_SHA = 'b79613178bb6a4d3f5f2b2e2b3f3b53e0bd0c0f1'
+
+export const SYNC_STORY_ID = 'm10c-sync'
+export const WORKER_STORY_ID = 'm10c-worker'
+
+export interface ParityMismatch {
+  chapterNumber: number
+  syncCaptureHash: string
+  workerCaptureHash: string
+}
+
+export function compareParity(sync: HarnessRunResult, worker: HarnessRunResult): ParityMismatch[] {
+  const mismatches: ParityMismatch[] = []
+  const workerByChapter = new Map(worker.chapters.map((c) => [c.chapterNumber, c]))
+  for (const syncChapter of sync.chapters) {
+    const workerChapter = workerByChapter.get(syncChapter.chapterNumber)
+    if (!workerChapter || workerChapter.captureHash !== syncChapter.captureHash) {
+      mismatches.push({
+        chapterNumber: syncChapter.chapterNumber,
+        syncCaptureHash: syncChapter.captureHash,
+        workerCaptureHash: workerChapter?.captureHash ?? '<missing>',
+      })
+    }
+  }
+  return mismatches
+}
+
+export interface CompletionCheck {
+  code: string
+  passed: boolean
+  detail: Record<string, unknown>
+}
+
+export function checkCompletion(run: HarnessRunResult): CompletionCheck[] {
+  return [
+    {
+      code: 'ALL_50_CHAPTERS_PUBLISHED',
+      passed: run.chapters.length === HARNESS_TOTAL_CHAPTERS,
+      detail: { published: run.chapters.length, expected: HARNESS_TOTAL_CHAPTERS },
+    },
+    {
+      code: 'CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER',
+      // A checkpoint resume must NOT double-advance canon.
+      passed: run.finalCanonRevision === HARNESS_TOTAL_CHAPTERS,
+      detail: { finalCanonRevision: run.finalCanonRevision, resumedChapters: run.resumedChapters },
+    },
+    {
+      code: 'READER_REACHED_COMPLETION',
+      passed: run.readerStatus === 'SELESAI' && run.readerCurrentChapter === HARNESS_TOTAL_CHAPTERS,
+      detail: { status: run.readerStatus, currentChapter: run.readerCurrentChapter },
+    },
+    {
+      code: 'ENDING_LOCKED',
+      passed: Boolean(run.lockedEndingKey),
+      detail: { lockedEndingKey: run.lockedEndingKey },
+    },
+    {
+      code: 'CHECKPOINT_RESUME_EXERCISED',
+      passed: run.resumedChapters.length >= DEFAULT_RESUME_PLAN.length,
+      detail: { resumedChapters: run.resumedChapters },
+    },
+  ]
+}
+
+export interface M10CRunOutput {
+  manifest: M10ArtifactManifestV1
+  summary: Record<string, unknown>
+  findings: LongHorizonFindingV1[]
+  parityMismatches: ParityMismatch[]
+  completion: { sync: CompletionCheck[]; worker: CompletionCheck[] }
+  findingsHash: string
+  summaryHash: string
+}
+
+export async function runM10CHarness(outDir?: string): Promise<M10CRunOutput> {
+  const startedAt = new Date().toISOString()
+
+  const syncSpec = buildRunSpec({
+    storyFixtureId: HARNESS_FIXTURE_ID,
+    routeProfile: 'high-trust',
+    publicationMode: 'sync',
+    checkpointResumePlan: DEFAULT_RESUME_PLAN,
+  })
+  const workerSpec = buildRunSpec({
+    storyFixtureId: HARNESS_FIXTURE_ID,
+    routeProfile: 'high-trust',
+    publicationMode: 'worker',
+    checkpointResumePlan: DEFAULT_RESUME_PLAN,
+  })
+
+  // Sequential on purpose: the two clones share one local Postgres and one
+  // generation-capacity slot pool. Parallelism would measure contention.
+  const sync = await runHarness({ spec: syncSpec, storyId: SYNC_STORY_ID })
+  const worker = await runHarness({ spec: workerSpec, storyId: WORKER_STORY_ID })
+
+  const parityMismatches = compareParity(sync, worker)
+  const completion = { sync: checkCompletion(sync), worker: checkCompletion(worker) }
+
+  const findings = sortFindings([...sync.findings, ...worker.findings])
+  const blockers = sync.blockers
+
+  const failedCompletion = [...completion.sync, ...completion.worker].filter((c) => !c.passed)
+  const blockerFindings = findings.filter((f) => f.severity === 'BLOCKER')
+
+  const summary = {
+    chapters: HARNESS_TOTAL_CHAPTERS,
+    choicePolicyVersion: HARNESS_CHOICE_POLICY_VERSION,
+    syncStoryId: sync.storyId,
+    workerStoryId: worker.storyId,
+    parityMismatchCount: parityMismatches.length,
+    failedCompletionChecks: failedCompletion.map((c) => c.code),
+    blocker: findings.filter((f) => f.severity === 'BLOCKER').length,
+    high: findings.filter((f) => f.severity === 'HIGH').length,
+    medium: findings.filter((f) => f.severity === 'MEDIUM').length,
+    low: findings.filter((f) => f.severity === 'LOW').length,
+    info: findings.filter((f) => f.severity === 'INFO').length,
+    totalFindings: findings.length,
+    captureBlockers: blockers.map((b) => b.code),
+  }
+
+  // A capture blocker means an evaluator input has no honest runtime source.
+  // The stage cannot claim coverage it does not have, so it reports BLOCKED.
+  const result: M10ArtifactManifestV1['result'] =
+    blockers.length > 0
+      ? 'BLOCKED'
+      : parityMismatches.length === 0 && failedCompletion.length === 0 && blockerFindings.length === 0
+        ? 'PASS'
+        : 'FAIL'
+
+  const findingsHash = computeFindingsHash(findings)
+  const summaryHash = computeSha256(stableStringify(summary))
+  const finishedAt = new Date().toISOString()
+  const runId = `m10-c-${findingsHash.slice(0, 12)}`
+
+  const manifest: M10ArtifactManifestV1 = {
+    schemaVersion: 1,
+    stage: 'C',
+    baselineSha: C_BASELINE_SHA,
+    m10aClosureAnchor: M10A_CLOSURE_ANCHOR,
+    runId,
+    startedAt,
+    finishedAt,
+    environment: 'isolated-qa',
+    storyIds: [sync.storyId, worker.storyId],
+    routeProfiles: [syncSpec.routeProfile, workerSpec.routeProfile],
+    runtimePolicyVersions: {
+      personalizedV1: '1.0.0',
+      choicePolicy: HARNESS_CHOICE_POLICY_VERSION,
+      harnessSpec: syncSpec.schemaVersion,
+    },
+    evaluatorVersions: EVALUATOR_VERSIONS,
+    artifactHashes: { findingsHash, summaryHash },
+    result,
+  }
+
+  if (outDir) {
+    const targetDir = join(outDir, runId)
+    mkdirSync(targetDir, { recursive: true })
+    writeFileSync(join(targetDir, 'findings.json'), stableStringify(findings))
+    writeFileSync(join(targetDir, 'summary.json'), stableStringify(summary))
+    writeFileSync(join(targetDir, 'manifest.json'), stableStringify(manifest))
+    writeFileSync(join(targetDir, 'blockers.json'), stableStringify(blockers))
+    writeFileSync(
+      join(targetDir, 'captures.json'),
+      stableStringify({ sync: sync.chapters, worker: worker.chapters }),
+    )
+    writeFileSync(
+      join(targetDir, 'parity.json'),
+      stableStringify({ mismatches: parityMismatches, completion }),
+    )
+    console.log(`Artifacts written to ${targetDir}`)
+  }
+
+  return { manifest, summary, findings, parityMismatches, completion, findingsHash, summaryHash }
+}
+
+export async function runM10CCli(): Promise<number> {
+  const artifactsDir = join(process.cwd(), '.zcode', 'artifacts', 'm10-c')
+  const run = await runM10CHarness(artifactsDir)
+
+  console.log('M10-C Long-Horizon Harness Summary:')
+  console.log(`  Result: ${run.manifest.result}`)
+  console.log(`  Chapters: ${HARNESS_TOTAL_CHAPTERS} (sync + worker)`)
+  console.log(`  Parity mismatches: ${run.parityMismatches.length}`)
+  console.log(`  Total findings: ${run.findings.length}`)
+  console.log(`  Findings hash: ${run.findingsHash}`)
+
+  for (const mismatch of run.parityMismatches) {
+    console.error(
+      `    parity mismatch Bab ${mismatch.chapterNumber}: sync=${mismatch.syncCaptureHash} worker=${mismatch.workerCaptureHash}`,
+    )
+  }
+  for (const check of [...run.completion.sync, ...run.completion.worker].filter((c) => !c.passed)) {
+    console.error(`    completion FAILED ${check.code}: ${stableStringify(check.detail)}`)
+  }
+  for (const code of run.summary.captureBlockers as string[]) {
+    console.error(`    CAPTURE BLOCKER: ${code}`)
+  }
+
+  return run.manifest.result === 'PASS' ? 0 : 1
+}
