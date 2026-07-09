export function normalizeStoryRouteId(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}
