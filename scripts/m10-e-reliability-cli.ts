/** CLI wrapper. Kept side-effect-only so the runner module stays importable by tests. */
import { runM10E1Cli } from './m10-e-reliability'

runM10E1Cli()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
