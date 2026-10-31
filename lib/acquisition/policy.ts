/**
 * Logika murni capture akuisisi (bebas I/O dan Node builtin — dipakai middleware Edge).
 * Desain: docs/designs/PRELAUNCH_ANALYTICS_PROMOTION_GATE.md (OQ1=A).
 *
 * Kontrak G1: setiap signup punya nilai sumber; tanpa penanda → 'direct', bukan kosong.
 */

export const ACQUISITION_COOKIE_NAME = 'lakoku_utm'

/**
 * Konstanta mandiri — SENGAJA bukan mirror `RewardPolicy.attributionCookieDays`
 * (itu setting admin live milik referral; dua concern bisnis tidak boleh satu knob).
 */
export const ACQUISITION_COOKIE_DAYS = 30

export const ACQUISITION_CHANNELS = [
  'direct',
  'whatsapp',
  'instagram',
  'tiktok',
  'x_twitter',
  'email',
  'google',
  'share_link',
  'referral_code',
  'other',
] as const

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number]

export interface ParsedAcquisition {
  channel: AcquisitionChannel
  utm_source: string | null
  utm_campaign: string | null
  referrer_host: string | null
}

export interface AcquisitionInput {
  pathname: string
  utm_source: string | null
  utm_campaign: string | null
  referrer_host: string | null
}

/** Nilai `utm_source` dikenal → kanal. Nilai di luar daftar → 'other'. */
const UTM_SOURCE_TO_CHANNEL: Record<string, AcquisitionChannel> = {
  whatsapp: 'whatsapp',
  wa: 'whatsapp',
  instagram: 'instagram',
  ig: 'instagram',
  tiktok: 'tiktok',
  tt: 'tiktok',
  x: 'x_twitter',
  twitter: 'x_twitter',
  email: 'email',
}

const GOOGLE_REFERRER_HOSTS = new Set(['google.com', 'www.google.com'])
const MAIL_REFERRER_HOSTS = new Set([
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
])

/**
 * Normalisasi nilai UTM menjadi slug reader-safe ([a-z0-9_-], maks 32) —
 * tanpa ini, teks bebas bocor ke tabel. Kosong setelah normalisasi → null.
 */
export function normalizeUtmSlug(value: string | null | undefined): string | null {
  if (!value) return null
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug.length > 0 ? slug : null
}

/** Ambil hostname dari header `referer`; invalid/kosong → null. */
export function referrerHostFromHeader(referer: string | null | undefined): string | null {
  if (!referer) return null
  try {
    return new URL(referer).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Klasifikasi kanal dari satu pintu masuk. Urutan: parameter UTM → path share →
 * path referral → referrer dikenal → direct. Murni, tanpa I/O.
 */
export function classifyAcquisition(input: AcquisitionInput): ParsedAcquisition {
  const utm_source = normalizeUtmSlug(input.utm_source)
  if (utm_source) {
    return {
      channel: UTM_SOURCE_TO_CHANNEL[utm_source] ?? 'other',
      utm_source,
      utm_campaign: normalizeUtmSlug(input.utm_campaign),
      referrer_host: input.referrer_host,
    }
  }

  if (input.pathname.startsWith('/s/')) {
    return { channel: 'share_link', utm_source: null, utm_campaign: null, referrer_host: input.referrer_host }
  }
  if (input.pathname.startsWith('/r/')) {
    return { channel: 'referral_code', utm_source: null, utm_campaign: null, referrer_host: input.referrer_host }
  }

  const host = input.referrer_host
  if (host) {
    if (GOOGLE_REFERRER_HOSTS.has(host)) {
      return { channel: 'google', utm_source: null, utm_campaign: null, referrer_host: host }
    }
    if (MAIL_REFERRER_HOSTS.has(host)) {
      return { channel: 'email', utm_source: null, utm_campaign: null, referrer_host: host }
    }
  }

  return { channel: 'direct', utm_source: null, utm_campaign: null, referrer_host: host ?? null }
}

/** Nilai cookie: JSON pendek ter-encode `{c,us,uc,rh}`. */
export function serializeAcquisitionCookie(parsed: ParsedAcquisition): string {
  return JSON.stringify({
    c: parsed.channel,
    us: parsed.utm_source,
    uc: parsed.utm_campaign,
    rh: parsed.referrer_host,
  })
}

/**
 * Parse nilai cookie `lakoku_utm`. Rusak/kosong/kanal tak dikenal → null
 * (fail-open; pencatat atribusi menulis 'direct').
 */
export function parseAcquisitionCookie(raw: string | null | undefined): ParsedAcquisition | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as { c?: unknown; us?: unknown; uc?: unknown; rh?: unknown }
    if (typeof obj.c !== 'string') return null
    if (!(ACQUISITION_CHANNELS as readonly string[]).includes(obj.c)) return null
    return {
      channel: obj.c as AcquisitionChannel,
      utm_source: typeof obj.us === 'string' && obj.us.length > 0 ? obj.us : null,
      utm_campaign: typeof obj.uc === 'string' && obj.uc.length > 0 ? obj.uc : null,
      referrer_host: typeof obj.rh === 'string' && obj.rh.length > 0 ? obj.rh : null,
    }
  } catch {
    return null
  }
}
