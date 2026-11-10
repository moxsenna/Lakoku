import { describe, expect, it } from 'vitest'
import { handleMcpRpc } from '@/lib/mcp-seed/dispatch.server'
import { SEED_TOOLS } from '@/lib/mcp-seed/tools.server'

const handlers = {
  async assignNovel(input: unknown, _sub: string) { return { echo: input } },
  async getUnitSpec(_input: unknown, _sub: string) { return { prompt: 'x' } },
  async submitUnit(_input: unknown, _sub: string) { return { status: 'accepted' } },
  async getBatchSpec(_input: unknown, _sub: string) { return { units: [] } },
  async submitUnits(_input: unknown, _sub: string) { return { results: [] } },
  async getNovelStatus(_input: unknown, _sub: string) { return { status: 'drafting' } },
  async finalizeNovel(_input: unknown, _sub: string) { return { status: 'review' } },
}

function rpc(body: unknown, sub: string | null = 'user-1'): Promise<Response> {
  return handleMcpRpc({ body, sub, handlers, origin: 'https://lakoku.test' })
}

describe('handleMcpRpc', () => {
  it('initialize mengembalikan protocolVersion + capabilities', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const json = await res.json() as { result: Record<string, unknown> }
    expect(json.result.protocolVersion).toBeTypeOf('string')
    expect(json.result.serverInfo).toMatchObject({ name: 'lakoku-seed' })
  })

  it('notifications tanpa id → 202 kosong', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })

  it('tools/list mengembalikan 5 tool dengan inputSchema', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const json = await res.json() as { result: { tools: Array<{ name: string }> } }
    expect(json.result.tools.map((t) => t.name)).toEqual([
      'seed_assign_novel',
      'seed_get_unit_spec',
      'seed_submit_unit',
      'seed_get_batch_spec',
      'seed_submit_units',
      'seed_get_novel_status',
      'seed_finalize_novel',
    ])
    expect(json.result.tools).toHaveLength(SEED_TOOLS.length)
  })

  it('tools/call meneruskan arguments ke handler', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'seed_get_novel_status', arguments: { novel_id: 'catalog:uji' } },
    })
    const json = await res.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(json.result.isError).toBeFalsy()
    expect(JSON.parse(json.result.content[0]!.text)).toEqual({ status: 'drafting' })
  })

  it('tanpa sub pada tools/call → 401 + WWW-Authenticate resource metadata', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'seed_get_novel_status', arguments: { novel_id: 'catalog:uji' } },
    }, null)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata')
  })

  it('tools/list boleh dipanggil tanpa sub', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 40, method: 'tools/list' }, null)
    expect(res.status).toBe(200)
    const json = await res.json() as { result: { tools: Array<{ name: string }> } }
    expect(json.result.tools).toHaveLength(SEED_TOOLS.length)
  })

  it('method tak dikenal → -32601', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'bukan/method' })
    const json = await res.json() as { error: { code: number } }
    expect(json.error.code).toBe(-32601)
  })

  it('tool unknown → error result', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'hack', arguments: {} } })
    const json = await res.json() as { result: { isError: boolean } }
    expect(json.result.isError).toBe(true)
  })

  it('handler melempar error → isError true dengan pesan', async () => {
    const failing = { ...handlers, async getNovelStatus(_input: unknown, _sub: string) { throw new Error('MCP_SEED_DISABLED: off') } }
    const res = await handleMcpRpc({
      body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'seed_get_novel_status', arguments: {} } },
      sub: 'user-1', handlers: failing, origin: 'https://lakoku.test',
    })
    const json = await res.json() as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(json.result.isError).toBe(true)
    expect(json.result.content[0]!.text).toContain('MCP_SEED_DISABLED')
  })
})
