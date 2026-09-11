import { resolve } from 'node:path'
import type {
  M10GAssembledSemanticCase,
  M10GSemanticAuthority,
  M10GSemanticIdentity,
  M10GSourceSurfaceAuthority,
  M10GStorySurfaceManifest,
} from '../contracts/m10-g-semantic-contract'
import {
  M10GAssembledSemanticCaseSchema,
  M10GSemanticIdentitySchema,
  M10GSourceSurfaceAuthoritySchema,
  M10GStorySurfaceManifestSchema,
} from '../contracts/m10-g-semantic-contract'
import { SemanticJudgeInputSchema } from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import { assertM10GExecutablePromptHash } from './m10-g-semantic-prompts'
import {
  assertNoLabelLeak,
  computeJudgeInputHash,
  coverageChapters,
  validateOrderedHorizon,
} from './semantic-judge-policy'

const validatedStorySurfaces = new WeakSet<object>()

/**
 * Explicit statement of what this pure layer does and does not prove about
 * source provenance. Digests are supplied by the caller; nothing here reads the
 * manifest/capture bytes, resolves a Git object, or queries a database. Only
 * internal consistency between the declared digests and the derived hashes is
 * verified.
 */
export const M10G_SOURCE_PROVENANCE_VERIFICATION_SCOPE = Object.freeze({
  assertionOrigin: 'CALLER_ASSERTED_CONTENT_DIGESTS',
  verifies: Object.freeze([
    'DECLARED_CONTENT_DIGEST_INTERNAL_CONSISTENCY',
    'SOURCE_SURFACE_AUTHORITY_SELF_HASH',
    'CHAPTER_CONTENT_AND_SURFACE_SELF_HASH',
    'STRUCTURAL_CONTEXT_SELF_HASH',
    'STORY_SURFACE_SELF_HASH',
  ]),
  doesNotVerify: Object.freeze([
    'SOURCE_BYTES_READ_FROM_DISK',
    'GIT_OBJECT_IDENTITY',
    'DATABASE_PROVENANCE',
    'CONTENT_DIGEST_ORIGIN',
  ]),
} as const)

/**
 * Caller-asserted source binding. `*ContentSha256` are SHA-256 digests of the
 * declared source content, not Git blob identities.
 */
export interface M10GStorySurfaceSourceBinding {
  sourceManifestPath: string
  sourceManifestContentSha256: string
  sourceCapturePath: string
  sourceCaptureContentSha256: string
  sourceSurfaceAuthority: M10GSourceSurfaceAuthority
}

export function computeM10GStructuralContextHash(
  context: M10GStorySurfaceManifest['structuralContext'],
): string {
  return computeSha256(stableStringify(context))
}

export function computeM10GSourceSurfaceAuthorityHash(
  authority: Omit<M10GSourceSurfaceAuthority, 'authorityHash'>,
): string {
  return computeSha256(stableStringify(authority))
}

export function computeM10GChapterContentHash(title: string, paragraphs: string[]): string {
  return computeSha256(stableStringify({ title, paragraphs }))
}

export function computeM10GChapterSurfaceHash(
  chapter: Omit<M10GStorySurfaceManifest['chapters'][number], 'chapterHash'>,
): string {
  return computeSha256(stableStringify(chapter))
}

export function computeM10GStorySurfaceHash(
  manifest: Omit<M10GStorySurfaceManifest, 'storySurfaceHash'>,
): string {
  return computeSha256(stableStringify(manifest))
}

export function validateM10GStorySurface(
  raw: unknown,
  expectedIdentity: M10GSemanticIdentity,
  source: M10GStorySurfaceSourceBinding,
): M10GStorySurfaceManifest {
  const identity = M10GSemanticIdentitySchema.parse(expectedIdentity)
  const parsed = M10GStorySurfaceManifestSchema.parse(raw)
  if (stableStringify(parsed.identity) !== stableStringify(identity)) {
    throw new Error('M10-G story surface identity mismatch')
  }
  const sourceAuthority = M10GSourceSurfaceAuthoritySchema.parse(source.sourceSurfaceAuthority)
  const { authorityHash, ...authorityPayload } = sourceAuthority
  if (computeM10GSourceSurfaceAuthorityHash(authorityPayload) !== authorityHash
    || parsed.sourceSurfaceAuthorityHash !== authorityHash
    || stableStringify(sourceAuthority.identity) !== stableStringify(identity)) {
    throw new Error('M10-G source story surface authority mismatch')
  }
  const bindings = [
    [parsed.sourceManifestPathHash, computeSha256(resolve(source.sourceManifestPath)), 'source manifest path'],
    [parsed.sourceManifestContentSha256, source.sourceManifestContentSha256, 'source manifest content digest'],
    [sourceAuthority.sourceManifestContentSha256, source.sourceManifestContentSha256, 'authority source manifest content digest'],
    [parsed.sourceCapturePathHash, computeSha256(resolve(source.sourceCapturePath)), 'source capture path'],
    [parsed.sourceCaptureContentSha256, source.sourceCaptureContentSha256, 'source capture content digest'],
    [sourceAuthority.sourceCaptureContentSha256, source.sourceCaptureContentSha256, 'authority source capture content digest'],
  ] as const
  for (const [observed, expected, label] of bindings) {
    if (observed !== expected) throw new Error(`M10-G ${label} hash mismatch`)
  }
  if (identity.kind === 'FORK' && identity.parentStorySurfaceHash === parsed.storySurfaceHash) {
    throw new Error('M10-G fork surface must differ from parent surface')
  }
  parsed.chapters.forEach((chapter, index) => {
    const authoritative = sourceAuthority.chapters[index]
    if (chapter.chapterNumber !== index + 1 || !authoritative
      || authoritative.chapterNumber !== chapter.chapterNumber
      || authoritative.title !== chapter.title
      || authoritative.contentHash !== chapter.contentHash
      || authoritative.sourceChapterContentSha256 !== chapter.sourceChapterContentSha256) {
      throw new Error(`M10-G chapter source authority mismatch at Bab ${index + 1}`)
    }
    if (chapter.contentHash !== computeM10GChapterContentHash(chapter.title, chapter.paragraphs)) {
      throw new Error(`M10-G chapter content hash mismatch at Bab ${chapter.chapterNumber}`)
    }
    const { chapterHash, ...payload } = chapter
    if (computeM10GChapterSurfaceHash(payload) !== chapterHash) {
      throw new Error(`M10-G chapter surface hash mismatch at Bab ${chapter.chapterNumber}`)
    }
  })
  if (computeM10GStructuralContextHash(parsed.structuralContext) !== sourceAuthority.structuralContextHash) {
    throw new Error('M10-G structural context source authority mismatch')
  }
  const { storySurfaceHash, ...surfacePayload } = parsed
  if (computeM10GStorySurfaceHash(surfacePayload) !== storySurfaceHash) {
    throw new Error('M10-G story surface hash mismatch')
  }
  validatedStorySurfaces.add(parsed)
  return parsed
}

export function assembleM10GSemanticCases(
  surface: M10GStorySurfaceManifest,
  authority: M10GSemanticAuthority,
): M10GAssembledSemanticCase[] {
  if (!validatedStorySurfaces.has(surface)) {
    throw new Error('M10-G semantic assembly requires source-authority-validated story surface')
  }
  const chapters = new Map(surface.chapters.map((chapter) => [chapter.chapterNumber, chapter]))
  return authority.cases.map((caseAuthority) => {
    assertM10GExecutablePromptHash(caseAuthority.rubricId, caseAuthority.promptHash)
    const segments = coverageChapters(caseAuthority.coverage).map((chapterNumber) => {
      const chapter = chapters.get(chapterNumber)
      if (!chapter) throw new Error(`M10-G semantic case requires missing Bab ${chapterNumber}`)
      return {
        segmentId: `${surface.identity.storyId}-bab-${chapterNumber}-${chapter.chapterHash.slice(0, 12)}`,
        chapterNumber,
        content: chapter.paragraphs.join('\n\n'),
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
    return M10GAssembledSemanticCaseSchema.parse({
      identity: surface.identity,
      authorityHash: authority.authorityHash,
      sourceSurfaceAuthorityHash: surface.sourceSurfaceAuthorityHash,
      sourceManifestContentSha256: surface.sourceManifestContentSha256,
      sourceCaptureContentSha256: surface.sourceCaptureContentSha256,
      storySurfaceHash: surface.storySurfaceHash,
      caseAuthority,
      judgeInput,
      judgeInputHash: computeJudgeInputHash(judgeInput),
      promptHash: caseAuthority.promptHash,
    })
  })
}
