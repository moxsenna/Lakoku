/**
 * Blueprint Review Dashboard — E5 Human Workflow Interface (E-OPS-1 Criterion #4).
 * 
 * Purpose: Admin dashboard for reviewing failed story generation incidents.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'
 * CORRECTION (Static Gate fb64c47): Remove empty-cookie loopback fetch, call workflow directly
 */
import { redirect } from 'next/navigation'
import { requireAdminUser } from '@/lib/admin/auth'
import { getPendingItems } from '@/lib/runtime/blueprint-workflow.server'
import type { PendingReviewItem } from '@/lib/types/blueprint.contract'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import ClientComponent from './client-component'

export const dynamic = 'force-dynamic'
export const revalidate = 0 // Never cache reader-facing content

// Server component that checks auth and fetches initial data via DIRECT WORKFLOW CALL (no HTTP loopback)
async function getInitialPendingItems(): Promise<PendingReviewItem[]> {
  try {
    // Call workflow directly after requireAdminUser(), no cookie/HTTP loopback
    const items = await getPendingItems()
    // Cast as PendingReviewItem[] - contract interface extends BlueprintQueueItem which has undefined optional fields
    return items as unknown as PendingReviewItem[] as any
  } catch (err) {
    console.error('Error fetching pending items:', err)
    return []
  }
}

export default async function Page() {
  const admin = await requireAdminUser()
  
  // Ensure only owner/admin can access
  if (admin.role !== 'owner' && admin.role !== 'admin') {
    redirect('/')
  }
  
  const items = await getInitialPendingItems()
  
  return (
    <div className="container max-w-6xl py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Tinjauan Blueprint - E5 Workflow</CardTitle>
          <CardDescription>
            Hubungi untuk menyelesaikan kegagalan generasi story yang terjadi saat ini.
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          {/* Role badge display */}
          <div className="mb-4">
            <Badge variant={admin.role === 'owner' ? 'destructive' : 'secondary'}>
              Role: {admin.role === 'owner' ? 'Owner' : 'Admin'}
            </Badge>
          </div>
          
          {/* Client component with initial data props */}
          <ClientComponent initialItems={items} reviewerRole={admin.role} />
        </CardContent>
      </Card>
    </div>
  )
}
