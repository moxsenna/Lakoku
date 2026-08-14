/** Full E2 CLI. Invoked directly until package command receives separate authorization. */
import { runM10E2Cli } from './m10-e-reliability'

runM10E2Cli()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
