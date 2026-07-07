import { createBrowserClient } from '@supabase/ssr'

export interface SupabasePublicConfig {
  url: string
  anonKey: string
}

export function createClient(config?: SupabasePublicConfig) {
  const url = config?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = config?.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  return createBrowserClient(
    url!,
    anonKey!,
  )
}
