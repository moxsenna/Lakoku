import { NextResponse } from 'next/server'
import { queryStory } from '@/lib/api/queries'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const story = await queryStory(id)
    if (!story) {
      return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
    }
    return NextResponse.json({ story })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat cerita.' }, { status: 500 })
  }
}
