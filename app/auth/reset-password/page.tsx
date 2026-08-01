import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { ResetPasswordForm } from './reset-password-form'

export default function ResetPasswordPage() {
  return <ResetPasswordForm supabaseConfig={getSupabasePublicConfig()} />
}

export const dynamic = 'force-dynamic'
