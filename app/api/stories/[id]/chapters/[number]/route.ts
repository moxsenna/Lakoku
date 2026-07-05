import { NextResponse } from 'next/server'
import { queryChapter } from '@/lib/api/queries'
import { jsonWithETag } from '@/lib/api/etag'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; number: string }> },
) {
  try {
    const { id, number } = await params
    const n = Number.parseInt(number, 10)
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ error: 'Nomor bab tidak valid.' }, { status: 400 })
    }
    const chapter = await queryChapter(id, n)
    if (!chapter) {
      return NextResponse.json({ error: 'Bab tidak ditemukan.' }, { status: 404 })
    }
    // Konten bab immutable setelah publish → ETag + dukungan 304.
    return jsonWithETag(req, { chapter })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat bab.' }, { status: 500 })
  }
}
