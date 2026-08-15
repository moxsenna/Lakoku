/** CLI wrapper for the counted comparator. Kept side-effect-only. */
import { runM10EE3AE4CompareCli } from './m10-e-e3a-e4-compare'

runM10EE3AE4CompareCli(process.argv[3], process.argv[4], process.argv[5])
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })