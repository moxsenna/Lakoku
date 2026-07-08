export function getEmailRedirectTo(origin: string, _legacyOverride?: string) {
  return `${origin}/auth/callback`
}
