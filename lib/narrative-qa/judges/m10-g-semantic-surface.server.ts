import 'server-only'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  M10GSemanticIdentitySchema,
  M10GStructuralContextSchema,
  type M10GSemanticIdentity,
  type M10GStorySurfaceManifest,
} from '../contracts/m10-g-semantic-contract'
import { M10_G_SEMANTIC_AUTHORITY, assertM10GSemanticAuthority } from '../../../fixtures/m10-g/semantic-authority'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  computeM10GChapterContentHash,
  computeM10GChapterSurfaceHash,
  computeM10GSourceSurfaceAuthorityHash,
  computeM10GStorySurfaceHash,
  computeM10GStructuralContextHash,
  validateM10GStorySurface,
} from './m10-g-semantic-assembly'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const FrozenManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifactKind: z.literal('M10_G_FROZEN_SEMANTIC_SOURCE_MANIFEST'),
  identity: M10GSemanticIdentitySchema,
  semanticAuthorityHash: Sha256Schema,
  sourceCaptureContentSha256: Sha256Schema,
  chapterCount: z.literal(50),
}).strict()
const FrozenCaptureSchema = z.object({
  schemaVersion: z.literal(1),
  artifactKind: z.literal('M10_G_FROZEN_SEMANTIC_SOURCE_CAPTURE'),
  identity: M10GSemanticIdentitySchema,
  chapters: z.array(z.object({
    chapterNumber: z.number().int().min(1).max(50),
    title: z.string().min(1).max(500),
    paragraphs: z.array(z.string().min(1).max(40_000)).min(1).max(200),
    sourceChapterContentSha256: Sha256Schema,
  }).strict()).length(50),
  structuralContext: M10GStructuralContextSchema,
  structuralContextHash: Sha256Schema,
}).strict()

export interface M10GSemanticCanonicalRows {
  chapters: Array<{ number: number; title: string; paragraphs: string[] }>
  structuralContext: z.infer<typeof M10GStructuralContextSchema>
}

export type M10GSemanticCanonicalRowLoader = (
  storyId: string,
) => Promise<M10GSemanticCanonicalRows>

function sameIdentity(left: M10GSemanticIdentity, right: M10GSemanticIdentity): boolean {
  return stableStringify(left) === stableStringify(right)
}

function hashRawBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function loadM10GSemanticCanonicalRows(storyId: string): Promise<M10GSemanticCanonicalRows> {
  const admin = createAdminClient()
  const [chapters, contract, reader, threads] = await Promise.all([
    admin.from('chapters').select('number,title,paragraphs').eq('story_id', storyId).order('number'),
    admin.from('story_generation_contracts').select('story_contract_json,plot_debts_json,ending_lock_json').eq('story_id', storyId).single(),
    admin.from('reader_states').select('locked_ending_key').eq('story_id', storyId).single(),
    admin.from('story_threads').select('title,status,payoff_window').eq('story_id', storyId).order('id'),
  ])
  for (const [name, result] of [['chapters', chapters], ['contract', contract], ['reader', reader], ['threads', threads]] as const) {
    if (result.error) throw new Error(`M10-G private semantic surface ${name} read failed: ${result.error.message}`)
  }
  const storyContract = (contract.data!.story_contract_json ?? {}) as Record<string, unknown>
  const endingLock = (contract.data!.ending_lock_json ?? {}) as Record<string, unknown>
  const plotDebts = Array.isArray(contract.data!.plot_debts_json) ? contract.data!.plot_debts_json : []
  const threadRows = threads.data ?? []
  return {
    chapters: (chapters.data ?? []).map((row) => ({
      number: Number(row.number),
      title: String(row.title),
      paragraphs: Array.isArray(row.paragraphs) ? row.paragraphs.map(String) : [],
    })),
    structuralContext: M10GStructuralContextSchema.parse({
      storyPromise: String(storyContract.corePromise ?? storyContract.storyPromise ?? ''),
      mainConflict: String(storyContract.mainConflict ?? ''),
      finalQuestion: String(storyContract.finalQuestion ?? ''),
      activeThreadSummaries: threadRows.filter((row) => !['RESOLVED', 'ABANDONED_APPROVED'].includes(String(row.status)))
        .map((row) => String(row.title)),
      resolvedThreadSummaries: threadRows.filter((row) => String(row.status) === 'RESOLVED')
        .map((row) => String(row.title)),
      payoffSchedule: plotDebts.map((debt) => stableStringify(debt)),
      lockedEndingKey: String(reader.data!.locked_ending_key ?? endingLock.endingKey ?? ''),
      actPosition: 'Novel lengkap Bab 1-50',
    }),
  }
}

export async function buildM10GStorySurfaceFromTrustedSources(input: {
  identity: M10GSemanticIdentity
  sourceManifestPath: string
  sourceCapturePath: string
  rowLoader?: M10GSemanticCanonicalRowLoader
}): Promise<M10GStorySurfaceManifest> {
  const identity = M10GSemanticIdentitySchema.parse(input.identity)
  const authority = assertM10GSemanticAuthority(M10_G_SEMANTIC_AUTHORITY)
  const sourceManifestPath = resolve(input.sourceManifestPath)
  const sourceCapturePath = resolve(input.sourceCapturePath)
  const manifestBytes = readFileSync(sourceManifestPath)
  const captureBytes = readFileSync(sourceCapturePath)
  const manifestHash = hashRawBytes(manifestBytes)
  const captureHash = hashRawBytes(captureBytes)
  const manifest = FrozenManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')) as unknown)
  const capture = FrozenCaptureSchema.parse(JSON.parse(captureBytes.toString('utf8')) as unknown)

  if (!sameIdentity(manifest.identity, identity) || !sameIdentity(capture.identity, identity)) {
    throw new Error('M10-G frozen semantic source identity mismatch')
  }
  if (manifest.semanticAuthorityHash !== authority.authorityHash) {
    throw new Error('M10-G frozen semantic authority hash mismatch')
  }
  if (manifest.sourceCaptureContentSha256 !== captureHash) {
    throw new Error('M10-G source capture byte hash mismatch')
  }
  if (capture.structuralContextHash !== computeM10GStructuralContextHash(capture.structuralContext)) {
    throw new Error('M10-G frozen structural context hash mismatch')
  }
  capture.chapters.forEach((chapter, index) => {
    if (chapter.chapterNumber !== index + 1) throw new Error(`M10-G source chapters not ordered at Bab ${index + 1}`)
    if (chapter.sourceChapterContentSha256 !== computeM10GChapterContentHash(chapter.title, chapter.paragraphs)) {
      throw new Error(`M10-G source chapter content hash mismatch at Bab ${index + 1}`)
    }
  })

  const rows = await (input.rowLoader ?? loadM10GSemanticCanonicalRows)(identity.storyId)
  if (rows.chapters.length !== 50) throw new Error(`M10-G canonical chapter count must be 50; observed ${rows.chapters.length}`)
  if (stableStringify(rows.structuralContext) !== stableStringify(capture.structuralContext)) {
    throw new Error('M10-G canonical structural context differs from frozen source capture')
  }
  const chapters = rows.chapters.map((row, index) => {
    const source = capture.chapters[index]!
    const contentHash = computeM10GChapterContentHash(row.title, row.paragraphs)
    if (row.number !== index + 1 || row.number !== source.chapterNumber || row.title !== source.title
      || contentHash !== source.sourceChapterContentSha256) {
      throw new Error(`M10-G canonical chapter content differs from frozen source at Bab ${index + 1}`)
    }
    const payload = {
      chapterNumber: row.number,
      title: row.title,
      paragraphs: row.paragraphs,
      contentHash,
      sourceChapterContentSha256: source.sourceChapterContentSha256,
    }
    return { ...payload, chapterHash: computeM10GChapterSurfaceHash(payload) }
  })
  const sourceAuthorityPayload = {
    schemaVersion: 1 as const,
    identity,
    sourceManifestContentSha256: manifestHash,
    sourceCaptureContentSha256: captureHash,
    chapters: chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      contentHash: chapter.contentHash,
      sourceChapterContentSha256: chapter.sourceChapterContentSha256,
    })),
    structuralContextHash: capture.structuralContextHash,
  }
  const sourceSurfaceAuthority = {
    ...sourceAuthorityPayload,
    authorityHash: computeM10GSourceSurfaceAuthorityHash(sourceAuthorityPayload),
  }
  const payload = {
    schemaVersion: 1 as const,
    identity,
    sourceSurfaceAuthorityHash: sourceSurfaceAuthority.authorityHash,
    sourceManifestPathHash: computeSha256(sourceManifestPath),
    sourceManifestContentSha256: manifestHash,
    sourceCapturePathHash: computeSha256(sourceCapturePath),
    sourceCaptureContentSha256: captureHash,
    chapters,
    structuralContext: capture.structuralContext,
  }
  return validateM10GStorySurface(
    { ...payload, storySurfaceHash: computeM10GStorySurfaceHash(payload) },
    identity,
    {
      sourceManifestPath,
      sourceManifestContentSha256: manifestHash,
      sourceCapturePath,
      sourceCaptureContentSha256: captureHash,
      sourceSurfaceAuthority,
    },
  )
}
