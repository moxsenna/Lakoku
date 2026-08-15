/** CLI wrapper for the M10-E E3A/E4 counted evidence runner. Kept side-effect-only. */
import { runM10EE3AE4Cli } from './m10-e-e3a-e4'

const allowedOptions = new Set([
  '--profile=CONTRACT_FIXTURE',
  '--seed=m10-e-e3a-e4-contract-v1',
])

for (const argument of process.argv.slice(3)) {
  if (!allowedOptions.has(argument)) {
    const profileGiven = argument.startsWith('--profile=')
    if (profileGiven && argument !== '--profile=CONTRACT_FIXTURE') {
      console.error('RELEASE_EVIDENCE_NOT_AUTHORIZED')
    } else {
      console.error(`UNSUPPORTED_OPTION ${argument}`)
    }
    process.exitCode = 1
    process.exit(1)
  }
}

runM10EE3AE4Cli()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })