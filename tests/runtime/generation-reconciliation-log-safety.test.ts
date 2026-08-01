import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MAX_LOG_ID_LENGTH, boundedLogId } from '@/lib/observability/safe-error'

const generationFiles = [
  'lib/runtime/story-generation.ts',
  'lib/runtime/personalized-generation.ts',
]

const reconciliationEventPattern =
  /console\.log\('(?:CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED|POST_PUBLISH_RECONCILIATION_NEEDED)', \{[\s\S]*?\n\s*\}\)/g

// Field kunci mentah yang tidak boleh pernah muncul pada payload rekonsiliasi.
const rawErrorFieldPattern = /\b(?:error|err|cause|stack|errorName|errorMessage)\s*:/

const boundedIdFields = ['storyId', 'correlationId', 'jobId', 'checkpointAttemptId'] as const

function collectEmissions(): string[] {
  return generationFiles.flatMap((file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    return source.match(reconciliationEventPattern) ?? []
  })
}

describe('post-publish reconciliation log safety', () => {
  it('uses fixed bounded outcomes without raw error fields in both generation paths', () => {
    const emissions = collectEmissions()

    expect(emissions).toHaveLength(6)
    for (const emission of emissions) {
      expect(emission).toMatch(/result: '(?:NOT_UPDATED|THREW)'/)
      expect(emission).toMatch(/errorCode: '[A-Z_]+'/)
      expect(emission).not.toMatch(/errorName|errorMessage/)
    }
  })

  it('omits raw error, err, cause, and stack fields in every reconciliation payload', () => {
    const emissions = collectEmissions()

    expect(emissions).toHaveLength(6)
    for (const emission of emissions) {
      expect(emission).not.toMatch(rawErrorFieldPattern)
    }
  })

  it('routes every emitted identifier through the bounded id helper', () => {
    const emissions = collectEmissions()

    expect(emissions).toHaveLength(6)
    for (const emission of emissions) {
      for (const field of boundedIdFields) {
        if (!emission.includes(`${field}:`)) continue
        expect(emission).toMatch(new RegExp(`${field}: boundedLogId\\(`))
      }
      // Tidak ada identifier shorthand tanpa bound (mis. `storyId,`).
      for (const field of boundedIdFields) {
        expect(emission).not.toMatch(new RegExp(`\\n\\s*${field},`))
      }
    }
  })

  it('bounds identifier strings to a fixed max length', () => {
    expect(MAX_LOG_ID_LENGTH).toBe(64)

    const oversized = 'a'.repeat(MAX_LOG_ID_LENGTH + 500)
    const bounded = boundedLogId(oversized)

    expect(bounded).not.toBeNull()
    expect(bounded).toHaveLength(MAX_LOG_ID_LENGTH)
    expect(oversized.startsWith(bounded!)).toBe(true)
  })

  it('normalizes missing identifiers to null and keeps short ids intact', () => {
    expect(boundedLogId(null)).toBeNull()
    expect(boundedLogId(undefined)).toBeNull()
    expect(boundedLogId('story-123')).toBe('story-123')
  })
})
