/**
 * Smoke web release:
 * - submitChoice tidak boleh membuat outcome sintetis saat backend menolak.
 * - pending-choice recovery menyimpan pilihan gagal dan retry dengan choice yang sama.
 */
import { submitChoice } from '@/lib/api/client'
import type { ChoiceOutcome } from '@lakoku/contracts'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()

  get length() {
    return this.data.size
  }

  clear() {
    this.data.clear()
  }

  getItem(key: string) {
    return this.data.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

async function testNoSyntheticChoiceFallback() {
  const originalFetch = globalThis.fetch
  let resolved: ChoiceOutcome | null = null
  let rejected = false

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      chapterNumber?: unknown
      choiceId?: unknown
    }
    check('submitChoice mengirim chapterNumber/choiceId asli', body.chapterNumber === 12 && body.choiceId === 'hilang')
    return new Response(JSON.stringify({ error: 'Pilihan tidak dikenali.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    resolved = await submitChoice('pesan-terakhir', 12, 'hilang')
  } catch {
    rejected = true
  } finally {
    globalThis.fetch = originalFetch
  }

  check('submitChoice menolak response gagal', rejected)
  check(
    'submitChoice tidak mengembalikan konsekuensi sintetis',
    !resolved || !resolved.consequence.join(' ').includes('Pilihanmu telah dicatat'),
    resolved,
  )
}

async function testPendingChoiceRecovery() {
  const storage = new MemoryStorage()
  ;(globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
  }

  const pendingApi = await import('@/lib/api/pending-choice').catch((error: unknown) => {
    check('pending-choice module tersedia', false, error)
    return null
  })
  if (!pendingApi) return

  pendingApi.clearPendingChoice()
  const pending = pendingApi.recordPendingChoice(
    { storyId: 'pesan-terakhir', chapterNumber: 12, choiceId: 'hadapi' },
    1_700_000_000_000,
  )
  check('pending choice tersimpan', pendingApi.getPendingChoice()?.choiceId === 'hadapi')
  check(
    'pending choice idempotency key stabil',
    pending.idempotencyKey === 'choice:pesan-terakhir:12:hadapi',
    pending,
  )

  let attempts = 0
  const outcome = await pendingApi.retryPendingChoice(async (storyId, chapterNumber, choiceId) => {
    attempts++
    return {
      storyId,
      chapterNumber,
      choiceId,
      consequence: ['Keputusanmu akhirnya diterima.'],
      nextChapterNumber: chapterNumber + 1,
      isEnding: false,
    } satisfies ChoiceOutcome
  })

  check('pending retry memakai pilihan yang sama', attempts === 1 && outcome?.choiceId === 'hadapi')
  check('pending choice dibersihkan setelah retry sukses', pendingApi.getPendingChoice() === null)

  pendingApi.recordPendingChoice(
    { storyId: 'pesan-terakhir', chapterNumber: 12, choiceId: 'pergi' },
    1_700_000_000_001,
  )
  let retryRejected = false
  await pendingApi
    .retryPendingChoice(async () => {
      throw new Error('offline')
    })
    .catch(() => {
      retryRejected = true
    })
  const stillPending = pendingApi.getPendingChoice()
  check('pending retry gagal tetap tersimpan', retryRejected && stillPending?.choiceId === 'pergi')
  check('pending retry gagal mencatat error aman', Boolean(stillPending?.lastError))
}

async function main() {
  console.log('Web release smoke:')
  await testNoSyntheticChoiceFallback()
  await testPendingChoiceRecovery()

  if (fail > 0) {
    console.error(`web-release-smoke: ${pass}/${pass + fail} PASS`)
    process.exit(1)
  }

  console.log(`web-release-smoke: ${pass}/${pass + fail} PASS`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
