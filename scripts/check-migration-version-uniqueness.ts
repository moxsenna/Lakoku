/**
 * Fail when two Supabase migrations share the same 14-digit version prefix.
 * Supabase uses the timestamp prefix as the migration version.
 */
import fs from 'node:fs'
import path from 'node:path'

const VERSION_RE = /^(\d{14})_(.+)\.sql$/i

export type MigrationVersionGroup = {
  version: string
  files: string[]
}

export function findDuplicateMigrationVersions(
  filenames: string[],
): MigrationVersionGroup[] {
  const groups = new Map<string, string[]>()
  for (const name of filenames) {
    const base = path.basename(name)
    const match = VERSION_RE.exec(base)
    if (!match) continue
    const version = match[1]
    const list = groups.get(version) ?? []
    list.push(base)
    groups.set(version, list)
  }
  const duplicates: MigrationVersionGroup[] = []
  for (const [version, files] of groups) {
    if (files.length > 1) {
      duplicates.push({ version, files: [...files].sort() })
    }
  }
  return duplicates.sort((a, b) => a.version.localeCompare(b.version))
}

export function listMigrationFilenames(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) return []
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort()
}

function main(): void {
  const root = path.resolve(__dirname, '..')
  const migrationsDir = path.join(root, 'supabase', 'migrations')
  const files = listMigrationFilenames(migrationsDir)
  const duplicates = findDuplicateMigrationVersions(files)

  if (duplicates.length === 0) {
    console.log(`OK: ${files.length} migrations, all version prefixes unique`)
    return
  }

  console.error('DUPLICATE_MIGRATION_VERSIONS')
  for (const group of duplicates) {
    console.error(`  version ${group.version}:`)
    for (const file of group.files) {
      console.error(`    - ${file}`)
    }
  }
  console.error(
    'Supabase uses the 14-digit prefix as version. Resolve with a unique repair migration; do not blindly rename applied history.',
  )
  process.exit(1)
}

if (require.main === module) {
  main()
}
