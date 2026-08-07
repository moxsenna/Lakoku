/**
 * CLI wrapper for the M10-B deterministic evaluator suite.
 * Kept separate so importing `m10-b-qa.ts` from tests has no side effects.
 */
import { runM10BCli } from './m10-b-qa'

process.exitCode = runM10BCli()
