import 'server-only'
import { getSessionUser } from '@/lib/api/user-state'

export const AUTHORING_AUTH_REQUIRED_ERROR = 'Masuk untuk membuat cerita.'

export async function requireAuthoringSessionUser() {
  const user = await getSessionUser()
  if (!user) throw new Error(AUTHORING_AUTH_REQUIRED_ERROR)
  return user
}
