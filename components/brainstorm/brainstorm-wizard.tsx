'use client'

/**
 * Wizard brainstorm AI (T7.4) — dialog multi-turn merakit story bible lalu
 * mengunci ke canon. Struktur 50 bab/gate tetap template; user & AI hanya
 * mengarang konten. Saat "Kunci", server menjalankan tangga kegagalan
 * (validate → AI repair → transform → escalate).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Sparkles, RefreshCw, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  actProposePremises,
  actRefinePremise,
  actProposeCast,
  actProposeMystery,
  actProposeWorld,
  type ActionResult,
} from '@/app/brainstorm/actions'
import { lockStoryBible, startChapter } from '@/lib/api/client'
import type {
  PremiseDraft,
  CastDraft,
  MysteryDraft,
  WorldDraft,
} from '@/lib/authoring/schema'
import type { Finding } from '@lakoku/narrative-core'

type Stage = 'idea' | 'premise' | 'cast' | 'mystery' | 'world' | 'review'
const ORDER: Stage[] = ['idea', 'premise', 'cast', 'mystery', 'world', 'review']
const LABEL: Record<Stage, string> = {
  idea: 'IDE AWAL',
  premise: 'PREMIS',
  cast: 'TOKOH',
  mystery: 'MISTERI & RAHASIA',
  world: 'DUNIA & JEJAK',
  review: 'TINJAU & KUNCI',
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold tracking-wide text-lavender">{children}</span>
}

/**
 * Pecah teks jadi paragraf pendek bergaya pembaca novel mobile.
 * Utamakan jeda baris dari AI (\n\n); jika teks datang sebagai satu blok
 * padat, pecah per kalimat lalu kelompokkan ~2 kalimat per paragraf.
 */
function toParagraphs(text: string): string[] {
  const byBreak = text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (byBreak.length > 1) return byBreak
  const sentences = (text.match(/[^.!?…]+[.!?…]+(?:["'”’)]+)?|\S[^.!?…]*$/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean)
  const groups: string[] = []
  for (let i = 0; i < sentences.length; i += 2) {
    groups.push(sentences.slice(i, i + 2).join(' '))
  }
  return groups.length ? groups : [text]
}

function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {toParagraphs(text).map((para, i) => (
        <p key={i} className="text-pretty leading-relaxed">{para}</p>
      ))}
    </div>
  )
}

function Feedback({
  value,
  onChange,
  onRegenerate,
  pending,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onRegenerate: () => void
  pending: boolean
  placeholder: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
      />
      <button
        type="button"
        onClick={onRegenerate}
        disabled={pending}
        className="flex items-center justify-center gap-2 rounded-2xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:opacity-50"
      >
        <RefreshCw className={cn('size-4', pending && 'animate-spin')} aria-hidden="true" />
        {value.trim() ? 'Perbaiki sesuai masukan' : 'Buat ulang usulan'}
      </button>
    </div>
  )
}

function NextButton({ onClick, disabled, label = 'Lanjut' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {label}
    </button>
  )
}

export function BrainstormWizard() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [stage, setStage] = useState<Stage>('idea')
  const [err, setErr] = useState<string | null>(null)

  // Draft state.
  const [idea, setIdea] = useState('')
  const [proposals, setProposals] = useState<PremiseDraft[]>([])
  const [premise, setPremise] = useState<PremiseDraft | null>(null)
  const [cast, setCast] = useState<CastDraft | null>(null)
  const [mystery, setMystery] = useState<MysteryDraft | null>(null)
  const [world, setWorld] = useState<WorldDraft | null>(null)
  const [feedback, setFeedback] = useState('')

  // Lock state.
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [transforms, setTransforms] = useState<string[]>([])
  // Fase pasca-kunci: menyiapkan Bab 1 (generasi nyata) sebelum masuk reader.
  const [preparing, setPreparing] = useState(false)

  const stepIndex = ORDER.indexOf(stage)

  function guard<T>(res: ActionResult<T>, onOk: (r: T) => void) {
    if (!res.ok) {
      setErr(res.error ?? 'Gagal memproses. Coba lagi.')
      return
    }
    setErr(null)
    onOk(res)
  }

  // --- Stage transitions ---
  function generatePremises() {
    startTransition(async () => {
      const res = await actProposePremises(idea)
      guard(res, (r) => {
        setProposals(r.proposals)
        setStage('premise')
      })
    })
  }

  function refinePremiseNow() {
    if (!premise) return
    startTransition(async () => {
      const res = await actRefinePremise(premise, feedback)
      guard(res, (r) => {
        setPremise(r.premise)
        setFeedback('')
      })
    })
  }

  function goCast(fb?: string) {
    if (!premise) return
    startTransition(async () => {
      const res = await actProposeCast(premise, fb, cast ?? undefined)
      guard(res, (r) => {
        setCast(r.cast)
        setFeedback('')
        setStage('cast')
      })
    })
  }

  function goMystery(fb?: string) {
    if (!premise || !cast) return
    startTransition(async () => {
      const res = await actProposeMystery(premise, cast, fb, mystery ?? undefined)
      guard(res, (r) => {
        setMystery(r.mystery)
        setFeedback('')
        setStage('mystery')
      })
    })
  }

  function goWorld(fb?: string) {
    if (!premise || !cast || !mystery) return
    startTransition(async () => {
      const res = await actProposeWorld(premise, cast, mystery, fb, world ?? undefined)
      guard(res, (r) => {
        setWorld(r.world)
        setFeedback('')
        setStage('world')
      })
    })
  }

  function doLock() {
    if (!premise || !cast || !mystery || !world) return
    setFindings(null)
    startTransition(async () => {
      const res = await lockStoryBible({ premise, cast, mystery, world })
      if (res.ok) {
        setErr(null)
        // Cerita terkunci. Siapkan Bab 1 (generasi nyata) sebelum masuk reader.
        setPreparing(true)
        const gen = await startChapter(res.storyId, 1)
        if (!gen.ok) {
          // Bab gagal disiapkan: jangan buntu — arahkan ke detail cerita.
          setPreparing(false)
          setErr(gen.error ?? 'Bab pertama gagal disiapkan.')
          router.push(`/cerita/${res.storyId}`)
          return
        }
        router.push(`/baca/${res.storyId}?bab=1`)
        return
      }
      if ('needsAuthor' in res) {
        setFindings(res.findings)
        setTransforms(res.transforms)
        setErr(null)
        return
      }
      setErr(res.error ?? 'Gagal mengunci cerita.')
    })
  }

  if (preparing) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <span className="lk-pulse-soft font-serif text-3xl text-foreground">lakoku</span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Ceritamu sedang ditulis.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Dunia, tokoh, dan rahasia yang menunggumu sudah terkunci. Bab 1 sedang
            disusun—sebentar lagi kamu masuk ke ceritanya.
          </p>
        </div>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
          <div className="lk-pulse-soft h-full w-2/3 bg-primary" />
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-10 pt-6">
      <header className="flex items-center gap-3">
        {stage === 'idea' ? (
          <Link href="/beranda" aria-label="Kembali ke Beranda" className="flex size-10 items-center justify-center rounded-full bg-card text-foreground">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setStage(ORDER[Math.max(0, stepIndex - 1)])}
            aria-label="Langkah sebelumnya"
            className="flex size-10 items-center justify-center rounded-full bg-card text-foreground"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        )}
        <div className="flex flex-1 items-center gap-1.5" aria-hidden="true">
          {ORDER.map((s, i) => (
            <span key={s} className={cn('h-1 flex-1 rounded-full transition-colors', i <= stepIndex ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>
      </header>

      {err && (
        <p className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {/* IDEA */}
      {stage === 'idea' && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{LABEL.idea} — 1 DARI 6</Label>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">Ceritakan benih idemu.</h1>
            <p className="text-sm text-muted-foreground">Satu-dua kalimat cukup. Kosongkan bila ingin AI mengusulkan bebas.</p>
          </div>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={4}
            placeholder="mis. seorang istri menemukan warisan tersembunyi yang mengubah segalanya…"
            className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
          <NextButton onClick={generatePremises} disabled={pending} label={pending ? 'Menyusun usulan…' : 'Usulkan 3 premis'} />
        </section>
      )}

      {/* PREMISE */}
      {stage === 'premise' && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{LABEL.premise} — 2 DARI 6</Label>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
              {premise ? 'Sempurnakan premis pilihanmu.' : 'Pilih satu premis untuk dijalani.'}
            </h1>
          </div>

          {!premise && (
            <div className="flex flex-col gap-4">
              {proposals.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPremise(p)}
                  className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                >
                  <div className="flex flex-wrap gap-2">
                    {p.tropes.map((t) => (
                      <span key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{t}</span>
                    ))}
                  </div>
                  <h2 className="font-serif text-xl leading-snug text-foreground">{p.title}</h2>
                  <p className="text-xs font-medium text-primary">{p.role}</p>
                  <Prose text={p.synopsis} className="text-sm text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {premise && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2 rounded-2xl bg-card p-5">
                <div className="flex flex-wrap gap-2">
                  {premise.tropes.map((t) => (
                    <span key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{t}</span>
                  ))}
                </div>
                <h2 className="font-serif text-2xl leading-snug text-foreground">{premise.title}</h2>
                <p className="text-sm font-medium text-primary">{premise.tagline}</p>
                <p className="text-xs font-medium text-muted-foreground">{premise.role}</p>
                <Prose text={premise.synopsis} className="text-sm text-foreground" />
              </div>
              <Feedback value={feedback} onChange={setFeedback} onRegenerate={refinePremiseNow} pending={pending} placeholder="Ingin lebih gelap? Ganti latar? Tulis di sini…" />
              <div className="flex flex-col gap-2">
                <NextButton onClick={() => goCast()} disabled={pending} label={pending ? 'Memproses…' : 'Lanjut ke Tokoh'} />
                <button type="button" onClick={() => setPremise(null)} className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">
                  Lihat premis lain
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* CAST */}
      {stage === 'cast' && cast && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{LABEL.cast} — 3 DARI 6</Label>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">Tokoh yang menghidupkan cerita.</h1>
          </div>
          <div className="flex flex-col gap-3">
            {cast.characters.map((c, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-2xl bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-serif text-lg text-foreground">{c.canonicalName}</h2>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{c.role}</span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{c.motivation}</p>
                <p className="text-[11px] text-lavender">Muncul di bab {c.introducedChapter} · suara: {c.voice.register}</p>
              </div>
            ))}
          </div>
          <Feedback value={feedback} onChange={setFeedback} onRegenerate={() => goCast(feedback || undefined)} pending={pending} placeholder="Tambah antagonis? Ubah motivasi? Tulis di sini…" />
          <NextButton onClick={() => goMystery()} disabled={pending} label={pending ? 'Memproses…' : 'Lanjut ke Misteri'} />
        </section>
      )}

      {/* MYSTERY */}
      {stage === 'mystery' && mystery && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{LABEL.mystery} — 4 DARI 6</Label>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">{mystery.mainMystery.title}</h1>
            <p className="text-sm text-muted-foreground">Rahasia dibuka pada gerbang cerita bab 12, 20, 32, dan 45.</p>
          </div>
          <ol className="flex flex-col gap-3">
            {mystery.secrets.map((s, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-2xl bg-card p-4">
                <Label>DIBUKA BAB {s.revealGateChapter}</Label>
                <p className="text-sm leading-relaxed text-foreground">{s.description}</p>
              </li>
            ))}
          </ol>
          <Feedback value={feedback} onChange={setFeedback} onRegenerate={() => goMystery(feedback || undefined)} pending={pending} placeholder="Rahasia lebih berlapis? Ubah gerbang? Tulis di sini…" />
          <NextButton onClick={() => goWorld()} disabled={pending} label={pending ? 'Memproses…' : 'Lanjut ke Dunia'} />
        </section>
      )}

      {/* WORLD */}
      {stage === 'world' && world && (
        <section className="lk-fade-up mt-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{LABEL.world} — 5 DARI 6</Label>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">Jejak & benang cerita.</h1>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <Label>BENANG NARATIF</Label>
              <ul className="mt-1 flex flex-col gap-1.5">
                {world.threads.map((t, i) => (
                  <li key={i} className="text-sm text-foreground">· {t.title}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <Label>FAKTA PIJAKAN</Label>
              <ul className="mt-1 flex flex-col gap-1.5">
                {world.facts.map((f, i) => (
                  <li key={i} className="text-sm leading-relaxed text-foreground">
                    · {f.statement}
                    {f.loadBearing && <span className="ml-1 text-[10px] font-semibold text-primary">[penyangga]</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Feedback value={feedback} onChange={setFeedback} onRegenerate={() => goWorld(feedback || undefined)} pending={pending} placeholder="Tambah subplot? Fakta baru? Tulis di sini…" />
          <NextButton onClick={() => setStage('review')} disabled={pending} label="Tinjau & Kunci" />
        </section>
      )}

      {/* REVIEW */}
      {stage === 'review' && premise && cast && mystery && world && (
        <section className="lk-fade-up mt-10 flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{LABEL.review} — 6 DARI 6</Label>
            <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">{premise.title}</h1>
            <p className="text-sm text-muted-foreground">{premise.tagline}</p>
          </div>

          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <dt><Label>PERANMU</Label></dt>
              <dd className="text-sm text-foreground">{premise.role}</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <dt><Label>STRUKTUR</Label></dt>
              <dd className="text-sm text-foreground">50 bab · {cast.characters.length} tokoh · {mystery.secrets.length} rahasia · {world.threads.length} benang</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <dt><Label>SPINE TETAP</Label></dt>
              <dd className="text-sm leading-relaxed text-foreground">
                Batas act, gerbang rahasia (12/20/32/45), dan aturan akhir dikunci. AI menyesuaikan alur di dalamnya seiring ceritamu berjalan.
              </dd>
            </div>
          </dl>

          {findings && findings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
              <Label>PERLU KEPUTUSANMU</Label>
              <p className="text-sm text-foreground">Beberapa hal belum bisa diselaraskan otomatis:</p>
              <ul className="flex flex-col gap-1">
                {findings.map((f, i) => (
                  <li key={i} className="text-sm text-destructive">· {f.message}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Kembali ke tahap terkait dan ubah kontennya, lalu coba kunci lagi.</p>
            </div>
          )}

          {transforms.length > 0 && !findings?.length && (
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
              <Label>PENYELARASAN OTOMATIS</Label>
              <ul className="flex flex-col gap-1">
                {transforms.map((t, i) => (
                  <li key={i} className="text-xs text-muted-foreground">· {t}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-3 pt-4">
            <button
              type="button"
              onClick={doLock}
              disabled={pending}
              className="flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Sparkles className="size-4 animate-pulse" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
              {pending ? 'Mengunci & menyusun 50 bab…' : 'Kunci Story Bible'}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Check className="size-3.5 text-primary" aria-hidden="true" />
              Divalidasi ke pagar canon sebelum dikunci
            </p>
          </div>
        </section>
      )}
    </main>
  )
}
