import { NextResponse } from 'next/server'
import { submitContentReport } from '@/lib/api/reports'
import { getSessionUser } from '@/lib/api/user-state'
import { SubmitReportRequestSchema } from '@lakoku/contracts'
import { rateLimit, clientIpFrom } from '@/lib/security/rate-limit'

/**
 * POST /api/stories/[id]/report  (ARCH §11.1 `/v1/stories/:id/report`)
 * Body: { chapterNumber: number, category: ReportCategory, note?: string }
 *
 * Menautkan referensi kanonik bab (server-derived) ke laporan — bukan meminta
 * screenshot pembaca. Respons sengaja reader-safe: tak membocorkan detail
 * internal apa pun, hanya konfirmasi bahwa laporan tersimpan.
 *
 * Publik (tamu boleh) tapi dibatasi per IP (audit M9): 8 laporan / menit —
 * cukup untuk pembaca sungguhan, membatasi flood ke story_events.
 */
const REPORT_RATE_LIMIT = 8
const REPORT_RATE_WINDOW_MS = 60_000

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const rl = rateLimit(`report:${clientIpFrom(req)}`, REPORT_RATE_LIMIT, REPORT_RATE_WINDOW_MS)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Terlalu banyak laporan. Coba lagi sebentar lagi.' },
        { status: 429, headers: { 'retry-after': String(rl.retryAfterSec) } },
      )
    }

    const body = await req.json().catch(() => null)

    const parsed = SubmitReportRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Kategori tidak dikenali.' }, { status: 400 })
    }
    const { chapterNumber, category } = parsed.data
    const note = parsed.data.note ?? null

    // Reporter opsional: laporan tamu tetap diterima (reporter_id null).
    let reporterId: string | null = null
    try {
      const user = await getSessionUser()
      reporterId = user?.id ?? null
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

export const dynamic = 'force-dynamic';
