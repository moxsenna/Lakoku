import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getDailyMissions } from '@/lib/missions/server'

export async function GET(): Promise<Response> {
  const user = await getSessionUser()

  if (!user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const snapshot = await getDailyMissions(user.id)
  return NextResponse.json(snapshot)
}

export const dynamic = 'force-dynamic'
