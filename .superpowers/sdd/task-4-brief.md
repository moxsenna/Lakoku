# Task 4: Integrasi Prompt Engine (`build-writer-prompt.ts` & `types.ts`)

## Context
Feature: Indonesian Cultural Honorifics & Mobile Paragraph Rhythm
Plan: `docs/superpowers/plans/2026-09-21-indonesian-cultural-honorifics-and-mobile-paragraphs.md`

## Files to Modify
- `lib/prose/prompt-engine/types.ts`
- `lib/prose/prompt-engine/build-writer-prompt.ts`
- `lib/ai-gateway/chapter-writer-contract.ts`
- `tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`

## Requirements
1. In `lib/prose/prompt-engine/types.ts`:
   - Add `characterDescriptors?: CharacterDescriptor[]` and `language?: SupportedLanguage` to `BuildWriterPromptInput`.
2. In `lib/prose/prompt-engine/build-writer-prompt.ts`:
   - Import `buildCulturalHonorificDirectives`, `CharacterDescriptor`, `SupportedLanguage` from `@/lib/prose/cultural-conventions`.
   - In P0:
     - Render legal honorifics and roles alongside character names: e.g. `Ragil (Peran: Ayah kandung, sapaan sah: Bapak / Pak / Ayah)`.
     - Explicit invariant: `language === 'id' ? '- Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan, BUKAN tokoh baru.' : ''`
   - In P3:
     - Strengthen mobile paragraph constraints (1-2 short sentences per narrative paragraph, max 25-30 words, standalone dialogue).
   - In P4:
     - Include `culturalDirective = buildCulturalHonorificDirectives(descriptors, language)` if non-empty and language is 'id'.
3. In `lib/ai-gateway/chapter-writer-contract.ts`:
   - In `buildProductionChapterWriterPrompt`:
     - Build character descriptors from active characters in snapshot using `buildCharacterDescriptors(activeChars, snapshot.aliases, 'id')`.
     - Pass `characterDescriptors` and `language: 'id'` into `buildWriterPrompt(...)`.
4. In `tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`:
   - Add tests verifying P0 and P4 directives when `language === 'id'`, and verifying cultural directives are omitted when `language === 'en'`.
   - Verify existing prompt architecture tests continue to pass.

## Verification
- Test runner: `node node_modules/vitest/vitest.mjs run tests/prose/prompt-engine/`
- Typecheck: `pnpm typecheck`
