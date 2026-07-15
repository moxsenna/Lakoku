import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  runCleanupSteps,
  signalRaceProcess,
  type RunningRacePsql,
} from '../../scripts/authoring-race-session'

const root = process.cwd()
const readScript = (name: string) => fs.readFileSync(path.join(root, 'scripts', name), 'utf8')

describe('authoring race lifecycle harnesses', () => {
  it('bounds race process success waits', () => {
    const source = readScript('authoring-race-session.ts')

    expect(source).not.toMatch(/await\s+running\.exit\b/)
    expect(source).toContain('RACE_PROCESS_EXIT_TIMEOUT_MS')
    expect(source).toContain("'local PostgreSQL process exit timed out'")
  })

  it('uses exact application names when PID capture is unavailable', () => {
    const source = readScript('authoring-race-session.ts')

    expect(source).toContain("sql: \"application_name = :'application_name'\"")
    expect(source).toContain('sessions.map((session, index) => ({')
    expect(source).not.toContain('if (running.backendPid === null) return false')
    expect(source).not.toContain('if (running.backendPid === null) return')
  })

  it('sets and verifies local marker inside every privileged psql connection', () => {
    const source = readScript('authoring-race-session.ts')

    expect(source).toContain("set lakoku.test_target = 'local-cli';")
    expect(source).toContain("current_setting('lakoku.test_target', true) <> 'local-cli'")
  })

  it.each([
    'authoring-race-cleanup-failure.ts',
    'authoring-story-claim-race.ts',
    'authoring-story-bible-race.ts',
    'publish-chapter-v2-race.ts',
  ])('enters cleanup scope before setup in %s', (name) => {
    const source = readScript(name)
    const main = source.slice(source.indexOf('async function main()'))

    expect(main.indexOf('try {')).toBeGreaterThan(-1)
    expect(main.indexOf('try {')).toBeLessThan(main.indexOf('execLocalPsql('))
  })

  it('requires exactly one injected cleanup failure label', () => {
    const source = readScript('authoring-race-cleanup-failure.ts')

    expect(source).toContain("assertCleanupFailureLabels(error, ['injected session cleanup'])")
    expect(source).toContain("assertRejectsExtraFailureLabels()")
  })

  it('does not add a session label when the process exited before SIGTERM', async () => {
    const child = {
      exitCode: null as number | null,
      kill: () => {
        child.exitCode = 0
        return false
      },
    }
    const running = {
      child,
      exit: Promise.resolve({ code: 0, signal: null, startFailed: false }),
    } as unknown as RunningRacePsql

    await expect(runCleanupSteps('cleanup test', [
      {
        label: 'injected session cleanup',
        run: () => { throw new Error('injected failure') },
      },
      {
        label: 'session 1',
        run: async () => { await signalRaceProcess(running, 'SIGTERM', 10) },
      },
    ])).rejects.toThrow(/^cleanup test: cleanup failed \(injected session cleanup\)$/)
  })
})
