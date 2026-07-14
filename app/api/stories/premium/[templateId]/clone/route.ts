import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import {
  clonePremiumStoryForUser,
  PremiumCloneError,
} from '@/lib/api/premium-clone.server'

const validIdempotencyKey = (value: string | null): value is string =>
  typeof value === 'string'
  && value.length >= 1
  && value.length <= 240
  && /^[\x21-\x7E]+$/.test(value)

function successBody(result: {
  storyId: string
  redirectUrl: string
  replayed: boolean
}) {
  return {
    storyId: result.storyId,
    redirectUrl: result.redirectUrl,
    replayed: result.replayed,
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  try {
    const cookie = await createClient()
    const { data: auth, error: authError } = await cookie.auth.getUser()
    if (authError || !auth?.user) {
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
    }

    const idempotencyKey = req.headers.get('Idempotency-Key')
    if (!validIdempotencyKey(idempotencyKey)) {
      return NextResponse.json({ error: 'Idempotency-Key tidak valid.' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'userId')) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
    }

    const route = await params
    const templateStoryId = normalizeStoryRouteId(route.templateId)
    const result = await clonePremiumStoryForUser({
      userId: auth.user.id,
      templateStoryId,
      idempotencyKey,
    })

    return NextResponse.json(
      successBody(result),
      { status: result.replayed ? 200 : 201 },
    )
  } catch (error) {
    if (error instanceof PremiumCloneError) {
      if (error.code === 'INVALID_IDEMPOTENCY_KEY') {
        return NextResponse.json({ error: 'Idempotency-Key tidak valid.' }, { status: 400 })
      }
      if (error.code === 'INVALID_TEMPLATE_ID' || error.code === 'INVALID_USER') {
        return NextResponse.json({ error: 'Template premium tidak valid.' }, { status: 400 })
      }
      if (error.code === 'IDEMPOTENCY_CONFLICT') {
        return NextResponse.json(
          { error: 'Permintaan berkonflik dengan kunci idempotensi.' },
          { status: 409 },
        )
      }
      if (error.code === 'INVALID_TEMPLATE') {
        return NextResponse.json(
          { error: 'Template premium tidak ditemukan.' },
          { status: 404 },
        )
      }
      if (error.code === 'GENERATION_IN_PROGRESS' && error.result) {
        return NextResponse.json(successBody(error.result), { status: 202 })
      }
      if (error.code === 'GENERATION_FAILED') {
        return NextResponse.json({ error: 'Bab pertama gagal dibuat.' }, { status: 422 })
      }
    }
    return NextResponse.json({ error: 'Gagal menyalin cerita premium.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
