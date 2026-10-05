/**
 * M10-E — post-fault DB invariant checker (plan E.5).
 *
 * After ANY injected failure (and after its recovery), the isolated story must
 * satisfy the recovery invariants. Every check reads the real local DB through
 * Kysely query builders — nothing is assumed, nothing is mocked. A single failed
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

import { getDb, countOf, result, single } from '@lakoku/db'
import { HARNESS_TOTAL_CHAPTERS } from '../harness/fixture'

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
  _admin: unknown,
  storyId: string,
  userId: string,
  expectedChapter: number,
  options: InvariantCheckOptionsV1 = {},
): Promise<InvariantCheckResultV1[]> {
  const db = getDb()
  const results: InvariantCheckResultV1[] = []
  const extraChapterRows = options.knownExtraChapterRows ?? 0

  // ---- INV_CHAPTERS_COUNT ----
  {
    // RLS_AUDIT(chapters): SERVICE_ROLE_BYPASS - invariant check chapters count
    const { data: count, error } = await result(
      countOf(
        db
          .selectFrom('chapters')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('story_id', '=', storyId)
          .execute()
      )
    )
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
    // RLS_AUDIT(chapter_state_commits): SERVICE_ROLE_BYPASS - invariant check commits count
    const { data: count, error } = await result(
      countOf(
        db
          .selectFrom('chapter_state_commits')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('story_id', '=', storyId)
          .execute()
      )
    )
    results.push({
      code: 'INV_COMMITS_COUNT',
      passed: !error && (count ?? -1) === expectedChapter,
      detail: { expected: expectedChapter, observed: count ?? null, error: error?.message ?? null },
    })
  }

  // ---- INV_ONE_COMMIT_PER_CHAPTER ----
  {
    // RLS_AUDIT(chapter_state_commits): SERVICE_ROLE_BYPASS - invariant check commit numbers
    const { data, error } = await result(
      db
        .selectFrom('chapter_state_commits')
        .select('chapter_number')
        .where('story_id', '=', storyId)
        .execute()
    )
    const numbers = Array.isArray(data)
      ? data.map((r) => Number(r.chapter_number))
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
    // RLS_AUDIT(stories): SERVICE_ROLE_BYPASS - invariant check canon revision
    const { data, error } = await single(
      db
        .selectFrom('stories')
        .select('canon_state_revision')
        .where('id', '=', storyId)
        .execute()
    )
    const revision = Number(data?.canon_state_revision ?? -1)
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
    const probeFns: Array<() => Promise<{ key: string; count: number; error: string | null }>> = [
      async () => {
        // RLS_AUDIT(character_states): SERVICE_ROLE_BYPASS - invariant check beyond canon
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('character_states')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('character_id', 'like', `${storyId}:%`)
              .where('as_of_chapter', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'character_states.as_of_chapter', count: data ?? 0, error: error?.message ?? null }
      },
      async () => {
        // RLS_AUDIT(facts_ledger): SERVICE_ROLE_BYPASS - invariant check beyond canon
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('facts_ledger')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('story_id', '=', storyId)
              .where('established_chapter', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'facts_ledger.established_chapter', count: data ?? 0, error: error?.message ?? null }
      },
      async () => {
        // RLS_AUDIT(timeline_events): SERVICE_ROLE_BYPASS - invariant check beyond canon
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('timeline_events')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('story_id', '=', storyId)
              .where('chapter_number', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'timeline_events.chapter_number', count: data ?? 0, error: error?.message ?? null }
      },
      async () => {
        // RLS_AUDIT(knowledge_scopes): SERVICE_ROLE_BYPASS - invariant check beyond canon
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('knowledge_scopes')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('story_id', '=', storyId)
              .where('known_from_chapter', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'knowledge_scopes.known_from_chapter', count: data ?? 0, error: error?.message ?? null }
      },
      async () => {
        // RLS_AUDIT(choice_outcomes): SERVICE_ROLE_BYPASS - invariant check beyond canon
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('choice_outcomes')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('story_id', '=', storyId)
              .where('chapter_number', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'choice_outcomes.chapter_number', count: data ?? 0, error: error?.message ?? null }
      },
      async () => {
        // RLS_AUDIT(story_threads): SERVICE_ROLE_BYPASS - invariant check beyond canon opened_chapter
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('story_threads')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('story_id', '=', storyId)
              .where('opened_chapter', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'story_threads.opened_chapter', count: data ?? 0, error: error?.message ?? null }
      },
      async () => {
        // RLS_AUDIT(story_threads): SERVICE_ROLE_BYPASS - invariant check beyond canon last_touched_chapter
        const { data, error } = await result(
          countOf(
            db
              .selectFrom('story_threads')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('story_id', '=', storyId)
              .where('last_touched_chapter', '>', expectedChapter)
              .execute()
          )
        )
        return { key: 'story_threads.last_touched_chapter', count: data ?? 0, error: error?.message ?? null }
      },
    ]

    let violations = 0
    const perTable: Record<string, number> = {}
    let probeError: string | null = null
    for (const probeFn of probeFns) {
      const res = await probeFn()
      if (res.error) {
        probeError = `${res.key}: ${res.error}`
        break
      }
      perTable[res.key] = res.count
      violations += res.count
    }

    // Revealed secrets past their gate chapter count as beyond-canon state too.
    if (!probeError) {
      // RLS_AUDIT(secrets_reveals): SERVICE_ROLE_BYPASS - invariant check beyond gate
      const { data: count, error } = await result(
        countOf(
          db
            .selectFrom('secrets_reveals')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .where('story_id', '=', storyId)
            .where('revealed', '=', true)
            .where('reveal_gate_chapter', '>', expectedChapter)
            .execute()
        )
      )
      if (error) {
        probeError = `secrets_reveals: ${error.message}`
      } else {
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
    // RLS_AUDIT(chapter_generation_checkpoints): SERVICE_ROLE_BYPASS - invariant check published cp beyond
    const { data: count, error } = await result(
      countOf(
        db
          .selectFrom('chapter_generation_checkpoints')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('story_id', '=', storyId)
          .where('status', '=', 'PUBLISHED')
          .where('chapter_number', '>', expectedChapter)
          .execute()
      )
    )
    results.push({
      code: 'INV_NO_PUBLISHED_CP_BEYOND',
      passed: !error && (count ?? -1) === 0,
      detail: { observed: count ?? null, horizon: expectedChapter, error: error?.message ?? null },
    })
  }

  // ---- INV_NO_SUCCEEDED_JOB_BEYOND ----
  {
    // RLS_AUDIT(generation_jobs): SERVICE_ROLE_BYPASS - invariant check succeeded job beyond
    const { data: count, error } = await result(
      countOf(
        db
          .selectFrom('generation_jobs')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('story_id', '=', storyId)
          .where('status', '=', 'SUCCEEDED')
          .where('chapter_number', '>', expectedChapter)
          .execute()
      )
    )
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
    // RLS_AUDIT(reader_states): SERVICE_ROLE_BYPASS - invariant check reader consistent
    const { data, error } = await single(
      db
        .selectFrom('reader_states')
        .select(['current_chapter', 'status', 'locked_ending_key', 'choice_history'])
        .where('user_id', '=', userId)
        .where('story_id', '=', storyId)
        .execute()
    )
    const row = data as {
      current_chapter: number
      status: string
      locked_ending_key: string | null
      choice_history?: unknown[]
    } | null
    const atTerminal = expectedChapter >= HARNESS_TOTAL_CHAPTERS
    const expectedStatus = atTerminal ? 'SELESAI' : 'BERJALAN'
    const history = Array.isArray(row?.choice_history)
      ? (row?.choice_history as Array<Record<string, unknown>>)
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
      // RLS_AUDIT(reader_states): SERVICE_ROLE_BYPASS - invariant check ending lock at 50
      const { data, error } = await single(
        db
          .selectFrom('reader_states')
          .select(['locked_ending_key', 'ending_name'])
          .where('user_id', '=', userId)
          .where('story_id', '=', storyId)
          .execute()
      )
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
