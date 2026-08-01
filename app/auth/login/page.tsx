import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>
}) {
  const { reset } = await searchParams
  return (
    <LoginForm
      supabaseConfig={getSupabasePublicConfig()}
      resetSuccess={reset === 'success'}
    />
  )
}

export const dynamic = 'force-dynamic'
