import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { SignUpForm } from './sign-up-form'

export default function SignUpPage() {
  return (
    <SignUpForm
      supabaseConfig={getSupabasePublicConfig()}
      redirectTo={process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL}
    />
  )
}

export const dynamic = 'force-dynamic'
