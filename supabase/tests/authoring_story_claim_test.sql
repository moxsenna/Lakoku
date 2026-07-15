begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Local setup only: ALTER DATABASE postgres SET lakoku.test_target = 'local-cli'; then reconnect.
-- Never set this marker on linked, staging, or production databases.
do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'authoring story claim pgTAP tests require explicit local test target marker';
  end if;
end
$$;

select plan(50);

select has_function(
  'public',
  'claim_authoring_story_shell_v1',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'jsonb', 'integer', 'text'],
  'authoring story claim function exists with exact signature'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.claim_authoring_story_shell_v1(text,uuid,text,text,text,text,jsonb,integer,text)',
    'EXECUTE'
  ),
  'anon cannot execute authoring story claim'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_authoring_story_shell_v1(text,uuid,text,text,text,text,jsonb,integer,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute authoring story claim'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_authoring_story_shell_v1(text,uuid,text,text,text,text,jsonb,integer,text)',
    'EXECUTE'
  ),
  'service_role can execute authoring story claim'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (
          select p.proacl
          from pg_proc p
          where p.oid = 'public.claim_authoring_story_shell_v1(text,uuid,text,text,text,text,jsonb,integer,text)'::regprocedure
        ),
        acldefault('f', 0)
      )
    ) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE grant'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'authoring-claim-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('b2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'authoring-claim-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

set local role anon;
select throws_ok(
  $$select public.claim_authoring_story_shell_v1(
    'test:authoring-denied-anon', 'a1000000-0000-4000-8000-000000000001',
    'Denied', '/denied.svg', 'Denied', 'Denied', '["denied"]'::jsonb, 50, 'Denied'
  )$$,
  '42501',
  null,
  'anon invocation is denied'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select public.claim_authoring_story_shell_v1(
    'test:authoring-denied-auth', 'a1000000-0000-4000-8000-000000000001',
    'Denied', '/denied.svg', 'Denied', 'Denied', '["denied"]'::jsonb, 50, 'Denied'
  )$$,
  '42501',
  null,
  'authenticated invocation is denied'
);
reset role;

set local role service_role;
select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-claim', 'a1000000-0000-4000-8000-000000000001',
    'Owner A v1', '/a-v1.svg', 'Tagline A v1', 'Role A v1', '["trope-a-v1","trope-a-v2"]'::jsonb, 50, 'Synopsis Owner A versi satu cukup panjang untuk melewati batas validasi ketat.'
  ),
  true,
  'first owner atomically inserts story shell'
);
select is(
  (
    select row(owner_user_id, visibility, title, cover, tagline, role, tropes, total_chapters, synopsis)::text
    from public.stories
    where id = 'test:authoring-claim'
  ),
  row(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'private',
    'Owner A v1',
    '/a-v1.svg',
    'Tagline A v1',
    'Role A v1',
    '["trope-a-v1","trope-a-v2"]'::jsonb,
    50,
    'Synopsis Owner A versi satu cukup panjang untuk melewati batas validasi ketat.'
  )::text,
  'new shell is private and owned by supplied service-side owner'
);

update public.stories
set source_story_id = 'test:canon-source-a'
where id = 'test:authoring-claim';

select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-claim', 'a1000000-0000-4000-8000-000000000001',
    'Owner A v2', '/a-v2.svg', 'Tagline A v2', 'Role A v2', '["trope-a-v2","trope-a-v3"]'::jsonb, 50, 'Synopsis Owner A versi dua cukup panjang untuk melewati batas validasi ketat.'
  ),
  true,
  'same owner atomically updates metadata'
);
select is(
  (
    select row(owner_user_id, visibility, title, source_story_id)::text
    from public.stories
    where id = 'test:authoring-claim'
  ),
  row(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'private',
    'Owner A v2',
    'test:canon-source-a'
  )::text,
  'same-owner update preserves owner, visibility, and canon source path'
);

select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-claim', 'b2000000-0000-4000-8000-000000000002',
    'Owner B', '/b.svg', 'Tagline B valid', 'Role B', '["trope-b","trope-c"]'::jsonb, 50, 'Synopsis Owner B cukup panjang untuk melewati batas validasi payload ketat.'
  ),
  false,
  'second owner loses conflicting atomic claim'
);
select is(
  (
    select row(owner_user_id, visibility, title, cover, source_story_id)::text
    from public.stories
    where id = 'test:authoring-claim'
  ),
  row(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'private',
    'Owner A v2',
    '/a-v2.svg',
    'test:canon-source-a'
  )::text,
  'losing owner cannot alter metadata, owner, visibility, or canon source path'
);

insert into public.stories (id, title, owner_user_id, visibility, source_story_id)
values ('test:authoring-null-owner', 'Legacy null owner', null, 'private', 'test:legacy-source');
select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-null-owner', 'a1000000-0000-4000-8000-000000000001',
    'Claim attempt', '/claim.svg', 'Claim', 'Claim', '["claim"]'::jsonb, 50, 'Claim'
  ),
  false,
  'existing null owner cannot be claimed'
);
select is(
  (
    select row(owner_user_id, title, source_story_id)::text
    from public.stories
    where id = 'test:authoring-null-owner'
  ),
  row(null::uuid, 'Legacy null owner', 'test:legacy-source')::text,
  'null-owner conflict remains unchanged'
);

select is(
  public.claim_authoring_story_shell_v1(
    '   ', 'a1000000-0000-4000-8000-000000000001',
    'Invalid', '/invalid.svg', 'Invalid', 'Invalid', '["invalid"]'::jsonb, 50, 'Invalid'
  ),
  false,
  'blank story ID is rejected without insert'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-invalid-title', 'a1000000-0000-4000-8000-000000000001',
    '   ', '/invalid.svg', 'Invalid', 'Invalid', '["invalid"]'::jsonb, 50, 'Invalid'
  ),
  false,
  'blank title is rejected without insert'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-invalid-chapters', 'a1000000-0000-4000-8000-000000000001',
    'Invalid chapters', '/invalid.svg', 'Invalid', 'Invalid', '["invalid"]'::jsonb, 0, 'Invalid'
  ),
  false,
  'unsafe chapter count is rejected without insert'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-invalid-owner', null,
    'Invalid owner', '/invalid.svg', 'Invalid', 'Invalid', '["invalid"]'::jsonb, 50, 'Invalid'
  ),
  false,
  'null owner ID is rejected without insert'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:authoring-invalid-tropes', 'a1000000-0000-4000-8000-000000000001',
    'Invalid tropes', '/invalid.svg', 'Invalid', 'Invalid', '{"not":"an array"}'::jsonb, 50, 'Invalid'
  ),
  false,
  'non-array tropes are rejected without insert'
);

select is(
  public.claim_authoring_story_shell_v1(
    repeat('i', 129), 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'story ID longer than 128 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-cover-blank', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '   ', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'blank cover is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-cover-long', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', repeat('c', 2049), 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'cover longer than 2048 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-title-short', 'a1000000-0000-4000-8000-000000000001',
    'ab', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'title shorter than 3 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-title-long', 'a1000000-0000-4000-8000-000000000001',
    repeat('t', 81), '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'title longer than 80 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tagline-blank', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', '   ', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'blank tagline is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tagline-long', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', repeat('g', 161), 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'tagline longer than 160 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-role-blank', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', '   ', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'blank role is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-role-long', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', repeat('r', 81), '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'role longer than 80 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-synopsis-blank', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, '   '
  ), false, 'blank synopsis is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-synopsis-long', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 701)
  ), false, 'synopsis longer than 700 characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tropes-few', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a"]'::jsonb, 50, repeat('s', 60)
  ), false, 'fewer than 2 tropes are rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tropes-many', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["aa","bb","cc","dd","ee","ff"]'::jsonb, 50, repeat('s', 60)
  ), false, 'more than 5 tropes are rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tropes-type', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a",7]'::jsonb, 50, repeat('s', 60)
  ), false, 'non-string trope element is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tropes-blank', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","   "]'::jsonb, 50, repeat('s', 60)
  ), false, 'blank trimmed trope element is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tropes-short', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","x"]'::jsonb, 50, repeat('s', 60)
  ), false, 'trope shorter than 2 trimmed characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-tropes-long', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', jsonb_build_array('trope-a', repeat('x', 41)), 50, repeat('s', 60)
  ), false, 'trope longer than 40 trimmed characters is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:invalid-chapter-49', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 49, repeat('s', 60)
  ), false, 'chapter count other than exactly 50 is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:valid-bounds', 'a1000000-0000-4000-8000-000000000001',
    repeat('t', 80), repeat('c', 2048), repeat('g', 160), repeat('r', 80), jsonb_build_array('aa', repeat('x', 40)), 50, repeat('s', 700)
  ), true, 'valid payload at maximum bounds is accepted'
);

select is(
  public.claim_authoring_story_shell_v1(
    ' ' || repeat('i', 128), 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'padded story ID over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:padded-cover-overlimit', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', ' ' || repeat('c', 2048), 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'padded cover over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:padded-title-overlimit', 'a1000000-0000-4000-8000-000000000001',
    ' ' || repeat('t', 80), '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'padded title over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:padded-tagline-overlimit', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', ' ' || repeat('g', 160), 'Role', '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'padded tagline over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:padded-role-overlimit', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', ' ' || repeat('r', 80), '["trope-a","trope-b"]'::jsonb, 50, repeat('s', 60)
  ), false, 'padded role over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:padded-synopsis-overlimit', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', '["trope-a","trope-b"]'::jsonb, 50, ' ' || repeat('s', 700)
  ), false, 'padded synopsis over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    'test:padded-trope-overlimit', 'a1000000-0000-4000-8000-000000000001',
    'Valid title', '/valid.svg', 'Valid tagline', 'Role', jsonb_build_array('trope-a', ' ' || repeat('x', 40)), 50, repeat('s', 60)
  ), false, 'padded trope over raw maximum is rejected'
);
select is(
  public.claim_authoring_story_shell_v1(
    '  test:valid-padded-normalized  ', 'a1000000-0000-4000-8000-000000000001',
    '  Padded title  ', '  /padded.svg  ', '  Padded tagline valid  ', '  Padded role  ', '["  Second trope  "," First trope "]'::jsonb, 50,
    '  Synopsis padded yang cukup panjang untuk lolos batas minimum setelah trim.  '
  ), true, 'valid padded payload within raw bounds is accepted'
);
select is(
  (
    select row(id, title, cover, tagline, role, tropes, synopsis)::text
    from public.stories
    where id = 'test:valid-padded-normalized'
  ),
  row(
    'test:valid-padded-normalized',
    'Padded title',
    '/padded.svg',
    'Padded tagline valid',
    'Padded role',
    '["Second trope","First trope"]'::jsonb,
    'Synopsis padded yang cukup panjang untuk lolos batas minimum setelah trim.'
  )::text,
  'stored scalar values and trope order are trimmed and normalized'
);

select ok(
  pg_get_functiondef(
    'public.claim_authoring_story_shell_v1(text,uuid,text,text,text,text,jsonb,integer,text)'::regprocedure
  ) ~* 'insert\s+into\s+public\.stories[\s\S]+on\s+conflict\s*\(id\)\s+do\s+update[\s\S]+where\s+public\.stories\.owner_user_id\s*=\s*p_owner_user_id[\s\S]+returning',
  'function body uses one conditional INSERT ON CONFLICT RETURNING race arbiter'
);
select is(
  (
    select count(*)
    from regexp_matches(
      pg_get_functiondef(
        'public.claim_authoring_story_shell_v1(text,uuid,text,text,text,text,jsonb,integer,text)'::regprocedure
      ),
      'insert\s+into\s+public\.stories',
      'gi'
    )
  ),
  1::bigint,
  'claim function contains exactly one stories INSERT statement'
);
reset role;

select * from finish();
rollback;
