/**
 * Titik masuk tunggal lapisan data Lakoku.
 * UI mengimpor dari '@/lib/api' — bukan dari fixtures atau types langsung.
 */
export * from './types'
export {
  listStories,
  getStory,
  getChapter,
  submitChoice,
} from './client'
