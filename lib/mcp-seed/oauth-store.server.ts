import 'server-only'
import { getDb, result } from '@lakoku/db'
import type { CodeRow, OAuthTokenStore, RefreshRow } from '@/lib/mcp-seed/oauth-core'
import { sha256B64Url } from '@/lib/mcp-seed/oauth-core'

function assertOk(res: { error: { message: string } | null }, label: string): void {
  if (res.error) throw new Error(`[mcp-seed-oauth] ${label} gagal: ${res.error.message}`)
}

/**
 * Store OAuth di DB produksi (tabel mcp_seed_oauth, migration Task 5b).
 * Code & refresh disimpan sebagai hash SHA-256; single-use dijaga oleh
 * DELETE ... RETURNING (atomik).
 */
export function createDbTokenStore(): OAuthTokenStore {
  const db = getDb()
  return {
    async putCode(row: CodeRow): Promise<void> {
      assertOk(await result(
        db.insertInto('mcp_seed_oauth').values({
          kind: 'code',
          token_hash: row.codeHash,
          user_id: row.userId,
          client_id: row.clientId,
          redirect_uri: row.redirectUri,
          code_challenge: row.codeChallenge,
          scope: row.scope,
          expires_at: new Date(row.expiresAt).toISOString(),
        }).execute(),
      ), 'putCode')
    },
    async takeCode(codeHash: string): Promise<CodeRow | null> {
      const deleted = await db.deleteFrom('mcp_seed_oauth')
        .where('token_hash', '=', codeHash)
        .where('kind', '=', 'code')
        .returning(['user_id', 'client_id', 'redirect_uri', 'code_challenge', 'scope', 'expires_at'])
        .execute()
      const row = deleted[0]
      if (!row) return null
      if (new Date(row.expires_at).getTime() <= Date.now()) return null
      return {
        codeHash,
        userId: String(row.user_id),
        clientId: String(row.client_id),
        redirectUri: String(row.redirect_uri ?? ''),
        codeChallenge: String(row.code_challenge ?? ''),
        scope: String(row.scope),
        expiresAt: new Date(row.expires_at).getTime(),
      }
    },
    async putRefresh(row: RefreshRow): Promise<void> {
      assertOk(await result(
        db.insertInto('mcp_seed_oauth').values({
          kind: 'refresh',
          token_hash: row.tokenHash,
          user_id: row.userId,
          client_id: row.clientId,
          redirect_uri: null,
          code_challenge: null,
          scope: row.scope,
          expires_at: new Date(row.expiresAt).toISOString(),
        }).execute(),
      ), 'putRefresh')
    },
    async takeRefresh(tokenHash: string): Promise<RefreshRow | null> {
      const deleted = await db.deleteFrom('mcp_seed_oauth')
        .where('token_hash', '=', tokenHash)
        .where('kind', '=', 'refresh')
        .returning(['user_id', 'client_id', 'scope', 'expires_at'])
        .execute()
      const row = deleted[0]
      if (!row) return null
      if (new Date(row.expires_at).getTime() <= Date.now()) return null
      return {
        tokenHash,
        userId: String(row.user_id),
        clientId: String(row.client_id),
        scope: String(row.scope),
        expiresAt: new Date(row.expires_at).getTime(),
      }
    },
  }
}

export { sha256B64Url }
