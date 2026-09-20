import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isMissionKey, MISSION_LABELS } from '@/lib/missions/policy'
import { claimMission } from '@/lib/missions/server'
import { notifyMissionComplete } from '@lakoku/notifications/server'

const claimSchema = z.object({
  missionKey: z.string().min(1).max(64),
})

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()

  if (!auth?.user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload tidak valid.' }, { status: 400 })
  }

  const parsed = claimSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Kunci misi wajib diisi.' }, { status: 400 })
  }

  const { missionKey } = parsed.data
  if (!isMissionKey(missionKey)) {
    return NextResponse.json({ error: 'Kunci misi tidak dikenali.' }, { status: 400 })
  }

  const result = await claimMission(auth.user.id, missionKey)

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      disabled: 403,
      duplicate: 409,
      incomplete: 422,
      unknown_mission: 404,
      error: 500,
    }
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: statusMap[result.reason] ?? 400 },
    )
  }

  // Pengingat transaksional (push): best-effort, idempoten per (user, misi, hari).
  // Tidak boleh menggagalkan klaim bila layanan push mati.
  void notifyMissionComplete({
    userId: auth.user.id,
    missionName: MISSION_LABELS[missionKey].title,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, status: 'ok' })
}

export const dynamic = 'force-dynamic'
