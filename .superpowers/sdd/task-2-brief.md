# Task 2 — Modul Pemecah Paragraf Deterministik (`mobile-paragraph-splitter.ts`)

## Context
Feature: Indonesian Cultural Honorifics & Mobile Paragraph Rhythm
Plan: `docs/superpowers/plans/2026-09-21-indonesian-cultural-honorifics-and-mobile-paragraphs.md`

## Deliverables
- `lib/prose/mobile-paragraph-splitter.ts`
- `tests/prose/mobile-paragraph-splitter.test.ts`

## Constraints
- ZERO WORD LOSS: `countParagraphWords(before) === countParagraphWords(after)` without dropping any tokens.
- Maximum 2 sentences per narrative chunk.
- Dialogue lines (standalone and split dialogues) isolated into their own paragraphs.
- Pure function without DB or network dependencies.
