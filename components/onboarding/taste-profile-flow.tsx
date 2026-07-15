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

// ── Genre → trope/konflik mapping (dynamic step 2) ────────────────

const GENRE_TROPE_OPTIONS: Record<string, string[]> = {
  'Misteri & rahasia': [
    'Rahasia keluarga yang dikubur lama',
    'Surat lama yang mengubah warisan',
    'Identitas asli yang disembunyikan',
    'Kematian lama yang belum terjawab',
    'Saksi yang tiba-tiba muncul',
    'Kebenaran yang sengaja ditutup keluarga',
  ],
  'Romansa': [
    'Cinta lama yang kembali',
    'Pernikahan kontrak',
    'Sekutu jadi cinta',
    'Cinta yang harus diperjuangkan lagi',
    'Hubungan pura-pura yang jadi nyata',
    'Orang yang salah di waktu yang tepat',
  ],
  'Drama keluarga': [
    'Konflik warisan yang memecah keluarga',
    'Rahasia keluarga & warisan',
    'Bangkit setelah jatuh',
    'Pengorbanan demi keluarga',
    'Anak yang kembali setelah bertahun-tahun',
    'Pilihan antara keluarga dan cinta',
  ],
  'Fantasi & kerajaan': [
    'Tahta yang diperebutkan',
    'Takdir kerajaan yang tersembunyi',
    'Sihir terlarang yang kembali muncul',
    'Aliansi dua kerajaan yang rapuh',
    'Ramalan yang mengubah segalanya',
    'Pengkhianatan di balik takhta',
  ],
  'Slice of life': [
    'Hidup baru di tempat tak terduga',
    'Persahabatan yang mengubah hidup',
    'Kesempatan kedua di usia dewasa',
    'Menemukan makna di hal sederhana',
    'Pulang ke kampung halaman',
    'Mimpi kecil yang akhirnya tercapai',
  ],
  'Thriller & bertahan hidup': [
    'Terjebak tanpa jalan keluar',
    'Balas dendam yang tertunda',
    'Dikhianati oleh orang terdekat',
    'Berlari dari masa lalu',
    'Permainan berbahaya yang tak bisa dihentikan',
    'Satu keputusan yang mengubah segalanya',
  ],
}

// ── Genre → avoided options mapping (dynamic step 3) ──────────────

const GENRE_AVOIDED_OPTIONS: Record<string, string[]> = {
  'Misteri & rahasia': [
    'Twist terlalu tiba-tiba',
    'Tokoh terlalu bodoh demi plot',
    'Rahasia yang tidak terjawab',
    'Horor berlebihan',
    'Kekerasan eksplisit',
    'Konflik perang',
  ],
  'Romansa': [
    'Pengkhianatan pasangan',
    'Cinta segitiga',
    'Hubungan toxic yang diromantisasi',
    'Kekerasan eksplisit',
    'Kematian tokoh utama',
    'Konflik perang',
  ],
  'Drama keluarga': [
    'Kekerasan eksplisit',
    'Pengkhianatan pasangan',
    'Kematian tokoh utama',
    'Horor & jumpscare',
    'Cinta segitiga',
    'Konflik perang',
  ],
  'Fantasi & kerajaan': [
    'Kekerasan eksplisit',
    'Horor & jumpscare',
    'Romansa berlebihan',
    'Kematian tokoh utama',
    'Plot armor berlebihan',
    'Konflik perang',
  ],
  'Slice of life': [
    'Kekerasan eksplisit',
    'Drama berlebihan',
    'Kematian tokoh utama',
    'Horor & jumpscare',
    'Konflik perang',
    'Pengkhianatan pasangan',
  ],
  'Thriller & bertahan hidup': [
    'Horor & jumpscare',
    'Kekerasan eksplisit',
    'Kematian tokoh utama',
    'Cinta segitiga',
    'Pengkhianatan pasangan',
    'Plot armor berlebihan',
  ],
}

const FALLBACK_TROPE_OPTIONS: string[] = [
  'Cinta lama yang kembali',
  'Pernikahan kontrak',
  'Rahasia keluarga & warisan',
  'Bangkit setelah jatuh',
  'Sekutu jadi cinta',
  'Balas dendam yang tertunda',
]

const FALLBACK_AVOIDED_OPTIONS: string[] = [
  'Kekerasan eksplisit',
  'Pengkhianatan pasangan',
  'Kematian tokoh utama',
  'Horor & jumpscare',
  'Cinta segitiga',
  'Konflik perang',
]

const MAX_OPTIONS = 6

/** Gabungkan opsi dari genre yang dipilih, deduplicate, max 6. */
function buildOptionsFromGenres(
  selectedGenres: string[],
  genreMap: Record<string, string[]>,
  fallback: string[],
): { label: string; value: string }[] {
  if (!selectedGenres.length) {
    return fallback.map((v) => ({ label: v, value: v }))
  }

  const seen = new Set<string>()
  const result: string[] = []

  for (const genre of selectedGenres) {
    const options = genreMap[genre]
    if (!options) continue
    for (const opt of options) {
      if (result.length >= MAX_OPTIONS) break
      if (seen.has(opt)) continue
      seen.add(opt)
      result.push(opt)
    }
    if (result.length >= MAX_OPTIONS) break
  }

  if (result.length < MAX_OPTIONS) {
    for (const opt of fallback) {
      if (result.length >= MAX_OPTIONS) break
      if (seen.has(opt)) continue
      seen.add(opt)
      result.push(opt)
    }
  }

  return result.map((v) => ({ label: v, value: v }))
}

// ── Static steps (genre, intensity, ending-style) ─────────────────

const GENRE_STEP: StepDefinition = {
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
}

const INTENSITY_STEP: StepDefinition = {
  id: 'intensity',
  eyebrow: 'LANGKAH 4 DARI 5',
  title: 'Seberapa kuat kamu suka ceritanya?',
  options: [
    { label: 'Ringan — cukup menghibur dan menyenangkan', value: 'ringan' },
    { label: 'Sedang — ada konflik tapi tidak terlalu berat', value: 'sedang' },
    { label: 'Tinggi — drama penuh, emosi naik-turun', value: 'tinggi' },
  ],
}

const ENDING_STEP: StepDefinition = {
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
}

/** Build dynamic steps berdasarkan genre yang dipilih. */
function buildSteps(selectedGenres: string[]): StepDefinition[] {
  return [
    GENRE_STEP,
    {
      id: 'tropes-liked',
      eyebrow: 'LANGKAH 2 DARI 5',
      title: 'Konflik atau trope apa yang kamu suka?',
      subtitle: 'Pilih satu atau beberapa.',
      multiSelect: true,
      field: 'likedTropes',
      options: buildOptionsFromGenres(selectedGenres, GENRE_TROPE_OPTIONS, FALLBACK_TROPE_OPTIONS),
    },
    {
      id: 'avoided',
      eyebrow: 'LANGKAH 3 DARI 5',
      title: 'Hal yang sebaiknya dikurangi',
      subtitle: 'Kami akan menghindari ini saat membuat cerita untukmu.',
      multiSelect: true,
      field: 'avoidedTropes',
      options: buildOptionsFromGenres(selectedGenres, GENRE_AVOIDED_OPTIONS, FALLBACK_AVOIDED_OPTIONS),
    },
    INTENSITY_STEP,
    ENDING_STEP,
  ]
}

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

  // Steps dibangun ulang saat genre berubah.
  const selectedGenres = (stepAnswers.preferredGenres as string[]) ?? []
  const steps = buildSteps(selectedGenres)

  const currentStep = steps[step]
  const isLastStep = step === steps.length - 1
  const totalSteps = steps.length

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
