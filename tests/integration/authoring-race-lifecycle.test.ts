import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  execLocalPsql,
  parseSupabaseProjectId,
  runCleanupSteps,
  signalRaceProcess,
  verifyLocalRaceContainer,
  verifyLocalRaceTarget,
  type LocalRaceVerificationDependencies,
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

  it('does not manufacture local marker in generic psql execution', () => {
    const calls: Array<{ command: string, args: readonly string[], input: string }> = []
    const output = execLocalPsql(
      { container: 'supabase_db_lakoku-v2', context: 'marker test' },
      'select 42;',
      {},
      100,
      (command, args, options) => {
        calls.push({ command, args, input: String(options.input) })
        return '42\n'
      },
    )

    expect(output).toBe('42\n')
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toContain("current_setting('lakoku.test_target', true) <> 'local-cli'")
    expect(calls[0].input).toContain('select 42;')
    expect(calls[0].input).not.toContain('set lakoku.test_target')
  })

  function verificationDependencies(overrides: Partial<LocalRaceVerificationDependencies> = {}): LocalRaceVerificationDependencies {
    return {
      cwd: 'C:\\repo',
      readConfig: () => 'project_id = "lakoku-v2"\n',
      readStatus: () => ({ API_URL: 'http://127.0.0.1:55321', DB_URL: 'postgresql://postgres@127.0.0.1:55322/postgres' }),
      inspectContainerProject: () => 'lakoku-v2',
      readPersistentMarker: () => 'local-cli',
      ...overrides,
    }
  }

  it('rejects absent persistent database marker', () => {
    const dependencies = verificationDependencies({ readPersistentMarker: () => '' })
    expect(() => verifyLocalRaceTarget('marker test', dependencies)).toThrow('lakoku.test_target must equal local-cli')
  })

  it('rejects unsafe project ID before container use', () => {
    const dependencies = verificationDependencies({ readConfig: () => 'project_id = "lakoku v2"\n' })
    expect(() => verifyLocalRaceContainer('project test', dependencies)).toThrow('unsafe project_id')
  })

  it('rejects non-loopback status URLs', () => {
    const dependencies = verificationDependencies({
      readStatus: () => ({ API_URL: 'https://example.supabase.co', DB_URL: 'postgresql://postgres@example.com/postgres' }),
    })
    expect(() => verifyLocalRaceContainer('status test', dependencies)).toThrow()
  })

  it('rejects mismatched container label', () => {
    const dependencies = verificationDependencies({ inspectContainerProject: () => 'other-project' })
    expect(() => verifyLocalRaceContainer('container test', dependencies)).toThrow('database container is not current local Supabase project')
  })

  it('parses strict tracked Supabase project IDs', () => {
    expect(parseSupabaseProjectId('project_id = "lakoku-v2"\n')).toBe('lakoku-v2')
    expect(parseSupabaseProjectId('# project_id = "wrong"\nproject_id = "safe_name-2"\n')).toBe('safe_name-2')
    expect(() => parseSupabaseProjectId('project_id = "lakoku v2"\n')).toThrow('unsafe project_id')
    expect(() => parseSupabaseProjectId('project_id = "first"\nproject_id = "second"\n')).toThrow('exactly one project_id')
    expect(() => parseSupabaseProjectId('[api]\nenabled = true\n')).toThrow('exactly one project_id')
  })

  it('derives local DB container only from tracked Supabase config', () => {
    const source = readScript('authoring-race-session.ts')

    expect(source).toContain("path.join(dependencies.cwd, 'supabase', 'config.toml')")
    expect(source).toContain('`supabase_db_${project}`')
    expect(source).toContain('export function verifyLocalRaceContainer')
    expect(source).not.toContain('path.basename(process.cwd())')
  })

  it('sets persistent marker only after container-only verification', () => {
    const source = readScript('set-local-db-test-marker.ts')

    expect(source).toContain("verifyLocalRaceContainer('set local DB test marker')")
    expect(source).toContain("alter database postgres set lakoku.test_target = 'local-cli';")
    expect(source).toContain("'-U', 'supabase_admin'")
    expect(source).toContain("'-w'")
    expect(source).toContain("verifyLocalRaceTarget('set local DB test marker')")
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
