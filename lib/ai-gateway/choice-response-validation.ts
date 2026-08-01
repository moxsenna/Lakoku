import { InvalidModelResponseError } from './model-call-errors'

export type ChoiceModelJsonParseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: InvalidModelResponseError }

/** Parse choice JSON and reject non-object roots before any protocol shape detection. */
export function parseChoiceModelJson(text: string): ChoiceModelJsonParseResult {
  const trimmed = text.trim()
  const raw = (trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed).trim()
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      error: new InvalidModelResponseError(
        'Choice response is not valid JSON.',
        [],
        undefined,
        'PARSE_JSON',
        ['CHOICE_RESPONSE_INVALID_JSON'],
      ),
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: new InvalidModelResponseError(
        'Choice response must be a JSON object.',
        [],
        undefined,
        'DRAFT_SCHEMA',
        ['CHOICE_RESPONSE_NOT_JSON_OBJECT'],
      ),
    }
  }

  return { ok: true, data: parsed as Record<string, unknown> }
}
