'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Sparkles, X, Coins, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  COVER_PRESETS,
  COVER_PRESET_KEYS,
  type CoverPresetKey,
} from '@lakoku/contracts'

interface StoryCoverDialogProps {
  open: boolean
  onClose: () => void
  storyId: string
  cost: number
  userBalance: number
  onGenerate: (payload: {
    preset: CoverPresetKey
    customNotes?: string
    includeTitle: boolean
  }) => Promise<void>
  generating: boolean
  error: string | null
}

export function StoryCoverDialog({
  open,
  onClose,
  storyId: _storyId,
  cost,
  userBalance,
  onGenerate,
  generating,
  error,
}: StoryCoverDialogProps) {
  const [mounted, setMounted] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<CoverPresetKey>('sinematik')
  const [customNotes, setCustomNotes] = useState('')
  const [includeTitle, setIncludeTitle] = useState(false)

  const isInsufficient = userBalance < cost

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !generating) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, generating, onClose])

  if (!open || !mounted) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (generating || isInsufficient) return
    await onGenerate({
      preset: selectedPreset,
      customNotes: customNotes.trim() ? customNotes.trim().slice(0, 80) : undefined,
      includeTitle,
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-cover-dialog-title"
      onClick={() => {
        if (!generating) onClose()
      }}
    >
      <div
        className="lk-fade-up flex max-h-[85svh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-2xl sm:rounded-3xl sm:max-h-[80svh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <h2 id="story-cover-dialog-title" className="font-serif text-lg text-foreground">
              Buat Sampul Cerita
            </h2>
          </div>
          <button
            type="button"
            disabled={generating}
            onClick={onClose}
            aria-label="Tutup"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
          {/* Status Saldo & Biaya */}
          <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center gap-2">
              <Coins className="size-4 text-amber-500" aria-hidden="true" />
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Saldo Lakoin Kamu</span>
                <span className="text-sm font-semibold text-foreground">{userBalance} Lakoin</span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-muted-foreground">Biaya Pembuatan</span>
              <span className="text-sm font-semibold text-primary">{cost} Lakoin</span>
            </div>
          </div>

          {isInsufficient && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
              <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 leading-relaxed">
                <span>Saldo Lakoin tidak cukup ({userBalance}/{cost}). </span>
                <Link
                  href="/kredit"
                  className="font-semibold underline hover:text-amber-400"
                  onClick={onClose}
                >
                  Isi Lakoin sekarang
                </Link>
              </div>
            </div>
          )}

          {/* 1. Pilih Preset Gaya */}
          <div className="mb-4 flex flex-col gap-2">
            <label className="text-xs font-semibold text-foreground">
              1. Pilih Gaya Visual
            </label>
            <div className="grid grid-cols-1 gap-2">
              {COVER_PRESET_KEYS.map((key) => {
                const preset = COVER_PRESETS[key]
                const isSelected = selectedPreset === key
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={generating}
                    onClick={() => setSelectedPreset(key)}
                    className={`flex items-start justify-between rounded-xl border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card/60 hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 pr-2">
                      <span className="text-xs font-medium text-foreground">
                        {preset.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {preset.description}
                      </span>
                    </div>
                    <div
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border mt-0.5 ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40'
                      }`}
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="size-2.5 stroke-[3]" />}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Catatan Visual Tambahan (Opsional) */}
          <div className="mb-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="custom-notes" className="text-xs font-semibold text-foreground">
                2. Catatan Visual (Opsional)
              </label>
              <span className="text-[10px] text-muted-foreground font-mono">
                {customNotes.length}/80
              </span>
            </div>
            <input
              id="custom-notes"
              type="text"
              disabled={generating}
              maxLength={80}
              placeholder="Contoh: baju seragam sekolah, latar hujan senja..."
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {/* 3. Checkbox Judul Buku */}
          <div className="mb-4">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card/40 p-3 hover:bg-muted/30">
              <input
                type="checkbox"
                disabled={generating}
                checked={includeTitle}
                onChange={(e) => setIncludeTitle(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground">
                  Tampilkan teks judul novel di dalam gambar
                </span>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  Gambar akan memuat tipografi judul cerita (jika tidak dicentang, gambar dibuat polos tanpa teks).
                </span>
              </div>
            </label>
          </div>

          {/* Error Message */}
          {error && (
            <p className="mb-4 text-xs leading-relaxed text-destructive">{error}</p>
          )}

          {/* Warning Generator Running */}
          {generating && (
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              Sedang meracik sampul ceritamu... proses ini membutuhkan waktu 15–30 detik. Jangan tutup dialog.
            </p>
          )}

          {/* Actions CTA */}
          <div className="mt-auto pt-2">
            <Button
              type="submit"
              variant="default"
              loading={generating}
              disabled={isInsufficient || generating}
              className="w-full"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Buat Sekarang — {cost} Lakoin
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
