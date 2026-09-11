import { computeSha256, stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'

export interface M10FEvidenceArtifactBytes {
  content: string
  sha256: string
}

export function serializeM10FEvidenceArtifact(value: unknown): M10FEvidenceArtifactBytes {
  const content = `${stableStringify(value)}\n`
  return {
    content,
    sha256: computeSha256(content),
  }
}
