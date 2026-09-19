/**
 * Reticle MCP stdio driver — one-shot.
 * Usage: node scripts/reticle-mcp-call.mjs <toolName> [jsonArgs]
 * Speaks JSON-RPC over stdio to `npx @reticlehq/server mcp`, prints the tool result.
 */
import { spawn } from 'node:child_process'

const tool = process.argv[2]
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {}

const child = spawn('npx', ['@reticlehq/server', 'mcp'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
})

let buf = ''
const pending = new Map()
let nextId = 1

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n')
}

function call(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ jsonrpc: '2.0', id, method, params })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout waiting for ${method} (id=${id})`))
      }
    }, 240_000)
  })
}

child.stdout.on('data', (chunk) => {
  buf += chunk.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    }
  }
})

child.stderr.on('data', (d) => process.stderr.write(d))

async function main() {
  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'zcode-oneshot', version: '1.0.0' },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  if (process.argv[2] === '--list') {
    const tools = await call('tools/list', {})
    for (const t of tools.tools) console.log(t.name, '::', (t.description || '').slice(0, 120))
    child.kill()
    return
  }

  const result = await call('tools/call', { name: tool, arguments: args })
  console.log(JSON.stringify(result, null, 2))
  child.kill()
  process.exit(0)
}

main().catch((err) => {
  console.error('MCP-DRIVER-ERROR:', err.message)
  child.kill()
  process.exit(1)
})
