import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { serializeM10FEvidenceArtifact } from '../../scripts/m10-f-evidence-artifact'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('M10-F evidence artifact serialization', () => {
  it('hashes exact newline-terminated UTF-8 bytes written to disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lakoku-m10-f-evidence-'))
    temporaryDirectories.push(directory)
    const artifactPath = join(directory, 'summary.json')
    const artifact = serializeM10FEvidenceArtifact({ zeta: 'cerita', alpha: 1 })

    writeFileSync(artifactPath, artifact.content, 'utf8')
    const writtenBytes = readFileSync(artifactPath)

    expect(writtenBytes.toString('utf8')).toBe('{"alpha":1,"zeta":"cerita"}\n')
    expect(artifact.sha256).toBe(createHash('sha256').update(writtenBytes).digest('hex'))
  })
})
