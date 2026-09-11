/** CLI wrapper for the allowlist auditor. Kept side-effect-only. */
import { runM10EE3AE4AllowlistCli } from './m10-e-e3a-e4-allowlist'

runM10EE3AE4AllowlistCli(process.argv[3], process.argv[4])
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })