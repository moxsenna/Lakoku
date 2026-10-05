import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance } from '@/lib/credits/server'

export async function GET(): Promise<Response> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const balance = await getCreditBalance(user.id)
  return NextResponse.json({ balance })
}

export const dynamic = 'force-dynamic'
