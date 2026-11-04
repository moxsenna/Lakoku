import { NextResponse } from 'next/server'
import { requireAuthoringSessionUser } from '@/lib/authoring/action-auth'
import { getStorySetupJobById } from '@/lib/authoring/setup-job.server'
import {
  StorySetupJobErrorCodeSchema,
  StorySetupJobStageSchema,
  StorySetupJobStatusSchema,
  type StorySetupJobErrorCode,
  type StorySetupJobStage,
  type StorySetupJobStatus,
} from '@lakoku/contracts'

/**
 * GET /api/stories/setup-jobs/[id]
 *
 * Poll status job setup milik sendiri. Hanya owner yang boleh melihat —
 * job user lain direspons 404 (tanpa membocorkan keberadaan).
 */

function parseEnum<T>(schema: { safeParse: (v: unknown) => { success: boolean; data: T } }, value: unknown): T | undefined {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let userId: string
  try {
    const user = await requireAuthoringSessionUser()
    userId = user.id
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Masuk untuk membuat cerita.' },
      { status: 401 },
    )
  }

  const job = await getStorySetupJobById(id)
  if (!job || job.userId !== userId) {
    return NextResponse.json(
      { ok: false, error: 'Job setup tidak ditemukan.' },
      { status: 404 },
    )
  }

  const status = parseEnum<StorySetupJobStatus>(StorySetupJobStatusSchema, job.status)
  const stage = parseEnum<StorySetupJobStage>(StorySetupJobStageSchema, job.stage)
  const errorCode = parseEnum<StorySetupJobErrorCode>(StorySetupJobErrorCodeSchema, job.errorCode)

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status: status ?? 'failed',
      stage: stage ?? 'cast',
      ...(errorCode ? { errorCode } : {}),
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      ...(job.storyId ? { storyId: job.storyId } : {}),
    },
  })
}

export const dynamic = 'force-dynamic'
