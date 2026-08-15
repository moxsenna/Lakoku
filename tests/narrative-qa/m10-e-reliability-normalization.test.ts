import { describe, expect, it } from 'vitest'
import {
  ALIASED_OPERATIONAL_ID_PATHS,
  NORMALIZATION_SCHEMA_VERSION,
  RELIABILITY_EXECUTION_METADATA_SCHEMA,
  RELIABILITY_NORMALIZATION_BLOCK_SCHEMA,
  RELIABILITY_NORMALIZED_EXECUTION_SCHEMA,
  REMOVED_OPERATIONAL_FIELDS,
  buildExecutionAliasMap,
  normalizeExecutionMetadata,
} from '../../lib/narrative-qa/reliability'

const VALID_METADATA = {
  executionInstanceId: 'run-0001',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:01:00.000Z',
  elapsedMilliseconds: 60000,
  artifactDirectoryPath: '/tmp/m10-e-e3a-e4/run-0001',
}

describe('normalizeExecutionMetadata', () => {
  it('is deterministic across repeated calls for identical metadata', () => {
    const first = normalizeExecutionMetadata(VALID_METADATA)
    const second = normalizeExecutionMetadata(VALID_METADATA)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('aliases the execution instance id to the deterministic execution-NNNN form', () => {
    const result = normalizeExecutionMetadata(VALID_METADATA)
    expect(result.execution).toEqual({ executionInstanceId: 'execution-0001' })
    expect(result.normalization.aliasMap).toEqual({ executionInstanceId: 'execution-0001' })
  })

  it('removes only the declared operational fields and nothing else', () => {
    const result = normalizeExecutionMetadata(VALID_METADATA)
    expect(result.normalization.schemaVersion).toBe(NORMALIZATION_SCHEMA_VERSION)
    expect(result.normalization.removedOperationalFields).toEqual([...REMOVED_OPERATIONAL_FIELDS])
    expect(ALIASED_OPERATIONAL_ID_PATHS).toEqual(['executionInstanceId'])
  })

  it('normalizes operational-only differences to identical output', () => {
    const shifted = {
      executionInstanceId: 'run-0001',
      startedAt: '2026-08-15T14:30:00.000Z',
      finishedAt: '2026-08-16T09:00:00.000Z',
      elapsedMilliseconds: 999999,
      artifactDirectoryPath: '/other/path/run-0001',
    }
    expect(JSON.stringify(normalizeExecutionMetadata(shifted)))
      .toBe(JSON.stringify(normalizeExecutionMetadata(VALID_METADATA)))
  })

  it('rejects identical raw ids with one shared alias only', () => {
    const map = buildExecutionAliasMap(['run-0001', 'run-0001', 'run-0001'])
    expect(map.size).toBe(1)
    expect(map.get('run-0001')).toBe('execution-0001')
  })

  it('maps distinct raw ids to distinct aliases in first-seen order', () => {
    const map = buildExecutionAliasMap(['run-0001', 'run-0002', 'run-0001', 'run-0003'])
    expect([...map.entries()]).toEqual([
      ['run-0001', 'execution-0001'],
      ['run-0002', 'execution-0002'],
      ['run-0003', 'execution-0003'],
    ])
  })

  it('throws a RangeError when more than 9999 distinct executions are aliased', () => {
    const ids = Array.from({ length: 10000 }, (_, index) => `run-${String(index + 1).padStart(4, '0')}`)
    expect(() => buildExecutionAliasMap(ids)).toThrow(RangeError)
  })

  it('freezes the normalized output', () => {
    const result = normalizeExecutionMetadata(VALID_METADATA)
    expect(Object.isFrozen(result.execution)).toBe(true)
    expect(Object.isFrozen(result.normalization)).toBe(true)
  })
})

describe('RELIABILITY_EXECUTION_METADATA_SCHEMA', () => {
  it('accepts complete valid metadata', () => {
    expect(RELIABILITY_EXECUTION_METADATA_SCHEMA.parse(VALID_METADATA)).toMatchObject({ executionInstanceId: 'run-0001' })
  })

  it('rejects a missing operational field', () => {
    const { artifactDirectoryPath: _omitted, ...partial } = VALID_METADATA
    expect(() => RELIABILITY_EXECUTION_METADATA_SCHEMA.parse(partial)).toThrow()
  })

  it('rejects timestamps without an offset', () => {
    expect(() => RELIABILITY_EXECUTION_METADATA_SCHEMA.parse({ ...VALID_METADATA, startedAt: '2026-08-15T12:00:00' })).toThrow()
  })

  it('rejects negative elapsed milliseconds', () => {
    expect(() => RELIABILITY_EXECUTION_METADATA_SCHEMA.parse({ ...VALID_METADATA, elapsedMilliseconds: -1 })).toThrow()
  })

  it('rejects an empty artifact directory path', () => {
    expect(() => RELIABILITY_EXECUTION_METADATA_SCHEMA.parse({ ...VALID_METADATA, artifactDirectoryPath: '' })).toThrow()
  })

  it('rejects an over-long execution instance id', () => {
    expect(() => RELIABILITY_EXECUTION_METADATA_SCHEMA.parse({ ...VALID_METADATA, executionInstanceId: 'x'.repeat(257) })).toThrow()
  })
})

describe('RELIABILITY_NORMALIZED_EXECUTION_SCHEMA', () => {
  it('accepts the canonical execution-NNNN alias form', () => {
    expect(RELIABILITY_NORMALIZED_EXECUTION_SCHEMA.parse({ executionInstanceId: 'execution-9999' })).toMatchObject({ executionInstanceId: 'execution-9999' })
  })

  it('rejects a raw execution instance id', () => {
    expect(() => RELIABILITY_NORMALIZED_EXECUTION_SCHEMA.parse({ executionInstanceId: 'run-0001' })).toThrow()
  })

  it('rejects a short alias without four digits', () => {
    expect(() => RELIABILITY_NORMALIZED_EXECUTION_SCHEMA.parse({ executionInstanceId: 'execution-01' })).toThrow()
  })
})

describe('RELIABILITY_NORMALIZATION_BLOCK_SCHEMA', () => {
  it('accepts the frozen normalization block shape', () => {
    const block = {
      schemaVersion: NORMALIZATION_SCHEMA_VERSION,
      removedOperationalFields: [...REMOVED_OPERATIONAL_FIELDS],
      aliasMap: { executionInstanceId: 'execution-0001' },
    }
    expect(RELIABILITY_NORMALIZATION_BLOCK_SCHEMA.parse(block)).toEqual(block)
  })

  it('rejects an unknown removed operational field', () => {
    expect(() => RELIABILITY_NORMALIZATION_BLOCK_SCHEMA.parse({
      schemaVersion: NORMALIZATION_SCHEMA_VERSION,
      removedOperationalFields: ['startedAt', 'credential'],
      aliasMap: { executionInstanceId: 'execution-0001' },
    })).toThrow()
  })

  it('rejects an aliased path outside the declared operational id paths', () => {
    expect(() => RELIABILITY_NORMALIZATION_BLOCK_SCHEMA.parse({
      schemaVersion: NORMALIZATION_SCHEMA_VERSION,
      removedOperationalFields: [...REMOVED_OPERATIONAL_FIELDS],
      aliasMap: { startedAt: 'execution-0001' },
    })).toThrow()
  })
})

describe('normalizeExecutionMetadata rejection', () => {
  it('throws when input fails the metadata schema', () => {
    expect(() => normalizeExecutionMetadata({ ...VALID_METADATA, elapsedMilliseconds: -5 })).toThrow()
    expect(() => normalizeExecutionMetadata(null as never)).toThrow()
  })
})