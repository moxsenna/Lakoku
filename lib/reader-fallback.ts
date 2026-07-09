export function resolveReaderFallbackNotice(
  requestedChapter: number | undefined,
  currentChapter: number,
  renderedChapter: number,
): number | undefined {
  const effectiveRequest = requestedChapter ?? currentChapter
  return renderedChapter !== effectiveRequest ? effectiveRequest : undefined
}
