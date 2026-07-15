/** Shared pure gateway errors and reader-facing leak detection. */

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly errors?: string[],
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

const FORBIDDEN_LEAK_PATTERNS: readonly RegExp[] = [
  /\bnarraza\b/i,
  /\bprompt\b/i,
  /\btoken(s)?\b/i,
  /\bgpt[-\s]?\d/i,
  /\bclaude\b/i,
  /\bgemini\b/i,
  /\bllm\b/i,
  /\bmodel\s*id\b/i,
  /\btemperature\b/i,
  /\bsystem\s*prompt\b/i,
  /\brag\b/i,
  /\bembedding(s)?\b/i,
  /\bprovider\b/i,
]

/** Return forbidden gateway terms found in reader-facing text. */
export function scanForLeaks(text: string): string[] {
  const hits: string[] = []
  for (const pattern of FORBIDDEN_LEAK_PATTERNS) {
    const match = text.match(pattern)
    if (match) hits.push(match[0])
  }
  return hits
}
