/**
 * Resolve Supabase public env with local + Cloudflare-friendly fallbacks.
 *
 * Workers Builds may expose either NEXT_PUBLIC_* or bare SUPABASE_* names.
 * Runtime Worker secrets and local .env/.dev.vars both need to work.
 */
export function getSupabaseUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    undefined
  )
}

export function getSupabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    undefined
  )
}

export function requireSupabaseUrl(): string {
  const url = getSupabaseUrl()
  if (!url) {
    throw new Error(
      'Supabase URL missing. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) for build and runtime.',
    )
  }
  return url
}

export function requireSupabaseAnonKey(): string {
  const key = getSupabaseAnonKey()
  if (!key) {
    throw new Error(
      'Supabase anon key missing. Set NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) for build and runtime.',
    )
  }
  return key
}
