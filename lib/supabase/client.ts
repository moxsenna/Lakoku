import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env'

export interface SupabasePublicConfig {
  url: string
  anonKey: string
}

export function createClient(config?: SupabasePublicConfig) {
  const url = config?.url ?? getSupabaseUrl()
  const anonKey = config?.anonKey ?? getSupabaseAnonKey()

  return createBrowserClient(
    url!,
    anonKey!,
  )
}
