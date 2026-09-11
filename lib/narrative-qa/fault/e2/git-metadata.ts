import { execFileSync } from 'node:child_process'
import type { GitMetadataReader } from './rows-1-9'

export type GitCommand = (args: readonly string[]) => string

function parseGitSha(value: string, command: string): string {
  const sha = value.trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`E2_GIT_INVALID_SHA:${command}`)
  return sha.toLowerCase()
}

export function createGitMetadataReader(command: GitCommand): GitMetadataReader {
  return {
    async readHeadSha(): Promise<string> {
      return parseGitSha(command(['rev-parse', 'HEAD']), 'rev-parse HEAD')
    },
    async readBlobSha(path: string, revision: string): Promise<string> {
      return parseGitSha(command(['rev-parse', `${revision}:${path}`]), `rev-parse ${revision}:${path}`)
    },
    async readBlobContent(path: string, revision: string): Promise<string> {
      return command(['show', `${revision}:${path}`])
    },
  }
}

export function createWorkingTreeGitReader(
  cwd = process.cwd(),
  execute: typeof execFileSync = execFileSync,
): GitMetadataReader & { readWorkingTreeDirty: () => Promise<boolean> } {
  const command: GitCommand = (args) => execute('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ...createGitMetadataReader(command),
    async readWorkingTreeDirty(): Promise<boolean> {
      return command(['status', '--porcelain']).trim().length > 0
    },
  }
}
