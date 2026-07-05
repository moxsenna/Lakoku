import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/api/user-state'
import { queryStory } from '@/lib/api/queries'

/**
 * POST /api/stories/[id]/reports — T7.3 laporan pembaca (PRD §10.7).
 *
 * Body: { chapterNumber: number, reason: string, note?: string }
 *
 * - Referensi kanonik (reference_json) dirakit OTOMATIS di server —
 *   pembaca tidak perlu screenshot; reader-safe (tanpa prompt/metadata model).
 * - Tamu boleh melapor (reporter_user_id null).
 * - Silent dedupe: laporan identik (user+story+bab+alasan) dalam 10 menit
 *   tetap dibalas sukses tanpa menulis row baru.
 * - Respons tidak pernah membocorkan detail internal.
 */

const REASONS = [
  'KARAKTER_TIDAK_KONSISTEN',
  'MELANGGAR_BATAS_KONTEN',
  'PILIHAN_TIDAK_BERDAMPAK',
  'TYPO_BAHASA',
  'VISUAL_TIDAK_SESUAI',
  'LAINNYA',
] as const

type Reason = (typeof REASONS)[number]

/** Pemetaan severity otomatis (PRD §18.4). P0 hanya via review admin. */
const SEVERITY: Record<Reason, 'P1' | 'P2' | 'P3'> = {
  MELANGGAR_BATAS_KONTEN: 'P1',
  KARAKTER_TIDAK_KONSISTEN: 'P2',
  PILIHAN_TIDAK_BERDAMPAK: 'P2',
  VISUAL_TIDAK_SESUAI: 'P2',
  TYPO_BAHASA: 'P3',
  LAINNYA: 'P3',
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as {
      chapterNumber?: unknown
      reason?: unknown
      note?: unknown
    } | null

    const chapterNumber = Number(body?.chapterNumber)
    const reason = typeof body?.reason === 'string' ? body.reason : ''
    const rawNote = typeof body?.note === 'string' ? body.note.trim() : ''

    if (
      !Number.isFinite(chapterNumber) ||
      chapterNumber < 1 ||
      !REASONS.includes(reason as Reason)
    ) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
    }

    const story = await queryStory(id)
    if (!story) {
      return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
    }

    const user = await getSessionUser()
    const note = rawNote ? rawNote.slice(0, 500) : null
    const admin = createAdminClient()

    // Silent dedupe: laporan identik dalam jendela 10 menit → balas sukses.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
    let dedupe = admin
      .from('content_reports')
      .select('id')
      .eq('story_instance_id', id)
      .eq('chapter_no', chapterNumber)
      .eq('reason', reason)
      .gte('created_at', since)
      .limit(1)
    dedupe = user
      ? dedupe.eq('reporter_user_id', user.id)
      : dedupe.is('reporter_user_id', null)
    const { data: existing } = await dedupe
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true })
    }

    // Referensi kanonik reader-safe — dirakit di server saat laporan dibuat.
    const referenceJson = {
      story_instance_id: id,
      chapter_no: chapterNumber,
      story_status: story.status,
      story_current_chapter: story.currentChapter,
      reported_at: new Date().toISOString(),
    }

    const { error } = await admin.from('content_reports').insert({
      story_instance_id: id,
      chapter_no: chapterNumber,
      reporter_user_id: user?.id ?? null,
      reason,
      note,
      severity: SEVERITY[reason as Reason],
      status: 'OPEN',
      reference_json: referenceJson,
    })

    if (error) {
      return NextResponse.json({ error: 'Gagal mengirim laporan.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Gagal mengirim laporan.' }, { status: 500 })
  }
}
