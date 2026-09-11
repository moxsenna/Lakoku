import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('writer length repair runtime policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([undefined, '', '0', 'true', 'TRUE', 'yes', ' 1', '1 '])(
    'keeps policy OFF for %s',
    async (value) => {
      if (value === undefined) delete process.env.LAKOKU_WRITER_LENGTH_REPAIR_V1
      else vi.stubEnv('LAKOKU_WRITER_LENGTH_REPAIR_V1', value)
      const { isWriterLengthRepairV1Enabled } = await import(
        '@/lib/runtime/writer-length-repair-policy.server'
      )

      expect(isWriterLengthRepairV1Enabled()).toBe(false)
    },
  )

  it('enables policy only for exact 1', async () => {
    vi.stubEnv('LAKOKU_WRITER_LENGTH_REPAIR_V1', '1')
    const { isWriterLengthRepairV1Enabled } = await import(
      '@/lib/runtime/writer-length-repair-policy.server'
    )

    expect(isWriterLengthRepairV1Enabled()).toBe(true)
  })

  it('logs only four aggregate metadata fields', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const {
      observeWriterLengthRepairTelemetry,
      WRITER_LENGTH_REPAIR_V1_TERMINAL_EVENT,
    } = await import('@/lib/runtime/writer-length-repair-policy.server')

    observeWriterLengthRepairTelemetry({
      firstPassOutcome: 'LENGTH_REPAIR_ELIGIBLE',
      repairAttempted: true,
      repairOutcome: 'ACCEPTED',
      finalWriterOutcome: 'ACCEPTED',
    })

    expect(log).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(WRITER_LENGTH_REPAIR_V1_TERMINAL_EVENT, {
      firstPassOutcome: 'LENGTH_REPAIR_ELIGIBLE',
      repairAttempted: true,
      repairOutcome: 'ACCEPTED',
      finalWriterOutcome: 'ACCEPTED',
    })
  })
})
