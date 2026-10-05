import { NextRequest, NextResponse } from 'next/server'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const next = sanitizeNextPath(body.next ?? '/beranda')
  return NextResponse.json({ ok: true, next })
}

export const dynamic = 'force-dynamic'
