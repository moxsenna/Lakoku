import 'server-only'

import type { WriterLengthRepairTelemetry } from '@lakoku/ai-gateway'

export const WRITER_LENGTH_REPAIR_V1_ENV = 'LAKOKU_WRITER_LENGTH_REPAIR_V1' as const
export const WRITER_LENGTH_REPAIR_V1_TERMINAL_EVENT = 'WRITER_LENGTH_REPAIR_V1_TERMINAL' as const

/** Strict server-only opt-in. Missing values and every value except exact `1` are OFF. */
export function isWriterLengthRepairV1Enabled(): boolean {
  return process.env[WRITER_LENGTH_REPAIR_V1_ENV] === '1'
}

/** Metadata-only terminal observer. Gateway guarantees one callback per enabled operation. */
export function observeWriterLengthRepairTelemetry(
  telemetry: WriterLengthRepairTelemetry,
): void {
  console.log(WRITER_LENGTH_REPAIR_V1_TERMINAL_EVENT, {
    firstPassOutcome: telemetry.firstPassOutcome,
    repairAttempted: telemetry.repairAttempted,
    repairOutcome: telemetry.repairOutcome,
    finalWriterOutcome: telemetry.finalWriterOutcome,
  })
}
