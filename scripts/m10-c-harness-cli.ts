/** CLI wrapper. Kept side-effect-only so the runner module stays importable by tests. */
import { runM10CCli } from './m10-c-harness'

runM10CCli()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
