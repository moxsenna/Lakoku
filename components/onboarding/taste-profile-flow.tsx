'use client'

/**
 * Onboarding Taste Profile — 5 langkah selera cerita.
 *
 * Alur: genre → trope disukai → trope dihindari + batas konten →
 * intensitas + romance + pacing → gaya bahasa + tipe ending.
 *
 * Guest bisa mengisi (localStorage), login bisa simpan ke DB.
 * Tombol "Lewati dulu" menyimpan profile kosong + skippedAt.
 * ?next= param menentukan redirect setelah selesai.
 */
import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  actSaveTasteProfile,
  actSkipTasteProfile,
} from '@/app/onboarding/selera/actions'
import {
  readGuestTasteProfile,
  saveGuestTasteProfile,
} from '@/lib/taste-profile/storage'
import {
  createDefaultTasteProfile,
  type TasteProfile,
} from '@/lib/taste-profile/schema'

// ─── Step definitions ─────────────────────────────────────────────

interface StepDefinition {
  id: string
  eyebrow: string
  title: string
  subtitle?: string
  options: { label: string; value: string }[]
  multiSelect?: boolean
  /** Field yang di-set saat step ini selesai (untuk multi-select). */
  field?: keyof TasteProfile
}

const STEPS: StepDefinition[] = [
  {
    id: 'genre',
    eyebrow: 'LANGKAH 1 DARI 5',
    title: 'Genre apa yang paling kamu suka?',
    subtitle: 'Pilih satu atau beberapa.',
    multiSelect: true,
    field: 'preferredGenres',
    options: [
      { label: 'Drama keluarga', value: 'Drama keluarga' },
      { label: 'Romansa', value: 'Romansa' },
      { label: 'Misteri & rahasia', value: 'Misteri & rahasia' },
      { label: 'Fantasi & kerajaan', value: 'Fantasi & kerajaan' },
      { label: 'Slice of life', value: 'Slice of life' },
      { label: 'Thriller & bertahan hidup', value: 'Thriller & bertahan hidup' },
    ],
  },
  {
    id: 'tropes-liked',
    eyebrow: 'LANGKAH 2 DARI 5',
    title: 'Konflik atau trope apa yang kamu suka?',
    subtitle: 'Pilih satu atau beberapa.',
    multiSelect: true,
    field: 'likedTropes',
    options: [
      { label: 'Cinta lama yang kembali', value: 'Cinta lama yang kembali' },
      { label: 'Pernikahan kontrak', value: 'Pernikahan kontrak' },
      { label: 'Rahasia keluarga & warisan', value: 'Rahasia keluarga & warisan' },
      { label: 'Bangkit setelah jatuh', value: 'Bangkit setelah jatuh' },
      { label: 'Sekutu jadi cinta', value: 'Sekutu jadi cinta' },
      { label: 'Balas dendam yang tertunda', value: 'Balas dendam yang tertunda' },
    ],
  },
  {
    id: 'avoided',
    eyebrow: 'LANGKAH 3 DARI 5',
    title: 'Hal yang sebaiknya dikurangi',
    subtitle: 'Kami akan menghindari ini saat membuat cerita untukmu.',
    multiSelect: true,
    field: 'avoidedTropes',
    options: [
      { label: 'Kekerasan eksplisit', value: 'Kekerasan eksplisit' },
      { label: 'Pengkhianatan pasangan', value: 'Pengkhianatan pasangan' },
      { label: 'Kematian tokoh utama', value: 'Kematian tokoh utama' },
      { label: 'Horor & jumpscare', value: 'Horor & jumpscare' },
      { label: 'Cinta segitiga', value: 'Cinta segitiga' },
      { label: 'Konflik perang', value: 'Konflik perang' },
    ],
  },
  {
    id: 'intensity',
    eyebrow: 'LANGKAH 4 DARI 5',
    title: 'Seberapa kuat kamu suka ceritanya?',
    options: [
      { label: 'Ringan — cukup menghibur dan menyenangkan', value: 'ringan' },
      { label: 'Sedang — ada konflik tapi tidak terlalu berat', value: 'sedang' },
      { label: 'Tinggi — drama penuh, emosi naik-turun', value: 'tinggi' },
    ],
  },
  {
    id: 'ending-style',
    eyebrow: 'LANGKAH 5 DARI 5',
    title: 'Akhir dan gaya bahasa yang kamu suka',
    subtitle: 'Pilih yang paling menggambarkan seleramu.',
    options: [
      { label: 'Keadilan — semua rahasia terbuka dan yang benar menang', value: 'keadilan' },
      { label: 'Kedamaian — melepaskan masa lalu, melangkah dengan tenang', value: 'kedamaian' },
      { label: 'Kemenangan — merebut kembali yang hilang', value: 'kemenangan' },
      { label: 'Tragis manis — pahit tapi berharga', value: 'tragis-manis' },
    ],
  },
]

// ─── Helper ───────────────────────────────────────────────────────

/** Rakit partial answers jadi TasteProfile utuh untuk disimpan. */
function buildProfile(
  stepAnswers: Partial<TasteProfile>,
  isSkip: boolean,
): TasteProfile {
  const base = createDefaultTasteProfile()
  const now = new Date().toISOString()

  if (isSkip) {
    return { ...base, skippedAt: now, updatedAt: now }
  }

  return {
    ...base,
    ...stepAnswers,
    completedAt: now,
    updatedAt: now,
  }
}

// ─── Komponen ─────────────────────────────────────────────────────

export function TasteProfileFlow() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const nextUrl = searchParams.get('next') || '/beranda'

  const [step, setStep] = useState(0)
  const [stepAnswers, setStepAnswers] = useState<Partial<TasteProfile>>({})
  const [err, setErr] = useState<string | null>(null)

  const currentStep = STEPS[step]
  const isLastStep = step === STEPS.length - 1
  const totalSteps = STEPS.length

  // ── Multi-select toggle ─────────────────────────────────────────

  function toggleMulti(field: keyof TasteProfile, value: string) {
    const current = (stepAnswers[field] as string[]) ?? []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]

    setStepAnswers((prev) => ({ ...prev, [field]: next }))
  }

  function isSelected(field: keyof TasteProfile, value: string): boolean {
    const current = (stepAnswers[field] as string[]) ?? []
    return current.includes(value)
  }

  // ── Single-select untuk step 4 & 5 ─────────────────────────────

  function handleNext() {
    if (isLastStep) {
      submitProfile(false)
      return
    }
    setStep((s) => s + 1)
  }

  function handleBack() {
    if (step === 0) {
      router.back()
      return
    }
    setStep((s) => s - 1)
  }

  // ── Submit / Skip ───────────────────────────────────────────────

  function submitProfile(isSkip: boolean) {
    setErr(null)

    const profile = buildProfile(stepAnswers, isSkip)

    startTransition(async () => {
      try {
        // Coba simpan ke server.
        const res = isSkip
          ? await actSkipTasteProfile()
          : await actSaveTasteProfile(profile)

        if (!res.ok) {
          // Guest: simpan ke localStorage.
          saveGuestTasteProfile(profile)
        }

        router.push(nextUrl)
      } catch {
        // Fallback: simpan ke localStorage + redirect.
        saveGuestTasteProfile(profile)
        router.push(nextUrl)
      }
    })
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-10 pt-6">
      {/* Header: back + progress */}
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali"
          className="flex size-10 items-center justify-center rounded-full bg-card text-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <div className="flex flex-1 items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= step ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </header>

      {/* Error state */}
      {err && (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm text-destructive" role="alert">{err}</p>
        </div>
      )}

      {/* Step content */}
      <section className="lk-fade-up mt-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-lavender">
            {currentStep.eyebrow}
          </span>
          <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
            {currentStep.title}
          </h1>
          {currentStep.subtitle && (
            <p className="text-sm text-muted-foreground">{currentStep.subtitle}</p>
          )}
        </div>

        <div className="flex flex-col gap-3" role="group" aria-label={currentStep.title}>
          {currentStep.options.map((opt) => {
            const active =
              currentStep.multiSelect && currentStep.field
                ? isSelected(currentStep.field, opt.value)
                : stepAnswers.endingBias === opt.value ||
                  stepAnswers.dramaIntensity === opt.value

            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  if (currentStep.multiSelect && currentStep.field) {
                    toggleMulti(currentStep.field, opt.value)
                  } else if (currentStep.id === 'intensity') {
                    setStepAnswers((prev) => ({ ...prev, dramaIntensity: opt.value as TasteProfile['dramaIntensity'] }))
                  } else if (currentStep.id === 'ending-style') {
                    setStepAnswers((prev) => ({ ...prev, endingBias: opt.value as TasteProfile['endingBias'] }))
                  }
                }}
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left text-sm font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/50',
                )}
              >
                <span>{opt.label}</span>
                {active && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </section>

      {/* Bottom actions */}
      <div className="mt-auto flex flex-col gap-3 pt-6">
        {isLastStep ? (
          <>
            <button
              type="button"
              onClick={() => submitProfile(false)}
              disabled={pending}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? 'Menyimpan...' : 'Simpan seleraku'}
            </button>
            <button
              type="button"
              onClick={() => submitProfile(true)}
              disabled={pending}
              className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-50"
            >
              Lewati dulu
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Lanjut
          </button>
        )}
      </div>
    </main>
  )
}
