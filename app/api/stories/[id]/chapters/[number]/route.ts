import { NextResponse } from 'next/server'
import { queryChapter } from '@/lib/api/queries'

export async function GET(
  _req: Request,
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
    return NextResponse.json({ chapter })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat bab.' }, { status: 500 })
  }
}
