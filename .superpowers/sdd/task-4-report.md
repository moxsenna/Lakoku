# Task 4 Implementation Report: Integrasi Prompt Engine (`build-writer-prompt.ts` & `types.ts`)

## Metadata
- **Date**: 2026-09-21
- **Branch**: `feat/cultural-honorifics-mobile-paragraphs`
- **Commit**: `cbd1599 feat(prose): integrate cultural honorifics and mobile rhythm into writer prompt engine`
- **Status**: DONE

## Scope & Changes
1. **Tests (`tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`)**:
   - Added unit tests for P0 and P4 directives when `language === 'id'`:
     - Verifies character presentation with role and legal honorifics: e.g. `Ragil (Peran: Ayah kandung, sapaan sah: Bapak / Pak / Ayah)`.
     - Verifies explicit canon invariant stating honorifics are legitimate forms of address for existing characters, not new characters.
     - Verifies cultural honorific directives section (`Tata Krama Sapaan Kultural Indonesia`) and rule prohibiting naked names for parents.
   - Added unit test verifying complete omission of Indonesian cultural directives when `language === 'en'`.

2. **Types (`lib/prose/prompt-engine/types.ts`)**:
   - Added `characterDescriptors?: CharacterDescriptor[]` and `language?: SupportedLanguage` to `BuildWriterPromptInput`.

3. **Prompt Engine (`lib/prose/prompt-engine/build-writer-prompt.ts`)**:
   - Imported `buildCulturalHonorificDirectives`, `CharacterDescriptor`, `SupportedLanguage` from `@/lib/prose/cultural-conventions`.
   - Updated P0:
     - Formatted character list with canonical name, optional role, and optional legal honorifics.
     - Injected canon invariant: `language === 'id' ? '- Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan, BUKAN tokoh baru.' : ''`.
   - Updated P3:
     - Reinforced mobile paragraph constraints: 1–2 short sentences per narrative paragraph (max 25–30 words), ban on 3+ sentences per block, standalone dialogue requirement.
   - Updated P4:
     - Injected `culturalDirective = buildCulturalHonorificDirectives(descriptors, language)` if non-empty and language is 'id'.

4. **AI Gateway Contract (`lib/ai-gateway/chapter-writer-contract.ts`)**:
   - In `buildProductionChapterWriterPrompt`:
     - Built character descriptors for active characters using `buildCharacterDescriptors(activeChars, snapshot.aliases, 'id')`.
     - Passed `characterDescriptors: descriptors` and `language: 'id'` into `buildWriterPrompt(...)`.

## Validation & Results
1. **Test RED Phase**:
   - Command: `node node_modules/vitest/vitest.mjs run tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`
   - Result: Failed as expected with `AssertionError: expected '=== [P0] ...' to contain 'Ragil (Peran: Ayah kandung, sapaan sah: Bapak / Pak / Ayah)'`.
2. **Test GREEN Phase**:
   - Command: `node node_modules/vitest/vitest.mjs run tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`
   - Result: 2 passed (4ms).
3. **All Prose Suite Tests**:
   - Command: `node node_modules/vitest/vitest.mjs run tests/prose/`
   - Result: 8 test files passed, 53 tests passed (1.25s).
4. **Typecheck**:
   - Command: `pnpm typecheck`
   - Result: Exit 0 (clean, no errors).

## Risks & Notes
- None. Changes strictly adhere to `language === 'id'` scoping, zero impact on English prompts, and full backward compatibility when `characterDescriptors` is not supplied.
