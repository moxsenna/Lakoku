/**
 * Runtime HEAD derivation for M10 artifact manifests (H2).
 *
 * `baselineSha` constants are static and can drift from what git actually
 * checked out when a stage ran. The manifest must record the HEAD the stage
 * really executed from, plus whether the working tree was dirty — otherwise a
 * manifest can claim reproducibility for uncommitted code.
 */

import { execFileSync } from 'node:child_process'

export function headShaOfWorkingTree(cwd = process.cwd()): { headSha: string; workingTreeDirty: boolean } {
  try {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty =
      execFileSync('git', ['status', '--porcelain'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().length > 0
    return { headSha, workingTreeDirty: dirty }
  } catch {
    // A stage outside a git checkout records no HEAD; the manifest documents
    // the absence instead of inventing one.
    return { headSha: '', workingTreeDirty: false }
  }
}