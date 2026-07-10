import { NextResponse } from 'next/server'
import { listChapterMetadatas } from '@/lib/api/server'

/**
 * GET /api/stories/[id]/chapters
 *
 * Mengembalikan daftar metadata bab (number + title) yang sudah dijangkau
 * pembaca, dibatasi oleh maxReachedChapter. Tidak membocorkan judul bab
 * di luar progress pengguna (spoiler gate).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await listChapterMetadatas(id)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Gagal memuat daftar bab.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
