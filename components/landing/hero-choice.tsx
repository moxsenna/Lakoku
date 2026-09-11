'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'

const OPTIONS = [
  { id: 'buka', label: 'Buka pesannya' },
  { id: 'abaikan', label: 'Abaikan untuk malam ini' },
] as const

type OptionId = (typeof OPTIONS)[number]['id']

/**
 * Mini-choice di hero: pengunjung merasakan satu keputusan kecil sebelum
 * kenal produk. Pilihan hanya dicatat di state lokal — tidak ada advance
 * cerita, jadi tidak ada risiko double-advance.
 */
export function HeroChoice() {
  const [choice, setChoice] = useState<OptionId | null>(null)
  const chosen = OPTIONS.find((option) => option.id === choice)

  return (
    <div>
      <div
        className="lk-fade-up rounded-2xl border border-border bg-card/80 p-5 backdrop-blur-sm"
        style={{ animationDelay: '120ms' }}
      >
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          <span>23.47</span>
          <span>1 pesan baru</span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Sebuah pesan masuk dari nomor yang sudah kamu hapus tiga tahun lalu.
        </p>
        <p className="mt-3 font-serif text-xl leading-snug text-foreground">
          &ldquo;Aku tahu apa yang sebenarnya terjadi malam itu.&rdquo;
        </p>
      </div>

      {chosen ? (
        <div className="lk-fade-up mt-3 flex flex-col gap-4" role="status">
          <div className="flex min-h-13 items-center gap-2 rounded-2xl border border-primary bg-primary/10 px-5 text-sm font-semibold text-foreground">
            <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
            {chosen.label}
          </div>
          <div>
            <p className="font-serif text-2xl text-foreground">Pilihanmu dicatat.</p>
            <p className="mt-1 text-sm text-muted-foreground">Tapi itu baru keputusan pertama.</p>
          </div>
          <Link
            href="/mulai"
            className="flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Mulai Ceritaku
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <p className="text-center text-[11px] text-muted-foreground">
            3 bab pertama gratis · tanpa kartu
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {OPTIONS.map((option, index) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setChoice(option.id)}
                className="lk-fade-up flex min-h-13 items-center justify-between gap-3 rounded-2xl border border-border bg-card/80 px-5 text-left text-sm font-semibold text-foreground backdrop-blur-sm transition-colors hover:border-primary/60"
                style={{ animationDelay: `${260 + index * 140}ms` }}
              >
                {option.label}
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
          <p
            className="lk-fade-up mt-4 text-center text-[11px] text-muted-foreground"
            style={{ animationDelay: '560ms' }}
          >
            Pilihanmu bisa kembali jauh setelah kamu melupakannya.
          </p>
        </>
      )}
    </div>
  )
}
