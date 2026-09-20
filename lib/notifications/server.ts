import 'server-only'
import { createHash, createSign } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildPushData,
  type PushAudience,
  type PushPayload,
} from './index'

/**
 * Lakoku — Pengirim push FCM (server-only).
 *
 * Satu-satunya tempat yang boleh menyentuh FCM HTTP v1. Kredensial service
 * account TIDAK PERNAH ke browser (ARCH §23 #1 semangat yang sama).
 *
 * Bila env Firebase belum diset, semua fungsi kirim menjadi no-op yang jujur
 * (`skipped_disabled`) — deploy tetap hijau tanpa kredensial.
 */

interface ServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        project_id?: string
        client_email?: string
        private_key?: string
      }
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        }
      }
    } catch {
      return null
    }
    return null
  }
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey }
  }
  return null
}

export function isPushConfigured(): boolean {
  return loadServiceAccount() !== null
}

let cachedToken: { value: string; expiresAt: number } | null = null

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function fetchAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = base64Url(signer.sign(account.privateKey))
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  })
  if (!res.ok) throw new Error(`token exchange gagal (${res.status})`)
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('token exchange tanpa access_token')
  cachedToken = {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  }
  return cachedToken.value
}

export interface SendOutcome {
  successCount: number
  failureCount: number
  invalidTokens: string[]
}

async function sendToTokensRaw(
  account: ServiceAccount,
  accessToken: string,
  tokens: string[],
  payload: PushPayload,
): Promise<SendOutcome> {
  const outcome: SendOutcome = { successCount: 0, failureCount: 0, invalidTokens: [] }
  const data = buildPushData(payload)
  for (const token of tokens) {
    const message: Record<string, unknown> = {
      token,
      notification: { title: payload.title, body: payload.body },
      data,
      android: { priority: 'high' as const },
      webpush: { fcm_options: { link: payload.deepLink ?? '/' } },
    }
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message }),
      },
    )
    if (res.ok) {
      outcome.successCount += 1
      continue
    }
    outcome.failureCount += 1
    const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 12)
    let code = ''
    try {
      const errBody = (await res.json()) as { error?: { status?: string } }
      code = errBody.error?.status ?? ''
    } catch {
      code = ''
    }
    if (code === 'NOT_FOUND' || code === 'INVALID_ARGUMENT') {
      outcome.invalidTokens.push(token)
    }
    console.log(`[push] kirim gagal (${res.status} ${code || 'tanpa-kode'} fp=${fingerprint})`)
  }
  return outcome
}

interface DeviceRow {
  fcm_token: string
}

async function tokensForAudience(audience: PushAudience): Promise<string[]> {
  const admin = createAdminClient()
  if (audience.startsWith('user:')) {
    const userId = audience.slice('user:'.length)
    const { data } = await admin
      .from('push_devices')
      .select('fcm_token')
      .eq('user_id', userId)
    return ((data ?? []) as DeviceRow[]).map((r) => r.fcm_token)
  }
  let query = admin.from('push_devices').select('fcm_token')
  if (audience === 'web' || audience === 'android') query = query.eq('platform', audience)
  const { data } = await query
  return ((data ?? []) as DeviceRow[]).map((r) => r.fcm_token)
}

async function pruneTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  const admin = createAdminClient()
  await admin.from('push_devices').delete().in('fcm_token', tokens)
}

async function writeLog(entry: {
  audience: string
  title: string
  body: string
  deepLink?: string
  dedupeKey?: string
  sentBy?: string
  status: string
  successCount: number
  failureCount: number
}): Promise<void> {
  const admin = createAdminClient()
  await admin.from('push_log').insert({
    audience: entry.audience,
    title: entry.title,
    body: entry.body,
    deep_link: entry.deepLink ?? null,
    dedupe_key: entry.dedupeKey ?? null,
    sent_by: entry.sentBy ?? null,
    status: entry.status,
    success_count: entry.successCount,
    failure_count: entry.failureCount,
  })
}

export interface DispatchResult extends SendOutcome {
  status: 'sent' | 'partial' | 'failed' | 'skipped_disabled'
}

/** Kirim ke satu audiens + catat ke push_log. Idempoten bila dedupeKey diisi. */
export async function dispatchPush(input: {
  audience: PushAudience
  payload: PushPayload
  dedupeKey?: string
  sentBy?: string
}): Promise<DispatchResult> {
  const account = loadServiceAccount()
  if (!account) {
    await writeLog({
      audience: input.audience,
      title: input.payload.title,
      body: input.payload.body,
      deepLink: input.payload.deepLink,
      dedupeKey: input.dedupeKey,
      sentBy: input.sentBy,
      status: 'skipped_disabled',
      successCount: 0,
      failureCount: 0,
    }).catch(() => undefined)
    return { successCount: 0, failureCount: 0, invalidTokens: [], status: 'skipped_disabled' }
  }

  if (input.dedupeKey) {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from('push_log')
      .select('id')
      .eq('dedupe_key', input.dedupeKey)
      .limit(1)
    if (existing && existing.length > 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [], status: 'sent' }
    }
  }

  const tokens = await tokensForAudience(input.audience)
  if (tokens.length === 0) {
    await writeLog({
      audience: input.audience,
      title: input.payload.title,
      body: input.payload.body,
      deepLink: input.payload.deepLink,
      dedupeKey: input.dedupeKey,
      sentBy: input.sentBy,
      status: 'sent',
      successCount: 0,
      failureCount: 0,
    })
    return { successCount: 0, failureCount: 0, invalidTokens: [], status: 'sent' }
  }

  const accessToken = await fetchAccessToken(account)
  const outcome = await sendToTokensRaw(account, accessToken, tokens, input.payload)
  await pruneTokens(outcome.invalidTokens)
  const status =
    outcome.failureCount === 0 ? 'sent' : outcome.successCount === 0 ? 'failed' : 'partial'
  await writeLog({
    audience: input.audience,
    title: input.payload.title,
    body: input.payload.body,
    deepLink: input.payload.deepLink,
    dedupeKey: input.dedupeKey,
    sentBy: input.sentBy,
    status,
    successCount: outcome.successCount,
    failureCount: outcome.failureCount,
  })
  return { ...outcome, status }
}

/** Pemicu transaksional: bab baru siap dibaca untuk satu user. */
export async function notifyChapterReady(input: {
  userId: string
  storyTitle: string
  chapterNumber: number
  deepLink: string
}): Promise<DispatchResult> {
  return dispatchPush({
    audience: `user:${input.userId}` as PushAudience,
    payload: {
      title: 'Bab baru sudah siap',
      body: `Lanjutan "${input.storyTitle}" bab ${input.chapterNumber} menunggumu.`,
      deepLink: input.deepLink,
    },
    dedupeKey: `chapter-ready:${input.userId}:${input.deepLink}`,
  })
}

/** Pemicu transaksional: misi harian selesai. */
export async function notifyMissionComplete(input: {
  userId: string
  missionName: string
}): Promise<DispatchResult> {
  return dispatchPush({
    audience: `user:${input.userId}` as PushAudience,
    payload: {
      title: 'Misi selesai',
      body: `"${input.missionName}" beres. Imbalanmu sudah masuk.`,
      deepLink: '/profil',
    },
    dedupeKey: `mission:${input.userId}:${input.missionName}:${new Date().toISOString().slice(0, 10)}`,
  })
}

/** Pemicu transaksional: hasil topup (berhasil/gagal). */
export async function notifyTopupResult(input: {
  userId: string
  ok: boolean
  ref: string
}): Promise<DispatchResult> {
  return dispatchPush({
    audience: `user:${input.userId}` as PushAudience,
    payload: input.ok
      ? {
          title: 'Topup berhasil',
          body: 'Lakoin-mu sudah bertambah. Selamat membaca!',
          deepLink: '/kredit',
        }
      : {
          title: 'Topup belum berhasil',
          body: 'Pembayaranmu belum masuk. Coba lagi atau hubungi bantuan.',
          deepLink: '/kredit',
        },
    dedupeKey: `topup:${input.ref}`,
  })
}
