export async function GET(req: Request): Promise<Response> {
  const origin = process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
  return Response.json({
    resource: `${origin}/api/mcp/seed`,
    authorization_servers: [origin],
    scopes_supported: ['seed'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/api/mcp/seed`,
  }, { headers: { 'access-control-allow-origin': '*' } })
}
