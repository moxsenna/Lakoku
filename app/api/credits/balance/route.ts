import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCreditBalance } from '@/lib/credits/server'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const balance = await getCreditBalance(auth.user.id)
  return NextResponse.json({ balance })
}

export const dynamic = 'force-dynamic'
