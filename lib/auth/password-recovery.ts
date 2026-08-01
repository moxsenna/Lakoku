export const RECOVERY_COOKIE_NAME = '__Host-lakoku-recovery'
export const recoveryCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 600,
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Buffer.from(digest).toString('hex')
}

export function validateRecoveryProvenance(exchange: { redirectType?: string | null }) {
  return { ok: exchange.redirectType === 'recovery' } as const
}

export async function buildRecoveryCapability(userId: string, sessionId: string) {
  const random = crypto.getRandomValues(new Uint8Array(32))
  const token = toBase64Url(random)
  return { token, tokenHash: await sha256(token), userId, sessionId }
}

type Consume = (args: { p_token_hash: string; p_user_id: string; p_session_id: string }) => Promise<{ data: boolean | null; error: unknown }>

export async function consumeRecoveryCapability(input: { token: string | null; userId: string; sessionId: string; consume: Consume }) {
  if (!input.token) return { ok: false } as const
  const result = await input.consume({ p_token_hash: `\\x${await sha256(input.token)}`, p_user_id: input.userId, p_session_id: input.sessionId })
  return { ok: !result.error && result.data === true } as const
}

export async function recoverySessionId(accessToken: string): Promise<string> {
  return sha256(accessToken)
}

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; message: string }

export function validateNewPassword(
  password: string,
  confirmation: string,
): PasswordValidationResult {
  if (password.length < 6) {
    return { ok: false, message: 'Kata sandi minimal 6 karakter.' }
  }
  if (password !== confirmation) {
    return { ok: false, message: 'Konfirmasi kata sandi tidak cocok.' }
  }
  return { ok: true }
}

export function mapPasswordRecoveryError(message: string): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('session missing') ||
    normalized.includes('session_not_found') ||
    normalized.includes('otp_expired') ||
    normalized.includes('expired') ||
    normalized.includes('invalid token')
  ) {
    return 'Tautan pemulihan tidak valid atau sudah kedaluwarsa.'
  }

  if (
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    normalized.includes('timeout')
  ) {
    return 'Koneksi bermasalah. Periksa jaringan lalu coba lagi.'
  }

  return 'Permintaan belum dapat diproses. Coba lagi.'
}
