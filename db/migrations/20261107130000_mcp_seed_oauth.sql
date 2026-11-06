-- MCP Seed Server: penyimpanan OAuth 2.1 (code + refresh, hash saja)
--
-- Hanya hash token yang disimpan; code single-use dijaga DELETE RETURNING
-- di lib/mcp-seed/oauth-store.server.ts.

create table if not exists public.mcp_seed_oauth (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('code', 'refresh')),
  token_hash text not null unique,
  user_id text not null,
  client_id text not null,
  redirect_uri text null,
  code_challenge text null,
  scope text not null default 'seed',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_seed_oauth_kind_idx on public.mcp_seed_oauth (kind);
create index if not exists mcp_seed_oauth_user_idx on public.mcp_seed_oauth (user_id);
