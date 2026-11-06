export async function GET(req: Request): Promise<Response> {
  const origin = process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/seed/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/seed/oauth/token`,
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    code_challenge_methods: ['S256'],
    token_endpoint_auth_methods: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ['seed'],
  }, { headers: { 'access-control-allow-origin': '*' } })
}
