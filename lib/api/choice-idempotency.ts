export function buildChoiceIdempotencyKey(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): string {
  return `choice:${storyId}:${chapterNumber}:${choiceId}`
}
