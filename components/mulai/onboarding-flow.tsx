'use client'

/**
 * Onboarding pembaca (T7.1) — jalur cepat "pilih peranmu".
 *
 * Alur: kuis ketuk (4 pertanyaan) → jawaban dirakit jadi ide → AI mengusulkan
 * 3 premis NYATA (actProposePremises) → pembaca pilih 1 → pipeline otomatis
 * (tokoh → misteri → dunia → kunci → Bab 1) dengan progres per tahap →
 * masuk reader di /baca/{storyId}?bab=1.
 *
 * Semua kerja berat memakai server action authoring yang sama dengan wizard
 * /brainstorm (T7.4); komponen ini hanya mengurut tahap & menyajikan progres.
 * Untuk merancang detail (edit tiap tahap), pembaca diarahkan ke /brainstorm.
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  actProposePremises,
  actProposeCast,
  actProposeMystery,
  actProposeWorld,
  lockStoryBible,
  startFirstChapter,
} from '@/app/brainstorm/actions'
import type { PremiseDraft } from '@/lib/authoring/schema'

interface Question {
  key: string
  prompt: string
  helper?: string
  /** Prefiks yang membingkai jawaban saat dirakit jadi ide untuk AI. */
  frame: (answer: string) => string
  options: string[]
}

const questions: Question[] = [
  {
    key: 'trope',
    prompt: 'Drama seperti apa yang ingin kamu jalani?',
    helper: 'Pilih konflik utama untuk peranmu.',
    frame: (a) => `Konflik utama cerita: ${a.toLowerCase()}.`,
    options: [
      'Pasangan yang berkhianat',
      'Pernikahan kontrak yang berubah arah',
      'Rahasia keluarga dan warisan',
      'Cinta lama yang kembali',
      'Bangkit setelah dipermalukan',
    ],
  },
  {
    key: 'sikap',
    prompt: 'Bagaimana tokohmu biasanya menghadapi konflik?',
    helper: 'Ini menentukan pilihan yang akan sering muncul.',
    frame: (a) => `Tokoh utama cenderung ${a.toLowerCase()}.`,
    options: [
      'Tenang dan menyusun rencana',
      'Langsung menghadapi, apa pun risikonya',
      'Menyimpan semuanya sampai waktunya tiba',
    ],
  },
  {
    key: 'hubungan',
    prompt: 'Hubungan seperti apa yang ingin kamu bentuk?',
    helper: 'Satu love interest utama akan hadir dalam ceritamu.',
    frame: (a) => `Hubungan yang diinginkan: ${a.toLowerCase()}.`,
    options: [
      'Cinta yang harus diperjuangkan lagi',
      'Sekutu yang perlahan menjadi lebih',
      'Fokus pada diriku sendiri dulu',
    ],
  },
  {
    key: 'akhir',
    prompt: 'Akhir seperti apa yang paling ingin kamu kejar?',
    helper: 'Cerita tetap bisa berubah karena pilihanmu.',
    frame: (a) => `Akhir yang dikejar: ${a.toLowerCase()}.`,
    options: [
      'Keadilan — semua rahasia terbuka',
      'Kedamaian — melepaskan dan melangkah',
      'Kemenangan — merebut kembali posisiku',
    ],
  },
]

/** Rakit jawaban kuis jadi satu ide berbahasa natural untuk AI premis. */
function buildIdea(answers: Record<string, string>): string {
  return questions
    .filter((q) => answers[q.key])
    .map((q) => q.frame(answers[q.key]))
    .join(' ')
}

type Phase = 'quiz' | 'proposals' | 'summary' | 'building' | 'error'

/** Tahap pipeline pasca-pilih, untuk progres yang terlihat hidup. */
const BUILD_STEPS = [
  { key: 'cast', label: 'Menyusun tokoh-tokohmu' },
  { key: 'mystery', label: 'Menata rahasia yang menunggu' },
  { key: 'world', label: 'Membangun dunia & jejaknya' },
  { key: 'lock', label: 'Mengunci alur 50 bab' },
  { key: 'chapter', label: 'Menulis Bab 1' },
] as const
type BuildKey = (typeof BUILD_STEPS)[number]['key']

export function OnboardingFlow() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [phase, setPhase] = useState<Phase>('quiz')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const [proposals, setProposals] = useState<PremiseDraft[]>([])
  const [selected, setSelected] = useState<PremiseDraft | null>(null)

  const [buildStage, setBuildStage] = useState<BuildKey>('cast')
  const [err, setErr] = useState<string | null>(null)

  const totalQuestions = questions.length
  const question = questions[step]

  // --- Kuis ---
  function pickAnswer(key: string, value: string) {
    const next = { ...answers, [key]: value }
    setAnswers(next)
    if (step < totalQuestions - 1) {
      setTimeout(() => setStep((s) => s + 1), 220)
    } else {
      setTimeout(() => generateProposals(next), 220)
    }
  }

  function backFromQuiz() {
    setStep((s) => Math.max(0, s - 1))
  }

  // --- Premis nyata dari AI ---
  function generateProposals(currentAnswers: Record<string, string>) {
    setErr(null)
    setPhase('proposals')
    startTransition(async () => {
      const res = await actProposePremises(buildIdea(currentAnswers))
      if (!res.ok) {
        setErr(res.error ?? 'Gagal menyiapkan cerita. Coba lagi.')
        setPhase('error')
        return
      }
      setProposals(res.proposals)
    })
  }

  // --- Pipeline otomatis dengan progres per tahap ---
  function beginStory(premise: PremiseDraft) {
    setSelected(premise)
    setErr(null)
    setPhase('building')
    startTransition(async () => {
      setBuildStage('cast')
      const castRes = await actProposeCast(premise)
      if (!castRes.ok) return failBuild(castRes.error)

      setBuildStage('mystery')
      const mysteryRes = await actProposeMystery(premise, castRes.cast)
      if (!mysteryRes.ok) return failBuild(mysteryRes.error)

      setBuildStage('world')
      const worldRes = await actProposeWorld(premise, castRes.cast, mysteryRes.mystery)
      if (!worldRes.ok) return failBuild(worldRes.error)

      setBuildStage('lock')
      const lockRes = await lockStoryBible({
        premise,
        cast: castRes.cast,
        mystery: mysteryRes.mystery,
        world: worldRes.world,
      })
      if (!lockRes.ok) {
        // needsAuthor / gagal kunci: pembaca tak perlu detail validator.
        return failBuild(
          'needsAuthor' in lockRes
            ? 'Cerita ini butuh sedikit penyesuaian. Coba pilih cerita lain atau ulangi.'
            : lockRes.error,
        )
      }

      setBuildStage('chapter')
      const gen = await startFirstChapter(lockRes.storyId)
      if (!gen.ok) {
        // Jangan buntu bila Bab 1 gagal: arahkan ke detail cerita.
        router.push(`/cerita/${lockRes.storyId}`)
        return
      }
      router.push(`/baca/${lockRes.storyId}?bab=1`)
    })
  }

  function failBuild(message?: string) {
    setErr(message ?? 'Terjadi kendala saat menyiapkan cerita.')
    setPhase('error')
  }

  function restart() {
    setPhase('quiz')
    setStep(0)
    setAnswers({})
    setProposals([])
    setSelected(null)
    setErr(null)
  }

  // ---------- Layar: menyiapkan cerita (progres per tahap) ----------
  if (phase === 'building') {
    const activeIndex = BUILD_STEPS.findIndex((s) => s.key === buildStage)
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-8 bg-background px-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="lk-pulse-soft font-serif text-3xl text-foreground">lakoku</span>
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Peranmu sedang disiapkan.
          </h1>
          {selected && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {selected.title} — {selected.role}
            </p>
          )}
        </div>

        <ol className="flex w-full flex-col gap-3 text-left" aria-live="polite">
          {BUILD_STEPS.map((s, i) => {
            const done = i < activeIndex
            const active = i === activeIndex
            return (
              <li
                key={s.key}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : done
                      ? 'border-border bg-card text-foreground'
                      : 'border-border bg-card text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full',
                    done ? 'bg-primary text-primary-foreground' : active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  {done ? (
                    <Check className="size-3.5" />
                  ) : active ? (
                    <Sparkles className="size-3.5 animate-pulse" />
                  ) : (
                    <span className="text-[11px] font-semibold">{i + 1}</span>
                  )}
                </span>
                <span className="font-medium">{s.label}</span>
              </li>
            )
          })}
        </ol>
      </main>
    )
  }

  // ---------- Layar: error / needs author ----------
  if (phase === 'error') {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Ada sedikit kendala.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground" role="alert">
            {err}
          </p>
        </div>
        <div className="flex w-full flex-col gap-3">
          {proposals.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setErr(null)
                setSelected(null)
                setPhase('proposals')
              }}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Pilih cerita lain
            </button>
          )}
          <button
            type="button"
            onClick={restart}
            className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
          >
            Ulangi dari awal
          </button>
        </div>
      </main>
    )
  }

  // ---------- Layar utama: kuis / proposal / ringkasan ----------
  const showQuiz = phase === 'quiz'
  const progressFilled = showQuiz ? step : totalQuestions

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-10 pt-6">
      <header className="flex items-center gap-3">
        {showQuiz && step === 0 ? (
          <Link
            href="/beranda"
            aria-label="Kembali ke Beranda"
            className="flex size-10 items-center justify-center rounded-full bg-card text-foreground"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (selected) {
                setSelected(null)
                setPhase('proposals')
              } else if (phase === 'proposals') {
                setPhase('quiz')
                setStep(totalQuestions - 1)
              } else {
                backFromQuiz()
              }
            }}
            aria-label="Kembali ke langkah sebelumnya"
            className="flex size-10 items-center justify-center rounded-full bg-card text-foreground"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        )}
        <div className="flex flex-1 items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: totalQuestions + 1 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= progressFilled ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </header>

      {/* KUIS */}
      {showQuiz && question && (
        <section key={question.key} className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              PILIH PERANMU — {step + 1} DARI {totalQuestions}
            </span>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              {question.prompt}
            </h1>
            {question.helper && <p className="text-sm text-muted-foreground">{question.helper}</p>}
          </div>
          <div className="flex flex-col gap-3" role="group" aria-label={question.prompt}>
            {question.options.map((opt) => {
              const isSelected = answers[question.key] === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pickAnswer(question.key, opt)}
                  className={cn(
                    'flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left text-sm font-medium transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground hover:border-primary/50',
                  )}
                >
                  {opt}
                  {isSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* PROPOSAL (dari AI) */}
      {phase === 'proposals' && !selected && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              BANDINGKAN CERITA
            </span>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              {pending && proposals.length === 0
                ? 'Menyiapkan tiga cerita untukmu…'
                : 'Tiga cerita disiapkan untukmu. Pilih satu untuk dijalani.'}
            </h1>
          </div>

          {pending && proposals.length === 0 ? (
            <div className="flex flex-col gap-4" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-card" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {proposals.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(p)}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                >
                  <div className="flex flex-wrap gap-2">
                    {p.tropes.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <h2 className="font-serif text-xl leading-snug text-foreground">{p.title}</h2>
                  <p className="text-xs font-medium text-primary">{p.role}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{p.synopsis}</p>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* RINGKASAN cerita terpilih */}
      {selected && (
        <section className="lk-fade-up mt-10 flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              RINGKASAN CERITA
            </span>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              {selected.title}
            </h1>
            <p className="text-sm text-muted-foreground">{selected.tagline}</p>
          </div>

          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <dt className="text-[11px] font-semibold tracking-wide text-lavender">PERANMU</dt>
              <dd className="text-sm text-foreground">{selected.role}</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <dt className="text-[11px] font-semibold tracking-wide text-lavender">SINOPSIS</dt>
              <dd className="text-sm leading-relaxed text-foreground">{selected.synopsis}</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <dt className="text-[11px] font-semibold tracking-wide text-lavender">
                PANJANG CERITA
              </dt>
              <dd className="text-sm text-foreground">
                50 bab — dengan beberapa akhir cerita yang berbeda, tergantung pilihanmu.
              </dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-col gap-3 pt-4">
            <button
              type="button"
              onClick={() => beginStory(selected)}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Masuk ke Cerita Ini
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
            >
              Lihat Cerita Lain
            </button>
            <Link
              href="/brainstorm"
              className="mt-1 text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Ingin merancang sendiri tiap detail? Buka mode lengkap
            </Link>
          </div>
        </section>
      )}
    </main>
  )
}
