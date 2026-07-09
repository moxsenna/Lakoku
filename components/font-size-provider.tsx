'use client'

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  clampReaderFontSize,
  DEFAULT_READER_FONT_SIZE,
  READER_FONT_SIZE_STORAGE_KEY,
} from '@/lib/reader-font-size'

interface FontSizeContextValue {
  fontSize: number
  setFontSize: (value: number) => void
  increaseFontSize: () => void
  decreaseFontSize: () => void
}

const FontSizeContext = createContext<FontSizeContextValue | null>(null)
const FONT_SIZE_CHANGE_EVENT = 'lakoku:reader-font-size-change'

function subscribeFontSize(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(FONT_SIZE_CHANGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(FONT_SIZE_CHANGE_EVENT, onStoreChange)
  }
}

function getFontSizeSnapshot() {
  return clampReaderFontSize(Number(window.localStorage.getItem(READER_FONT_SIZE_STORAGE_KEY)))
}

function getServerFontSizeSnapshot() {
  return DEFAULT_READER_FONT_SIZE
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const fontSize = useSyncExternalStore(
    subscribeFontSize,
    getFontSizeSnapshot,
    getServerFontSizeSnapshot,
  )

  function setFontSize(value: number) {
    const next = clampReaderFontSize(value)
    window.localStorage.setItem(READER_FONT_SIZE_STORAGE_KEY, String(next))
    window.dispatchEvent(new Event(FONT_SIZE_CHANGE_EVENT))
  }

  const value = useMemo<FontSizeContextValue>(
    () => ({
      fontSize,
      setFontSize,
      increaseFontSize: () => setFontSize(fontSize + 1),
      decreaseFontSize: () => setFontSize(fontSize - 1),
    }),
    [fontSize],
  )

  return <FontSizeContext.Provider value={value}>{children}</FontSizeContext.Provider>
}

export function useReaderFontSize() {
  const value = useContext(FontSizeContext)
  if (!value) throw new Error('useReaderFontSize must be used inside FontSizeProvider')
  return value
}
