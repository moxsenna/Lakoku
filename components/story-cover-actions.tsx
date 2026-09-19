'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageIcon, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { generateStoryCover, uploadStoryCover } from '@/lib/api/client'

/**
 * Aksi sampul untuk pemilik cerita: buat dengan Lakoin, atau unggah sendiri
 * (gratis). Setelah berhasil, RSC di-refresh supaya sampul baru langsung tampak.
 */
export function StoryCoverActions({
  storyId,
  cost,
  generateEnabled,
}: {
  storyId: string
  cost: number
  generateEnabled: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setError(null)
    setGenerating(true)
    try {
      const result = await generateStoryCover(storyId)
      if (result.ok) {
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
            loading={generating}
            onClick={handleGenerate}
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
      {generating && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sedang membuat sampul... ini bisa memakan waktu hingga setengah menit. Jangan tutup halaman.
        </p>
      )}
    </div>
  )
}
