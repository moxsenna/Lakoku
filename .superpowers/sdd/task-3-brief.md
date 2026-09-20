# Task 3: Integrasi ke Ingestion Pipeline (`parseChapterWriterProse`)

## Context
Feature: Indonesian Cultural Honorifics & Mobile Paragraph Rhythm
Plan: `docs/superpowers/plans/2026-09-21-indonesian-cultural-honorifics-and-mobile-paragraphs.md`

## What to Implement
1. Create failing test: `tests/ai-gateway/chapter-writer-prose-parser.test.ts`
   Test that `parseChapterWriterProse` splits bulky narrative paragraphs automatically into mobile-friendly paragraphs while preserving title and zero word loss.
2. Run test to verify RED: `node node_modules/vitest/vitest.mjs run tests/ai-gateway/chapter-writer-prose-parser.test.ts`
3. Modify `lib/ai-gateway/chapter-writer-contract.ts`:
   Import `splitParagraphsForMobile` from `@/lib/prose/mobile-paragraph-splitter`.
   Apply `splitParagraphsForMobile(rawParagraphs)` to format the parsed paragraphs in `parseChapterWriterProse`.
4. Run test to verify GREEN.
5. Commit: `feat(ai-gateway): integrate mobile paragraph splitter into parseChapterWriterProse`

## Constraints
- ZERO WORD LOSS: countParagraphWords(before) === countParagraphWords(after).
- Ensure existing parser tests (`tests/ai-gateway/*` or other parser tests) continue to pass.
