export type CatalogSource = 'cli' | 'gemini-agent'

export function resolveCatalogSource(raw: unknown): CatalogSource {
  if (raw === undefined || raw === null) return 'cli'
  if (raw === 'cli' || raw === 'gemini-agent') return raw
  throw new Error(`CATALOG_SOURCE_INVALID:${String(raw)}`)
}
