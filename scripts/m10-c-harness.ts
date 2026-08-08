/**
 * M10-C — long-horizon 1→50 harness runner.
 *
 * Runs the deterministic 50-chapter harness twice (sync clone + worker clone)
 * against an ISOLATED local Supabase, using the production runtime and the
 * production accepted-choice seam, then emits the M10 artifact set.
 *
 * FAIL-CLOSED:
 *   - any chapter that fails to generate/publish aborts the run (no skip, no repair);
 *   - sync and worker must reach byte-identical per-chapter capture hashes;
 *   - capture blockers force result=BLOCKED unless a blocker carries a
 *     proof-backed CLOSED/RECLASSIFIED disposition (blocker-dispositions.ts).
 *     A blocker only closes when the production runtime gains the wire and the
 *     capture reads it back; every disposition (including all six original
 *     codes) is written into the artifacts for reviewer audit.
 *
 * Never touches production. Never invokes a real model. Requires an explicitly
 * local Supabase target (enforced by `assertIsolatedTarget`).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function bootstrapLocalSupabaseEnv(): void {
  const mirrorNextPublicUrl = () => {
    // lib/commercial/worker-preflight.server.ts builds its own client from
    // NEXT_PUBLIC_SUPABASE_URL; mirror the (isolation-checked) local URL so the
    // worker-mode preflight seam resolves the same local target.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
    }
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    mirrorNextPublicUrl()
    return
  }
  try {
    const raw = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    })
    const parsed = JSON.parse(raw.match(/{[\s\S]*}/)?.[0] ?? raw) as Record<string, string>
    if (parsed.API_URL) process.env.SUPABASE_URL = parsed.API_URL
    if (parsed.SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = parsed.SERVICE_ROLE_KEY
  } catch {
    // Left unset on purpose: assertIsolatedTarget will refuse to run and the
    // operator gets an explicit blocker instead of a silent wrong-target run.
  }
  mirrorNextPublicUrl()
}

bootstrapLocalSupabaseEnv()

import type { M10ArtifactManifestV1 } from '../lib/narrative-qa/contracts/evaluator-contract'
import type { LongHorizonFindingV1 } from '../lib/narrative-qa/contracts/evaluator-contract'
import {
  computeFindingsHash,
  computeSha256,
  sortFindings,
  stableStringify,
} from '../lib/narrative-qa/scoring/canonical-serializer'
import { runHarness } from '../lib/narrative-qa/harness/run'
import type { HarnessRunResult } from '../lib/narrative-qa/harness/run'
import { runForkProbe, FORK_STORY_A_ID, FORK_STORY_B_ID } from '../lib/narrative-qa/harness/fork'
import { BLOCKER_DISPOSITIONS, unresolvedBlockers } from '../lib/narrative-qa/harness/blocker-dispositions'
import { headShaOfWorkingTree } from '../lib/narrative-qa/git-sha'
import { DEFAULT_RESUME_PLAN, HARNESS_CHOICE_POLICY_VERSION, buildRunSpec } from '../lib/narrative-qa/harness/run-spec'
import { ACT_PLAN, ACT_BOUNDARY_CHAPTERS, HARNESS_FIXTURE_ID, HARNESS_TOTAL_CHAPTERS } from '../lib/narrative-qa/harness/fixture'
import { EVALUATOR_VERSIONS, M10A_CLOSURE_ANCHOR } from './m10-b-qa'

/**
 * Real commit this RECOVERY stage started from: current main with M10-B
 * integrated (PR #56 squash 7d0dd03, closure docs 21cb682) — the reviewer-
 * mandated restart point "dari main baru yang sudah memuat B + current
 * runtime". Verifiable with `git cat-file -t`. NOT the M10-A closure anchor,
 * and NOT the stale 401f0f8 base of the superseded pre-Phase-2B branch. The
 * manifest additionally records the runtime `headSha` + `workingTreeDirty` so
 * an uncommitted tree can never masquerade as a clean provenance.
 */
export const C_BASELINE_SHA = '21cb68279eb024f9922f8b05a939d43eb2ae3e16'

export const SYNC_STORY_ID = 'm10c-sync'
export const WORKER_STORY_ID = 'm10c-worker'

export interface ParityMismatch {
  chapterNumber: number
  syncCaptureHash: string
  workerCaptureHash: string
}

/**
 * What the sync/worker parity comparison does and does NOT cover (M2).
 *
 * COMPARED (via the provenance-normalized per-chapter captureHash):
 *   chapterNumber, canonRevision, baseCanonRevision, the committed
 *   state-delta CONTENT through N, checkpointSchemaVersion, choiceIds,
 *   acceptedChoiceId, and the canon-drift / plot-debt / thread / choice
 *   evaluator inputs plus per-chapter finding CODES.
 *
 * NOT COMPARED, and why:
 *   - `state_delta_hash`: a DB-computed digest over a delta that embeds
 *     story-scoped ids, so it can never match across two different stories by
 *     construction. Its CONTENT is compared instead (the normalized delta). A
 *     separate completion check asserts the digest is present in both modes.
 *   - finding severity/message/evidence, publishedTitle, checkpointStatus and
 *     the blueprint-authority / repetition envelopes: not part of captureHash.
 *     Repetition is a whole-horizon evaluator compared once at run level, and
 *     the remaining fields are provenance/presentation, not canonical state.
 */
export const PARITY_SCOPE: Record<string, unknown> = {
  compared: [
    'canonRevision',
    'baseCanonRevision',
    'committedStateDeltaContent',
    'checkpointSchemaVersion',
    'choiceIds',
    'acceptedChoiceId',
    'canonDriftInput',
    'plotDebtInput',
    'threadInput',
    'choiceInput',
    'perChapterFindingCodes',
  ],
  excluded: [
    { field: 'state_delta_hash', reason: 'story-scoped DB digest; content compared instead, presence asserted separately' },
    { field: 'publishedTitle', reason: 'presentation, not canonical state' },
    { field: 'checkpointStatus', reason: 'provenance, not canonical state' },
    { field: 'finding severity/message/evidence', reason: 'only finding codes are hashed per chapter' },
    { field: 'blueprintAuthority envelope', reason: 'not part of captureHash' },
    { field: 'repetition envelope', reason: 'whole-horizon evaluator compared once at run level' },
  ],
}

export function compareParity(sync: HarnessRunResult, worker: HarnessRunResult): ParityMismatch[] {
  const mismatches: ParityMismatch[] = []
  const workerByChapter = new Map(worker.chapters.map((c) => [c.chapterNumber, c]))
  for (const syncChapter of sync.chapters) {
    const workerChapter = workerByChapter.get(syncChapter.chapterNumber)
    if (!workerChapter || workerChapter.captureHash !== syncChapter.captureHash) {
      mismatches.push({
        chapterNumber: syncChapter.chapterNumber,
        syncCaptureHash: syncChapter.captureHash,
        workerCaptureHash: workerChapter?.captureHash ?? '<missing>',
      })
    }
  }
  return mismatches
}

/** Every chapter must carry a non-empty DB-computed delta digest in BOTH modes. */
export function stateDeltaHashPresentInBoth(sync: HarnessRunResult, worker: HarnessRunResult): boolean {
  const workerByChapter = new Map(worker.chapters.map((c) => [c.chapterNumber, c]))
  return sync.chapters.every((c) => {
    const w = workerByChapter.get(c.chapterNumber)
    return Boolean(c.stateDeltaHash) && Boolean(w?.stateDeltaHash)
  })
}

export interface CompletionCheck {
  code: string
  passed: boolean
  detail: Record<string, unknown>
}

export function checkCompletion(run: HarnessRunResult): CompletionCheck[] {
  return [
    {
      code: 'ALL_50_CHAPTERS_PUBLISHED',
      passed: run.chapters.length === HARNESS_TOTAL_CHAPTERS,
      detail: { published: run.chapters.length, expected: HARNESS_TOTAL_CHAPTERS },
    },
    {
      code: 'CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER',
      // A checkpoint resume must NOT double-advance canon.
      passed: run.finalCanonRevision === HARNESS_TOTAL_CHAPTERS,
      detail: { finalCanonRevision: run.finalCanonRevision, resumedChapters: run.resumedChapters },
    },
    {
      code: 'READER_REACHED_COMPLETION',
      passed: run.readerStatus === 'SELESAI' && run.readerCurrentChapter === HARNESS_TOTAL_CHAPTERS,
      detail: { status: run.readerStatus, currentChapter: run.readerCurrentChapter },
    },
    {
      code: 'ENDING_LOCKED',
      passed: Boolean(run.lockedEndingKey),
      detail: { lockedEndingKey: run.lockedEndingKey },
    },
    {
      code: 'CHECKPOINT_RESUME_EXERCISED',
      passed: run.resumedChapters.length >= DEFAULT_RESUME_PLAN.length,
      detail: { resumedChapters: run.resumedChapters },
    },
    {
      code: 'PROVENANCE_TAMPER_FAILS_CLOSED',
      // B2/B3 semantics:
      //   - state-delta / attempt-id / job-id tamper probes MUST be rejected —
      //     an accepted one is a real fencing gap;
      //   - a sync new-attempt re-entry may legitimately answer EXACT_REPLAY:
      //     the chapter is served from the durable commit ledger, nothing new
      //     is written, and canon double-advance is separately proven false by
      //     CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER. Any other accepted code
      //     fails this check. Worker new-attempt must be rejected outright.
      passed:
        run.fencingEvidence.length > 0
        && run.fencingEvidence.every((e) =>
          e.kind === 'new-attempt-resume' && run.publicationMode === 'sync'
            ? e.rejected || e.observedCode === 'EXACT_REPLAY'
            : e.rejected),
      detail: {
        probes: run.fencingEvidence.length,
        violations: run.fencingEvidence
          .filter((e) => !(e.kind === 'new-attempt-resume' && run.publicationMode === 'sync'
            ? e.rejected || e.observedCode === 'EXACT_REPLAY'
            : e.rejected))
          .map((e) => `${e.kind}@${e.chapterNumber}:${e.observedCode}`),
      },
    },
    {
      code: 'ACT_BOUNDARY_HOOKS_PROVEN',
      // Every configured boundary must have a committed rollup and (where a next
      // act exists) a blueprint version in effect for the next act's first
      // chapter. Missing either is a production side-effect gap.
      passed:
        run.actBoundaries.length === ACT_BOUNDARY_CHAPTERS.filter((c) => c <= HARNESS_TOTAL_CHAPTERS).length
        && run.actBoundaries.every((b) => {
          const hasNextAct = ACT_PLAN.some((a) => a.actNumber === b.actNumber + 1)
          return b.rollupPresent && (!hasNextAct || b.nextActFirstChapterBlueprintVersion !== null)
        }),
      detail: { actBoundaries: run.actBoundaries.map((b) => ({ act: b.actNumber, rollup: b.rollupPresent, nextBlueprint: b.nextActFirstChapterBlueprintVersion })) },
    },
  ]
}

export interface M10CRunOutput {
  manifest: M10ArtifactManifestV1
  summary: Record<string, unknown>
  findings: LongHorizonFindingV1[]
  parityMismatches: ParityMismatch[]
  completion: { sync: CompletionCheck[]; worker: CompletionCheck[] }
  findingsHash: string
  summaryHash: string
}

export async function runM10CHarness(outDir?: string): Promise<M10CRunOutput> {
  const startedAt = new Date().toISOString()
  const { headSha, workingTreeDirty } = headShaOfWorkingTree()

  const syncSpec = buildRunSpec({
    storyFixtureId: HARNESS_FIXTURE_ID,
    routeProfile: 'high-trust',
    publicationMode: 'sync',
    checkpointResumePlan: DEFAULT_RESUME_PLAN,
  })
  const workerSpec = buildRunSpec({
    storyFixtureId: HARNESS_FIXTURE_ID,
    routeProfile: 'high-trust',
    publicationMode: 'worker',
    checkpointResumePlan: DEFAULT_RESUME_PLAN,
  })

  // Sequential on purpose: the two clones share one local Postgres and one
  // generation-capacity slot pool. Parallelism would measure contention.
  const sync = await runHarness({ spec: syncSpec, storyId: SYNC_STORY_ID })
  const worker = await runHarness({ spec: workerSpec, storyId: WORKER_STORY_ID })

  // Branch-fork probe (C.4.5): two isolated canonical snapshots fork on two
  // DIFFERENT legal choices at a mid-story boundary, each run through the next
  // act boundary. Two isolated stories (the ownership model allows one reader
  // per personalized story), snapshot equivalence proven by captureHash parity.
  const fork = await runForkProbe({ forkChapter: 10 })

  const parityMismatches = compareParity(sync, worker)
  const deltaHashPresent = stateDeltaHashPresentInBoth(sync, worker)
  const completion = { sync: checkCompletion(sync), worker: checkCompletion(worker) }

  const findings = sortFindings([...sync.findings, ...worker.findings, ...fork.findings])
  // Merge both clones' capture blockers, deduped by code (M4): the same missing
  // runtime wire appears in both clones and must be reported once.
  const blockers = [...new Map([...sync.blockers, ...worker.blockers].map((b) => [b.code, b])).values()]

  // Blocker gate: only blockers that are still UNRESOLVED (or have no
  // disposition at all) force BLOCKED. After C-R1 (reviewer 2026-08-08), five
  // of the six original blockers are CLOSED by production wiring with capture
  // read-back (blocker-dispositions.ts carries the proof per code); the prompt
  // layers blocker stays RECLASSIFIED to M10-F with reviewer ratification #1.
  // The full disposition table is written into the artifacts as evidence.
  const unresolved = unresolvedBlockers(blockers)

  const failedCompletion = [...completion.sync, ...completion.worker].filter((c) => !c.passed)
  const blockerFindings = findings.filter((f) => f.severity === 'BLOCKER')

  const summary = {
    chapters: HARNESS_TOTAL_CHAPTERS,
    choicePolicyVersion: HARNESS_CHOICE_POLICY_VERSION,
    syncStoryId: sync.storyId,
    workerStoryId: worker.storyId,
    forkStoryIds: [FORK_STORY_A_ID, FORK_STORY_B_ID],
    forkEvidence: fork.evidence,
    parityMismatchCount: parityMismatches.length,
    stateDeltaHashPresentBothModes: deltaHashPresent,
    failedCompletionChecks: failedCompletion.map((c) => c.code),
    blocker: findings.filter((f) => f.severity === 'BLOCKER').length,
    high: findings.filter((f) => f.severity === 'HIGH').length,
    medium: findings.filter((f) => f.severity === 'MEDIUM').length,
    low: findings.filter((f) => f.severity === 'LOW').length,
    info: findings.filter((f) => f.severity === 'INFO').length,
    totalFindings: findings.length,
    captureBlockers: blockers.map((b) => b.code),
    unresolvedCaptureBlockers: unresolved.map((b) => b.code),
    blockerDispositions: BLOCKER_DISPOSITIONS.map((d) => ({
      code: d.code,
      disposition: d.disposition,
      reclassifiedTo: d.reclassifiedTo,
      consequenceFindings: d.consequenceFindings,
      ratifiedByReviewer: d.ratifiedByReviewer,
    })),
    blockerDispositionBasis:
      'C-R2 corrective package (reviewer Entry 6, 2026-08-08): three CLOSED by production wiring + capture read-back (context budget, ending-lock durability on ending-runway 1.3.0 raw rows, act-reconciliation trigger); prompt layers RECLASSIFIED to M10-F (ratification #1) and Bab-49 emotional-resolution RECLASSIFIED to M10-D (Entry 6 BLOCKER 1 veto of the C-R1 beat derivation); ending reachability UNRESOLVED — #6 stays OPEN and the run reports BLOCKED. Proofs in blocker-dispositions.ts.',
  }

  // A capture blocker means an evaluator input has no honest runtime source.
  // The stage cannot claim coverage it does not have, so an UNRESOLVED blocker
  // reports BLOCKED. Proof-backed CLOSED/RECLASSIFIED dispositions are audited
  // via blockers.json — the five closures rest on runtime wires, not removal.
  const result: M10ArtifactManifestV1['result'] =
    unresolved.length > 0
      ? 'BLOCKED'
      : parityMismatches.length === 0 && deltaHashPresent && failedCompletion.length === 0 && blockerFindings.length === 0
        ? 'PASS'
        : 'FAIL'

  const findingsHash = computeFindingsHash(findings)
  const summaryHash = computeSha256(stableStringify(summary))
  const finishedAt = new Date().toISOString()
  const runId = `m10-c-${findingsHash.slice(0, 12)}`

  const manifest: M10ArtifactManifestV1 = {
    schemaVersion: 1,
    stage: 'C',
    baselineSha: C_BASELINE_SHA,
    headSha,
    workingTreeDirty,
    m10aClosureAnchor: M10A_CLOSURE_ANCHOR,
    runId,
    startedAt,
    finishedAt,
    environment: 'isolated-qa',
    storyIds: [sync.storyId, worker.storyId, FORK_STORY_A_ID, FORK_STORY_B_ID],
    routeProfiles: [syncSpec.routeProfile, workerSpec.routeProfile],
    runtimePolicyVersions: {
      personalizedV1: '1.0.0',
      choicePolicy: HARNESS_CHOICE_POLICY_VERSION,
      harnessSpec: syncSpec.schemaVersion,
    },
    evaluatorVersions: EVALUATOR_VERSIONS,
    artifactHashes: { findingsHash, summaryHash },
    result,
  }

  if (outDir) {
    const targetDir = join(outDir, runId)
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'findings.json'), stableStringify(findings))
    writeFileSync(join(targetDir, 'summary.json'), stableStringify(summary))
    writeFileSync(join(targetDir, 'manifest.json'), stableStringify(manifest))
    writeFileSync(
      join(targetDir, 'blockers.json'),
      stableStringify({
        blockers,
        unresolvedCodes: unresolved.map((b) => b.code),
        dispositions: BLOCKER_DISPOSITIONS,
        basis: 'C-R2 (reviewer Entry 6, 2026-08-08): blockers listed are the capture gaps still open; dispositions cover all six codes — three CLOSED by production wiring, two RECLASSIFIED (prompt layers to M10-F, Bab-49 emotional resolution to M10-D after the Entry 6 BLOCKER 1 veto), one UNRESOLVED (ending reachability: EndingCandidateSchema cannot express a secret ending or structured flag blocking, so NCS §1.4 stays unproven and the run reports BLOCKED)',
      }),
    )
    writeFileSync(
      join(targetDir, 'captures.json'),
      stableStringify({ sync: sync.chapters, worker: worker.chapters }),
    )
    writeFileSync(
      join(targetDir, 'parity.json'),
      stableStringify({
        scope: PARITY_SCOPE,
        stateDeltaHashPresentBothModes: deltaHashPresent,
        mismatches: parityMismatches,
        completion,
      }),
    )
    writeFileSync(
      join(targetDir, 'fork.json'),
      stableStringify(fork.evidence),
    )
    writeFileSync(
      join(targetDir, 'fencing.json'),
      stableStringify({ sync: sync.fencingEvidence, worker: worker.fencingEvidence }),
    )
    writeFileSync(
      join(targetDir, 'act-boundaries.json'),
      stableStringify({ sync: sync.actBoundaries, worker: worker.actBoundaries }),
    )
    console.log(`Artifacts written to ${targetDir}`)
  }

  return { manifest, summary, findings, parityMismatches, completion, findingsHash, summaryHash }
}

export async function runM10CCli(): Promise<number> {
  const artifactsDir = join(process.cwd(), '.zcode', 'artifacts', 'm10-c')
  const run = await runM10CHarness(artifactsDir)

  console.log('M10-C Long-Horizon Harness Summary:')
  console.log(`  Result: ${run.manifest.result}`)
  console.log(`  Chapters: ${HARNESS_TOTAL_CHAPTERS} (sync + worker)`)
  console.log(`  Parity mismatches: ${run.parityMismatches.length}`)
  console.log(`  Total findings: ${run.findings.length}`)
  console.log(`  Findings hash: ${run.findingsHash}`)

  for (const mismatch of run.parityMismatches) {
    console.error(
      `    parity mismatch Bab ${mismatch.chapterNumber}: sync=${mismatch.syncCaptureHash} worker=${mismatch.workerCaptureHash}`,
    )
  }
  for (const check of [...run.completion.sync, ...run.completion.worker].filter((c) => !c.passed)) {
    console.error(`    completion FAILED ${check.code}: ${stableStringify(check.detail)}`)
  }
  const captureBlockers = (run.summary.captureBlockers ?? []) as string[]
  const unresolvedCodes = new Set((run.summary.unresolvedCaptureBlockers ?? []) as string[])
  const dispositionByCode = new Map(
    ((run.summary.blockerDispositions ?? []) as Array<{ code: string; disposition: string }>)
      .map((d) => [d.code, d.disposition]),
  )
  for (const code of captureBlockers) {
    const disposition = dispositionByCode.get(code) ?? 'UNRESOLVED'
    const marker = unresolvedCodes.has(code) ? 'UNRESOLVED — run stays BLOCKED' : `${disposition} (proof in blockers.json)`
    console.error(`    CAPTURE BLOCKER: ${code} :: ${marker}`)
  }
  if (run.manifest.result === 'PASS' && captureBlockers.length > 0) {
    console.error(
      '    NOTE: PASS rests on proof-backed blocker reclassifications that are pending reviewer ratification; '
      + 'without them the honest result is BLOCKED. See blockers.json.',
    )
  }

  return run.manifest.result === 'PASS' ? 0 : 1
}
