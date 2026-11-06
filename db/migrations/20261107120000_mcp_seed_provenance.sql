-- MCP Seed Server (Gemini agent): provenance novel katalog
--
-- createCatalogDraft (lib/catalog/generator-db.server.ts) kini menerima
-- source: 'cli' (default) | 'gemini-agent'. Dipakai gate volume bulanan
-- lib/mcp-seed/gates dan filter QC admin.

alter table public.catalog_stories
  add column if not exists source text not null default 'cli';

alter table public.catalog_stories
  add constraint catalog_stories_source_check
  check (source in ('cli', 'gemini-agent'));

create index if not exists catalog_stories_source_created_idx
  on public.catalog_stories (source, created_at);
