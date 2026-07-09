export const MIN_READER_FONT_SIZE = 16
export const MAX_READER_FONT_SIZE = 22
export const DEFAULT_READER_FONT_SIZE = 17
export const READER_FONT_SIZE_STORAGE_KEY = 'lakoku:reader-font-size:v1'

export function clampReaderFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_READER_FONT_SIZE
  return Math.min(MAX_READER_FONT_SIZE, Math.max(MIN_READER_FONT_SIZE, Math.round(value)))
}
