/**
 * Adaptasi satu-jalan supabase/migrations -> neon/migrations.
 * Usage: node scripts/adapt-supabase-migrations.mjs
 * Deterministik; hasil di-commit supaya reviewer bisa membedah.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'supabase/migrations'
const DST = 'neon/migrations'
mkdirSync(DST, { recursive: true })

// Pola yang DIHAPUS seluruh statement-nya:
const DROP_PATTERNS = [
  /^\s*create\s+extension\s+if\s+not\s+exists\s+pg_cron\b/i,
  /^\s*select\s+cron\.schedule\s*\(/i, // blok select cron.schedule (sampai ';')
  /^\s*create\s+policy\b/i,
  /^\s*alter\s+table[\s\S]*?\benable\s+row\s+level\s+security\b/i,
  /^\s*alter\s+table[\s\S]*?\bforce\s+row\s+level\s+security\b/i,
  /^\s*grant\b/i,
  /^\s*revoke\b/i,
  /^\s*insert\s+into\s+storage\.buckets\b/i,
  /^\s*alter\s+table[\s\S]*?\badd\s+constraint\b[\s\S]*?references\s+(?:"auth"|auth)\.(?:"users"|users)[\s\S]*?\)/i, // constraint FK auth.users
  /^\s*alter\s+(?:table|function)\s+[\s\S]*?\bowner\s+to\b/i,
]

// Statement-lain yang disesuaikan:
const REWRITES = [
  [
    /create\s+extension\s+if\s+not\s+exists\s+btree_gist\s+with\s+schema\s+extensions;/i,
    'create schema if not exists extensions;\ncreate extension if not exists btree_gist with schema extensions;',
  ],
  // FK inline pada CREATE TABLE / ALTER TABLE: "references auth.users(id)" / "(id) on delete cascade"
  [
    /references\s+(?:"auth"|auth)\.(?:"users"|users)\s*\(\s*(?:"id"|id)\s*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi,
    '/* auth.users fk removed */',
  ],
]

const BASELINE_PREAMBLE = `
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE SCHEMA IF NOT EXISTS "auth";
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  role text,
  aud text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`

function stripStatements(sqlText) {
  // pisah per ';' di luar dollar-quoted ($tag$...$tag$), string literals, dan komentar
  const statements = []
  let i = 0
  const n = sqlText.length
  let start = 0

  while (i < n) {
    // 1. Line comment: --
    if (sqlText[i] === '-' && sqlText[i + 1] === '-') {
      i += 2
      while (i < n && sqlText[i] !== '\n') i++
      continue
    }
    // 2. Block comment: /* ... */ (supports nested comments in PostgreSQL)
    if (sqlText[i] === '/' && sqlText[i + 1] === '*') {
      i += 2
      let depth = 1
      while (i < n && depth > 0) {
        if (sqlText[i] === '/' && sqlText[i + 1] === '*') {
          depth++
          i += 2
        } else if (sqlText[i] === '*' && sqlText[i + 1] === '/') {
          depth--
          i += 2
        } else {
          i++
        }
      }
      continue
    }
    // 3. String literal: '...' (with '' escape)
    if (sqlText[i] === "'") {
      i++
      while (i < n) {
        if (sqlText[i] === "'") {
          if (sqlText[i + 1] === "'") {
            i += 2
          } else {
            i++
            break
          }
        } else {
          i++
        }
      }
      continue
    }
    // 4. Quoted identifier: "..."
    if (sqlText[i] === '"') {
      i++
      while (i < n) {
        if (sqlText[i] === '"') {
          if (sqlText[i + 1] === '"') {
            i += 2
          } else {
            i++
            break
          }
        } else {
          i++
        }
      }
      continue
    }
    // 5. Dollar quote: $tag$ ... $tag$ (tag: letters, digits, underscore, or empty)
    if (sqlText[i] === '$') {
      const match = sqlText.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/)
      if (match) {
        const tag = match[0]
        i += tag.length
        const closeIdx = sqlText.indexOf(tag, i)
        if (closeIdx === -1) {
          i = n
        } else {
          i = closeIdx + tag.length
        }
        continue
      }
    }
    // 6. Statement terminator: ;
    if (sqlText[i] === ';') {
      const stmt = sqlText.slice(start, i + 1)
      statements.push(stmt)
      i++
      start = i
      continue
    }
    i++
  }
  if (start < n) {
    const rem = sqlText.slice(start)
    if (rem.trim()) statements.push(rem)
  }
  return statements
}

function getCodeWithoutLeadingComments(stmt) {
  return stmt.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))+/s, '').trimStart()
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  let raw = readFileSync(join(SRC, f), 'utf8')
  let isBaseline = false
  if (f === '20260707000000_core_runtime_baseline.sql') {
    isBaseline = true
    const m1 = raw.indexOf('$baseline_ddl$')
    const m2 = raw.lastIndexOf('$baseline_ddl$')
    if (m1 !== -1 && m2 !== -1 && m2 > m1) {
      raw = raw.slice(m1 + '$baseline_ddl$'.length, m2)
    }
  }

  const kept = []
  if (isBaseline) {
    kept.push(BASELINE_PREAMBLE.trim())
  }
  for (let stmt of stripStatements(raw)) {
    const code = getCodeWithoutLeadingComments(stmt)
    if (DROP_PATTERNS.some((re) => re.test(code))) {
      continue
    }
    for (const [re, to] of REWRITES) stmt = stmt.replace(re, to)
    kept.push(stmt)
  }
  writeFileSync(join(DST, f), kept.join('\n'))
}
console.log(`adapted ${files.length} files -> ${DST}`)
