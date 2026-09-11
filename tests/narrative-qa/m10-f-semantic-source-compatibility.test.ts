import { describe, expect, it } from 'vitest'
import {
  M10F_FROZEN_SEMANTIC_SOURCE_HASHES,
  evaluateM10FSemanticSourceCompatibility,
} from '@/lib/narrative-qa/judges/m10-f-semantic-compatibility'

describe('M10-F semantic source compatibility freeze', () => {
  it('preserves exact bytes for every frozen semantic source', () => {
    const result = evaluateM10FSemanticSourceCompatibility()

    expect(result).toEqual({
      ok: true,
      code: 'M10F_SEMANTIC_ARTIFACTS_UNCHANGED',
      checkedPaths: Object.keys(M10F_FROZEN_SEMANTIC_SOURCE_HASHES),
      mismatches: [],
    })
  })

  it('fails closed when frozen sources cannot be loaded', () => {
    expect(evaluateM10FSemanticSourceCompatibility('missing-root')).toMatchObject({
      ok: false,
      code: 'M10F_SEMANTIC_ARTIFACTS_CHANGED',
      mismatches: Object.keys(M10F_FROZEN_SEMANTIC_SOURCE_HASHES),
    })
  })
})
