import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return <LoginForm supabaseConfig={getSupabasePublicConfig()} />
}

export const dynamic = 'force-dynamic'
