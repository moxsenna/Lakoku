'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ImageIcon, Sparkles, Check, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  generateStoryCover,
  uploadStoryCover,
  applyStoryCover,
} from '@/lib/api/client'
import { StoryCoverDialog } from '@/components/story-cover-dialog'
import { COVER_PRESETS, type CoverPresetKey } from '@lakoku/contracts'

export interface StoryCoverCandidateItem {
  id: string
  url: string
  preset: string
  createdAt: string
  expiresAt: string
}

function formatRemainingDays(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return 'Kedaluwarsa'
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  if (hours < 24) return `${Math.max(1, hours)} jam`
  const days = Math.ceil(hours / 24)
  return `${days} hari`
}

function getPresetLabel(preset: string): string {
  if (preset in COVER_PRESETS) {
    return COVER_PRESETS[preset as CoverPresetKey]?.label ?? preset
  }
  if (preset === 'unggah') return 'Unggahan'
  return preset
}

/**
 * Aksi sampul untuk pemilik cerita: buat dengan Lakoin, atau unggah sendiri (gratis).
 * Dilengkapi penyimpanan 3 sampul terakhir (retensi 3 hari) untuk pembanding sebelum/sesudah pasang.
 */
export function StoryCoverActions({
  storyId,
  cost,
  generateEnabled,
  userBalance = 0,
  candidates = [],
  currentCover,
}: {
  storyId: string
  cost: number
  generateEnabled: boolean
  userBalance?: number
  candidates?: StoryCoverCandidateItem[]
  currentCover?: string
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null)
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

  async function handleApplyCover(url: string) {
    if (url === currentCover || applyingUrl) return
    setError(null)
    setApplyingUrl(url)
    try {
      const result = await applyStoryCover(storyId, url)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error ?? 'Gagal memasang sampul.')
      }
    } finally {
      setApplyingUrl(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Tombol Buat & Unggah (Vertical Stack anti-overload) */}
      <div className="flex flex-col gap-2">
        {generateEnabled && (
          <Button
            variant="secondary"
            size="default"
            onClick={() => setDialogOpen(true)}
            className="w-full justify-center"
          >
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Buat Sampul — {cost} Lakoin
          </Button>
        )}

        {generateEnabled && (
          <div className="relative flex items-center justify-center py-0.5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border/60" />
            </div>
            <span className="relative bg-card px-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              atau
            </span>
          </div>
        )}

        <Button
          variant="outline"
          size="default"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full justify-center"
        >
          <ImageIcon className="size-4" aria-hidden="true" />
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

      {/* Galeri 3 Sampul Terakhir (Retensi 3 Hari) */}
      {candidates.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              3 Sampul Terakhir
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              Tersimpan 3 hari
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Bandingkan hasil generate dan pilih sampul yang ingin kamu pasang.
          </p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {candidates.map((cand) => {
              const isCurrent = cand.url === currentCover
              const isApplying = applyingUrl === cand.url
              return (
                <div
                  key={cand.id}
                  className={`flex flex-col overflow-hidden rounded-lg border transition-all ${
                    isCurrent
                      ? 'border-primary ring-1 ring-primary bg-primary/5'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
                    <Image
                      src={cand.url}
                      alt="Pratinjau sampul"
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                    {isCurrent && (
                      <div className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="size-3 stroke-[3]" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1 text-[9px] text-white">
                      <span className="line-clamp-1 font-medium">{getPresetLabel(cand.preset)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 p-1.5">
                    <span className="text-[9px] text-muted-foreground text-center">
                      {formatRemainingDays(cand.expiresAt)}
                    </span>
                    {isCurrent ? (
                      <span className="rounded bg-primary/20 py-0.5 text-center text-[10px] font-semibold text-primary">
                        Terpasang
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={isApplying}
                        disabled={Boolean(applyingUrl)}
                        onClick={() => handleApplyCover(cand.url)}
                        className="h-6 w-full text-[10px] px-1"
                      >
                        Pasang
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
