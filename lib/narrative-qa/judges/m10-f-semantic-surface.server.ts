import 'server-only'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  M10FPilotIdentity,
  M10FStorySurfaceManifest,
} from '../contracts/m10-f-semantic-contract'
import {
  M10FPilotIdentitySchema,
  M10FStructuralContextSchema,
} from '../contracts/m10-f-semantic-contract'
import {
  validateM10FLiveChapterCaptures,
  type M10FLiveChapterCaptureRecord,
} from '../harness/m10-f-evidence-summary'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  computeM10FChapterContentHash,
  computeM10FChapterSurfaceHash,
  computeM10FSourceStorySurfaceAuthorityHash,
  computeM10FStorySurfaceHash,
  computeM10FStructuralContextHash,
  validateM10FStorySurface,
} from './m10-f-semantic-assembly'
import {
  projectM10FStructuralContext,
  type M10FStructuralRows,
} from './m10-f-structural-context'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const EvidenceManifestSchema = z.object({
  schemaVersion: z.literal(2),
  pilotIdentity: M10FPilotIdentitySchema,
  storyIds: z.array(z.string()).length(1),
  artifactHashes: z.object({ capturesHash: Sha256Schema }).passthrough(),
}).passthrough()
const EvidenceCapturesSchema = z.object({
  schemaVersion: z.literal(2),
  storyId: z.string().min(1),
  runId: z.string().min(1),
  correlationId: z.string().uuid(),
  captureMode: z.literal('LIVE_CHAPTER_LOCAL'),
  structuralContext: z.object({
    payload: M10FStructuralContextSchema,
    structuralContextHash: Sha256Schema,
  }).strict(),
  chapters: z.array(z.object({
    chapterNumber: z.number().int().min(1).max(50),
    captureHash: Sha256Schema,
    contentHash: Sha256Schema,
    publishedTitle: z.string().min(1).max(500),
  }).passthrough()).length(50),
}).passthrough()

export interface M10FSemanticSourcePaths {
  sourceEvidenceManifestPath: string
  sourceCaptureArtifactPath: string
  liveCaptureArtifactPath: string
}

interface StoryChapterRow {
  number: number
  title: string
  paragraphs: string[]
}

function readJsonLines(path: string): unknown[] {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown)
}

function sourceAuthority(paths: M10FSemanticSourcePaths, identity: M10FPilotIdentity) {
  const normalized = {
    sourceEvidenceManifestPath: resolve(paths.sourceEvidenceManifestPath),
    sourceCaptureArtifactPath: resolve(paths.sourceCaptureArtifactPath),
    liveCaptureArtifactPath: resolve(paths.liveCaptureArtifactPath),
  }
  const manifestBytes = readFileSync(normalized.sourceEvidenceManifestPath, 'utf8')
  const captureBytes = readFileSync(normalized.sourceCaptureArtifactPath, 'utf8')
  const liveBytes = readFileSync(normalized.liveCaptureArtifactPath, 'utf8')
  const manifest = EvidenceManifestSchema.parse(JSON.parse(manifestBytes) as unknown)
  const captures = EvidenceCapturesSchema.parse(JSON.parse(captureBytes) as unknown)
  const liveCaptures = readJsonLines(normalized.liveCaptureArtifactPath) as M10FLiveChapterCaptureRecord[]
  const captureHash = computeSha256(captureBytes)
  if (manifest.artifactHashes.capturesHash !== captureHash) {
    throw new Error('M10-F capture artifact hash does not match source manifest authority')
  }
  if (stableStringify(manifest.pilotIdentity) !== stableStringify(identity)
    || manifest.storyIds[0] !== identity.storyId
    || captures.storyId !== identity.storyId
    || captures.runId !== identity.runId
    || captures.correlationId !== identity.correlationId) {
    throw new Error('M10-F source artifact pilot identity mismatch')
  }
  validateM10FLiveChapterCaptures(liveCaptures, identity, 50)
  const frozenStructuralContextHash = computeM10FStructuralContextHash(captures.structuralContext.payload)
  if (frozenStructuralContextHash !== captures.structuralContext.structuralContextHash) {
    throw new Error('M10-F frozen structural context hash mismatch')
  }
  captures.chapters.forEach((capture, index) => {
    const live = liveCaptures[index]!
    if (capture.chapterNumber !== index + 1
      || capture.captureHash !== live.capture.captureHash
      || capture.contentHash !== live.contentHash
      || capture.publishedTitle !== live.capture.publishedTitle) {
      throw new Error(`M10-F source capture authority mismatch at Bab ${index + 1}`)
    }
  })
  return {
    normalized,
    manifestHash: computeSha256(manifestBytes),
    captureHash,
    liveCaptureHash: computeSha256(liveBytes),
    captures,
  }
}

export function buildM10FStorySurfaceFromCanonicalSources(input: {
  pilotIdentity: M10FPilotIdentity
  sourcePaths: M10FSemanticSourcePaths
  chapters: StoryChapterRow[]
  structuralRows: M10FStructuralRows
}): M10FStorySurfaceManifest {
  const identity = M10FPilotIdentitySchema.parse(input.pilotIdentity)
  const authority = sourceAuthority(input.sourcePaths, identity)
  if (input.chapters.length !== 50) throw new Error(`M10-F canonical chapter count must be 50; observed ${input.chapters.length}`)
  const chapters = input.chapters.map((row, index) => {
    const capture = authority.captures.chapters[index]!
    if (row.number !== index + 1 || row.title !== capture.publishedTitle) {
      throw new Error(`M10-F canonical chapter/source capture mismatch at Bab ${index + 1}`)
    }
    const contentHash = computeM10FChapterContentHash(row.title, row.paragraphs)
    if (contentHash !== capture.contentHash) {
      throw new Error(`M10-F canonical chapter content differs from frozen pilot capture at Bab ${index + 1}`)
    }
    const payload = {
      chapterNumber: row.number,
      title: row.title,
      paragraphs: row.paragraphs,
      contentHash,
      pilotCaptureHash: capture.captureHash,
      sourceCaptureArtifactHash: authority.captureHash,
      sourceEvidenceManifestHash: authority.manifestHash,
    }
    return { ...payload, chapterHash: computeM10FChapterSurfaceHash(payload) }
  })
  const context = projectM10FStructuralContext(input.structuralRows)
  const currentStructuralContextHash = computeM10FStructuralContextHash(context)
  if (currentStructuralContextHash !== authority.captures.structuralContext.structuralContextHash) {
    throw new Error('M10-F canonical structural context differs from frozen pilot capture')
  }
  const sourceStorySurfaceAuthorityPayload = {
    schemaVersion: 3 as const,
    pilotIdentity: identity,
    sourceEvidenceManifestHash: authority.manifestHash,
    sourceCaptureArtifactHash: authority.captureHash,
    liveCaptureArtifactHash: authority.liveCaptureHash,
    chapters: chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      publishedTitle: chapter.title,
      contentHash: chapter.contentHash,
      pilotCaptureHash: chapter.pilotCaptureHash,
    })),
    structuralContextHash: authority.captures.structuralContext.structuralContextHash,
  }
  const sourceStorySurfaceAuthority = {
    ...sourceStorySurfaceAuthorityPayload,
    authorityHash: computeM10FSourceStorySurfaceAuthorityHash(sourceStorySurfaceAuthorityPayload),
  }
  const payload = {
    schemaVersion: 5 as const,
    pilotIdentity: identity,
    sourceStorySurfaceAuthorityHash: sourceStorySurfaceAuthority.authorityHash,
    sourceEvidenceManifestPathHash: computeSha256(authority.normalized.sourceEvidenceManifestPath),
    sourceEvidenceManifestHash: authority.manifestHash,
    sourceCaptureArtifactPathHash: computeSha256(authority.normalized.sourceCaptureArtifactPath),
    sourceCaptureArtifactHash: authority.captureHash,
    liveCaptureArtifactPathHash: computeSha256(authority.normalized.liveCaptureArtifactPath),
    liveCaptureArtifactHash: authority.liveCaptureHash,
    chapters,
    structuralContext: context,
  }
  return validateM10FStorySurface(
    { ...payload, storySurfaceHash: computeM10FStorySurfaceHash(payload) },
    identity,
    {
      sourceEvidenceManifestPath: authority.normalized.sourceEvidenceManifestPath,
      sourceCaptureArtifactPath: authority.normalized.sourceCaptureArtifactPath,
      liveCaptureArtifactPath: authority.normalized.liveCaptureArtifactPath,
      sourceEvidenceManifestHash: authority.manifestHash,
      sourceCaptureArtifactHash: authority.captureHash,
      liveCaptureArtifactHash: authority.liveCaptureHash,
      sourceStorySurfaceAuthority,
    },
  )
}

export interface M10FSemanticCanonicalRows {
  chapters: StoryChapterRow[]
  structuralRows: M10FStructuralRows
}

export type M10FSemanticCanonicalRowLoader = (
  storyId: string,
) => Promise<M10FSemanticCanonicalRows>

async function loadM10FSemanticCanonicalRows(
  storyId: string,
): Promise<M10FSemanticCanonicalRows> {
  const admin = createAdminClient()
  const [chapters, contract, reader, threads] = await Promise.all([
    admin.from('chapters').select('number,title,paragraphs').eq('story_id', storyId).order('number'),
    admin.from('story_generation_contracts').select('story_contract_json,plot_debts_json,ending_lock_json').eq('story_id', storyId).single(),
    admin.from('reader_states').select('locked_ending_key').eq('story_id', storyId).single(),
    admin.from('story_threads').select('id,title,status,payoff_window').eq('story_id', storyId).order('id'),
  ])
  for (const [name, result] of [['chapters', chapters], ['contract', contract], ['reader', reader], ['threads', threads]] as const) {
    if (result.error) throw new Error(`M10-F private surface ${name} read failed: ${result.error.message}`)
  }
  return {
    chapters: (chapters.data ?? []).map((row) => ({
      number: Number(row.number),
      title: String(row.title),
      paragraphs: Array.isArray(row.paragraphs) ? row.paragraphs.map(String) : [],
    })),
    structuralRows: {
      storyContract: (contract.data!.story_contract_json ?? {}) as Record<string, unknown>,
      plotDebts: Array.isArray(contract.data!.plot_debts_json) ? contract.data!.plot_debts_json : [],
      endingLock: (contract.data!.ending_lock_json ?? {}) as Record<string, unknown>,
      lockedEndingKey: reader.data!.locked_ending_key ? String(reader.data!.locked_ending_key) : null,
      threads: (threads.data ?? []).map((row) => ({
        id: String(row.id), title: String(row.title), status: String(row.status),
        payoffWindow: row.payoff_window === null ? null : Number(row.payoff_window),
      })),
    },
  }
}

export async function buildM10FStorySurfaceFromIsolatedDatabase(input: {
  pilotIdentity: M10FPilotIdentity
  sourcePaths: M10FSemanticSourcePaths
  rowLoader?: M10FSemanticCanonicalRowLoader
}): Promise<M10FStorySurfaceManifest> {
  const rows = await (input.rowLoader ?? loadM10FSemanticCanonicalRows)(input.pilotIdentity.storyId)
  return buildM10FStorySurfaceFromCanonicalSources({
    pilotIdentity: input.pilotIdentity,
    sourcePaths: input.sourcePaths,
    ...rows,
  })
}
