import { execFileSync } from 'node:child_process'
import {
  verifyLocalRaceContainer,
  verifyLocalRaceTarget,
} from './authoring-race-session'

function main(): void {
  const target = verifyLocalRaceContainer('set local DB test marker')
  try {
    execFileSync(
      'docker',
      [
        'exec', '-i', target.container,
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
        '-U', 'supabase_admin', '-w', '-d', 'postgres',
        '-c', "alter database postgres set lakoku.test_target = 'local-cli';",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 },
    )
  } catch {
    throw new Error('set local DB test marker: local PostgreSQL command failed')
  }
  verifyLocalRaceTarget('set local DB test marker')
  console.log('Local DB test marker: PASS')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'set local DB test marker failed')
  process.exitCode = 1
}
