import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { M10_G_SEMANTIC_AUTHORITY } from '../../fixtures/m10-g/semantic-authority'
import { createGlobalInferenceBudget } from '../../lib/ai-gateway/global-inference-budget.contract'
import type { M10GSemanticIdentity } from '../../lib/narrative-qa/contracts/m10-g-semantic-contract'
import {
  computeM10GChapterContentHash,
  computeM10GStructuralContextHash,
} from '../../lib/narrative-qa/judges/m10-g-semantic-assembly'
import {
  buildM10GStorySurfaceFromTrustedSources,
  type M10GSemanticCanonicalRows,
} from '../../lib/narrative-qa/judges/m10-g-semantic-surface.server'
import {
  createM10GSemanticCaptureWriter,
  validateM10GSemanticCaptureJsonl,
} from '../../lib/narrative-qa/judges/m10-g-semantic-capture.server'
import {
  executeM10GSemanticJudgeWithTrustedCapture,
} from '../../lib/narrative-qa/judges/m10-g-semantic-executor.server'
import { assembleM10GSemanticCases } from '../../lib/narrative-qa/judges/m10-g-semantic-assembly'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import {
  assertM10GSemanticExecuteGuard,
  preflightM10GSemanticCli,
} from '../../scripts/m10-g-semantic'

const identity: M10GSemanticIdentity = {
  kind: 'NOVEL',
  profileId: 'G1',
  routeClass: 'HIGH_TRUST',
  storyId: 'm10c-m10g-g1-authority-test',
  runId: 'm10g-g1-authority-test-run',
  correlationId: '11111111-1111-4111-8111-111111111111',
}

function sourceFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'm10g-semantic-'))
  const manifestPath = join(directory, 'source-manifest.json')
  const capturePath = join(directory, 'source-capture.json')
  const chapters = Array.from({ length: 50 }, (_, index) => {
    const chapterNumber = index + 1
    const title = `Bab ${chapterNumber}`
    const paragraphs = [`Isi tepercaya Bab ${chapterNumber}.`]
    return {
      chapterNumber,
      title,
      paragraphs,
      sourceChapterContentSha256: computeM10GChapterContentHash(title, paragraphs),
    }
  })
  const structuralContext = {
    storyPromise: 'Janji cerita.',
    mainConflict: 'Konflik utama.',
    finalQuestion: 'Pertanyaan akhir?',
    activeThreadSummaries: [],
    resolvedThreadSummaries: ['Utas selesai.'],
    payoffSchedule: ['Bayar janji.'],
    lockedEndingKey: 'ending-jujur',
    actPosition: 'Novel lengkap.',
  }
  const capture = {
    schemaVersion: 1,
    artifactKind: 'M10_G_FROZEN_SEMANTIC_SOURCE_CAPTURE',
    identity,
    chapters,
    structuralContext,
    structuralContextHash: computeM10GStructuralContextHash(structuralContext),
  }
  const captureBytes = `${stableStringify(capture)}\n`
  writeFileSync(capturePath, captureBytes, 'utf8')
  const manifest = {
    schemaVersion: 1,
    artifactKind: 'M10_G_FROZEN_SEMANTIC_SOURCE_MANIFEST',
    identity,
    semanticAuthorityHash: M10_G_SEMANTIC_AUTHORITY.authorityHash,
    sourceCaptureContentSha256: computeSha256(captureBytes),
    chapterCount: 50,
  }
  writeFileSync(manifestPath, `${stableStringify(manifest)}\n`, 'utf8')
  const rows: M10GSemanticCanonicalRows = {
    chapters: chapters.map(({ chapterNumber, title, paragraphs }) => ({ number: chapterNumber, title, paragraphs })),
    structuralContext,
  }
  return { directory, manifestPath, capturePath, rows }
}

const executionOptions = {
  telemetryContext: {
    userId: '99999999-9999-4999-9999-999999999999',
    storyId: identity.storyId,
    chapterNumber: null,
    generationKind: null,
    jobId: null,
    correlationId: identity.correlationId,
    attemptNumber: null,
  },
  workflowPhase: 'M10_G_SEMANTIC_JUDGE_TEST',
  m10gMode: true,
}

describe('M10-G trusted source loader', () => {
  it('hashes raw UTF-8 source bytes itself and binds 50 ordered canonical chapters', async () => {
    const fixture = sourceFixture()
    const loader = vi.fn(async () => fixture.rows)
    const surface = await buildM10GStorySurfaceFromTrustedSources({
      identity,
      sourceManifestPath: fixture.manifestPath,
      sourceCapturePath: fixture.capturePath,
      rowLoader: loader,
    })

    expect(loader).toHaveBeenCalledWith(identity.storyId)
    expect(surface.chapters).toHaveLength(50)
    expect(surface.sourceManifestContentSha256).toBe(computeSha256(readFileSync(fixture.manifestPath, 'utf8')))
    expect(surface.sourceCaptureContentSha256).toBe(computeSha256(readFileSync(fixture.capturePath, 'utf8')))
    expect(surface.chapters.map((chapter) => chapter.chapterNumber)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
  })

  it('rejects source byte, identity, chapter, and fork parent mismatches', async () => {
    const fixture = sourceFixture()
    writeFileSync(fixture.capturePath, `${readFileSync(fixture.capturePath, 'utf8')} `, 'utf8')
    await expect(buildM10GStorySurfaceFromTrustedSources({
      identity, sourceManifestPath: fixture.manifestPath, sourceCapturePath: fixture.capturePath,
      rowLoader: async () => fixture.rows,
    })).rejects.toThrow('source capture byte hash mismatch')

    const clean = sourceFixture()
    const wrongRows = structuredClone(clean.rows)
    wrongRows.chapters[20]!.paragraphs = ['Isi DB berubah.']
    await expect(buildM10GStorySurfaceFromTrustedSources({
      identity, sourceManifestPath: clean.manifestPath, sourceCapturePath: clean.capturePath,
      rowLoader: async () => wrongRows,
    })).rejects.toThrow('canonical chapter content differs')
  })
})

describe('M10-G trusted executor capture authority', () => {
  it('issues attempt from fake completion, reserves cap, and writes deterministic validated JSONL', async () => {
    const fixture = sourceFixture()
    const surface = await buildM10GStorySurfaceFromTrustedSources({
      identity, sourceManifestPath: fixture.manifestPath, sourceCapturePath: fixture.capturePath,
      rowLoader: async () => fixture.rows,
    })
    const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)[0]!
    const segment = assembled.judgeInput.segments.at(-1)!
    const rawResponse = JSON.stringify({
      score: 80,
      modelVerdict: 'PASS',
      confidence: 90,
      evidenceMode: 'SPAN',
      findingCodes: ['PACING_PRESSURE_PRESENT'],
      evidence: [{ segmentId: segment.segmentId, quote: segment.content.slice(0, 20) }],
      rationaleSummary: 'Pacing bergerak.',
    })
    const capturePath = join(fixture.directory, 'attempts.jsonl')
    const writer = createM10GSemanticCaptureWriter(capturePath)
    const transport = vi.fn(async ({ candidateId, sampleIndex }: { candidateId: string; sampleIndex: number }) => ({
      rawResponse,
      capture: {
        runId: identity.runId,
        correlationId: identity.correlationId,
        candidateId,
        sampleIndex,
        providerId: 'openrouter',
        configuredModelId: 'deepseek/deepseek-v3.2',
        routeVersion: '2026-08-m10g-live',
        fallbackIndex: 0,
        actualModelId: 'deepseek/deepseek-v3.2',
        actualModelResolved: true,
        finishReason: 'stop',
        outcome: 'SUCCEEDED' as const,
        errorCode: null,
      },
    }))
    const budget = createGlobalInferenceBudget({ runId: identity.runId, hardLimit: 1 })
    const attempt = await executeM10GSemanticJudgeWithTrustedCapture({
      assembled,
      authority: M10_G_SEMANTIC_AUTHORITY,
      sampleIndex: 0,
      executionOptions: { ...executionOptions, globalInferenceBudget: budget },
      transport,
      captureWriter: writer,
    })

    expect(attempt.status).toBe('VALID')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(budget.consumed).toBe(1)
    expect(validateM10GSemanticCaptureJsonl(readFileSync(capturePath), {
      identity, authorityHash: M10_G_SEMANTIC_AUTHORITY.authorityHash,
    })).toHaveLength(1)
  })
})

describe('M10-G semantic CLI guards', () => {
  it('preflight reports architecture readiness with zero effects and missing future inputs separately', () => {
    expect(preflightM10GSemanticCli()).toMatchObject({
      architectureStatus: 'ARCHITECTURE_READY',
      runInputStatus: 'RUN_INPUTS_NOT_YET_AVAILABLE',
      providerCalls: 0,
      networkAttempts: 0,
      dbCalls: 0,
      artifactWritten: false,
    })
  })

  it('blocks execute before credential or transport when explicit authorization is absent', () => {
    expect(() => assertM10GSemanticExecuteGuard({})).toThrow('M10G_SEMANTIC_EXECUTION_AUTHORIZATION_REQUIRED')
  })

  it('requires credentials, paths, story identity, isolated DB, and budget authority after authorization', () => {
    expect(() => assertM10GSemanticExecuteGuard({
      M10G_SEMANTIC_EXECUTION_AUTHORIZATION: 'AUTHORIZED',
    })).toThrow('M10G_SEMANTIC_CHILD_PROCESS_REQUIRED')
    expect(() => assertM10GSemanticExecuteGuard({
      M10G_SEMANTIC_EXECUTION_AUTHORIZATION: 'AUTHORIZED',
      LAKOKU_M10G_SEMANTIC_CHILD: '1',
    })).toThrow('M10G_SEMANTIC_ISOLATED_DB_FLAG_REQUIRED')
  })
})
