import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
type Event = { operation: string; registry: number; key: number; value: { present?: boolean; registered?: boolean; modelId?: string } }
type Probe = { events: Event[]; networkAttempts: number }

function child(instrumented: boolean) {
  return new Promise<{ status: number | null; stdout: string; stderr: string; probe?: Probe }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'PATHEXT']) {
      if (process.env[name] !== undefined) env[name] = process.env[name]
    }
    Object.assign(env, { NODE_ENV: 'production', OPENROUTER_API_KEY: 'offline-placeholder', LAKOKU_WRITER_V2_FLAGSHIP_REPLACEMENT_CHILD: '1' })
    const args = instrumented ? ['--require', fileURLToPath(new URL('./replacement-binding-probe.cjs', import.meta.url))] : []
    const processChild = spawn(process.execPath, [...args, 'scripts/run-smoke.cjs', 'scripts/writer-v2-flagship-replacement.ts', '--preflight-only'], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 30000,
    })
    let stdout = ''
    let stderr = ''
    let probe: Probe | undefined
    processChild.stdout!.on('data', (data: Buffer) => { stdout += data.toString() })
    processChild.stderr!.on('data', (data: Buffer) => { stderr += data.toString() })
    processChild.on('message', (message: Probe) => { probe = message })
    processChild.on('error', reject)
    processChild.on('close', (status) => resolve({ status, stdout, stderr, probe }))
  })
}

describe('replacement real child binding provenance', () => {
  it.each([false, true])('retains provider registry through real child bootstrap (instrumented=%s)', async (instrumented) => {
    const result = await child(instrumented)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('offline-placeholder')
    const snapshot = JSON.parse(lines[0])
    expect(snapshot).toMatchObject({ ok: true, providerCalls: 0, networkAttempts: 0, budgetReservations: 0,
      artifactWritten: false, databaseCalls: 0, publicationCalls: 0, allowance: 'UNUSED',
      gatewayTransport: 'OpenRouter', requestedModel: 'openai/gpt-5.6-sol', rawResponseModelCapture: true,
      observerAuthority: false, observerIsolation: 'PASS', semanticOutcome: 'UNVERIFIABLE' })
    expect(result.status).toBe(0)
    if (instrumented) {
      expect(result.probe?.networkAttempts).toBe(0)
      const binding = result.probe?.events.find((event) => event.operation === 'bind')
      const lookup = result.probe?.events.find((event) => event.operation === 'lookup')
      expect(binding?.value).toMatchObject({ registered: true, modelId: 'openai/gpt-5.6-sol' })
      expect(lookup?.key).toBe(binding?.key)
      expect(lookup?.registry).toBe(binding?.registry)
      expect(lookup?.value.present).toBe(true)
    }
  }, 40000)
})
