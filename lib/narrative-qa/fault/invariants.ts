/**
 * M10-E — post-fault DB invariant checker (plan E.5).
 *
 * After ANY injected failure (and after its recovery), the isolated story must
 * satisfy the recovery invariants. Every check reads the real local DB through
 * the admin client — nothing is assumed, nothing is mocked. A single failed
 * invariant marks the scenario failed; the checker never "fixes" state.
 *
 * Invariants (plan E.5 mapping):
 *   INV_CHAPTERS_COUNT            — no double publish / no lost chapter
 *   INV_COMMITS_COUNT             — commit ledger 1:1 with published chapters
 *   INV_ONE_COMMIT_PER_CHAPTER    — no double canon increment
 *   INV_CANON_REVISION            — revision == published chapter count
 *   INV_NO_STATE_BEYOND_CANON     — no partial state rows past the canon
 *   INV_NO_PUBLISHED_CP_BEYOND    — no checkpoint past canon in PUBLISHED
 *   INV_NO_SUCCEEDED_JOB_BEYOND   — no worker job past canon in SUCCEEDED
 *   INV_READER_CONSISTENT         — reader position/status matches the canon
 *   INV_ENDING_LOCK_AT_50         — ending locked when the horizon completes
 */

import { createAdminClient } from '../../supabase/admin'
import { HARNESS_TOTAL_CHAPTERS } from '../harness/fixture'

type Admin = ReturnType<typeof createAdminClient>

export interface InvariantCheckResultV1 {
  code: string
  passed: boolean
  detail: Record<string, unknown>
}

/**
 * Scenario-declared adjustments the checker must honor. They exist because a
 * fault scenario may legitimately leave HARNESS-INJECTED rows in place at the
 * moment the check runs (e.g. a torn-transaction residue row that IS the
 * fault), and because production positions the reader one chapter ahead once
 * the choice for the last published chapter is accepted. Every adjustment is
 * declared by the scenario, recorded in evidence, and never inferred.
 */
export interface InvariantCheckOptionsV1 {
  /** Rows in `chapters` injected by the scenario itself (fault residue). */
  knownExtraChapterRows?: number
}

/**
 * Checks the full invariant set for a harness story whose canon is expected to
 * be exactly `expectedChapter` published chapters (revision == count).
 */
export async function checkPostFaultInvariants(
  admin: Admin,
  storyId: string,
  userId: string,
  expectedChapter: number,
  options: InvariantCheckOptionsV1 = {},
): Promise<InvariantCheckResultV1[]> {
  const results: InvariantCheckResultV1[] = []
  const extraChapterRows = options.knownExtraChapterRows ?? 0

  // ---- INV_CHAPTERS_COUNT ----
  {
    const { count, error } = await admin
      .from('chapters')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', storyId)
    results.push({
      code: 'INV_CHAPTERS_COUNT',
      passed: !error && (count ?? -1) === expectedChapter + extraChapterRows,
      detail: {
        expected: expectedChapter,
        knownExtraChapterRows: extraChapterRows,
        observed: count ?? null,
        error: error?.message ?? null,
      },
    })
  }

  // ---- INV_COMMITS_COUNT ----
  {
    const { count, error } = await admin
      .from('chapter_state_commits')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', storyId)
    results.push({
      code: 'INV_COMMITS_COUNT',
      passed: !error && (count ?? -1) === expectedChapter,
      detail: { expected: expectedChapter, observed: count ?? null, error: error?.message ?? null },
    })
  }

  // ---- INV_ONE_COMMIT_PER_CHAPTER ----
  {
    const { data, error } = await admin
      .from('chapter_state_commits')
      .select('chapter_number')
      .eq('story_id', storyId)
    const numbers = Array.isArray(data)
      ? (data as Array<{ chapter_number: number }>).map((r) => Number(r.chapter_number))
      : []
    const distinct = new Set(numbers)
    const duplicates = numbers.length - distinct.size
    results.push({
      code: 'INV_ONE_COMMIT_PER_CHAPTER',
      passed: !error && duplicates === 0 && numbers.length === expectedChapter,
      detail: { rows: numbers.length, distinctChapters: distinct.size, duplicates, error: error?.message ?? null },
    })
  }

  // ---- INV_CANON_REVISION ----
  {
    const { data, error } = await admin
      .from('stories')
      .select('canon_state_revision')
      .eq('id', storyId)
      .maybeSingle()
    const revision = Number((data as { canon_state_revision?: number } | null)?.canon_state_revision ?? -1)
    results.push({
      code: 'INV_CANON_REVISION',
      passed: !error && revision === expectedChapter,
      detail: { expected: expectedChapter, observed: revision, error: error?.message ?? null },
    })
  }

  // ---- INV_NO_STATE_BEYOND_CANON ----
  // Any canon-state row whose chapter stamp is past the published horizon is
  // partial state from an interrupted publication — it must not exist.
  {
    const probes: Array<{ table: string; column: string; scope: 'story' | 'character' }> = [
      { table: 'character_states', column: 'as_of_chapter', scope: 'character' },
      { table: 'facts_ledger', column: 'established_chapter', scope: 'story' },
      { table: 'timeline_events', column: 'chapter_number', scope: 'story' },
      { table: 'knowledge_scopes', column: 'known_from_chapter', scope: 'story' },
      { table: 'choice_outcomes', column: 'chapter_number', scope: 'story' },
      { table: 'story_threads', column: 'opened_chapter', scope: 'story' },
      { table: 'story_threads', column: 'last_touched_chapter', scope: 'story' },
    ]
    let violations = 0
    const perTable: Record<string, number> = {}
    let probeError: string | null = null
    for (const probe of probes) {
      let query = admin.from(probe.table).select('*', { count: 'exact', head: true })
      query = probe.scope === 'story'
        ? query.eq('story_id', storyId)
        : query.like('character_id', `${storyId}:%`)
      const { count, error } = await query.gt(probe.column, expectedChapter)
      if (error) {
        probeError = `${probe.table}: ${error.message}`
        break
      }
      const n = count ?? 0
      perTable[`${probe.table}.${probe.column}`] = n
      violations += n
    }
    // Revealed secrets past their gate chapter count as beyond-canon state too.
    if (!probeError) {
      const { count, error } = await admin
        .from('secrets_reveals')
        .select('*', { count: 'exact', head: true })
        .eq('story_id', storyId)
        .eq('revealed', true)
        .gt('reveal_gate_chapter', expectedChapter)
      if (error) probeError = `secrets_reveals: ${error.message}`
      else {
        perTable['secrets_reveals.revealed_beyond_gate'] = count ?? 0
        violations += count ?? 0
      }
    }
    results.push({
      code: 'INV_NO_STATE_BEYOND_CANON',
      passed: !probeError && violations === 0,
      detail: { violations, perTable, horizon: expectedChapter, error: probeError },
    })
  }

  // ---- INV_NO_PUBLISHED_CP_BEYOND ----
  // A PROSE_READY checkpoint one ahead of the canon is legitimate crash
  // evidence (that is what crash recovery resumes from). A PUBLISHED checkpoint
  // past the canon would mean publication without commit — never allowed.
  {
    const { count, error } = await admin
      .from('chapter_generation_checkpoints')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', storyId)
      .eq('status', 'PUBLISHED')
      .gt('chapter_number', expectedChapter)
    results.push({
      code: 'INV_NO_PUBLISHED_CP_BEYOND',
      passed: !error && (count ?? -1) === 0,
      detail: { observed: count ?? null, horizon: expectedChapter, error: error?.message ?? null },
    })
  }

  // ---- INV_NO_SUCCEEDED_JOB_BEYOND ----
  {
    const { count, error } = await admin
      .from('generation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', storyId)
      .eq('status', 'SUCCEEDED')
      .gt('chapter_number', expectedChapter)
    results.push({
      code: 'INV_NO_SUCCEEDED_JOB_BEYOND',
      passed: !error && (count ?? -1) === 0,
      detail: { observed: count ?? null, horizon: expectedChapter, error: error?.message ?? null },
    })
  }

  // ---- INV_READER_CONSISTENT ----
  // Production positions the reader at `current_chapter = N` when Bab N
  // publishes, and at `N + 1` once the choice for Bab N is accepted (the
  // reader is standing on the next chapter, waiting to read it). A position of
  // canon + 1 is therefore only legitimate when the choice for the last
  // published chapter was actually accepted — otherwise it is corruption.
  {
    const { data, error } = await admin
      .from('reader_states')
      .select('current_chapter,status,locked_ending_key,choice_history')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .maybeSingle()
    const row = data as {
      current_chapter: number
      status: string
      locked_ending_key: string | null
      choice_history?: unknown[]
    } | null
    const atTerminal = expectedChapter >= HARNESS_TOTAL_CHAPTERS
    const expectedStatus = atTerminal ? 'SELESAI' : 'BERJALAN'
    const history = Array.isArray(row?.choice_history)
      ? (row?.choice_history as Array<Record<string, unknown>> ?? [])
      : []
    const choiceAcceptedFor = (chapter: number): boolean => history.some(
      (h) => Number(h.chapter ?? h.chapterNumber) === chapter,
    )
    const positionOk = row != null
      && (atTerminal
        ? row.current_chapter === expectedChapter
        : row.current_chapter === expectedChapter
          || (row.current_chapter === expectedChapter + 1 && choiceAcceptedFor(expectedChapter)))
    const passed = !error && positionOk && row?.status === expectedStatus
    results.push({
      code: 'INV_READER_CONSISTENT',
      passed,
      detail: {
        expectedChapter,
        expectedStatus,
        choiceAcceptedForExpected: choiceAcceptedFor(expectedChapter),
        observed: row ? { ...row, choice_history: history.length } : null,
        error: error?.message ?? null,
      },
    })
  }

  // ---- INV_ENDING_LOCK_AT_50 ----
  {
    if (expectedChapter < HARNESS_TOTAL_CHAPTERS) {
      results.push({
        code: 'INV_ENDING_LOCK_AT_50',
        passed: true,
        detail: { skipped: true, reason: `horizon ${expectedChapter} < ${HARNESS_TOTAL_CHAPTERS}` },
      })
    } else {
      const { data, error } = await admin
        .from('reader_states')
        .select('locked_ending_key,ending_name')
        .eq('user_id', userId)
        .eq('story_id', storyId)
        .maybeSingle()
      const row = data as { locked_ending_key: string | null; ending_name: string | null } | null
      results.push({
        code: 'INV_ENDING_LOCK_AT_50',
        passed: !error && row != null && row.locked_ending_key != null && row.ending_name != null,
        detail: { observed: row ?? null, error: error?.message ?? null },
      })
    }
  }

  return results
}

export function allInvariantsPassed(results: InvariantCheckResultV1[]): boolean {
  return results.every((r) => r.passed)
}
