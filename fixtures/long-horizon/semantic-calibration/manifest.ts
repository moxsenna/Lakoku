import {
  D1_EXPECTED_EVALUATION_CASE_COUNT,
  D1_EXPECTED_ROW_COUNT,
  D1_PARTITIONS,
  D1_PARTITION_UNIVERSE,
  D1_ROWS_PER_RUBRIC_PARTITION,
  D1_RUBRICS,
  D1_RUBRIC_CASE_SPECS,
  D1_RUBRIC_CHAPTERS,
  D1_RUBRIC_REVIEW_STATE,
  D1_TIERS,
  D1_TIER_COUNTS,
  D1_UNIVERSE_IDS,
  type D1CorpusFixture,
  type D1EvaluationCase,
  type D1Partition,
  type D1RubricId,
  type D1RubricRow,
  type D1Tier,
  type D1UniverseId,
} from './corpus'
import { D1_AUTHORED_BANKS, D1_UNIVERSE_CONTEXT } from './contexts'
import {
  D1_CONTROLLED_MUTATIONS,
  d1FixtureFamilyId,
} from './mutation-map'
import {
  SemanticCorpusManifestSchema,
  SemanticCorpusRubricRowSchema,
  SemanticEvaluationCaseSchema,
} from '../../../lib/narrative-qa/contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../../../lib/narrative-qa/scoring/canonical-serializer'

/**
 * Independent freeze anchor. This literal is the authority; the computed hash
 * must equal it, so the manifest can never silently re-freeze itself.
 */
export const D1_EXPECTED_MANIFEST_SHA256 = 'fcfb6bbf07e36ecbb8781725af814abbd13f35aade1ffbe3c1b3d72174ef2185'

export { D1_CONTROLLED_MUTATIONS } from './mutation-map'

const TIER_ORDINAL_LABEL: Readonly<Record<D1Tier, string>> = {
  STRONG: 'a',
  WEAK: 'b',
  BORDERLINE: 'c',
}

/** Canonical fixture content covers reader prose and structural context. */
export function canonicalFixtureContent(
  fixture: Pick<D1CorpusFixture, 'chapters' | 'structuralContext'>,
): string {
  return stableStringify({ chapters: fixture.chapters, structuralContext: fixture.structuralContext })
}

export function computeFixtureContentHash(
  fixture: Pick<D1CorpusFixture, 'chapters' | 'structuralContext'>,
): string {
  return computeSha256(canonicalFixtureContent(fixture))
}

/** Per-chapter hash so a full-chapter surface can be proven byte-for-byte. */
export function computeChapterHashes(
  chapters: D1CorpusFixture['chapters'],
): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const chapter of chapters) {
    hashes[String(chapter.chapterNumber)] = computeSha256(chapter.paragraphs.join('\n\n'))
  }
  return hashes
}

function selectAuthoredEntry(universeId: D1UniverseId, rubricId: D1RubricId, tier: D1Tier, ordinal: number) {
  const bank = D1_AUTHORED_BANKS[universeId]?.[rubricId]
  if (!bank) throw new Error(`Missing authored bank for ${universeId}/${rubricId}.`)
  const entry = bank[tier][ordinal]
  if (!entry) throw new Error(`Missing authored ${tier} fixture ${ordinal} for ${universeId}/${rubricId}.`)
  return entry
}

function makeRow(
  rubricId: D1RubricId,
  partition: D1Partition,
  tier: D1Tier,
  index: number,
): D1RubricRow {
  const universeId = D1_PARTITION_UNIVERSE[partition]
  const authored = selectAuthoredEntry(universeId, rubricId, tier, index)
  // Identity is universe-scoped. No id encodes the partition, so no id can
  // self-prove isolation; isolation is proven by content and universe.
  const key = `${universeId}-${rubricId.toLowerCase()}-${TIER_ORDINAL_LABEL[tier]}${index + 1}`
  const universeContext = D1_UNIVERSE_CONTEXT[universeId]
  const fixtureId = `d1-fixture-${key}`
  const fixtureWithoutHash = {
    fixtureId,
    universeId,
    fixtureFamilyId: d1FixtureFamilyId(fixtureId),
    lineageId: `d1-lineage-${universeId}-${rubricId.toLowerCase()}`,
    mutationSiblingId: `d1-sibling-${key}`,
    // Mutation metadata comes only from the ratified exact-fixture registry.
    // Fixtures absent from it remain independent one-fixture families.
    ...(D1_CONTROLLED_MUTATIONS[fixtureId]
      ? { mutationRelation: D1_CONTROLLED_MUTATIONS[fixtureId] }
      : {}),
    partition,
    provenance: 'human-authored' as const,
    chapters: authored.chapters,
    structuralContext: {
      storyPromise: universeContext.storyPromise,
      mainConflict: universeContext.mainConflict,
      finalDramaticQuestion: universeContext.finalDramaticQuestion,
      actPosition: rubricId === 'D-R7' || rubricId === 'D-R8' ? 'penutupan Bab 41-50' : 'tekanan pertengahan cerita',
      activeThreadSummaries: universeContext.activeThreadSummaries,
      resolvedThreadSummaries: universeContext.resolvedThreadSummaries,
      payoffSchedule: universeContext.payoffSchedule,
      lockedEndingKey: universeContext.lockedEndingKey,
    },
  }
  const fixture: D1CorpusFixture = {
    ...fixtureWithoutHash,
    contentHash: computeFixtureContentHash(fixtureWithoutHash),
    chapterHashes: computeChapterHashes(authored.chapters),
  }
  return {
    rowId: `d1-row-${key}`,
    rubricId,
    partition,
    universeId,
    tier,
    fixture,
    // Read from the rubric review-state authority. Authoring code never decides
    // that a row has been reviewed.
    reviewState: D1_RUBRIC_REVIEW_STATE[rubricId],
    justification: authored.justification,
  }
}

/** Frozen deterministic list: 8 rubrics × 2 partitions × (5 strong + 5 weak + 3 borderline). */
export const D1_RUBRIC_ROWS: readonly D1RubricRow[] = Object.freeze(
  D1_PARTITIONS.flatMap((partition) => D1_RUBRICS.flatMap((rubricId) =>
    D1_TIERS.flatMap((tier) => Array.from(
      { length: D1_TIER_COUNTS[tier] },
      (_, index) => makeRow(rubricId, partition, tier, index),
    )),
  )),
)

/**
 * Frozen evaluation cases. D2 call ceiling is `evaluationCases.length × k`.
 * Adding a case after scores exist is forbidden.
 */
export const D1_EVALUATION_CASES: readonly D1EvaluationCase[] = Object.freeze(
  D1_RUBRIC_ROWS.flatMap((row) => D1_RUBRIC_CASE_SPECS[row.rubricId].map((spec): D1EvaluationCase => ({
    caseId: `${row.rowId}-${spec.caseSuffix}`,
    rowId: row.rowId,
    fixtureId: row.fixture.fixtureId,
    rubricId: row.rubricId,
    view: spec.view,
    horizonKind: spec.horizonKind,
    coverage: spec.coverage,
  }))),
)

function parseD1Rows(rows: readonly D1RubricRow[]): void {
  for (const row of rows) SemanticCorpusRubricRowSchema.parse(row)
}

export function computeD1ManifestHash(
  rows: readonly D1RubricRow[],
  evaluationCases: readonly D1EvaluationCase[],
): string {
  parseD1Rows(rows)
  for (const evaluationCase of evaluationCases) SemanticEvaluationCaseSchema.parse(evaluationCase)
  return computeSha256(stableStringify({
    rows: rows.map((row) => ({
      rowId: row.rowId,
      rubricId: row.rubricId,
      partition: row.partition,
      universeId: row.universeId,
      tier: row.tier,
      reviewState: row.reviewState,
      justification: row.justification,
      fixtureId: row.fixture.fixtureId,
      fixtureFamilyId: row.fixture.fixtureFamilyId,
      lineageId: row.fixture.lineageId,
      mutationSiblingId: row.fixture.mutationSiblingId,
      mutationRelation: row.fixture.mutationRelation,
      contentHash: row.fixture.contentHash,
      chapterHashes: row.fixture.chapterHashes,
    })),
    evaluationCases,
  }))
}

export interface D1Manifest {
  schemaVersion: 2
  corpusId: 'M10-D1-semantic-calibration-v1'
  provenance: 'frozen human-authored fixture corpus'
  manifestHash: string
  review: {
    status: 'RATIFIED'
    corpusCommit: 'a3dc2cd'
  }
  rows: readonly D1RubricRow[]
  evaluationCases: readonly D1EvaluationCase[]
}

export const D1_MANIFEST: D1Manifest = Object.freeze({
  schemaVersion: 2,
  corpusId: 'M10-D1-semantic-calibration-v1',
  provenance: 'frozen human-authored fixture corpus',
  manifestHash: computeD1ManifestHash(D1_RUBRIC_ROWS, D1_EVALUATION_CASES),
  review: Object.freeze({ status: 'RATIFIED', corpusCommit: 'a3dc2cd' }),
  rows: D1_RUBRIC_ROWS,
  evaluationCases: D1_EVALUATION_CASES,
})

export function assertD1Manifest(manifest: D1Manifest = D1_MANIFEST): void {
  SemanticCorpusManifestSchema.parse(manifest)
  if (manifest.manifestHash !== computeD1ManifestHash(manifest.rows, manifest.evaluationCases)) {
    throw new Error('Frozen manifestHash does not match registered labels, fixture hashes, and evaluation cases.')
  }
  if (manifest === D1_MANIFEST && manifest.manifestHash !== D1_EXPECTED_MANIFEST_SHA256) {
    throw new Error(`D1 manifest drifted from frozen anchor: computed ${manifest.manifestHash}.`)
  }
}

export function d1MatrixCount(
  rubricId: D1RubricId,
  partition: D1Partition,
  tier: D1Tier,
): number {
  parseD1Rows(D1_RUBRIC_ROWS)
  return D1_RUBRIC_ROWS.filter((row) => row.rubricId === rubricId && row.partition === partition && row.tier === tier).length
}

const PARTITION_TOKEN_PATTERN = /calibration|holdout|validation/i

export function assertD1CorpusIsolation(rows: readonly D1RubricRow[]): void {
  parseD1Rows(rows)
  for (const field of ['fixtureId', 'fixtureFamilyId', 'lineageId', 'mutationSiblingId'] as const) {
    if (rows.some((row) => PARTITION_TOKEN_PATTERN.test(row.fixture[field]))) {
      throw new Error(`Semantic ${field} must not encode a partition token.`)
    }
    const left = new Set(rows.filter((row) => row.partition === 'CALIBRATION').map((row) => row.fixture[field]))
    const right = new Set(rows.filter((row) => row.partition === 'VALIDATION_HOLDOUT').map((row) => row.fixture[field]))
    if ([...left].some((identity) => right.has(identity))) {
      throw new Error(`Cross-partition ${field} is forbidden.`)
    }
  }
  if (rows.some((row) => PARTITION_TOKEN_PATTERN.test(row.rowId))) {
    throw new Error('rowId must not encode a partition token.')
  }
  const universes = new Map<D1Partition, Set<D1UniverseId>>()
  for (const row of rows) {
    const seen = universes.get(row.partition) ?? new Set<D1UniverseId>()
    seen.add(row.universeId)
    universes.set(row.partition, seen)
  }
  const calibrationUniverses = universes.get('CALIBRATION') ?? new Set<D1UniverseId>()
  const holdoutUniverses = universes.get('VALIDATION_HOLDOUT') ?? new Set<D1UniverseId>()
  if ([...calibrationUniverses].some((universeId) => holdoutUniverses.has(universeId))) {
    throw new Error('Cross-partition universeId is forbidden.')
  }
  const calibrationHashes = new Set(rows.filter((row) => row.partition === 'CALIBRATION').map((row) => row.fixture.contentHash))
  const holdoutHashes = new Set(rows.filter((row) => row.partition === 'VALIDATION_HOLDOUT').map((row) => row.fixture.contentHash))
  if ([...calibrationHashes].some((contentHash) => holdoutHashes.has(contentHash))) {
    throw new Error('Cross-partition contentHash is forbidden.')
  }
}

/**
 * Controlled-mutation fence. A declared relation is only legal as an
 * intra-partition, intra-universe, intra-family, one-axis variant. A relation
 * that crosses CALIBRATION and VALIDATION_HOLDOUT is always rejected, so no
 * holdout row can inherit a calibration spine through lineage.
 */
export function assertD1ControlledMutations(rows: readonly D1RubricRow[] = D1_RUBRIC_ROWS): void {
  parseD1Rows(rows)
  const rowsByFixtureId = new Map(rows.map((row) => [row.fixture.fixtureId, row]))
  for (const row of rows) {
    const relation = row.fixture.mutationRelation
    if (!relation) continue
    if (relation.baseFixtureId === row.fixture.fixtureId) {
      throw new Error(`Controlled mutation must not reference itself: ${row.fixture.fixtureId}.`)
    }
    const base = rowsByFixtureId.get(relation.baseFixtureId)
    if (!base) {
      throw new Error(`Controlled mutation base is not a registered fixture: ${relation.baseFixtureId}.`)
    }
    if (base.partition !== row.partition) {
      throw new Error(`Controlled mutation must stay intra-partition: ${row.fixture.fixtureId}.`)
    }
    if (base.universeId !== row.universeId) {
      throw new Error(`Controlled mutation must stay inside one universe: ${row.fixture.fixtureId}.`)
    }
    if (base.fixture.fixtureFamilyId !== row.fixture.fixtureFamilyId) {
      throw new Error(`Controlled mutation must stay inside one family: ${row.fixture.fixtureId}.`)
    }
    if (base.rubricId !== row.rubricId) {
      throw new Error(`Controlled mutation must stay inside one rubric: ${row.fixture.fixtureId}.`)
    }
    if (base.fixture.mutationRelation) {
      throw new Error(`Controlled mutation base must itself be a base: ${relation.baseFixtureId}.`)
    }
  }
  const rowsByFamily = new Map<string, D1RubricRow[]>()
  for (const row of rows) {
    const family = rowsByFamily.get(row.fixture.fixtureFamilyId) ?? []
    family.push(row)
    rowsByFamily.set(row.fixture.fixtureFamilyId, family)
  }
  for (const family of rowsByFamily.values()) {
    if (family.length === 1) {
      if (family[0]!.fixture.mutationRelation) throw new Error('Controlled mutation member cannot occupy an independent family.')
      continue
    }
    const bases = family.filter((row) => !row.fixture.mutationRelation)
    if (bases.length !== 1) throw new Error(`Controlled mutation family must have exactly one base: ${family[0]!.fixture.fixtureFamilyId}.`)
    if (family.some((row) => row !== bases[0] && row.fixture.mutationRelation?.baseFixtureId !== bases[0]!.fixture.fixtureId)) {
      throw new Error(`Controlled mutation members must point directly to family base: ${family[0]!.fixture.fixtureFamilyId}.`)
    }
  }
  // Registered entries must correspond to real fixtures, so a stale key cannot
  // silently stop being enforced.
  for (const fixtureId of Object.keys(D1_CONTROLLED_MUTATIONS)) {
    if (!rowsByFixtureId.get(fixtureId)?.fixture.mutationRelation) {
      throw new Error(`Registered controlled mutation was not applied: ${fixtureId}.`)
    }
  }
}

export function assertD1EvaluationCases(
  rows: readonly D1RubricRow[] = D1_RUBRIC_ROWS,
  evaluationCases: readonly D1EvaluationCase[] = D1_EVALUATION_CASES,
): void {
  for (const evaluationCase of evaluationCases) SemanticEvaluationCaseSchema.parse(evaluationCase)
  if (evaluationCases.length !== D1_EXPECTED_EVALUATION_CASE_COUNT) {
    throw new Error(`Expected ${D1_EXPECTED_EVALUATION_CASE_COUNT} frozen evaluation cases.`)
  }
  const caseIds = evaluationCases.map((evaluationCase) => evaluationCase.caseId)
  if (new Set(caseIds).size !== caseIds.length) throw new Error('Duplicate evaluation caseId.')
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  for (const evaluationCase of evaluationCases) {
    const row = rowsById.get(evaluationCase.rowId)
    if (!row) throw new Error(`Evaluation case references unknown row: ${evaluationCase.rowId}.`)
    if (row.rubricId !== evaluationCase.rubricId || row.fixture.fixtureId !== evaluationCase.fixtureId) {
      throw new Error(`Evaluation case identity mismatch: ${evaluationCase.caseId}.`)
    }
    const covered = evaluationCase.coverage.mode === 'CONTIGUOUS'
      ? Array.from(
        { length: evaluationCase.coverage.toChapter - evaluationCase.coverage.fromChapter + 1 },
        (_, index) => evaluationCase.coverage.mode === 'CONTIGUOUS' ? evaluationCase.coverage.fromChapter + index : 0,
      )
      : [...evaluationCase.coverage.chapterNumbers]
    const authored = new Set(row.fixture.chapters.map((chapter) => chapter.chapterNumber))
    if (covered.some((chapterNumber) => !authored.has(chapterNumber))) {
      throw new Error(`Evaluation case ${evaluationCase.caseId} covers chapters the fixture does not author.`)
    }
  }
}

export function assertD1CorpusMatrix(rows: readonly D1RubricRow[] = D1_RUBRIC_ROWS): void {
  parseD1Rows(rows)
  if (rows.length !== D1_EXPECTED_ROW_COUNT) throw new Error(`Expected ${D1_EXPECTED_ROW_COUNT} D1 rows.`)
  for (const rubricId of D1_RUBRICS) for (const partition of D1_PARTITIONS) {
    if (rows.filter((row) => row.rubricId === rubricId && row.partition === partition).length !== D1_ROWS_PER_RUBRIC_PARTITION) {
      throw new Error(`Expected ${D1_ROWS_PER_RUBRIC_PARTITION} rows for ${rubricId}/${partition}.`)
    }
    for (const tier of D1_TIERS) if (rows.filter((row) => row.rubricId === rubricId && row.partition === partition && row.tier === tier).length !== D1_TIER_COUNTS[tier]) {
      throw new Error(`Invalid ${tier} count for ${rubricId}/${partition}.`)
    }
  }
  const fixtureIds = rows.map((row) => row.fixture.fixtureId)
  if (new Set(fixtureIds).size !== fixtureIds.length) throw new Error('Duplicate fixtureId.')
  for (const row of rows) {
    if (row.fixture.contentHash !== computeFixtureContentHash(row.fixture)) {
      throw new Error(`Frozen contentHash does not match canonical fixture content: ${row.fixture.fixtureId}.`)
    }
    const chapterHashes = computeChapterHashes(row.fixture.chapters)
    if (stableStringify(row.fixture.chapterHashes) !== stableStringify(chapterHashes)) {
      throw new Error(`Frozen chapterHashes do not match authored chapters: ${row.fixture.fixtureId}.`)
    }
    const authoredChapters = row.fixture.chapters.map((chapter) => chapter.chapterNumber)
    const requiredChapters = D1_RUBRIC_CHAPTERS[row.rubricId]
    if (stableStringify(authoredChapters) !== stableStringify(requiredChapters)) {
      throw new Error(`Fixture ${row.fixture.fixtureId} must author chapters ${requiredChapters.join(', ')}.`)
    }
  }
  if (new Set(rows.map((row) => row.fixture.contentHash)).size !== rows.length) throw new Error('Duplicate canonical fixture content.')
  // Review state must equal the declared rubric authority, so a row can never
  // claim a state its rubric was not granted. A rubric under an open wave is
  // legitimately PENDING_REVIEW here; assembly is what refuses to execute it.
  if (rows.some((row) => row.reviewState !== D1_RUBRIC_REVIEW_STATE[row.rubricId])) {
    throw new Error('Every D1 row must carry the review state declared for its rubric.')
  }
  if (rows.some((row) => row.justification.length === 0)) {
    throw new Error('Every D1 row needs a written justification.')
  }
  if (new Set(rows.map((row) => row.universeId)).size !== D1_UNIVERSE_IDS.length) {
    throw new Error('Both authored universes must be represented.')
  }
  assertD1CorpusIsolation(rows)
  assertD1ControlledMutations(rows)
}

assertD1CorpusMatrix()
assertD1EvaluationCases()
assertD1Manifest()
