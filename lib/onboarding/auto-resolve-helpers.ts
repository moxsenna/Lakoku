import { CONFLICT_CATALOG_BY_GENRE } from '@/lib/taste-profile/catalog'

export function buildCoreConflictFallback(): { id: string; label: string }[] {
  return (CONFLICT_CATALOG_BY_GENRE.mystery ?? []).slice(0, 3).map((e) => ({
    id: e.id,
    label: e.label,
  }))
}
