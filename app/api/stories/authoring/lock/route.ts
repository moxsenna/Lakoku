import { NextResponse } from 'next/server'
import { lockStoryBibleForSession } from '@/lib/api/authoring-lock.server'
import { AUTHORING_AUTH_REQUIRED_ERROR } from '@/lib/authoring/action-auth'

/**
 * POST /api/stories/authoring/lock
 *
 * Authenticated lock of a story bible draft (session cookie / Supabase JWT via cookies).
 * Android/web: same contract. Body = StoryBibleDraft JSON.
 * Response mirrors former server action shape (ok / needsAuthor / error).
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON tidak valid.' }, { status: 400 })
  }

  const result = await lockStoryBibleForSession(body)

  if (!result.ok) {
    if ('needsAuthor' in result && result.needsAuthor) {
      return NextResponse.json(result, { status: 422 })
    }
    const status =
      'error' in result && result.error === AUTHORING_AUTH_REQUIRED_ERROR ? 401 : 400
    return NextResponse.json(result, { status })
  }

  return NextResponse.json(result, { status: 201 })
}

export const dynamic = 'force-dynamic'
