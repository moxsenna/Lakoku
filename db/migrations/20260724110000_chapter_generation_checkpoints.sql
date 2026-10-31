-- Durable prose checkpoints for choice-only retry (PROSE_READY).
-- Service role / worker only. No public select of draft prose.

create table if not exists public.chapter_generation_checkpoints (
  story_id text not null references public.stories(id) on delete cascade,
  chapter_number int not null check (chapter_number between 1 and 50),
  attempt_id uuid not null,
  correlation_id uuid not null,

  status text not null
    check (status in (
      'PROSE_READY',
      'QUEUED_CHOICES',
      'RUNNING_CHOICES',
      'CHOICES_RETRY_WAIT',
      'READY_TO_PUBLISH',
      'PUBLISHED',
      'EXPIRED',
      'FAILED'
    )),

  title text not null,
  paragraphs_json jsonb not null,

  prose_fingerprint text not null,
  canon_version bigint null,
  blueprint_version bigint null,
  direction_fingerprint text null,

  prose_attempt_count int not null default 0,
  choice_attempt_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,

  primary key (story_id, chapter_number, attempt_id)
);

create index if not exists chapter_generation_checkpoints_story_chapter_idx
  on public.chapter_generation_checkpoints (story_id, chapter_number, updated_at desc);

create index if not exists chapter_generation_checkpoints_status_idx
  on public.chapter_generation_checkpoints (status, expires_at)
  where status in ('PROSE_READY', 'CHOICES_RETRY_WAIT', 'QUEUED_CHOICES', 'RUNNING_CHOICES');

alter table public.chapter_generation_checkpoints enable row level security;

-- No policies for anon/authenticated — service role only.
revoke all on table public.chapter_generation_checkpoints from public, anon, authenticated;
grant all on table public.chapter_generation_checkpoints to service_role;

comment on table public.chapter_generation_checkpoints is
  'Worker-only prose draft checkpoint. Never expose paragraphs_json via Reader API.';
