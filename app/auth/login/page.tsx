import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/api/user-state'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { isGoogleAuthEnabled } from '@/lib/auth/google-availability'
import { mapOAuthErrorMessage } from '@/lib/auth/oauth-error'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; next?: string; error?: string }>
}) {
  const { reset, next, error } = await searchParams
  const user = await getSessionUser()
  if (user) {
    redirect(sanitizeNextPath(next))
  }

  return (
    <LoginForm
      resetSuccess={reset === 'success'}
      nextPath={sanitizeNextPath(next)}
      googleEnabled={isGoogleAuthEnabled()}
      oauthError={mapOAuthErrorMessage(error)}
    />
  )
}

export const dynamic = 'force-dynamic'
