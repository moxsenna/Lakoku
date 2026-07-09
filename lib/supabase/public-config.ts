import 'server-only'
import type { SupabasePublicConfig } from './client'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'

export function getSupabasePublicConfig(): SupabasePublicConfig {
  return {
    url: requireSupabaseUrl(),
    anonKey: requireSupabaseAnonKey(),
  }
}
