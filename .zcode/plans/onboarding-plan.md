Plan implementasi lengkap
1. Pecah konsep onboarding menjadi 2 jenis
A. First-time onboarding: Taste Profile

Tujuannya bukan membuat cerita langsung, tapi menyimpan selera pembaca.

Data yang disimpan:

type TasteProfile = {
  version: 1
  preferredGenres: string[]
  likedTropes: string[]
  avoidedTropes: string[]
  dramaIntensity: 'ringan' | 'sedang' | 'tinggi'
  romanceLevel: 'none' | 'subtle' | 'utama'
  pacing: 'slow-burn' | 'seimbang' | 'cepat'
  languageStyle: 'ringkas' | 'puitis' | 'sinematik'
  endingBias: 'keadilan' | 'kedamaian' | 'kemenangan' | 'tragis-manis'
  contentBoundaries: string[]
  completedAt?: string
  skippedAt?: string
  updatedAt: string
}

Jangan mulai dari demografi. Demografi mentah kurang berguna dan menambah friksi. Kalau nanti perlu, cukup ageBand opsional untuk batas konten, bukan pertanyaan identitas yang berat.

B. New-story onboarding: Story Setup

Ini flow /mulai sekarang, tapi diperbaiki:

user bisa pilih cepat,
user bisa mengetik ide sendiri,
user bisa mengetik jawaban sendiri di tiap pertanyaan,
opsi default dipengaruhi Taste Profile,
pilihan story saat ini tetap mengalahkan Taste Profile.
2. Tambahkan storage Taste Profile
File baru
lib/taste-profile/schema.ts
lib/taste-profile/storage.ts
lib/taste-profile/server.ts
app/onboarding/selera/actions.ts
components/onboarding/taste-profile-flow.tsx
app/onboarding/selera/page.tsx
Migration baru
supabase/migrations/20260710xxxx_reader_taste_profiles.sql

Saat ini folder migration yang terlihat hanya berisi migration kredit dan reading policy, belum ada migration khusus preferensi/taste profile.

SQL yang disarankan:

create table if not exists public.reader_taste_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.reader_taste_profiles enable row level security;

drop policy if exists reader_taste_profiles_own_read on public.reader_taste_profiles;
create policy reader_taste_profiles_own_read
on public.reader_taste_profiles
for select
using (auth.uid() = user_id);

drop policy if exists reader_taste_profiles_own_write on public.reader_taste_profiles;
create policy reader_taste_profiles_own_write
on public.reader_taste_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists reader_taste_profiles_own_update on public.reader_taste_profiles;
create policy reader_taste_profiles_own_update
on public.reader_taste_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

Untuk guest, pakai localStorage key baru:

const TASTE_PROFILE_STORAGE_KEY = 'lakoku:taste-profile:v1'

Jangan pakai key yang sudah ada. Saat ini repo sudah memakai localStorage untuk draft onboarding login-resume lewat lakoku:onboarding-draft:v1, dengan TTL 30 menit. Ada juga localStorage untuk fallback pilihan terakhir guest. Jadi profile harus punya key sendiri agar tidak tabrakan.

3. Buat prompt composer, bukan engine baru
File baru
lib/onboarding/story-setup.ts

Isi utama:

export type StorySetupMode = 'quick' | 'custom'

export interface StorySetupInput {
  mode: StorySetupMode
  answers?: Record<string, string>
  customIdea?: string
  guestTasteProfile?: TasteProfile | null
}

export function buildStorySetupIdea(input: {
  setup: StorySetupInput
  tasteProfile?: TasteProfile | null
}) {
  const profile = input.tasteProfile
  const setup = input.setup

  return [
    profile ? buildTasteProfileBlock(profile) : '',
    'Pilihan cerita saat ini adalah prioritas utama.',
    setup.mode === 'custom'
      ? `Ide bebas pengguna: ${setup.customIdea?.trim() || 'bebas'}`
      : buildQuickAnswersBlock(setup.answers ?? {}),
    'Jika preferensi pembaca bertentangan dengan ide saat ini, ikuti ide saat ini.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

Aturan penting:

Taste Profile = soft bias.
contentBoundaries dan avoidedTropes = lebih keras.
customIdea user = prioritas tertinggi.
Jangan ubah schema PremiseDraft, CastDraft, MysteryDraft, WorldDraft.

Ini aman karena engine authoring sekarang memang menerima idea: string untuk membuat 3 premis. proposePremises(idea) sudah punya fallback kalau ide kosong dan menghasilkan tepat 3 proposal.

4. Jangan ubah signature actProposePremises

Jangan ubah ini:

actProposePremises(idea: string)

Karena /brainstorm masih memakainya secara langsung. Di BrainstormWizard, user mengetik ide bebas di textarea lalu generatePremises() memanggil actProposePremises(idea). Kalau signature diubah menjadi object, /brainstorm akan rawan rusak.

Solusi aman: buat server action khusus /mulai.

File baru
app/mulai/actions.ts

Contoh:

'use server'

import { proposePremises, publicAuthoringErrorMessage } from '@/lib/authoring/server'
import { getTasteProfileForCurrentUser } from '@/lib/taste-profile/server'
import { StorySetupInputSchema } from '@/lib/onboarding/story-setup'
import { buildStorySetupIdea } from '@/lib/onboarding/story-setup'

export async function actProposeStorySetupPremises(rawInput: unknown) {
  try {
    const setup = StorySetupInputSchema.parse(rawInput)
    const serverTasteProfile = await getTasteProfileForCurrentUser()

    const idea = buildStorySetupIdea({
      setup,
      tasteProfile: serverTasteProfile ?? setup.guestTasteProfile ?? null,
    })

    const { proposals } = await proposePremises(idea)
    return { ok: true as const, proposals }
  } catch (e) {
    return {
      ok: false as const,
      error: publicAuthoringErrorMessage(e),
    }
  }
}

Dengan ini:

/brainstorm tetap pakai action lama.
/mulai pakai action baru.
engine authoring tetap satu.
tidak ada fork logic cast/mystery/world/lock.
5. Update components/mulai/onboarding-flow.tsx

File ini adalah pusat perubahan UI. Saat ini flow quiz memakai questions, buildIdea(answers), lalu generateProposals(next) memanggil actProposePremises(buildIdea(currentAnswers)).

Perubahan state

Tambahkan:

type EntryMode = 'choose' | 'quick' | 'custom'

const [entryMode, setEntryMode] = useState<EntryMode>('choose')
const [customIdea, setCustomIdea] = useState('')
const [customAnswerFor, setCustomAnswerFor] = useState<string | null>(null)
const [customAnswerText, setCustomAnswerText] = useState('')
const [guestTasteProfile, setGuestTasteProfile] = useState<TasteProfile | null>(null)
Phase tetap minim

Jangan terlalu banyak phase baru. Cukup:

type Phase =
  | 'entry'
  | 'quiz'
  | 'custom'
  | 'proposals'
  | 'summary'
  | 'building'
  | 'error'

summary sebenarnya di kode sekarang tidak dipakai sebagai phase aktif terpisah karena selected menentukan ringkasan. Boleh dirapikan, tapi jangan wajib di fase pertama.

Entry screen baru

Di awal /mulai:

Buat cerita baru

[Mulai cepat]
Pilih beberapa arah cerita, lalu Lakoku siapkan 3 cerita.

[Aku punya ide sendiri]
Tulis idemu bebas, Lakoku jadikan 3 premis.

[Mode lengkap]
Rancang premis, tokoh, misteri, dan dunia satu per satu.

Mode lengkap tetap link ke /brainstorm, karena file itu memang sudah disiapkan untuk merancang detail per tahap.

Custom screen baru
Ceritakan idemu

Textarea:
"Mis. seorang istri menemukan surat warisan yang mengungkap kebohongan keluarganya..."

CTA:
[Usulkan 3 cerita]

Ketika submit:

actProposeStorySetupPremises({
  mode: 'custom',
  customIdea,
  guestTasteProfile,
})
Quick mode

Tetap pakai 4 pertanyaan, tapi ganti label dari:

PILIH PERANMU

menjadi:

BENTUK CERITAMU

Alasannya: pertanyaan pertama saat ini adalah konflik/drama, bukan peran. Kode saat ini menampilkan PILIH PERANMU — {step + 1} DARI {totalQuestions}.

Custom answer di tiap pertanyaan

Tambahkan option:

Tulis sendiri

Bukan mengganti “Pilihkan untukku”. Jadi setiap pertanyaan punya:

opsi tetap,
Pilihkan untukku,
Tulis sendiri.

Saat user pilih “Tulis sendiri”, tampilkan textarea pendek + tombol “Pakai jawaban ini”.

function submitCustomAnswer() {
  if (!customAnswerFor || !customAnswerText.trim()) return
  pickAnswer(customAnswerFor, customAnswerText.trim())
  setCustomAnswerFor(null)
  setCustomAnswerText('')
}
Generate proposal quick mode

Ganti:

actProposePremises(buildIdea(currentAnswers))

menjadi:

actProposeStorySetupPremises({
  mode: 'quick',
  answers: currentAnswers,
  guestTasteProfile,
})

Pipeline setelah premis tidak berubah:

actProposeCast
actProposeMystery
actProposeWorld
lockStoryBible
startFirstChapter

Itu penting karena lockStoryBible sudah menjadi pagar canon sebelum persist.

6. Update progress bar

Sekarang progress bar memakai totalQuestions + 1, jadi terlihat 5 bar, sementara teks mengatakan 1 dari 4. Itu tidak fatal, tapi terasa tidak konsisten.

Ubah menjadi eksplisit:

const progressSteps =
  phase === 'entry'
    ? 0
    : entryMode === 'custom'
      ? 2 // tulis ide + pilih premis
      : 5 // 4 pertanyaan + pilih premis

Atau lebih sederhana:

Quick: 4 pertanyaan + 1 pilih cerita.
Custom: 1 tulis ide + 1 pilih cerita.

Label quick:

LANGKAH 1 DARI 5

bukan:

1 DARI 4

Untuk custom:

LANGKAH 1 DARI 2

Ini memperjelas kenapa halaman proposal juga punya progress.

7. Personalisasi opsi tanpa LLM tambahan

Untuk fase awal, jangan generate pertanyaan onboarding pakai AI. Itu menambah biaya dan potensi tidak stabil.

Buat fungsi statis:

lib/onboarding/question-presets.ts

Contoh:

export function getPersonalizedQuestions(profile?: TasteProfile | null): Question[] {
  const base = defaultQuestions

  if (!profile) return base

  if (profile.preferredGenres.includes('misteri keluarga')) {
    return injectOptions(base, {
      trope: [
        'Rahasia keluarga dan warisan',
        'Kematian lama yang belum terjawab',
        'Identitas asli yang disembunyikan',
      ],
    })
  }

  return base
}

Aturan:

jangan hapus opsi default seluruhnya,
cukup reorder atau inject 1–2 opsi,
tetap ada “Pilihkan untukku”,
tetap ada “Tulis sendiri”.

Dengan ini, Taste Profile terasa berpengaruh tanpa membebani engine.

8. Jangan simpan Taste Profile ke reader_states

reader_states saat ini bertugas menyimpan progress personal login: status, current chapter, jejak, dan ending. Tamu tidak disentuh oleh file ini. Pilihan user juga no-op untuk tamu di server dan hanya login yang masuk reader_states.

Jadi jangan campur preferensi cerita ke sana. Buat table terpisah reader_taste_profiles.

Alasannya:

progress baca dan preferensi adalah domain berbeda,
RLS lebih sederhana,
tidak merusak query reader,
tidak memengaruhi monotonic progress.
9. Jangan ubah schema story bible

Schema authoring sekarang sudah jelas:

PremiseDraft,
CastDraft,
MysteryDraft,
WorldDraft,
StoryBibleDraft.

Premis wajib punya title, tagline, role, synopsis, tropes. Cast 3–8 karakter. Mystery punya reveal gate. World punya threads/facts.

Jangan tambahkan tasteProfile ke StoryBibleDraft. Itu akan menyebar ke compile, validate, persist, dan mungkin contracts. Tidak perlu.

Taste Profile cukup memengaruhi input prompt sebelum premis, bukan menjadi bagian canon.

10. Tetap hormati lock ladder

Validasi semantic sekarang sudah mengecek:

reveal gate hanya 12/20/32/45,
misteri utama selesai sebelum bab 48,
subject fakta harus karakter valid atau null,
protagonis muncul di bab 1,
tidak ada istilah internal bocor.

runLockLadder juga sudah memperbaiki hal aman secara deterministik, seperti snap gate ilegal ke gate valid, payoffWindow ke 45, subject fakta tidak dikenal ke null, dan protagonis ke bab 1.

Maka jangan bypass lockStoryBible. Flow custom input harus tetap melewati:

custom/quick input
→ premise proposals
→ cast
→ mystery
→ world
→ lockStoryBible
→ startFirstChapter

Bukan:

custom input
→ langsung generate chapter

Itu akan konflik dengan canon engine.

11. Update login/resume tanpa konflik

Flow sekarang menyimpan draft lengkap ke localStorage saat user belum login, lalu redirect ke:

/auth/login?next=/mulai?resume=1

Setelah login, draft dibaca lagi dan lockAndStart(draft) dilanjutkan.

Jangan ubah mekanisme itu.

Untuk custom input, tidak perlu menyimpan customIdea di draft login-resume karena saat redirect terjadi draft sudah berisi:

premise
cast
mystery
world

Jadi setelah login, profile/idea awal tidak lagi dibutuhkan untuk lock.

Kalau mau menyimpan untuk analytics nanti, tambahkan optional field:

setup?: StorySetupSnapshot

Tapi jangan bump storage version dulu. Biarkan backwards-compatible karena validator payload sekarang hanya butuh premise, cast, mystery, dan world.

12. First-time Taste Profile flow
Route
/onboarding/selera

Jangan redirect paksa semua user baru ke sini. Buat skippable.

Rekomendasi trigger:

dari /beranda, tampilkan card: “Atur selera cerita”.

dari /mulai, kalau belum ada profile, tampilkan entry screen dengan teks kecil:

Mau hasil lebih cocok? Atur selera cerita dulu.
jangan sisipkan onboarding taste saat user datang dari share ending/resume login. Flow share harus tetap cepat.
Pertanyaan Taste Profile

Cukup 5 langkah:

1. Genre yang paling kamu suka?
2. Konflik/trope yang kamu suka?
3. Yang ingin kamu hindari?
4. Intensitas cerita?
5. Gaya akhir dan bahasa?

CTA akhir:

[Simpan seleraku]
[Lewati dulu]
13. Sync guest profile ke akun

Saat guest mengisi Taste Profile, simpan localStorage.

Saat login, lakukan salah satu:

actMergeGuestTasteProfile(guestProfile)

Aturan merge:

jika server profile kosong → pakai guest profile,
jika server profile ada → server profile menang,
jangan overwrite profile login otomatis tanpa persetujuan,
tampilkan opsi “Gunakan selera dari perangkat ini” jika berbeda.

Ini mencegah kasus user login di perangkat lain lalu profile lamanya ketimpa localStorage.

14. File yang berubah
Baru
lib/taste-profile/schema.ts
lib/taste-profile/storage.ts
lib/taste-profile/server.ts
lib/onboarding/story-setup.ts
lib/onboarding/question-presets.ts
app/mulai/actions.ts
app/onboarding/selera/page.tsx
app/onboarding/selera/actions.ts
components/onboarding/taste-profile-flow.tsx
supabase/migrations/20260710xxxx_reader_taste_profiles.sql
scripts/story-setup-prompt-smoke.ts
scripts/taste-profile-smoke.ts
Diubah
components/mulai/onboarding-flow.tsx
app/mulai/page.tsx
package.json

Opsional:

lib/onboarding-draft.ts

Tapi hanya jika ingin menyimpan snapshot setup. Untuk fase aman, tidak perlu.

15. Test plan

Repo sudah punya script typecheck, test, dan banyak smoke test. Tambahkan dua smoke test kecil.

A. scripts/story-setup-prompt-smoke.ts

Cek:

quick answers menghasilkan prompt,
custom idea menghasilkan prompt,
custom idea menang atas profile,
avoided tropes masuk sebagai batas,
output tidak kosong.
B. scripts/taste-profile-smoke.ts

Cek:

schema valid,
profile guest bisa diserialisasi,
merge tidak overwrite server profile,
skipped profile tetap valid.

Tambahkan ke package.json:

"smoke:story-setup": "node scripts/run-smoke.cjs scripts/story-setup-prompt-smoke.ts",
"smoke:taste-profile": "node scripts/run-smoke.cjs scripts/taste-profile-smoke.ts"

Lalu masukkan ke chain smoke.

16. Urutan implementasi yang paling aman
Phase 1 — Free-text di /mulai

Implementasi:

app/mulai/actions.ts
lib/onboarding/story-setup.ts
update components/mulai/onboarding-flow.tsx
update progress label
tambah custom idea mode
tambah custom answer per question

Belum perlu database profile.

Ini memberi dampak produk paling cepat dan risiko rendah.

Phase 2 — Taste Profile guest-only

Implementasi:

lib/taste-profile/schema.ts
lib/taste-profile/storage.ts
components/onboarding/taste-profile-flow.tsx
localStorage only
/mulai membaca guest profile

Belum perlu Supabase.

Phase 3 — Taste Profile login + Supabase

Implementasi:

migration reader_taste_profiles
lib/taste-profile/server.ts
app/onboarding/selera/actions.ts
merge guest → login
RLS test manual
Phase 4 — Personalisasi opsi quick onboarding

Implementasi:

lib/onboarding/question-presets.ts
reorder/inject options dari profile
jangan AI-generate options dulu
Phase 5 — Analytics ringan

Simpan event:

story_setup_mode = quick/custom
has_taste_profile = true/false
selected_premise_index = 0/1/2
started_story = true/false

Tapi jangan menahan implementasi utama untuk analytics.

Risiko konflik dan mitigasi
Area	Risiko	Mitigasi
/brainstorm	Rusak jika actProposePremises diubah	Jangan ubah signature. Buat app/mulai/actions.ts
Story bible schema	Compile/validate rusak jika profile dimasukkan ke canon	Profile hanya jadi prompt context, bukan bagian StoryBibleDraft
Lock ladder	Custom input bisa menghasilkan konten invalid	Tetap lewat lockStoryBible
Reader state	Preferensi tercampur dengan progress baca	Buat table reader_taste_profiles, jangan sentuh reader_states
Guest flow	Login-resume rusak	Jangan ubah onboarding-draft; draft lengkap tetap dipakai
LocalStorage	Key tabrakan	Pakai lakoku:taste-profile:v1
Biaya AI	Opsi onboarding digenerate AI tiap kali	Personalisasi opsi secara statis dulu
Privacy	Demografi terasa invasif	Simpan selera cerita, bukan identitas personal
Kesimpulan

Implementasi paling rasional: mulai dari free-text di /mulai, lalu Taste Profile sebagai lapisan personalisasi terpisah.

Jangan membuat engine baru. Jangan ubah contracts, schema story bible, runtime chapter, lock ladder, atau reader-state. Semua personalisasi cukup masuk sebagai story setup prompt context sebelum proposePremises, lalu pipeline lama tetap berjalan. Ini memberi fleksibilitas user tanpa membuat konflik dengan canon engine yang sudah ada.