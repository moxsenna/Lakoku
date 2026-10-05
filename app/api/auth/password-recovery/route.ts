import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ ok: true, redirect: '/auth/forgot-password' })
}

export const dynamic = 'force-dynamic'
