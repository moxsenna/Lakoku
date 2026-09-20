'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageIcon, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { generateStoryCover, uploadStoryCover } from '@/lib/api/client'
import { StoryCoverDialog } from '@/components/story-cover-dialog'
import type { CoverPresetKey } from '@lakoku/contracts'

/**
 * Aksi sampul untuk pemilik cerita: buat dengan Lakoin, atau unggah sendiri
 * (gratis). Setelah berhasil, RSC di-refresh supaya sampul baru langsung tampak.
 */
export function StoryCoverActions({
  storyId,
  cost,
  generateEnabled,
  userBalance = 0,
}: {
  storyId: string
  cost: number
  generateEnabled: boolean
  userBalance?: number
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate(payload: {
    preset: CoverPresetKey
    customNotes?: string
    includeTitle: boolean
  }) {
    setError(null)
    setGenerating(true)
    try {
      const result = await generateStoryCover(storyId, payload)
      if (result.ok) {
        setDialogOpen(false)
        router.refresh()
      } else {
        setError(result.error ?? 'Sampul gagal dibuat. Coba lagi.')
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const result = await uploadStoryCover(storyId, file)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error ?? 'Sampul gagal diunggah. Coba lagi.')
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {generateEnabled && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="flex-1"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Buat Sampul — {cost} Lakoin
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
          className={generateEnabled ? 'flex-1' : 'w-full'}
        >
          <ImageIcon className="size-3.5" aria-hidden="true" />
          Unggah Gambar
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
      <StoryCoverDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        storyId={storyId}
        cost={cost}
        userBalance={userBalance}
        onGenerate={handleGenerate}
        generating={generating}
        error={error}
      />
    </div>
  )
}
