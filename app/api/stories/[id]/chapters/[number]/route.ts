import { NextResponse } from 'next/server'
import { getChapter } from '@/lib/api/server'
import { jsonWithETag } from '@/lib/api/etag'
import { getSessionUser } from '@/lib/api/user-state'
import { getReadingPolicy } from '@/lib/credits/server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; number: string }> },
) {
  try {
    const route = await params
    const id = normalizeStoryRouteId(route.id)
    const n = Number.parseInt(route.number, 10)
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ error: 'Nomor bab tidak valid.' }, { status: 400 })
    }
    const chapter = await getChapter(id, n)
    if (!chapter) {
      return NextResponse.json({ error: 'Bab tidak ditemukan.' }, { status: 404 })
    }

    const [user, policy] = await Promise.all([getSessionUser(), getReadingPolicy()])
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    const accessDecision = await resolveChapterAccess({
      userId: user?.id ?? null,
      storyId: id,
      chapterNumber: chapter.number,
      policy,
    })

    if (!accessDecision.readable) {
      if (accessDecision.reason === 'PAYMENT_REQUIRED') {
        return NextResponse.json({ error: 'Bab ini perlu dibuka dulu.' }, { status: 402 })
      }
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 403 })
    }

    // Konten bab immutable setelah publish → ETag + dukungan 304.
    return jsonWithETag(req, { chapter })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat bab.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
