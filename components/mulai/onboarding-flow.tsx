'use client'

/**
 * Onboarding pembaca (T7.1) — jalur cepat "bentuk ceritamu".
 *
 * Alur baru:
 *   entry → quick (4 pertanyaan) | customIdea (free-text) → 3 premis AI →
 *   pilih 1 → pipeline otomatis (tokoh → misteri → dunia → kunci → Bab 1).
 *
 * Setiap pertanyaan quick punya opsi "Tulis sendiri" selain opsi tetap dan
 * "Pilihkan untukku". Custom idea bisa diketik bebas di textarea.
 *
 * Lock + Bab 1 lewat Reader API (`/api/stories/authoring/lock`,
 * `/api/stories/[id]/start-chapter`) agar web & Android berbagi kontrak.
 * Tahap propose cast/misteri/dunia masih server action; detail penuh di /brainstorm.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { createClient, type SupabasePublicConfig } from '@/lib/supabase/client'
import {
  clearOnboardingDraftStash,
  readOnboardingDraftStash,
  saveOnboardingDraftStash,
} from '@/lib/onboarding-draft'
import {
  actProposeCast,
  actProposeMystery,
  actProposeWorld,
} from '@/app/brainstorm/actions'
import { lockStoryBible, startChapter } from '@/lib/api/client'
import { actProposeStorySetupPremises } from '@/app/mulai/actions'
import { actGetTasteProfile } from '@/app/onboarding/selera/actions'
import { readGuestTasteProfile } from '@/lib/taste-profile/storage'
import {
  buildStorySpecificQuestions,
  profileSummaryForMulai,
  type AutoOrValue,
  type StorySpecificQuestion,
} from '@/lib/onboarding/story-questions'
import { hasUsableTasteProfile } from '@/lib/taste-profile/resolver'
import type { PremiseDraft, StoryBibleDraft } from '@/lib/authoring/schema'
import type { TasteProfile } from '@/lib/taste-profile/schema'
import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'

const PoetryLottie = dynamic(
  () => import('@/components/mulai/poetry-lottie').then((m) => m.PoetryLottie),
  { ssr: false },
)

const SMART_DEFAULT_LABEL = 'Pilihkan yang paling cocok'
const CUSTOM_ANSWER_LABEL = 'Tulis sendiri'

// ─── Phase + state ────────────────────────────────────────────────

type Phase = 'entry' | 'quiz' | 'customIdea' | 'proposals' | 'building' | 'error'

const BUILD_STEPS = [
  { key: 'cast', label: 'Menyusun tokoh-tokohmu' },
  { key: 'mystery', label: 'Menata rahasia yang menunggu' },
  { key: 'world', label: 'Membangun dunia & jejaknya' },
  { key: 'lock', label: 'Mengunci alur 50 bab' },
  { key: 'chapter', label: 'Menulis Bab 1' },
] as const
type BuildKey = (typeof BUILD_STEPS)[number]['key']

const RESUME_LOGIN_URL = '/auth/login?next=%2Fmulai%3Fresume%3D1'

// ─── Progress bar helper ──────────────────────────────────────────

function getProgressMeta(
  phase: Phase,
  entryMode: 'quick' | 'custom' | null,
  step: number,
  totalQuestions: number,
): { total: number; current: number; label: string } {
  if (phase === 'entry' || phase === 'building' || phase === 'error') {
    return { total: 0, current: 0, label: '' }
  }

  if (entryMode === 'custom') {
    if (phase === 'customIdea') {
      return { total: 2, current: 1, label: 'LANGKAH 1 DARI 2' }
    }
    if (phase === 'proposals' || phase === 'quiz') {
      return { total: 2, current: 2, label: 'LANGKAH 2 DARI 2' }
    }
  }

  if (entryMode === 'quick') {
    if (phase === 'quiz') {
      return {
        total: totalQuestions + 1,
        current: step + 1,
        label: `LANGKAH ${step + 1} DARI ${totalQuestions + 1}`,
      }
    }
    if (phase === 'proposals') {
      return {
        total: totalQuestions + 1,
        current: totalQuestions + 1,
        label: `LANGKAH ${totalQuestions + 1} DARI ${totalQuestions + 1}`,
      }
    }
  }

  return { total: 0, current: 0, label: '' }
}

// ─── Komponen utama ───────────────────────────────────────────────

export function OnboardingFlow({ supabaseConfig }: { supabaseConfig: SupabasePublicConfig }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const resumeAttemptedRef = useRef(false)

  const [phase, setPhase] = useState<Phase>('entry')
  const [entryMode, setEntryMode] = useState<'quick' | 'custom' | null>(null)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, AutoOrValue>>({})
  const [customIdea, setCustomIdea] = useState('')
  const [tasteProfile, setTasteProfile] = useState<TasteProfile | null>(null)
  const [activeQuestions, setActiveQuestions] = useState<StorySpecificQuestion[]>([])
  const [customAnswerFor, setCustomAnswerFor] = useState<string | null>(null)
  const [customAnswerText, setCustomAnswerText] = useState('')
  const [creativeDirection, setCreativeDirection] = useState<StoryCreativeDirection | null>(null)
  const [publicSummary, setPublicSummary] = useState<string | null>(null)

  const [proposals, setProposals] = useState<PremiseDraft[]>([])
  const [selected, setSelected] = useState<PremiseDraft | null>(null)

  const [buildStage, setBuildStage] = useState<BuildKey>('cast')
  const [err, setErr] = useState<string | null>(null)

  const questions = activeQuestions
  const totalQuestions = questions.length
  const question = questions[step]
  const resume = searchParams.get('resume')

  // Baca taste profile — localStorage dulu, lalu server (best-effort, jangan block UI).
  useEffect(() => {
    // Local first: defer setState out of effect body (same pattern as reader-view).
    const timer = window.setTimeout(() => {
      setTasteProfile(readGuestTasteProfile())
    }, 0)

    // Server: best-effort, fallback ke localStorage kalau gagal.
    startTransition(async () => {
      const result = await actGetTasteProfile()
      if (result.ok && result.profile) {
        setTasteProfile(result.profile)
      }
    })

    return () => window.clearTimeout(timer)
  }, [])

  const failBuild = useCallback((message?: string) => {
    setErr(message ?? 'Terjadi kendala saat menyiapkan cerita.')
    setPhase('error')
  }, [])

  // ── Quick flow start ────────────────────────────────────────────

  function startQuickFlow() {
    setEntryMode('quick')
    setActiveQuestions(buildStorySpecificQuestions({ tasteProfile }))
    setAnswers({})
    setStep(0)
    setPhase('quiz')
  }

  const hasSession = useCallback(async () => {
    const supabase = createClient(supabaseConfig)
    const { data: { user } } = await supabase.auth.getUser()
    return Boolean(user)
  }, [supabaseConfig])

  const lockAndStart = useCallback(async (draft: StoryBibleDraft) => {
    setBuildStage('lock')
    const lockRes = await lockStoryBible(draft)
    if (!lockRes.ok) {
      return failBuild(
        'needsAuthor' in lockRes
          ? 'Cerita ini butuh sedikit penyesuaian. Coba pilih cerita lain atau ulangi.'
          : lockRes.error,
      )
    }

    clearOnboardingDraftStash(window.localStorage)

    // T-SHARE-3: tautkan story baru ke share start row.
    try {
      const raw = sessionStorage.getItem('lakoku:share-start:v1')
      if (raw) {
        const parsed = JSON.parse(raw) as { startId?: string }
        if (parsed.startId) {
          const { actAttachShareStart } = await import('@/app/share/actions')
          await actAttachShareStart(parsed.startId, lockRes.storyId)
        }
        sessionStorage.removeItem('lakoku:share-start:v1')
      }
    } catch {
      // best-effort
    }

    setBuildStage('chapter')
    const gen = await startChapter(lockRes.storyId, 1)
    if (!gen.ok) {
      router.push(`/cerita/${lockRes.storyId}`)
      return
    }
    router.push(`/baca/${lockRes.storyId}?bab=1`)
  }, [failBuild, router])

  // ── Resume flow ─────────────────────────────────────────────────

  useEffect(() => {
    if (resume !== '1' || resumeAttemptedRef.current) return
    resumeAttemptedRef.current = true

    queueMicrotask(() => {
      const draft = readOnboardingDraftStash(window.localStorage)
      if (!draft) {
        failBuild('Rancangan ceritamu sudah kedaluwarsa. Mulai lagi agar ceritanya tetap rapi.')
        return
      }

      setSelected(draft.premise)
      // Resume stash stores string answers; convert lightly for display state only.
      if (draft.answers) {
        const restored: Record<string, AutoOrValue> = {}
        for (const [k, v] of Object.entries(draft.answers)) {
          if (!v) continue
          restored[k] =
            v === 'auto'
              ? { mode: 'auto' }
              : /^[a-z][a-z0-9_]*$/.test(v)
                ? { mode: 'selected', value: v }
                : { mode: 'custom', text: v }
        }
        setAnswers(restored)
      }
      if (draft.creativeDirection) {
        // Opaque stash — cast only if shape looks like direction
        setCreativeDirection(draft.creativeDirection as StoryCreativeDirection)
      }
      setErr(null)
      setPhase('building')
      startTransition(async () => {
        if (!(await hasSession())) {
          router.push(RESUME_LOGIN_URL)
          return
        }
        await lockAndStart(draft)
      })
    })
  }, [failBuild, hasSession, lockAndStart, resume, router])

  // ── Kuis ────────────────────────────────────────────────────────

  function pickAnswer(key: string, answer: AutoOrValue) {
    const next = { ...answers, [key]: answer }
    setAnswers(next)
    setCustomAnswerFor(null)
    setCustomAnswerText('')

    if (step < totalQuestions - 1) {
      setTimeout(() => setStep((s) => s + 1), 220)
    } else {
      setTimeout(() => generateProposals(next), 220)
    }
  }

  function submitCustomAnswer() {
    if (!customAnswerFor || !customAnswerText.trim()) return
    pickAnswer(customAnswerFor, { mode: 'custom', text: customAnswerText.trim() })
  }

  // ── Generate premis dari AI ────────────────────────────────────

  function generateProposals(currentAnswers: Record<string, AutoOrValue>) {
    setErr(null)
    setPhase('proposals')
    startTransition(async () => {
      const res = await actProposeStorySetupPremises({
        mode: 'quick',
        answers: currentAnswers,
        guestTasteProfile: tasteProfile,
      })
      if (!res.ok) {
        setErr(res.error ?? 'Gagal menyiapkan cerita. Coba lagi.')
        setPhase('error')
        return
      }
      setProposals(res.proposals)
      if (res.direction) setCreativeDirection(res.direction)
      if (res.publicSummary) setPublicSummary(res.publicSummary)
    })
  }

  // ── Custom idea → 3 premis ─────────────────────────────────────

  function submitCustomIdea() {
    const trimmed = customIdea.trim()
    if (!trimmed) return
    setErr(null)
    setPhase('proposals')
    startTransition(async () => {
      const res = await actProposeStorySetupPremises({
        mode: 'custom',
        customIdea: trimmed,
        guestTasteProfile: tasteProfile,
      })
      if (!res.ok) {
        setErr(res.error ?? 'Gagal menyiapkan cerita. Coba lagi.')
        setPhase('error')
        return
      }
      setProposals(res.proposals)
      if (res.direction) setCreativeDirection(res.direction)
      if (res.publicSummary) setPublicSummary(res.publicSummary)
    })
  }

  // ── Pipeline otomatis ──────────────────────────────────────────

  function beginStory(premise: PremiseDraft) {
    setSelected(premise)
    setErr(null)
    setPhase('building')
    startTransition(async () => {
      setBuildStage('cast')
      const castRes = await actProposeCast(premise, undefined, undefined, creativeDirection)
      if (!castRes.ok) return failBuild(castRes.error)

      setBuildStage('mystery')
      const mysteryRes = await actProposeMystery(
        premise,
        castRes.cast,
        undefined,
        undefined,
        creativeDirection,
      )
      if (!mysteryRes.ok) return failBuild(mysteryRes.error)

      setBuildStage('world')
      const worldRes = await actProposeWorld(
        premise,
        castRes.cast,
        mysteryRes.mystery,
        undefined,
        undefined,
        creativeDirection,
      )
      if (!worldRes.ok) return failBuild(worldRes.error)

      const draft = {
        premise,
        cast: castRes.cast,
        mystery: mysteryRes.mystery,
        world: worldRes.world,
        creativeDirection: creativeDirection ?? undefined,
      }

      setBuildStage('lock')
      if (!(await hasSession())) {
        saveOnboardingDraftStash(window.localStorage, {
          ...draft,
          answers: Object.fromEntries(
            Object.entries(answers).map(([k, v]) => [
              k,
              v.mode === 'custom' ? v.text : v.mode === 'selected' ? v.value : 'auto',
            ]),
          ),
        })
        router.push(RESUME_LOGIN_URL)
        return
      }

      await lockAndStart(draft)
    })
  }

  function restart() {
    setPhase('entry')
    setEntryMode(null)
    setStep(0)
    setAnswers({})
    setCustomIdea('')
    setCustomAnswerFor(null)
    setCustomAnswerText('')
    setProposals([])
    setSelected(null)
    setCreativeDirection(null)
    setPublicSummary(null)
    setErr(null)
  }

  // ── Back behavior ──────────────────────────────────────────────

  function handleBack() {
    if (phase === 'entry') {
      router.back()
      return
    }
    if (phase === 'customIdea') {
      setPhase('entry')
      return
    }
    if (phase === 'quiz' && step === 0) {
      setPhase('entry')
      return
    }
    if (phase === 'quiz' && step > 0) {
      setStep((s) => s - 1)
      return
    }
    if (phase === 'proposals') {
      if (selected) {
        setSelected(null)
        return
      }
      if (entryMode === 'custom') {
        setPhase('customIdea')
        return
      }
      if (entryMode === 'quick') {
        setPhase('quiz')
        return
      }
    }
  }

  // ── Progress meta ──────────────────────────────────────────────

  const progress = getProgressMeta(phase, entryMode, step, totalQuestions)
  const progressFilled =
    phase === 'quiz'
      ? step
      : phase === 'proposals' || (entryMode === 'custom' && phase !== 'entry')
        ? progress.total
        : 0

  // ════════════════════════════════════════════════════════════════
  // RENDER: building
  // ════════════════════════════════════════════════════════════════

  if (phase === 'building') {
    const activeIndex = BUILD_STEPS.findIndex((s) => s.key === buildStage)
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-8 bg-background px-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <PoetryLottie className="h-40 w-52 sm:h-48 sm:w-60" />
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            {buildStage === 'lock' ? 'Cerita ini siap dikunci ke akunmu.' : 'Peranmu sedang disiapkan.'}
          </h1>
          <p className="text-xs text-muted-foreground">Biasanya 30-60 detik.</p>
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
                    done
                      ? 'bg-primary text-primary-foreground'
                      : active
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground',
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
                {active ? (
                  <Shimmer
                    as="span"
                    duration={1.4}
                    spread={3}
                    className="font-medium [--color-background:var(--cream)] [--color-muted-foreground:var(--foreground)]"
                  >
                    {s.label}
                  </Shimmer>
                ) : (
                  <span className="font-medium">{s.label}</span>
                )}
              </li>
            )
          })}
        </ol>
      </main>
    )
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER: error
  // ════════════════════════════════════════════════════════════════

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
          {/* Coba lagi — kembali ke mode terakhir */}
          {entryMode === 'quick' && (
            <button
              type="button"
              onClick={() => {
                setErr(null)
                setPhase('quiz')
              }}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Coba lagi dari pertanyaan
            </button>
          )}
          {entryMode === 'custom' && (
            <button
              type="button"
              onClick={() => {
                setErr(null)
                setPhase('customIdea')
              }}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Coba lagi dari ide cerita
            </button>
          )}
          {proposals.length > 0 && !entryMode && (
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
            Mulai dari awal lagi
          </button>
        </div>
      </main>
    )
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER: main shell (entry / quiz / customIdea / proposals)
  // ════════════════════════════════════════════════════════════════

  const showProgress = progress.total > 0

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-10 pt-6">
      {/* Header: back button + progress bar */}
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke langkah sebelumnya"
          className="flex size-10 items-center justify-center rounded-full bg-card text-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        {showProgress && (
          <div className="flex flex-1 items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: progress.total }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i < progressFilled ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        )}
      </header>

      {/* ═══ ENTRY SCREEN ═══ */}
      {phase === 'entry' && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              MULAI CERITA
            </span>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              Cerita seperti apa yang ingin kamu jalani kali ini?
            </h1>
          </div>

          {hasUsableTasteProfile(tasteProfile) ? (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] font-semibold tracking-wide text-lavender">
                SELERA YANG AKAN DIPAKAI
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {profileSummaryForMulai(tasteProfile)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Kami akan memakai selera ini untuk menyusun premis, tokoh, konflik, dan gaya cerita.
              </p>
              <Link
                href="/onboarding/selera?next=/mulai"
                className="mt-2 inline-block text-xs font-semibold text-lavender underline-offset-4 hover:underline"
              >
                Ubah selera utama
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-medium text-foreground">Belum ada selera tersimpan.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Atur selera dulu agar premis dan gaya cerita lebih cocok, atau lanjut tanpa mengatur.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href="/onboarding/selera?next=/mulai"
                  className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                >
                  Atur selera dulu
                </Link>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={startQuickFlow}
              className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
            >
              <span className="text-sm font-semibold text-foreground">
                {hasUsableTasteProfile(tasteProfile)
                  ? 'Mulai cepat dari seleraku'
                  : 'Lanjut tanpa mengatur'}
              </span>
              <span className="text-xs text-muted-foreground">
                Jawab beberapa detail khusus, lalu Lakoku menyiapkan 3 premis.
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEntryMode('custom')
                setPhase('customIdea')
              }}
              className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
            >
              <span className="text-sm font-semibold text-foreground">Aku sudah punya ide cerita</span>
              <span className="text-xs text-muted-foreground">
                Tulis benih ceritamu. Selera dan batas ceritamu tetap ikut diterapkan.
              </span>
            </button>

            <Link
              href="/brainstorm"
              className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
            >
              <span className="text-sm font-semibold text-foreground">Rancang perlahan</span>
              <span className="text-xs text-muted-foreground">
                Tentukan premis, tokoh, misteri, dan dunia satu per satu.
              </span>
            </Link>
          </div>
        </section>
      )}

      {/* ═══ CUSTOM IDEA ═══ */}
      {phase === 'customIdea' && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              {progress.label}
            </span>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              Ceritakan idemu
            </h1>
            <p className="text-sm text-muted-foreground">
              Tulis 1–3 kalimat tentang cerita yang ingin kamu jalani. Lakoku akan
              mengubahnya menjadi 3 premis berbeda.
            </p>
          </div>

          <textarea
            value={customIdea}
            onChange={(e) => setCustomIdea(e.target.value)}
            placeholder="Contoh: seorang pewaris menemukan surat lama yang membongkar rahasia keluarganya..."
            maxLength={2000}
            rows={4}
            className="w-full rounded-2xl border border-input bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors resize-none field-sizing-content"
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{customIdea.length} / 2000 karakter</span>
          </div>

          <button
            type="button"
            onClick={submitCustomIdea}
            disabled={!customIdea.trim() || pending}
            className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Menyiapkan...' : 'Siapkan 3 cerita'}
          </button>
        </section>
      )}

      {/* ═══ QUIZ ═══ */}
      {phase === 'quiz' && question && (
        <section key={question.key} className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              BENTUK CERITAMU — {progress.label}
            </span>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              {question.prompt}
            </h1>
            {question.helper && <p className="text-sm text-muted-foreground">{question.helper}</p>}
          </div>

          <div className="flex flex-col gap-3" role="group" aria-label={question.prompt}>
            {question.options.map((opt) => {
              const current = answers[question.key]
              const isSelected =
                current?.mode === 'selected' && current.value === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    pickAnswer(question.key, { mode: 'selected', value: opt.id })
                  }
                  className={cn(
                    'flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground hover:border-primary/50',
                  )}
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              )
            })}
            {question.allowAuto && (
              <button
                type="button"
                onClick={() => pickAnswer(question.key, { mode: 'auto' })}
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  answers[question.key]?.mode === 'auto'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/50',
                )}
              >
                <span>{question.autoLabel || SMART_DEFAULT_LABEL}</span>
                {answers[question.key]?.mode === 'auto' && (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                )}
              </button>
            )}
            {question.allowCustom && (
              <button
                type="button"
                onClick={() => setCustomAnswerFor(question.key)}
                className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{question.customLabel || CUSTOM_ANSWER_LABEL}</span>
              </button>
            )}
          </div>

          {/* Custom answer input */}
          {customAnswerFor === question.key && (
            <div className="flex flex-col gap-3 rounded-2xl border border-primary/50 bg-card p-4">
              <span className="text-xs font-semibold text-primary">Tulis jawabanmu</span>
              <textarea
                value={customAnswerText}
                onChange={(e) => setCustomAnswerText(e.target.value)}
                placeholder="Tulis jawabanmu sendiri..."
                rows={2}
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors resize-none"
              />
              <button
                type="button"
                onClick={submitCustomAnswer}
                disabled={!customAnswerText.trim()}
                className="flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Pakai jawaban ini
              </button>
            </div>
          )}
        </section>
      )}

      {/* ═══ PROPOSALS ═══ */}
      {phase === 'proposals' && !selected && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">
              {progress.label}
            </span>
            {publicSummary && (
              <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {publicSummary}
              </p>
            )}
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
                  <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{p.synopsis}</p>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ═══ SUMMARY (selected premise) ═══ */}
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
