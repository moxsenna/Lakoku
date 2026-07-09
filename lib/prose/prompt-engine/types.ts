import type { ChapterMode } from '@/lib/prose/mobile-drama-style'

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
