import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { ForgotPasswordForm } from './forgot-password-form'

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm supabaseConfig={getSupabasePublicConfig()} />
}

export const dynamic = 'force-dynamic'
