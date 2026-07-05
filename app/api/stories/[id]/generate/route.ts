import { NextResponse } from 'next/server'
import { generateNextChapter, generateNextChapterReal } from '@lakoku/runtime'

/**
 * Endpoint runtime: memicu workflow generasi satu bab.
 * Permukaan INTERNAL/operasional (bukan endpoint pembaca). Dijaga token
 * internal (RUNTIME_ADMIN_TOKEN) bila diset; tanpa token, ditolak di produksi.
 *
 * Body:
 *   - chapterNumber: number (wajib, >= 1)
 *   - mode?: 'real' | 'fake'  (default 'real' — jalur cerita AI tervalidasi;
 *     'fake' = fixture deterministik M2 untuk uji lifecycle murni)
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
      mode?: 'real' | 'fake'
    }
    const n = Number(body.chapterNumber)
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json(
        { error: 'chapterNumber wajib bilangan bulat >= 1.' },
        { status: 400 },
      )
    }

    const mode = body.mode === 'fake' ? 'fake' : 'real'
    const result =
      mode === 'fake'
        ? await generateNextChapter(id, n)
        : await generateNextChapterReal(id, n)

    if (!result.ok) {
      // LEASE_HELD/CHAPTER_EXISTS/FAILED_REVIEW_REQUIRED → konflik/tak-dapat-diproses.
      const status =
        result.reason === 'FAILED_REVIEW_REQUIRED'
          ? 422
          : result.reason === 'CANON_MISSING'
            ? 404
            : 409
      return NextResponse.json(result, { status })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menghasilkan bab.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
