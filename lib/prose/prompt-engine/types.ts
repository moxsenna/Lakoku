import type { ContinuationContext } from '@lakoku/narrative-core'
import type { ChapterMode } from '@/lib/prose/mobile-drama-style'
import type { PreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

export type { ChapterMode }

export interface WriterPromptParts {
  system: string
  user: string
  styleProfileId: string
  wordTarget: {
    hardMin: number
    hardMax: number
    softMin: number
    softMax: number
  }
  paragraphTarget: {
    hardMin: number
    hardMax: number
    softMin: number
    softMax: number
  }
  /**
   * M10-A closure: berapa baris per kategori yang dievicted layer-3 saat
   * melewati batas karakter (trim granular per-baris, bukan whole-section).
   * Untuk observability/audit; tidak memotong prosa.
   */
  layer3Eviction?: {
    timeline: number
    facts: number
    threads: number
    rollups: number
  }
}

export interface BuildWriterPromptInput {
  chapterNumber: number
  phase?: string
  goal?: string
  characterNames?: string[]
  voiceGuidance?: string
  plannedBeats?: string[]
  sceneCount?: number
  chapterMode?: ChapterMode
  repairFindings?: Array<{ severity?: string; message: string }>
  continuation?: ContinuationContext | null
  brief: PreProseChapterBrief
}

export type EvalSeverity = 'pass' | 'warn' | 'fail'

export type PromptEvalFinding = {
  code: string
  severity: 'warn' | 'fail'
  message: string
  actual?: number | string
  expected?: string
}

export type PromptEvalReport = {
  status: EvalSeverity
  findings: PromptEvalFinding[]
  metrics: {
    words: number
    paragraphs: number
    dialogueParagraphRatio: number
    longParagraphCount: number
    multiSentenceParagraphRatio: number
  }
}

export interface EvaluateProseInput {
  title?: string
  paragraphs: string[]
  chapterMode?: ChapterMode
}
