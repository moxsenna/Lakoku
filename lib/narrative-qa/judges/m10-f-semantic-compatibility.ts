import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const M10F_FROZEN_SEMANTIC_SOURCE_HASHES = Object.freeze({
  'fixtures/m10-f/semantic-authority.ts': 'e81aa1c3029ab2b891f3a7e82cd263adf6bf2afce1fcfd27c40c3f21f122bc41',
  'lib/narrative-qa/contracts/m10-f-semantic-contract.ts': '871a4ed90702d60f4e439b76bc7acb98a84075ab949236550533ada653316e95',
  'lib/narrative-qa/judges/m10-f-semantic-assembly.ts': '8cd08641e6be0767ec2b778eb48c9e3f317faae08f491e7dabe679d257b7f4cd',
  'lib/narrative-qa/judges/m10-f-semantic-artifact.ts': '20d55e6d2b3a450734ddc3960b3d2f61f5c061901290aee9d41f4743f9136b21',
  'lib/narrative-qa/judges/m10-f-semantic-prompts.ts': 'f2d7d75994eb87335b698a903ff9d33259f3391882acbe41cefe8cd8b679f404',
  'lib/narrative-qa/judges/m10-f-semantic-surface.server.ts': '69195ad6afe7498d928c0610d3c8f20e38ef46076036e5f046de4541bbde0ac1',
  'lib/narrative-qa/judges/m10-f-semantic-executor.server.ts': 'd2058a899d093194af19612eb4b88110628d3ce654441d9de79ecd966c2926a2',
} as const)

export type M10FSemanticCompatibilityResult = Readonly<{
  ok: boolean
  code: 'M10F_SEMANTIC_ARTIFACTS_UNCHANGED' | 'M10F_SEMANTIC_ARTIFACTS_CHANGED'
  checkedPaths: readonly string[]
  mismatches: readonly string[]
}>

/** Existing M10-F byte-freeze oracle, reusable by later offline preflights. */
export function evaluateM10FSemanticSourceCompatibility(
  root = process.cwd(),
): M10FSemanticCompatibilityResult {
  const mismatches: string[] = []
  for (const [path, expectedHash] of Object.entries(M10F_FROZEN_SEMANTIC_SOURCE_HASHES)) {
    try {
      const actualHash = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
      if (actualHash !== expectedHash) mismatches.push(path)
    } catch {
      mismatches.push(path)
    }
  }
  return Object.freeze({
    ok: mismatches.length === 0,
    code: mismatches.length === 0
      ? 'M10F_SEMANTIC_ARTIFACTS_UNCHANGED'
      : 'M10F_SEMANTIC_ARTIFACTS_CHANGED',
    checkedPaths: Object.freeze(Object.keys(M10F_FROZEN_SEMANTIC_SOURCE_HASHES)),
    mismatches: Object.freeze(mismatches),
  })
}
