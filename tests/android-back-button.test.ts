import { describe, expect, it } from 'vitest'
import { decideAndroidBack } from '@/lib/android/back-button'

describe('decideAndroidBack', () => {
  it('pops history when WebView has history', () => {
    expect(decideAndroidBack({ canGoBack: true, pathname: '/baca/x' })).toBe('history')
  })
  it('goes home from a deep page opened without history (notification/deep link)', () => {
    expect(decideAndroidBack({ canGoBack: false, pathname: '/baca/x' })).toBe('home')
  })
  it('exits only from home routes', () => {
    expect(decideAndroidBack({ canGoBack: false, pathname: '/beranda' })).toBe('exit')
    expect(decideAndroidBack({ canGoBack: false, pathname: '/' })).toBe('exit')
  })
})
