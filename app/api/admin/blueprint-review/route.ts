/**
 * Blueprint Review Queue Reader API (E-OPS-1 Criterion #1).
 * 
 * Purpose: Fetch pending review items from exactly-once queue.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() auth seam; NO invented role='reviewer'
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/api/server'
import { getSessionUser } from '@/lib/api/user-state'

export async function GET(request: Request) {
  try {
    // Require authorized admin user via existing auth seam
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthenticated' },
        { status: 401 }
      )
    }

    // Check admin role via DB (reuse lib/admin/auth.ts pattern)
    const db = createAdminClient()
    const { data: adminRole } = await db
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (!adminRole) {
      return NextResponse.json(
        { error: 'Forbidden - requires owner/admin role' },
        { status: 403 }
      )
    }

    // Fetch pending review items with full details
    const { data: pendingItems, error } = await db
      .rpc('vw_blueprint_pending_review_items') // View from migration
      .select('*')
      .order('queue_created_at', { ascending: true })
      .limit(100)

    if (error || !pendingItems) {
      console.error('Error fetching pending items:', error)
      return NextResponse.json(
        { error: 'Gagal memuat daftar item tinjauan.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ items: pendingItems })
  } catch (err) {
    console.error('Unexpected error in blueprint-review queue:', err)
    return NextResponse.json(
      { error: 'Terjadi kesalahan sistem.' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = false
