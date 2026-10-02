import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}))

import { putCover } from './storage'

afterEach(() => {
  vi.unstubAllEnvs()
  sendMock.mockReset()
})

const webp = Buffer.from('RIFFxxxxWEBP', 'ascii')

describe('putCover', () => {
  it('mengunggah ke R2 dan mengembalikan key', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'key')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret')
    vi.stubEnv('R2_BUCKET', 'lakoku-story-covers')
    sendMock.mockResolvedValue({})

    const result = await putCover('story_1', webp)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.key).toMatch(/^story_1\/[a-z0-9]+\.webp$/)
    const cmd = sendMock.mock.calls[0][0]
    expect(cmd.input.Bucket).toBe('lakoku-story-covers')
    expect(cmd.input.Key).toBe(result.key)
    expect(cmd.input.ContentType).toBe('image/webp')
    expect(cmd.input.CacheControl).toBe('31536000')
    expect(cmd.input.Body).toBe(webp)
  })

  it('kegagalan SDK → ok:false dengan detail, tanpa throw', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'key')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret')
    vi.stubEnv('R2_BUCKET', 'lakoku-story-covers')
    sendMock.mockRejectedValue(new Error('NetworkError'))

    const result = await putCover('story_1', webp)

    expect(result).toEqual({ ok: false, detail: 'NetworkError' })
  })

  it('env belum diset → ok:false, tidak ada panggilan keluar', async () => {
    vi.stubEnv('R2_BUCKET', '')
    const result = await putCover('story_1', webp)
    expect(result.ok).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
