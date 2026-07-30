# supabase/ — Database Migrations & SQL Tests

## OVERVIEW

Supabase PostgreSQL database schema, migrations, and SQL-based tests. 40 migrations, 21 SQL test files, Postgres 17.

## STRUCTURE

```
supabase/
├── config.toml           # Supabase local dev config
├── migrations/           # SQL migrations (40 files, chronological)
├── tests/                # SQL test files (21 files)
└── .temp/                # Temporary files
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Schema migrations | `migrations/` | Chronological SQL files |
| SQL tests | `tests/` | Database function tests |
| Local config | `config.toml` | Ports, schemas, features |
| Push to prod | `pnpm exec supabase db push --linked` | Production deployment |

## CONVENTIONS

### Migration Naming

```
YYYYMMDDHHMMSS_description.sql
```

### Migration Order

1. Schema changes (tables, columns)
2. Function changes (RPCs)
3. Policy changes (RLS)
4. Data changes (seeds)

### SQL Tests

- Named: `*_test.sql`
- Run via: `supabase test db --local [test_file.sql]`
- Test database functions and RLS policies

## ANTI-PATTERNS

- Migrations that break existing data
- Hardcoded IDs in migrations
- Missing `IF EXISTS` / `IF NOT EXISTS`
- Tests that modify schema

## NOTES

- Postgres 17 (via Supabase)
- Local dev: `supabase start`
- Production: Supabase linked
