'use client'

/**
 * Onboarding Taste Profile V2 — intro + 5 langkah selera cerita.
 *
 * Alur: intro → genre → konflik → soft/hard boundary → intensitas+ritme → ending+gaya.
 * Guest: localStorage. Login: server. Partial draft disimpan lokal.
 */
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  actSaveTasteProfile,
  actSkipTasteProfile,
} from '@/app/onboarding/selera/actions'
import {
  clearTasteDraft,
  readTasteDraft,
  saveGuestTasteProfile,
  saveTasteDraft,
} from '@/lib/taste-profile/storage'
import { trackEvent } from '@/lib/analytics/client'
import {
  BOUNDARY_NONE,
  CONTENT_BOUNDARY_CATALOG,
  DRAMA_INTENSITY_LABEL,
  ENDING_BIAS_LABEL,
  GENRE_CATALOG,
  LANGUAGE_STYLE_LABEL,
  PACING_LABEL,
  SOFT_AVOIDANCE_CATALOG,
  answersFromDraft,
  buildConflictOptionEntries,
  buildProfileFromAnswers,
  buildTasteSummaryLines,
  canAdvanceFromPhase,
  draftFromAnswers,
  emptyAnswers,
  invalidConflictsAfterGenreChange,
  phaseIndex,
  selectedGenreIds,
  toggleGenre,
  toggleHardBoundary,
  toggleMulti,
  type TasteOnboardingAnswers,
  type TasteOnboardingPhase,
} from '@/lib/taste-profile/onboarding-state'
import type {
  DramaIntensity,
  EndingBias,
  GenreId,
  LanguageStyle,
  Pacing,
} from '@/lib/taste-profile/schema'

type SaveStatus = 'idle' | 'local_only' | 'failed'

const INTENSITY_OPTIONS: { id: DramaIntensity; label: string; desc: string }[] = [
  { id: 'warm', label: DRAMA_INTENSITY_LABEL.warm, desc: 'Konflik lebih ringan dengan banyak ruang bernapas' },
  { id: 'balanced', label: DRAMA_INTENSITY_LABEL.balanced, desc: 'Emosi dan konflik terasa kuat tanpa terus menekan' },
  { id: 'intense', label: DRAMA_INTENSITY_LABEL.intense, desc: 'Taruhan tinggi, konflik tajam, dan emosi naik-turun' },
]

const PACING_OPTIONS: { id: Pacing; label: string; desc: string }[] = [
  { id: 'slow_deep', label: PACING_LABEL.slow_deep, desc: 'Lebih banyak ruang untuk relasi, suasana, dan detail' },
  { id: 'balanced', label: PACING_LABEL.balanced, desc: 'Adegan tenang dan kejadian besar bergantian' },
  { id: 'fast_eventful', label: PACING_LABEL.fast_eventful, desc: 'Cerita bergerak cepat dengan tekanan yang sering meningkat' },
]

const ENDING_OPTIONS: { id: EndingBias; label: string; desc: string }[] = [
  { id: 'peaceful', label: ENDING_BIAS_LABEL.peaceful, desc: 'Luka lama selesai dan tokoh bisa melanjutkan hidup' },
  { id: 'justice', label: ENDING_BIAS_LABEL.justice, desc: 'Kebenaran terbuka dan yang bersalah menerima akibat' },
  { id: 'victory', label: ENDING_BIAS_LABEL.victory, desc: 'Tokoh utama merebut kembali sesuatu yang sangat berarti' },
  { id: 'bittersweet', label: ENDING_BIAS_LABEL.bittersweet, desc: 'Ada kehilangan, namun perjalanan terasa berharga' },
]

const LANGUAGE_OPTIONS: { id: LanguageStyle; label: string; desc: string }[] = [
  { id: 'clear_concise', label: LANGUAGE_STYLE_LABEL.clear_concise, desc: 'Kalimat langsung, mudah diikuti, tidak bertele-tele' },
  { id: 'poetic_emotional', label: LANGUAGE_STYLE_LABEL.poetic_emotional, desc: 'Lebih banyak suasana, perasaan, dan pilihan kata lembut' },
  { id: 'cinematic_visual', label: LANGUAGE_STYLE_LABEL.cinematic_visual, desc: 'Adegan terasa hidup seperti rangkaian gambar dalam film' },
]

const STEP_PHASES: TasteOnboardingPhase[] = [
  'genre',
  'conflicts',
  'boundaries',
  'tone',
  'ending_style',
]

function optionClass(active: boolean) {
  return cn(
    'flex min-h-14 w-full items-start justify-between gap-3 rounded-2xl border px-5 py-4 text-left text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    active
      ? 'border-primary bg-primary/10 text-foreground'
      : 'border-border bg-card text-foreground hover:border-primary/50',
  )
}

export function TasteProfileFlow() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const nextUrl = searchParams.get('next') || '/beranda'

  const [phase, setPhase] = useState<TasteOnboardingPhase>('intro')
  const [answers, setAnswers] = useState<TasteOnboardingAnswers>(emptyAnswers)
  const [err, setErr] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [customConflictOpen, setCustomConflictOpen] = useState(false)
  const [customConflictText, setCustomConflictText] = useState('')
  const [draftOffer, setDraftOffer] = useState(false)
  const [genreChangeWarning, setGenreChangeWarning] = useState<string | null>(null)

  // Load draft once on mount
  useEffect(() => {
    trackEvent('taste_onboarding_viewed', { stage: 'intro', profile_version: 2 })
    const draft = readTasteDraft()
    if (!draft) return
    const restored = answersFromDraft(draft)
    if (restored.primaryGenreId || restored.likedConflictIds.length > 0) {
      setDraftOffer(true)
    }
  }, [])

  // Persist draft on answer change (not on intro)
  useEffect(() => {
    if (phase === 'intro' || phase === 'done') return
    saveTasteDraft(draftFromAnswers(answers))
  }, [answers, phase])

  const conflictOptions = useMemo(
    () => buildConflictOptionEntries(answers.primaryGenreId, answers.secondaryGenreId),
    [answers.primaryGenreId, answers.secondaryGenreId],
  )

  const summaryLines = useMemo(() => buildTasteSummaryLines(answers), [answers])
  const stepNumber = Math.max(0, phaseIndex(phase) - 1) // 0 for intro, 1..5 for steps
  const progressSteps = 5

  function resumeDraft() {
    const draft = readTasteDraft()
    setAnswers(answersFromDraft(draft))
    setCustomConflictText(draft?.customLikedConflict ?? '')
    setDraftOffer(false)
    setPhase('genre')
  }

  function restartDraft() {
    clearTasteDraft()
    setAnswers(emptyAnswers())
    setCustomConflictText('')
    setDraftOffer(false)
    setPhase('intro')
  }

  function goBack() {
    setHint(null)
    setErr(null)
    if (phase === 'intro') {
      router.back()
      return
    }
    if (phase === 'genre') {
      setPhase('intro')
      return
    }
    const idx = STEP_PHASES.indexOf(phase as (typeof STEP_PHASES)[number])
    if (idx > 0) {
      setPhase(STEP_PHASES[idx - 1])
    } else if (phase === 'save_error') {
      setPhase('ending_style')
    }
  }

  function goNext() {
    setHint(null)
    setErr(null)
    if (!canAdvanceFromPhase(phase, answers)) return

    if (phase === 'intro') {
      setPhase('genre')
      return
    }
    if (phase === 'genre') {
      // Prune conflicts that no longer match genres
      const invalid = invalidConflictsAfterGenreChange(
        answers.likedConflictIds,
        answers.primaryGenreId,
        answers.secondaryGenreId,
      )
      if (invalid.length > 0) {
        setGenreChangeWarning(
          invalid.length === 1
            ? 'Satu pilihan konflik tidak cocok dengan genre baru dan akan dihapus.'
            : `${invalid.length} pilihan konflik tidak cocok dengan genre baru dan akan dihapus.`,
        )
        setAnswers((prev) => ({
          ...prev,
          likedConflictIds: prev.likedConflictIds.filter((id) => !invalid.includes(id)),
        }))
      } else {
        setGenreChangeWarning(null)
      }
      setPhase('conflicts')
      return
    }
    if (phase === 'conflicts') setPhase('boundaries')
    else if (phase === 'boundaries') setPhase('tone')
    else if (phase === 'tone') setPhase('ending_style')
    else if (phase === 'ending_style') submitComplete()
  }

  function skipIntro() {
    setErr(null)
    const profile = buildProfileFromAnswers(emptyAnswers(), { mode: 'skip_intro' })
    trackEvent('taste_onboarding_skipped', { stage: 'intro', profile_version: 2 })
    startTransition(async () => {
      try {
        const res = await actSkipTasteProfile()
        if (!res.ok) {
          saveGuestTasteProfile(profile)
        }
        clearTasteDraft()
        router.push(nextUrl)
      } catch {
        saveGuestTasteProfile(profile)
        clearTasteDraft()
        router.push(nextUrl)
      }
    })
  }

  function submitComplete() {
    setErr(null)
    setSaveStatus('idle')
    setPhase('saving')

    const withCustom: TasteOnboardingAnswers = {
      ...answers,
      customLikedConflict: customConflictText.trim() || null,
    }
    const profile = buildProfileFromAnswers(withCustom, { mode: 'complete' })
    const genreCount = selectedGenreIds(withCustom).length
    const safeCounts = {
      profile_version: 2 as const,
      genre_count: genreCount,
      conflict_count: withCustom.likedConflictIds.length,
      soft_avoidance_count: withCustom.softAvoidanceIds.length,
      boundary_count: withCustom.contentBoundaryIds.filter((id) => id !== BOUNDARY_NONE)
        .length,
    }

    startTransition(async () => {
      try {
        const res = await actSaveTasteProfile(profile)
        if (res.ok) {
          clearTasteDraft()
          trackEvent('taste_profile_saved', safeCounts)
          setPhase('done')
          router.push(nextUrl)
          return
        }
        // Server fail — try local
        try {
          saveGuestTasteProfile(profile)
          clearTasteDraft()
          trackEvent('taste_profile_saved_local_only', {
            ...safeCounts,
            error_code: 'local_only',
          })
          setSaveStatus('local_only')
          setPhase('save_error')
        } catch {
          trackEvent('taste_profile_saved_local_only', {
            ...safeCounts,
            error_code: 'save_failed',
          })
          setSaveStatus('failed')
          setPhase('save_error')
          setErr('Seleramu belum berhasil disimpan. Pilihanmu tetap ada di halaman ini.')
        }
      } catch {
        try {
          saveGuestTasteProfile(profile)
          clearTasteDraft()
          trackEvent('taste_profile_saved_local_only', {
            ...safeCounts,
            error_code: 'local_only',
          })
          setSaveStatus('local_only')
          setPhase('save_error')
        } catch {
          trackEvent('taste_profile_saved_local_only', {
            ...safeCounts,
            error_code: 'save_failed',
          })
          setSaveStatus('failed')
          setPhase('save_error')
          setErr('Seleramu belum berhasil disimpan. Pilihanmu tetap ada di halaman ini.')
        }
      }
    })
  }

  function retrySave() {
    if (saveStatus === 'local_only') {
      // Retry server sync with last answers
      submitComplete()
      return
    }
    submitComplete()
  }

  function handleGenreClick(id: GenreId) {
    const result = toggleGenre(answers, id)
    if (result.maxReached) {
      setHint('Pilih maksimal dua agar arah ceritanya tetap jelas.')
      return
    }
    setHint(null)
    setAnswers(result.answers)
  }

  // ─── RENDER ───────────────────────────────────────────────────────

  if (draftOffer && phase === 'intro') {
    return (
      <Shell onBack={() => router.back()} progress={0} total={progressSteps} showProgress={false}>
        <Eyebrow>SELERA CERITAMU</Eyebrow>
        <Title>Lanjutkan pilihan sebelumnya?</Title>
        <p className="text-sm text-muted-foreground">
          Ada draf selera yang belum selesai di perangkat ini.
        </p>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <PrimaryButton onClick={resumeDraft}>Lanjutkan pilihan sebelumnya</PrimaryButton>
          <SecondaryButton onClick={restartDraft}>Mulai ulang</SecondaryButton>
        </div>
      </Shell>
    )
  }

  if (phase === 'intro') {
    return (
      <Shell onBack={() => router.back()} progress={0} total={progressSteps} showProgress={false}>
        <Eyebrow>SELERA CERITAMU</Eyebrow>
        <Title>Biar ceritanya terasa lebih kamu</Title>
        <p className="text-sm text-muted-foreground">
          Pilih beberapa hal yang kamu nikmati. Lakoku akan memakainya saat menyusun premis, tokoh,
          konflik, gaya penulisan, dan arah akhir. Semuanya bisa diubah nanti.
        </p>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <PrimaryButton
            onClick={() => {
              trackEvent('taste_onboarding_started', { stage: 'intro', profile_version: 2 })
              setPhase('genre')
            }}
            disabled={pending}
          >
            Atur seleraku
          </PrimaryButton>
          <SecondaryButton onClick={skipIntro} disabled={pending}>
            Nanti saja
          </SecondaryButton>
        </div>
      </Shell>
    )
  }

  if (phase === 'save_error') {
    return (
      <Shell onBack={goBack} progress={5} total={progressSteps}>
        <Eyebrow>SELERA CERITAMU</Eyebrow>
        <Title>
          {saveStatus === 'local_only'
            ? 'Seleramu tersimpan di perangkat ini'
            : 'Belum berhasil disimpan'}
        </Title>
        <p className="text-sm text-muted-foreground">
          {saveStatus === 'local_only'
            ? 'Sinkronisasi akun belum berhasil.'
            : err ?? 'Pilihanmu tetap ada di halaman ini.'}
        </p>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <PrimaryButton onClick={retrySave} disabled={pending}>
            {saveStatus === 'local_only' ? 'Coba sinkronkan lagi' : 'Coba simpan lagi'}
          </PrimaryButton>
          {saveStatus === 'local_only' && (
            <SecondaryButton onClick={() => router.push(nextUrl)}>Lanjut dulu</SecondaryButton>
          )}
        </div>
      </Shell>
    )
  }

  if (phase === 'saving') {
    return (
      <Shell onBack={() => {}} progress={5} total={progressSteps}>
        <Eyebrow>SELERA CERITAMU</Eyebrow>
        <Title>Menyimpan seleramu…</Title>
      </Shell>
    )
  }

  // Steps 1–5
  return (
    <Shell onBack={goBack} progress={stepNumber} total={progressSteps}>
      {phase === 'genre' && (
        <>
          <Eyebrow>LANGKAH 1 DARI 5</Eyebrow>
          <Title>Jenis cerita apa yang paling kamu suka?</Title>
          <p className="text-sm text-muted-foreground">
            Pilih maksimal 2. Pilihan pertama menjadi genre utama.
          </p>
          <Counter
            current={selectedGenreIds(answers).length}
            max={2}
          />
          {hint && <Hint>{hint}</Hint>}
          <div className="flex flex-col gap-3" role="group" aria-label="Genre">
            {GENRE_CATALOG.map((g) => {
              const isPrimary = answers.primaryGenreId === g.id
              const isSecondary = answers.secondaryGenreId === g.id
              const active = isPrimary || isSecondary
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleGenreClick(g.id)}
                  className={optionClass(active)}
                >
                  <span className="flex flex-col gap-1">
                    <span>{g.label}</span>
                    {isPrimary && <Badge>Utama</Badge>}
                    {isSecondary && <Badge>Pendamping</Badge>}
                  </span>
                  {active && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>
        </>
      )}

      {phase === 'conflicts' && (
        <>
          <Eyebrow>LANGKAH 2 DARI 5</Eyebrow>
          <Title>Konflik apa yang paling bikin kamu penasaran?</Title>
          <p className="text-sm text-muted-foreground">
            Pilihan ini akan memengaruhi premis yang kami tawarkan. Pilih maksimal 3.
          </p>
          <Counter current={answers.likedConflictIds.length} max={3} />
          {genreChangeWarning && <Hint>{genreChangeWarning}</Hint>}
          {hint && <Hint>{hint}</Hint>}
          <div className="flex flex-col gap-3" role="group" aria-label="Konflik">
            {conflictOptions.map((opt) => {
              const active = answers.likedConflictIds.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    const r = toggleMulti(answers.likedConflictIds, opt.id, 3)
                    if (r.maxReached) {
                      setHint('Pilih maksimal 3 konflik.')
                      return
                    }
                    setHint(null)
                    setAnswers((prev) => ({ ...prev, likedConflictIds: r.next }))
                  }}
                  className={optionClass(active)}
                >
                  <span>{opt.label}</span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => setCustomConflictOpen((v) => !v)}
            className="text-left text-sm font-semibold text-lavender underline-offset-4 hover:underline"
          >
            Tulis konflik sendiri
          </button>
          {customConflictOpen && (
            <textarea
              value={customConflictText}
              onChange={(e) => {
                setCustomConflictText(e.target.value.slice(0, 160))
                setAnswers((prev) => ({
                  ...prev,
                  customLikedConflict: e.target.value.slice(0, 160) || null,
                }))
              }}
              maxLength={160}
              rows={3}
              placeholder="Tuliskan konflik yang kamu bayangkan…"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </>
      )}

      {phase === 'boundaries' && (
        <>
          <Eyebrow>LANGKAH 3 DARI 5</Eyebrow>
          <Title>Ada hal yang ingin kamu kurangi atau hindari?</Title>

          <SectionHeading>Kurangi dalam cerita</SectionHeading>
          <p className="text-sm text-muted-foreground">
            Lakoku akan berusaha menguranginya, tetapi ini bukan larangan mutlak.
          </p>
          <Counter current={answers.softAvoidanceIds.length} max={4} />
          {hint && <Hint>{hint}</Hint>}
          <div className="flex flex-col gap-3" role="group" aria-label="Kurangi">
            {SOFT_AVOIDANCE_CATALOG.map((opt) => {
              const active = answers.softAvoidanceIds.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    const r = toggleMulti(answers.softAvoidanceIds, opt.id, 4)
                    if (r.maxReached) {
                      setHint('Pilih maksimal 4 preferensi lembut.')
                      return
                    }
                    setHint(null)
                    setAnswers((prev) => ({ ...prev, softAvoidanceIds: r.next }))
                  }}
                  className={optionClass(active)}
                >
                  <span>{opt.label}</span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>

          <SectionHeading className="mt-4">Jangan tampilkan</SectionHeading>
          <p className="text-sm text-muted-foreground">
            Pilihan ini menjadi batas tegas untuk cerita yang dibuat dari seleramu.
          </p>
          <div className="flex flex-col gap-3" role="group" aria-label="Batas tegas">
            {CONTENT_BOUNDARY_CATALOG.map((opt) => {
              const active = answers.contentBoundaryIds.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    setAnswers((prev) => ({
                      ...prev,
                      contentBoundaryIds: toggleHardBoundary(prev.contentBoundaryIds, opt.id),
                    }))
                  }
                  className={optionClass(active)}
                >
                  <span>{opt.label}</span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() =>
                setAnswers((prev) => ({
                  ...prev,
                  contentBoundaryIds: toggleHardBoundary(prev.contentBoundaryIds, BOUNDARY_NONE),
                }))
              }
              className={optionClass(answers.contentBoundaryIds.includes(BOUNDARY_NONE))}
            >
              <span>Tidak ada batas khusus</span>
              {answers.contentBoundaryIds.includes(BOUNDARY_NONE) && (
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
              )}
            </button>
          </div>
        </>
      )}

      {phase === 'tone' && (
        <>
          <Eyebrow>LANGKAH 4 DARI 5</Eyebrow>
          <Title>Seberapa intens dan cepat ceritanya?</Title>

          <SectionHeading>Intensitas</SectionHeading>
          <div className="flex flex-col gap-3" role="group" aria-label="Intensitas">
            {INTENSITY_OPTIONS.map((opt) => {
              const active = answers.dramaIntensity === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, dramaIntensity: opt.id }))}
                  className={optionClass(active)}
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{opt.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{opt.desc}</span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>

          <SectionHeading className="mt-4">Ritme cerita</SectionHeading>
          <div className="flex flex-col gap-3" role="group" aria-label="Ritme">
            {PACING_OPTIONS.map((opt) => {
              const active = answers.pacing === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, pacing: opt.id }))}
                  className={optionClass(active)}
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{opt.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{opt.desc}</span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>
        </>
      )}

      {phase === 'ending_style' && (
        <>
          <Eyebrow>LANGKAH 5 DARI 5</Eyebrow>
          <Title>Akhir dan gaya penulisan seperti apa yang kamu suka?</Title>

          <SectionHeading>Arah akhir yang terasa paling memuaskan</SectionHeading>
          <p className="text-sm text-muted-foreground">
            Ini menjadi kecenderungan. Pilihanmu selama membaca tetap menentukan hasil akhirnya.
          </p>
          <div className="flex flex-col gap-3" role="group" aria-label="Arah akhir">
            {ENDING_OPTIONS.map((opt) => {
              const active = answers.endingBias === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, endingBias: opt.id }))}
                  className={optionClass(active)}
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{opt.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{opt.desc}</span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>

          <SectionHeading className="mt-4">Gaya penulisan</SectionHeading>
          <div className="flex flex-col gap-3" role="group" aria-label="Gaya penulisan">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = answers.languageStyle === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, languageStyle: opt.id }))}
                  className={optionClass(active)}
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{opt.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{opt.desc}</span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>

          {summaryLines.length > 0 && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] font-semibold tracking-wide text-lavender">
                SELERA CERITAMU
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
                {summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <StickyFooter>
        <PrimaryButton
          onClick={goNext}
          disabled={pending || !canAdvanceFromPhase(phase, answers)}
        >
          {phase === 'ending_style'
            ? pending
              ? 'Menyimpan...'
              : 'Simpan seleraku'
            : 'Lanjut'}
        </PrimaryButton>
        {phase === 'ending_style' && (
          <SecondaryButton
            onClick={() => {
              // Partial save of whatever is filled
              submitComplete()
            }}
            disabled={pending}
          >
            Simpan yang sudah kupilih
          </SecondaryButton>
        )}
      </StickyFooter>
    </Shell>
  )
}

// ─── UI atoms ───────────────────────────────────────────────────────

function Shell({
  children,
  onBack,
  progress,
  total,
  showProgress = true,
}: {
  children: React.ReactNode
  onBack: () => void
  progress: number
  total: number
  showProgress?: boolean
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Kembali"
          className="flex size-10 items-center justify-center rounded-full bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        {showProgress && (
          <div className="flex flex-1 items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i < progress ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        )}
      </header>
      <section className="lk-fade-up mt-10 flex flex-1 flex-col gap-4">{children}</section>
    </main>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-wide text-lavender">{children}</span>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-serif text-3xl leading-tight text-balance text-foreground">{children}</h1>
  )
}

function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2 className={cn('text-sm font-semibold text-foreground', className)}>{children}</h2>
  )
}

function Counter({ current, max }: { current: number; max: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      {current} dari {max} dipilih
    </p>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground" role="status">
      {children}
    </p>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-fit rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
      {children}
    </span>
  )
}

function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 mt-auto flex flex-col gap-3 bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-sm">
      {children}
    </div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {children}
    </button>
  )
}
