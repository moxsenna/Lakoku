import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDailyMissions } from '@/lib/missions/server'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()

  if (!auth?.user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const snapshot = await getDailyMissions(auth.user.id)
  return NextResponse.json(snapshot)
}

export const dynamic = 'force-dynamic'
