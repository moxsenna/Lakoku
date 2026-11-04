import { NextResponse } from 'next/server'
import { requireAuthoringSessionUser } from '@/lib/authoring/action-auth'
import { getStorySetupJobById } from '@/lib/authoring/setup-job.server'
import {
  StorySetupJobErrorCodeSchema,
  StorySetupJobStageSchema,
  StorySetupJobStatusSchema,
} from '@lakoku/contracts'

/**
 * GET /api/stories/setup-jobs/[id]
 *
 * Poll status job setup milik sendiri. Hanya owner yang boleh melihat —
 * job user lain direspons 404 (tanpa membocorkan keberadaan).
 */
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

  const statusParsed = StorySetupJobStatusSchema.safeParse(job.status)
  const stageParsed = StorySetupJobStageSchema.safeParse(job.stage)
  const errorCodeParsed = StorySetupJobErrorCodeSchema.safeParse(job.errorCode)

  const status = statusParsed.success ? statusParsed.data : 'failed'
  const stage = stageParsed.success ? stageParsed.data : 'cast'
  const errorCode = errorCodeParsed.success ? errorCodeParsed.data : undefined

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status,
      stage,
      ...(errorCode ? { errorCode } : {}),
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      ...(job.storyId ? { storyId: job.storyId } : {}),
    },
  })
}

export const dynamic = 'force-dynamic'
