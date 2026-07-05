import { NextResponse } from 'next/server'
import { submitContentReport } from '@/lib/api/reports'
import { createClient } from '@/lib/supabase/server'
import type { ReportCategory } from '@/lib/api/types'

const VALID_CATEGORIES: ReportCategory[] = [
  'TOKOH_TIDAK_KONSISTEN',
  'DETAIL_BERTENTANGAN',
  'ALUR_MEMBINGUNGKAN',
  'BOCORAN_TERLALU_DINI',
  'LAINNYA',
]

/**
 * POST /api/stories/[id]/report  (ARCH §11.1 `/v1/stories/:id/report`)
 * Body: { chapterNumber: number, category: ReportCategory, note?: string }
 *
 * Menautkan referensi kanonik bab (server-derived) ke laporan — bukan meminta
 * screenshot pembaca. Respons sengaja reader-safe: tak membocorkan detail
 * internal apa pun, hanya konfirmasi bahwa laporan tersimpan.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as {
      chapterNumber?: unknown
      category?: unknown
      note?: unknown
    } | null

    const chapterNumber = Number(body?.chapterNumber)
    const category = body?.category as ReportCategory
    const note = typeof body?.note === 'string' ? body.note : null

    if (!Number.isFinite(chapterNumber) || chapterNumber < 1) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Kategori tidak dikenali.' }, { status: 400 })
    }

    // Reporter opsional: laporan tamu tetap diterima (reporter_id null).
    let reporterId: string | null = null
    try {
      const supabase = await createClient()
      const { data } = await supabase.auth.getUser()
      reporterId = data.user?.id ?? null
    } catch {
      reporterId = null
    }

    const { reportId } = await submitContentReport({
      storyId: id,
      chapterNumber,
      category,
      note,
      reporterId,
    })

    return NextResponse.json({ ok: true, reportId })
  } catch {
    // Bahasa aman; jangan bocorkan alasan teknis.
    return NextResponse.json(
      { error: 'Laporan gagal dikirim. Coba lagi sebentar lagi.' },
      { status: 500 },
    )
  }
}


export const runtime = 'edge';
