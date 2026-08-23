/**
 * Blueprint Review Queue Reader API (E-OPS-1 Criterion #1).
 * 
 * Purpose: Fetch pending review items from exactly-once queue.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() auth seam; NO invented role='reviewer'; single approved path per allowlist
 */
import { NextResponse } from 'next/server'
import { getPendingItems, claimQueueItem } from '@lakoku/runtime'
import { requireAdminUser } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'
export const revalidate = false // Never cache reader-facing content

export async function GET(request: Request) {
  try {
    // Require authorized admin user via existing auth seam
    await requireAdminUser()
    
    // Fetch pending review items with full details
    const pendingItems = await getPendingItems()
    
    return NextResponse.json({ items: pendingItems })
  } catch (err) {
    if (err instanceof Error && err.message === 'Forbidden') {
      return NextResponse.json(
        { error: 'Forbidden - requires owner/admin role' },
        { status: 403 }
      )
    }
    
    console.error('Unexpected error in blueprint-review queue:', err)
    return NextResponse.json(
      { error: 'Gagal memuat daftar item tinjauan.' },
      { status: 500 }
    )
  }
}

// POST endpoint for claiming queue items (worker processes only)
export async function POST(_request: Request) {
  try {
    // Claim is handled via separate worker process, not API call
    return NextResponse.json({ 
      success: false,
      message: 'Use direct database claim for workers'
    })
  } catch (err) {
    console.error('Claim queue item failed:', err)
    return NextResponse.json(
      { error: 'Gagal mengklaim antrian.' },
      { status: 500 }
    )
  }
}

// POST endpoint for recording disposition (admin dashboard only)
export async function POST_disposition(_request: Request) {
  // This is handled by [id]/route.ts for individual stories
  // See app/api/blueprint-review/[id]/route.ts
  return NextResponse.json({ 
    success: false,
    message: 'Use /api/blueprint-review/{story_id} for dispositions'
  })
}
