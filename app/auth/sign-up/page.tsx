import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { SignUpForm } from './sign-up-form'

export default function SignUpPage() {
  return <SignUpForm supabaseConfig={getSupabasePublicConfig()} />
}

export const dynamic = 'force-dynamic'
