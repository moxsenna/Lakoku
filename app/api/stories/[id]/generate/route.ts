import { NextResponse } from 'next/server'
import { generateNextChapter } from '@/lib/runtime/fake-generation'

/**
 * Endpoint runtime (M2): memicu fake generation workflow untuk satu bab.
 * Ini permukaan INTERNAL/operasional, bukan endpoint pembaca. Dijaga token
 * internal (RUNTIME_ADMIN_TOKEN) bila diset; tanpa token, ditolak di produksi.
 *
 * Idempoten: memanggil ulang untuk (story, chapter) yang sama tidak
 * menduplikasi bab (dijaga idempotency key + RPC atomik).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminToken = process.env.RUNTIME_ADMIN_TOKEN
  if (adminToken) {
    const provided = req.headers.get('x-runtime-token')
    if (provided !== adminToken) {
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
    }
  }

  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      chapterNumber?: number
    }
    const n = Number(body.chapterNumber)
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json(
        { error: 'chapterNumber wajib bilangan bulat >= 1.' },
        { status: 400 },
      )
    }

    const result = await generateNextChapter(id, n)
    if (!result.ok) {
      const status = result.reason === 'LEASE_HELD' ? 409 : 409
      return NextResponse.json({ ok: false, reason: result.reason }, { status })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menghasilkan bab.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
