/**
 * JSON-RPC MCP streamable-HTTP tulisan tangan (tanpa dependency SDK):
 * initialize / notifications/initialized / ping / tools/list / tools/call.
 * Handler tool bisa melempar Error; pesan error diteruskan ke agent agar
 * bisa memperbaiki diri (pesan berkode, sisi admin — bukan sisi pembaca).
 */
import { SEED_TOOLS, type ToolName } from '@/lib/mcp-seed/tools.server'

export interface SeedToolHandlers {
  assignNovel(input: unknown, sub: string): Promise<Record<string, unknown>>
  getUnitSpec(input: unknown, sub: string): Promise<Record<string, unknown>>
  submitUnit(input: unknown, sub: string): Promise<Record<string, unknown>>
  getNovelStatus(input: unknown, sub: string): Promise<Record<string, unknown>>
  finalizeNovel(input: unknown, sub: string): Promise<Record<string, unknown>>
}

const HANDLER_BY_TOOL: Record<ToolName, keyof SeedToolHandlers> = {
  seed_assign_novel: 'assignNovel',
  seed_get_unit_spec: 'getUnitSpec',
  seed_submit_unit: 'submitUnit',
  seed_get_novel_status: 'getNovelStatus',
  seed_finalize_novel: 'finalizeNovel',
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolText(id: unknown, result: Record<string, unknown>, isError = false): Response {
  return jsonRpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    ...(isError ? { isError: true } : {}),
  })
}

export async function handleMcpRpc(args: {
  body: unknown
  sub: string | null
  handlers: SeedToolHandlers
  origin: string
}): Promise<Response> {
  const { body, sub, handlers } = args
  if (!body || typeof body !== 'object') {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, { status: 400 })
  }
  const record = body as { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }
  if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') {
    return Response.json({ jsonrpc: '2.0', id: record.id ?? null, error: { code: -32600, message: 'Invalid Request' } }, { status: 400 })
  }
  const id = record.id
  const isNotification = id === undefined || id === null

  if (record.method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lakoku-seed', version: '1.0.0' },
      instructions: 'Server seeding novel katalog Lakoku. Alur: seed_assign_novel → loop(seed_get_unit_spec → tulis → seed_submit_unit) → seed_finalize_novel.',
    })
  }
  if (record.method === 'notifications/initialized' || record.method.startsWith('notifications/')) {
    return new Response(null, { status: 202 })
  }
  if (record.method === 'ping') {
    return jsonRpcResult(id, {})
  }
  if (record.method === 'tools/list') {
    return jsonRpcResult(id, { tools: SEED_TOOLS })
  }
  if (record.method === 'tools/call') {
    if (!sub) {
      return Response.json(
        { jsonrpc: '2.0', id: id ?? null, error: { code: -32001, message: 'Unauthorized' } },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${args.origin}/.well-known/oauth-protected-resource"` } },
      )
    }
    const params = (record.params ?? {}) as { name?: unknown; arguments?: unknown }
    const name = typeof params.name === 'string' ? params.name : ''
    const descriptor = SEED_TOOLS.find((tool) => tool.name === name)
    if (!descriptor) {
      return jsonRpcResult(id, { content: [{ type: 'text', text: `Tool tidak dikenal: ${name}` }], isError: true })
    }
    try {
      const handler = handlers[HANDLER_BY_TOOL[descriptor.name]]
      const result = await handler(params.arguments, sub)
      return toolText(id, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return jsonRpcResult(id, { content: [{ type: 'text', text: message }], isError: true })
    }
  }
  if (isNotification) return new Response(null, { status: 202 })
  return jsonRpcError(id, -32601, `Method not found: ${record.method}`)
}
