/**
 * Lakoku — Seam data sisi BROWSER (API-first).
 *
 * Ini SATU-SATUNYA pintu yang boleh dipakai komponen client untuk berbicara
 * dengan backend, via Reader API (interim: Next.js route handlers /api/*;
 * nanti: Cloudflare Workers — cukup ganti API_BASE, komponen tidak berubah).
 *
 * Logika naratif (memori T0–T3, validator, alias registry, thread lifecycle,
 * reveal gates) TETAP di backend. Client hanya menampilkan hasilnya.
 *
 * Untuk Server Components, gunakan lib/api/server.ts (kontrak identik).
 */

import type {
  StorySummary,
  StoryDetail,
  Chapter,
  ChoiceOutcome,
  ReportCategory,
  ReportResult,
} from './types'
import {
  ChapterStatusResponseSchema,
  SubmitChoiceResponseSchema,
  type ChapterStatusResponse,
  type SubmitChoiceResponse,
} from '../../packages/contracts/src/reader'
import { buildChoiceIdempotencyKey } from './choice-idempotency'

const API_BASE = '/api'

/** Daftar seluruh cerita (ringkasan) untuk katalog/beranda/koleksiku. */
export async function listStories(): Promise<StorySummary[]> {
  const res = await fetch(`${API_BASE}/stories`)
  if (!res.ok) throw new Error('Gagal memuat daftar cerita.')
  const data = (await res.json()) as { stories: StorySummary[] }
  return data.stories
}

/** Detail lengkap satu cerita berdasarkan id. */
export async function getStory(id: string): Promise<StoryDetail | null> {
  const res = await fetch(`${API_BASE}/stories/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Gagal memuat cerita.')
  const data = (await res.json()) as { story: StoryDetail }
  return data.story
}

/** Ambil satu bab tertentu. */
export async function getChapter(
  storyId: string,
  chapterNumber: number,
): Promise<Chapter | null> {
  const res = await fetch(
    `${API_BASE}/stories/${encodeURIComponent(storyId)}/chapters/${chapterNumber}`,
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Gagal memuat bab.')
  const data = (await res.json()) as { chapter: Chapter }
  return data.chapter
}

/**
 * Kirim pilihan pembaca. Backend yang menghitung konsekuensi &
 * menentukan bab berikutnya (bounded branching + validator di server).
 */
export async function submitChoice(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<ChoiceOutcome> {
  const data = await submitChoiceWithReadiness(storyId, chapterNumber, choiceId)
  return data.outcome
}

export async function submitChoiceWithReadiness(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<SubmitChoiceResponse> {
  try {
    const res = await fetch(
      `${API_BASE}/stories/${encodeURIComponent(storyId)}/choices`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': buildChoiceIdempotencyKey(storyId, chapterNumber, choiceId),
        },
        body: JSON.stringify({ chapterNumber, choiceId }),
      },
    )

    if (!res.ok) throw new Error()
    return SubmitChoiceResponseSchema.parse(await res.json())
  } catch {
    throw new Error('Pilihan belum berhasil dikirim.')
  }
}

export async function getChapterGenerationStatus(
  storyId: string,
  chapterNumber: number,
  signal?: AbortSignal,
): Promise<ChapterStatusResponse> {
  try {
    const url = `${API_BASE}/stories/${encodeURIComponent(storyId)}/chapters/${chapterNumber}/status`
    const res = signal
      ? await fetch(url, { signal })
      : await fetch(url)
    if (!res.ok) throw new Error()
    return ChapterStatusResponseSchema.parse(await res.json())
  } catch {
    throw new Error('Status bab belum berhasil diperiksa.')
  }
}

/**
 * Kirim laporan masalah cerita untuk sebuah bab. Server yang menautkan
 * referensi kanonik bab (bukan pembaca). Respons reader-safe.
 */
export async function submitReport(
  storyId: string,
  chapterNumber: number,
  category: ReportCategory,
  note?: string,
): Promise<ReportResult> {
  try {
    const res = await fetch(
      `${API_BASE}/stories/${encodeURIComponent(storyId)}/report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterNumber, category, note }),
      },
    )
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { ok: boolean; reportId?: string }
    return { ok: Boolean(data.ok), reportId: data.reportId }
  } catch {
    return { ok: false }
  }
}

/**
 * Daftar metadata bab yang sudah bisa diakses pembaca.
 * Server membatasi sampai maxReachedChapter (spoiler gate).
 */
export async function listChapters(storyId: string): Promise<{
  chapters: { number: number; title: string }[]
  maxReachedChapter: number
}> {
  const res = await fetch(
    `${API_BASE}/stories/${encodeURIComponent(storyId)}/chapters`,
  )
  if (!res.ok) throw new Error('Gagal memuat daftar bab.')
  return res.json()
}
