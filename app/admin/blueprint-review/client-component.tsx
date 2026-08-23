/**
 * Client Component for Blueprint Review Dashboard (E-OPS-1 Criterion #4).
 * 
 * Purpose: Real-time updates, form handling, and reader-safe error display.
 * Boundary: "use client" directive required for browser-side interactions
 */
"use client"

import { useState } from 'react'
import type { PendingReviewItem as ContractPendingReviewItem } from '@/lib/types/blueprint.contract'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Helper function for act badge variant */
export function getActBadgeVariant(actBoundary: string): 'secondary' | 'destructive' | 'outline' {
  switch (actBoundary) {
    case 'ACT_1': return 'secondary' as const
    case 'ACT_2': return 'destructive' as const
    default: return 'outline' as const
  }
}

/** Helper function for relative time formatting */
export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 1) return 'Baru saja'
  if (diffMins < 60) return `${diffMins} menit yang lalu`
  
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} jam yang lalu`
  
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} hari yang lalu`
}

interface PendingReviewItem {
  story_id: string
  story_title?: string | null
  tagline?: string | null
  chapter_numbers: number[]
  act_boundary: 'ACT_1' | 'ACT_2' | 'ACT_3'
  findings: Array<'BRAND_LEAK' | 'CANONICAL_CORRUPTION' | 'LEASE_TIMEOUT' | 'PARSE_FAILURE'>
  queue_created_at?: string
}

type ClientComponentProps = {
  initialItems: PendingReviewItem[]
  reviewerRole: 'owner' | 'admin'
}

export default function ClientComponent({ initialItems, reviewerRole }: ClientComponentProps) {
  const [items, setItems] = useState<PendingReviewItem[]>(initialItems)
  const [activeDispositions, setActiveDispositions] = useState<Map<string, boolean>>(new Map())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [successes, setSuccesses] = useState<Map<string, string>>(new Map())

  const handleDispositionSubmit = async (storyId: string, disposition: string, reasonText: string) => {
    try {
      // Set loading state
      setActiveDispositions(prev => new Map(prev).set(storyId, true))
      
      const res = await fetch(`/api/blueprint-review/${encodeURIComponent(storyId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          disposition,
          reason_text: reasonText,
        }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        setErrors(prev => new Map(prev).set(storyId, data.error || 'Gagal mencatat keputusan'))
        setActiveDispositions(prev => new Map(prev).set(storyId, false))
        return
      }
      
      // Clear item from list on success
      setItems(prev => prev.filter(item => item.story_id !== storyId))
      setSuccesses(prev => new Map(prev).set(storyId, disposition))
    } catch (err) {
      setErrors(prev => new Map(prev).set(storyId, err instanceof Error ? err.message : 'Network error'))
    } finally {
      setActiveDispositions(prev => new Map(prev).set(storyId, false))
    }
  }

  return (
    <>
      {/* Inline Error/Success Messages */}
      {errors.size > 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{Array.from(errors.values())[0] || 'Terjadi kesalahan dalam sistem'}</AlertDescription>
        </Alert>
      )}

      {successes.size > 0 && (
        <Alert className="mb-4">
          <AlertTitle>Keputusan Tercatat</AlertTitle>
          <AlertDescription>
            {Array.from(successes.values()).join(', ')}
          </AlertDescription>
        </Alert>
      )}

      {/* Items Grid */}
      <div className="grid grid-cols-1 gap-6">
        {items.map((item) => (
          <BlueprintReviewCard
            key={item.story_id}
            item={item}
            reviewerRole={reviewerRole}
            onSubmit={(disposition, reason) => handleDispositionSubmit(item.story_id, disposition, reason)}
            isLoading={!!activeDispositions.get(item.story_id)}
          />
        ))}
      </div>
    </>
  )
}

interface ReviewCardProps {
  item: PendingReviewItem
  reviewerRole: 'owner' | 'admin'
  onSubmit: (disposition: string, reason: string) => Promise<void>
  isLoading: boolean
}

function BlueprintReviewCard({ item, reviewerRole, onSubmit, isLoading }: ReviewCardProps) {
  const [selectedDisposition, setSelectedDisposition] = useState('')
  const [reasonText, setReasonText] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedDisposition || !reasonText.trim()) {
      return
    }

    await onSubmit(selectedDisposition, reasonText.trim())
    
    // Reset form
    setSelectedDisposition('')
    setReasonText('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-3">
          <span>{item.story_title || 'Story tidak tersedia'}</span>
          <Badge variant={getActBadgeVariant(item.act_boundary)}>
            {item.act_boundary}
          </Badge>
        </CardTitle>
        <CardDescription className="text-sm">
          Genre: N/A • Bab: {item.chapter_numbers.join(', ')} • 
          Dibuat: {formatRelativeTime(item.queue_created_at || new Date().toISOString())}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Findings */}
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase text-muted-foreground">Temuan Insiden</Label>
          <div className="flex flex-wrap gap-2">
            {item.findings.map((finding) => (
              <Badge key={finding} variant="destructive">
                {finding.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>
        
        <Separator />
        
        {/* Resolution Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`disposition-${item.story_id}`}>Keputusan Tinjauan *</Label>
            <select
              id={`disposition-${item.story_id}`}
              value={selectedDisposition}
              onChange={(e) => setSelectedDisposition(e.target.value)}
              required
              disabled={isLoading}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Pilih keputusan...</option>
              <option value="REJECT_BLOCK">REJECT_BLOCK — Tahan permanen</option>
              <option value="RETRY_ALLOW">RETRY_ALLOW — Izinkan retry</option>
              <option value="UNBLOCK_PERMIT">UNBLOCK_PERMIT — Unblock dengan validator rerun</option>
            </select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor={`reason-${item.story_id}`}>Alasan *</Label>
            <Textarea
              id={`reason-${item.story_id}`}
              placeholder="Jelaskan alasan keputusan Anda..."
              rows={4}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              required
              disabled={isLoading}
              className="resize-none"
            />
          </div>
          
          <div className="flex gap-3 pt-2">
            <Button type="submit" variant={reviewerRole === 'owner' ? 'destructive' : 'default'} disabled={!selectedDisposition || !reasonText.trim() || isLoading}>
              {isLoading ? 'Memproses...' : 'Catat Keputusan'}
            </Button>
            
            {!selectedDisposition && (
              <p className="text-xs text-muted-foreground">
                Diperlukan: sumber event nyata (no null/sentinel/placeholder/fake binding). Missing real event → fail closed.
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
