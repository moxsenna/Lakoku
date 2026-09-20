import 'server-only'

/**
 * Adapter penyedia gambar untuk sampul cerita.
 *
 * Sengaja berdiri sendiri dan TIDAK menyentuh lib/ai-gateway/: gateway itu
 * jalur teks dengan kontrak parser, penghitung kata, dan gerbang kontinuitas
 * naratif yang tidak berlaku untuk gambar.
 *
 * Dua sifat endpoint yang sudah terukur dan membentuk file ini:
 *   * balasan selalu base64 (`data[0].b64_json`), tidak pernah URL — jadi
 *     pemanggil wajib mengunggah byte-nya sendiri;
 *   * parameter `size` diabaikan penyedia, jadi rasio potret diminta lewat
 *     kalimat prompt dan tetap dinormalkan ulang di lib/cover/image.ts.
 */

import { type CoverPresetKey } from '@lakoku/contracts'

const SERVER_PRESET_PROMPT_MODIFIERS: Record<CoverPresetKey, string> = {
  sinematik:
    'Gaya: sinematik, pencahayaan lembut dan dramatis, kedalaman ruang (shallow depth of field), warna hangat, komposisi tokoh sentral.',
  webtoon:
    'Gaya: ilustrasi webtoon manhwa modern dan anime berkualitas tinggi, garis bersih tegas, pewarnaan digital cerah dinamis, karakter ekspresif memikat.',
  cat_air:
    'Gaya: lukisan cat air klasik (watercolor painting), sapuan kuas basah bertekstur, palet warna pastel puitis mengalir, suasana artistik elegan.',
  gelap:
    'Gaya: gelap dan menegangkan (moody dark thriller), kontras chiaroscuro tinggi, bayangan pekat atmosferik, palet dingin menegangkan.',
  fantasi:
    'Gaya: fantasi megah epik (epic high fantasy), efek cahaya magis berpendar, latar dan busana megah memukau, aura mistis.',
}

export type CoverGenerationInput = {
  title: string
  tagline: string
  role: string
  tropes: string[]
  preset?: CoverPresetKey
  customNotes?: string
  includeTitle?: boolean
  basePromptOverride?: string
}

export type CoverGenerationResult =
  | { ok: true; image: Buffer }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'EMPTY_RESPONSE'; detail: string }

/**
 * Batas waktu satu panggilan. Terukur 12-16 detik, tapi tercatat pernah
 * melampaui 45 detik saat penyedia ramai; 90 detik masih aman di bawah
 * TTL reservasi 300 detik.
 */
const REQUEST_TIMEOUT_MS = 90_000

type ProviderConfig = { baseUrl: string; apiKey: string; modelId: string }

function readProviderConfig(): ProviderConfig | null {
  const baseUrl = process.env.COVER_IMAGE_BASE_URL
  const apiKey = process.env.COVER_IMAGE_API_KEY
  const modelId = process.env.COVER_IMAGE_MODEL_ID
  if (!baseUrl || !apiKey || !modelId) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, modelId }
}

/** Apakah fitur generate bisa dijalankan sama sekali di environment ini. */
export function isCoverProviderConfigured(): boolean {
  return readProviderConfig() !== null
}

/**
 * Susun prompt sampul dari metadata cerita.
 *
 * Teks bebas dari pengguna (judul, tagline) dibatasi panjangnya supaya tidak
 * ada yang mencoba menyelundupkan instruksi panjang lewat kolom judul.
 */
export function buildCoverPrompt(input: CoverGenerationInput): string {
  const title = input.title.slice(0, 120).trim()
  const tagline = input.tagline.slice(0, 200).trim()
  const role = input.role.slice(0, 120).trim()
  const tropes = input.tropes.slice(0, 5).map((t) => t.slice(0, 40).trim()).filter(Boolean)

  const selectedKey = input.preset && SERVER_PRESET_PROMPT_MODIFIERS[input.preset]
    ? input.preset
    : 'sinematik'
  const styleLine = SERVER_PRESET_PROMPT_MODIFIERS[selectedKey]

  const customNotes = input.customNotes
    ? input.customNotes
        .replace(/[\r\n"“”]/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
        .trim()
    : ''

  const baseHeader = input.basePromptOverride?.trim() ||
    'Sampul novel romansa Indonesia, orientasi potret vertikal rasio 2:3 (lebih tinggi daripada lebar).'

  const textInstruction = input.includeTitle
    ? `Tampilkan teks judul cerita "${title}" secara jelas, artistik, dan terbaca rapi di dalam gambar.`
    : 'JANGAN menuliskan teks, huruf, judul, atau tanda air apa pun di dalam gambar.'

  const lines = [
    baseHeader,
    `Judul cerita: "${title}".`,
    tagline ? `Suasana: ${tagline}.` : '',
    role ? `Tokoh utama: ${role}.` : '',
    tropes.length ? `Nuansa: ${tropes.join(', ')}.` : '',
    styleLine,
    customNotes ? `Catatan visual tambahan: "${customNotes}".` : '',
    'Latar dan busana khas Indonesia kontemporer.',
    textInstruction,
  ]
  return lines.filter(Boolean).join('\n')
}

type ImagesResponse = {
  data?: Array<{ b64_json?: string }>
}

/** Panggil penyedia sekali. Kegagalan jadi nilai hasil, bukan exception liar. */
export async function generateCoverImage(
  input: CoverGenerationInput,
): Promise<CoverGenerationResult> {
  const config = readProviderConfig()
  if (!config) {
    return { ok: false, reason: 'NOT_CONFIGURED', detail: 'COVER_IMAGE_* belum diset' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        prompt: buildCoverPrompt(input),
        n: 1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, reason: 'PROVIDER_ERROR', detail: `HTTP ${res.status} ${body.slice(0, 300)}` }
    }

    const payload = (await res.json()) as ImagesResponse
    const b64 = payload.data?.[0]?.b64_json
    if (!b64) {
      return { ok: false, reason: 'EMPTY_RESPONSE', detail: 'balasan tanpa b64_json' }
    }

    const image = Buffer.from(b64, 'base64')
    if (image.byteLength === 0) {
      return { ok: false, reason: 'EMPTY_RESPONSE', detail: 'base64 kosong' }
    }

    return { ok: true, image }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      reason: isAbort ? 'TIMEOUT' : 'PROVIDER_ERROR',
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}
