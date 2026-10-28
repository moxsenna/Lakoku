export interface LocalSupabaseStatus {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
}

export function assertLoopbackSupabaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('personalized DB test requires loopback Supabase URL')
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('personalized DB test requires loopback Supabase URL')
  }
  return value
}

export function assertLoopbackDatabaseUrl(
  databaseUrl: string | undefined,
  allowRemote = false,
): string {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('Invalid DATABASE_URL')
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host)
  if (!isLoopback && !allowRemote) {
    throw new Error(
      `Refusing to seed non-loopback host "${host}". Set LAKOKU_ALLOW_REMOTE_FIXTURE_SEED=1 to override.`,
    )
  }
  return host
}

export function readLocalStatus(value: Record<string, unknown>): LocalSupabaseStatus {
  const apiUrl = value.API_URL
  const anonKey = value.ANON_KEY
  const serviceRoleKey = value.SERVICE_ROLE_KEY
  if (
    typeof apiUrl !== 'string' ||
    typeof anonKey !== 'string' ||
    typeof serviceRoleKey !== 'string' ||
    !anonKey ||
    !serviceRoleKey
  ) {
    throw new Error('personalized DB test requires local anon and service-role keys')
  }
  return {
    apiUrl: assertLoopbackSupabaseUrl(apiUrl),
    anonKey,
    serviceRoleKey,
  }
}
