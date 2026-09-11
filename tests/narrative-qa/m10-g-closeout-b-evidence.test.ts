/**
 * M10-G closeout — deterministic B evidence (evidence-only, zero inference).
 *
 * Runs frozen deterministic evaluators over the frozen checkpoint prose:
 *  - B.3.8 repetition (exact/normalized fingerprint matching, non-semantic)
 *  - B.3.6 choice-history (monotonicity, duplicates, summary projection)
 *
 * The checkpoints live outside the repo (local evidence, hashes recorded in
 * M10_G_FINAL_50_CHAPTER_PROOF.md); the path is supplied via env
 * M10G_CHECKPOINT_DIR so CI and local runs resolve the same files.
 *
 * What this does NOT cover (marked GAP, never inferred):
 *  - canon drift, plot-debt, thread, fact-conflict, blueprint, context,
 *    ending-runway evaluators need canon/contract state not captured per
 *    chapter during the runs.
 *  - M10-D semantic judges need model inference (forbidden in closeout).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateRepetition } from '@/lib/narrative-qa/evaluators/repetition-evaluator'
import { evaluateChoiceHistory } from '@/lib/narrative-qa/evaluators/choice-evaluator'

const CHECKPOINT_DIR =
  process.env.M10G_CHECKPOINT_DIR ?? 'C:/Users/bimap/AppData/Local/Temp'

interface CheckpointRow {
  branch?: string
  chapterNumber: number
  paragraphs?: string[]
  choiceLabels?: string[]
  chosenLabel?: string
  chosenConsequence?: string
}

function loadCheckpoint(name: string): CheckpointRow[] {
  const raw = readFileSync(join(CHECKPOINT_DIR, name), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CheckpointRow)
}

function branchRows(records: CheckpointRow[], branch: string): CheckpointRow[] {
  return records
    .filter((r) => (r.branch ?? 'trunk') === branch)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
}

const FILES = ['m10g-full-proof-50.jsonl', 'm10g-sinta-50.jsonl', 'm10g-fork-50.jsonl']

describe('m10-g closeout deterministic B evidence (zero inference)', () => {
  for (const file of FILES) {
    it(`${file}: no BLOCKER/CRITICAL repetition finding`, () => {
      const records = loadCheckpoint(file)
      const branches = [...new Set(records.map((r) => r.branch ?? 'trunk'))]
      for (const branch of branches) {
        const rows = branchRows(records, branch)
        const chapters = rows.map((r) => ({
          chapterNumber: r.chapterNumber,
          text: (r.paragraphs ?? []).join('\n'),
          choiceLabels: r.choiceLabels ?? [],
        }))
        const findings = evaluateRepetition({
          schemaVersion: 1,
          storyId: `${file}#${branch}`,
          evaluatorId: 'repetition',
          evaluatorVersion: '1.1.0',
          mode: 'HORIZON',
          horizon: {
            fromChapter: rows[0].chapterNumber,
            toChapter: rows[rows.length - 1].chapterNumber,
          },
          input: { chapters },
        })
        const blockers = findings.filter((f) =>
          (['BLOCKER', 'CRITICAL'] as readonly string[]).includes(f.severity),
        )
        expect(
          blockers,
          `${file}#${branch} blocker findings: ${JSON.stringify(blockers.slice(0, 3))}`,
        ).toEqual([])
      }
    })

    it(`${file}: choice history monotone, no duplicate previous`, () => {
      const records = loadCheckpoint(file)
      const branches = [...new Set(records.map((r) => r.branch ?? 'trunk'))]
      for (const branch of branches) {
        const rows = branchRows(records, branch).filter(
          (r) => r.chapterNumber < 50 && r.chosenLabel,
        )
        const acceptedChoices = rows.map((r) => ({
          chapterNumber: r.chapterNumber,
          choiceId: `${file}#${branch}#ch${r.chapterNumber}`,
          choiceLabel: r.chosenLabel ?? '',
          branchKey: branch,
          consequence: r.chosenConsequence ?? r.chosenLabel ?? '',
        }))
        const includedChapterNumbers = acceptedChoices.map((c) => c.chapterNumber)
        const renderedText = acceptedChoices
          .map((c) => `Bab ${c.chapterNumber}: ${c.choiceLabel} — ${c.consequence}`)
          .join('\n')
        const findings = evaluateChoiceHistory({
          schemaVersion: 1,
          storyId: `${file}#${branch}`,
          evaluatorId: 'choice-history',
          evaluatorVersion: '1.1.0',
          mode: 'CHAPTER_LOCAL',
          evaluatedChapter: rows.length ? rows[rows.length - 1].chapterNumber : 0,
          input: {
            acceptedChoices,
            boundedSummary: { includedChapterNumbers, renderedText },
            currentBranchKey: branch,
          },
        })
        const majors = findings.filter(
          (f) =>
            f.code === 'CHOICE_HISTORY_NON_MONOTONIC' ||
            f.code === 'CHOICE_HISTORY_DUPLICATE_PREVIOUS',
        )
        expect(
          majors,
          `${file}#${branch} choice findings: ${JSON.stringify(majors.slice(0, 3))}`,
        ).toEqual([])
      }
    })
  }
})
