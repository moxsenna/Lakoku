import { resolve } from 'node:path'
import type {
  M10FAssembledSemanticCase,
  M10FPilotIdentity,
  M10FSemanticAuthority,
  M10FSourceStorySurfaceAuthority,
  M10FStorySurfaceManifest,
} from '../contracts/m10-f-semantic-contract'
import {
  M10FAssembledSemanticCaseSchema,
  M10FPilotIdentitySchema,
  M10FStorySurfaceManifestSchema,
} from '../contracts/m10-f-semantic-contract'
import { SemanticJudgeInputSchema } from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  assertNoLabelLeak,
  computeJudgeInputHash,
  coverageChapters,
  validateOrderedHorizon,
} from './semantic-judge-policy'

const validatedStorySurfaces = new WeakSet<object>()

export interface M10FStorySurfaceSourceAuthority {
  sourceEvidenceManifestPath: string
  sourceEvidenceManifestHash: string
  sourceCaptureArtifactPath: string
  sourceCaptureArtifactHash: string
  liveCaptureArtifactPath: string
  liveCaptureArtifactHash: string
  sourceStorySurfaceAuthority: M10FSourceStorySurfaceAuthority
}

export function computeM10FStructuralContextHash(
  context: M10FStorySurfaceManifest['structuralContext'],
): string {
  return computeSha256(stableStringify(context))
}

export function computeM10FSourceStorySurfaceAuthorityHash(
  authority: Omit<M10FSourceStorySurfaceAuthority, 'authorityHash'>,
): string {
  return computeSha256(stableStringify(authority))
}

function chapterContent(chapter: M10FStorySurfaceManifest['chapters'][number]): string {
  return chapter.paragraphs.join('\n\n')
}

export function computeM10FChapterContentHash(title: string, paragraphs: string[]): string {
  return computeSha256(stableStringify({ title, paragraphs }))
}

export function computeM10FChapterSurfaceHash(
  chapter: Omit<M10FStorySurfaceManifest['chapters'][number], 'chapterHash'>,
): string {
  return computeSha256(stableStringify(chapter))
}

export function computeM10FStorySurfaceHash(
  manifest: Omit<M10FStorySurfaceManifest, 'storySurfaceHash'>,
): string {
  return computeSha256(stableStringify(manifest))
}

export function validateM10FStorySurface(
  raw: unknown,
  expectedIdentity: M10FPilotIdentity,
  source: M10FStorySurfaceSourceAuthority,
): M10FStorySurfaceManifest {
  const identity = M10FPilotIdentitySchema.parse(expectedIdentity)
  const parsed = M10FStorySurfaceManifestSchema.parse(raw)
  if (stableStringify(parsed.pilotIdentity) !== stableStringify(identity)) {
    throw new Error('M10-F story surface pilot identity mismatch')
  }
  const surfaceAuthority = source.sourceStorySurfaceAuthority
  const { authorityHash, ...authorityPayload } = surfaceAuthority
  if (computeM10FSourceStorySurfaceAuthorityHash(authorityPayload) !== authorityHash
    || parsed.sourceStorySurfaceAuthorityHash !== authorityHash
    || stableStringify(surfaceAuthority.pilotIdentity) !== stableStringify(identity)) {
    throw new Error('M10-F source story surface authority mismatch')
  }
  const sourceBindings = [
    [surfaceAuthority.sourceEvidenceManifestHash, source.sourceEvidenceManifestHash, 'source authority evidence manifest hash'],
    [surfaceAuthority.sourceCaptureArtifactHash, source.sourceCaptureArtifactHash, 'source authority capture artifact hash'],
    [surfaceAuthority.liveCaptureArtifactHash, source.liveCaptureArtifactHash, 'source authority live capture artifact hash'],
    [parsed.sourceEvidenceManifestPathHash, computeSha256(resolve(source.sourceEvidenceManifestPath)), 'source evidence manifest path'],
    [parsed.sourceEvidenceManifestHash, source.sourceEvidenceManifestHash, 'source evidence manifest hash'],
    [parsed.sourceCaptureArtifactPathHash, computeSha256(resolve(source.sourceCaptureArtifactPath)), 'source capture artifact path'],
    [parsed.sourceCaptureArtifactHash, source.sourceCaptureArtifactHash, 'source capture artifact hash'],
    [parsed.liveCaptureArtifactPathHash, computeSha256(resolve(source.liveCaptureArtifactPath)), 'live capture artifact path'],
    [parsed.liveCaptureArtifactHash, source.liveCaptureArtifactHash, 'live capture artifact hash'],
  ] as const
  for (const [observed, expected, label] of sourceBindings) {
    if (observed !== expected) throw new Error(`M10-F ${label} mismatch`)
  }
  parsed.chapters.forEach((chapter, index) => {
    if (chapter.chapterNumber !== index + 1) {
      throw new Error(`M10-F story surface requires exact Bab ${index + 1}`)
    }
    const authoritativeChapter = surfaceAuthority.chapters[index]
    if (!authoritativeChapter || authoritativeChapter.chapterNumber !== chapter.chapterNumber
      || authoritativeChapter.publishedTitle !== chapter.title
      || authoritativeChapter.contentHash !== chapter.contentHash
      || authoritativeChapter.pilotCaptureHash !== chapter.pilotCaptureHash) {
      throw new Error(`M10-F chapter source surface authority mismatch at Bab ${chapter.chapterNumber}`)
    }
    if (chapter.contentHash !== computeM10FChapterContentHash(chapter.title, chapter.paragraphs)) {
      throw new Error(`M10-F chapter content hash mismatch at Bab ${chapter.chapterNumber}`)
    }
    if (chapter.sourceEvidenceManifestHash !== parsed.sourceEvidenceManifestHash
      || chapter.sourceCaptureArtifactHash !== parsed.sourceCaptureArtifactHash) {
      throw new Error(`M10-F chapter source authority mismatch at Bab ${chapter.chapterNumber}`)
    }
    const { chapterHash, ...payload } = chapter
    if (computeM10FChapterSurfaceHash(payload) !== chapterHash) {
      throw new Error(`M10-F chapter surface hash mismatch at Bab ${chapter.chapterNumber}`)
    }
  })
  if (computeM10FStructuralContextHash(parsed.structuralContext) !== surfaceAuthority.structuralContextHash) {
    throw new Error('M10-F structural context source authority mismatch')
  }
  const { storySurfaceHash, ...surfacePayload } = parsed
  if (computeM10FStorySurfaceHash(surfacePayload) !== storySurfaceHash) {
    throw new Error('M10-F story surface hash mismatch')
  }
  validatedStorySurfaces.add(parsed)
  return parsed
}

export function assembleM10FSemanticCases(
  surface: M10FStorySurfaceManifest,
  authority: M10FSemanticAuthority,
): M10FAssembledSemanticCase[] {
  if (!validatedStorySurfaces.has(surface)) {
    throw new Error('M10-F semantic assembly requires source-authority-validated story surface')
  }
  const chapters = new Map(surface.chapters.map((chapter) => [chapter.chapterNumber, chapter]))
  return authority.cases.map((caseAuthority) => {
    const segments = coverageChapters(caseAuthority.coverage).map((chapterNumber) => {
      const chapter = chapters.get(chapterNumber)
      if (!chapter) throw new Error(`M10-F semantic case requires missing Bab ${chapterNumber}`)
      return {
        segmentId: `${surface.pilotIdentity.storyId}-bab-${chapterNumber}-${chapter.chapterHash.slice(0, 12)}`,
        chapterNumber,
        content: chapterContent(chapter),
      }
    })
    const structural = surface.structuralContext
    const judgeInput = SemanticJudgeInputSchema.parse(caseAuthority.view === 'reader'
      ? { view: 'reader', segments }
      : {
        view: 'structural', segments,
        storyPromise: structural.storyPromise, mainConflict: structural.mainConflict,
        finalQuestion: structural.finalQuestion, activeThreadSummaries: structural.activeThreadSummaries,
        resolvedThreadSummaries: structural.resolvedThreadSummaries, payoffSchedule: structural.payoffSchedule,
        lockedEndingKey: structural.lockedEndingKey, actPosition: structural.actPosition,
      })
    assertNoLabelLeak(judgeInput)
    validateOrderedHorizon(judgeInput, caseAuthority.rubricId, {
      kind: caseAuthority.horizonKind,
      coverage: caseAuthority.coverage,
    })
    const judgeInputHash = computeJudgeInputHash(judgeInput)
    return M10FAssembledSemanticCaseSchema.parse({
      pilotIdentity: surface.pilotIdentity,
      authorityHash: authority.authorityHash,
      sourceEvidenceManifestHash: surface.sourceEvidenceManifestHash,
      sourceCaptureArtifactHash: surface.sourceCaptureArtifactHash,
      liveCaptureArtifactHash: surface.liveCaptureArtifactHash,
      storySurfaceHash: surface.storySurfaceHash,
      caseAuthority,
      judgeInput,
      judgeInputHash,
      promptHash: caseAuthority.promptHash,
    })
  })
}
