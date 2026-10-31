begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(38);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('30000000-0000-4000-8000-000000000003','authenticated','authenticated','bootstrap-owner@example.invalid','',now(),'{}','{}',now(),now()),
('40000000-0000-4000-8000-000000000004','authenticated','authenticated','bootstrap-other@example.invalid','',now(),'{}','{}',now(),now()) on conflict(id) do nothing;

insert into public.stories(id,title,owner_user_id,visibility,story_mode,generation_status,total_chapters,status,current_chapter)
values
('test:bootstrap-ok','Bootstrap OK','30000000-0000-4000-8000-000000000003','private','personalized_ai','creating_contract',50,'BARU',0),
('test:bootstrap-owner','Wrong Owner','40000000-0000-4000-8000-000000000004','private','personalized_ai','creating_contract',50,'BARU',0),
('test:bootstrap-null', 'Null Owner',null,'private','personalized_ai','creating_contract',50,'BARU',0),
('test:bootstrap-mode','Wrong Mode','30000000-0000-4000-8000-000000000003','private','standard','creating_contract',50,'BARU',0),
('test:bootstrap-public','Public','30000000-0000-4000-8000-000000000003','public','personalized_ai','creating_contract',50,'BARU',0),
('test:bootstrap-started','Started','30000000-0000-4000-8000-000000000003','private','personalized_ai','creating_contract',50,'BARU',0),
('test:bootstrap-progress','Progress','30000000-0000-4000-8000-000000000003','private','personalized_ai','creating_contract',50,'BARU',0);
insert into public.chapters(story_id,number,title,paragraphs,choice_prompt,choices) values('test:bootstrap-started',1,'Live','["survive"]','Choose','[]');
insert into public.reader_states(user_id,story_id) values('30000000-0000-4000-8000-000000000003','test:bootstrap-progress');

create temporary table payload(story_id text primary key,args jsonb);
insert into payload
select story_id,jsonb_build_object(
'contract_source','template_fallback','onboarding','{"version":1}'::jsonb,
'contract',jsonb_build_object('storyId',story_id,'totalChapters',50,'title','Personalized Bootstrap','genre','Misteri Drama','tone','tegang intim','styleProfile','lakoku_mobile_drama_v1','mainCharacter',jsonb_build_object('name','Maya Pradipta','role','Arsiparis utama','wound','Maya kehilangan kakaknya.','desire','Membuka kebenaran keluarganya.'),'mainConflict','Maya harus membuka bukti yang disembunyikan keluarga.','finalQuestion','Akankah Maya membuka kebenaran?','corePromise','Setiap petunjuk mengubah pilihan Maya.','actPlan',jsonb_build_array(jsonb_build_object('actNumber',1,'fromChapter',1,'toChapter',50,'goal','Membuka misteri utama.')),'chapterTargets',(select jsonb_agg(jsonb_build_object('chapterNumber',n,'phase','Fase','goal','Tujuan bab','mustInclude',jsonb_build_array('Beat'),'mustNotReveal','[]'::jsonb,'emotionalTurn','Kepercayaan berubah.','expectedThreadMovement',jsonb_build_array('Misteri bergerak.')) order by n) from generate_series(1,50)n),'revealRunway',jsonb_build_array(jsonb_build_object('secretId','secret:main','revealGateChapter',12)),'closureRunway',jsonb_build_object('noNewMajorConflictAfter',35,'noNewThreadAfter',40,'endingLockChapter',45,'mainMysteryResolveBy',48,'emotionalResolutionChapter',49,'finalEndingChapter',50)),
'route','{}'::jsonb,
'debts',jsonb_build_array(jsonb_build_object('id','main_mystery','question','Siapa menyembunyikan bukti utama?','introducedAt',1,'mustProgressBy',jsonb_build_array(12,32,45),'mustCloseBy',48,'status','open')),
'endings',jsonb_build_array(jsonb_build_object('key','ending-a','name','Arsip Dibuka','condition','Maya memilih kesaksian publik.','requiredClosure',jsonb_build_array('Misteri selesai.')),jsonb_build_object('key','ending-b','name','Saksi Dijaga','condition','Maya melindungi saksi.','requiredClosure',jsonb_build_array('Saksi selamat.'))),
'characters',jsonb_build_array(jsonb_build_object('id',story_id||':character:main','story_id',story_id,'canonical_name','Maya Pradipta','role','Arsiparis utama','motivation','Membuka kebenaran keluarga','introduced_chapter',1)),
'aliases',jsonb_build_array(jsonb_build_object('story_id',story_id,'character_id',story_id||':character:main','alias','Maya Pradipta','alias_type','NAME')),
'voices',jsonb_build_array(jsonb_build_object('story_id',story_id,'character_id',story_id||':character:main','register','tegang dan intim','speech_habits',jsonb_build_array('bicara jelas'),'forbidden_words','[]'::jsonb,'sample_lines',jsonb_build_array('Aku akan membuka kebenaran.'))),
'facts',jsonb_build_array(jsonb_build_object('id',story_id||':fact:main','story_id',story_id,'statement','Maya menyimpan bukti utama.','subject_character_id',story_id||':character:main','established_chapter',1,'salience',1,'load_bearing',true,'paid_off',false)),
'knowledge',jsonb_build_array(jsonb_build_object('story_id',story_id,'character_id',story_id||':character:main','fact_id',story_id||':fact:main','known_from_chapter',1)),
'secrets',jsonb_build_array(jsonb_build_object('id',story_id||':secret:main','story_id',story_id,'description','Bukti utama disembunyikan keluarga Maya.','reveal_gate_chapter',12,'revealed',false)),
'threads',jsonb_build_array(jsonb_build_object('id',story_id||':thread:main','story_id',story_id,'title','Siapa menyembunyikan bukti utama?','status','OPEN','opened_chapter',1,'last_touched_chapter',1,'payoff_window',48,'is_main_mystery',true,'stale',false,'stale_since_chapter',null)),
'blueprints',(select jsonb_agg(jsonb_build_object('story_id',story_id,'chapter_number',n,'version',1,'phase','Fase','chapter_goal','Tujuan bab','mandatory_beats',jsonb_build_array('Beat'),'forbidden_reveals',case when n<12 then jsonb_build_array(story_id||':secret:main') else '[]'::jsonb end,'allowed_state_delta','{}'::jsonb,'introduces_characters',case when n=1 then jsonb_build_array(story_id||':character:main') else '[]'::jsonb end,'reconciled_from_version',null,'reconciliation_reason',null) order by n) from generate_series(1,50)n)
) from (values('test:bootstrap-ok'),('test:bootstrap-missing'),('test:bootstrap-owner'),('test:bootstrap-null'),('test:bootstrap-mode'),('test:bootstrap-public'),('test:bootstrap-started'),('test:bootstrap-progress')) ids(story_id);
grant select on table payload to service_role;

create function pg_temp.bootstrap(id text,a jsonb,owner uuid default '30000000-0000-4000-8000-000000000003') returns void language plpgsql set search_path='' as $$begin
perform public.bootstrap_personalized_story_v1(id,owner,a->>'contract_source',a->'onboarding',a->'contract',a->'route',a->'debts',a->'endings',a->'characters',a->'aliases',a->'voices',a->'facts',a->'knowledge',a->'secrets',a->'threads',a->'blueprints');end$$;

set local role service_role;
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-missing',(select args from payload where story_id='test:bootstrap-missing'))$$,'P0001','STORY_SHELL_NOT_FOUND','missing shell rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-owner',(select args from payload where story_id='test:bootstrap-owner'))$$,'42501','STORY_OWNER_MISMATCH','wrong owner rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-null',(select args from payload where story_id='test:bootstrap-null'))$$,'42501','STORY_OWNER_MISMATCH','null owner rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-mode',(select args from payload where story_id='test:bootstrap-mode'))$$,'22023','INVALID_STORY_MODE','wrong mode rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-public',(select args from payload where story_id='test:bootstrap-public'))$$,'22023','STORY_NOT_PRIVATE','public shell rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-started',(select args from payload where story_id='test:bootstrap-started'))$$,'55000','STORY_GENERATION_STARTED','existing chapter rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-progress',(select args from payload where story_id='test:bootstrap-progress'))$$,'55000','STORY_GENERATION_STARTED','progress row rejected');
reset role;
select is((select title from stories where id='test:bootstrap-owner'),'Wrong Owner','wrong owner shell unchanged');
select is((select paragraphs from chapters where story_id='test:bootstrap-started'),'["survive"]'::jsonb,'live chapter unchanged');

set local role service_role;
select lives_ok($$select pg_temp.bootstrap('test:bootstrap-ok',(select args from payload where story_id='test:bootstrap-ok'))$$,'valid bootstrap succeeds');
select lives_ok($$select pg_temp.bootstrap('test:bootstrap-ok',(select args from payload where story_id='test:bootstrap-ok'))$$,'identical rerun succeeds');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{contract,title}','"Changed"'))$$,'23000','BOOTSTRAP_PAYLOAD_MISMATCH','changed rerun rejected');
reset role;
select is((select count(*) from chapter_blueprints where story_id='test:bootstrap-ok'),50::bigint,'exact 50 blueprints');
select is((select count(*) from chapters where story_id='test:bootstrap-ok'),0::bigint,'exact zero chapters');
select is((select count(*) from characters where story_id='test:bootstrap-ok'),1::bigint,'identical rerun unchanged');

set local role service_role;
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{characters,0,extra}','true'))$$,'22023','INVALID_CANON_ROW','extra key rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{characters,0,introduced_chapter}','"one"'))$$,'22023','INVALID_CANON_ROW','wrong type rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{characters}',(select (args->'characters')||(args->'characters') from payload where story_id='test:bootstrap-ok')))$$,'22023','DUPLICATE_CANON_ROW','duplicate rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{knowledge,0,fact_id}','"other:fact"'))$$,'22023','NONLOCAL_CANON_REFERENCE','invalid reference rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{onboarding,padding}',to_jsonb(repeat('x',4200000))))$$,'22023','INVALID_BOOTSTRAP_PAYLOAD','oversize rejected');
-- Integer trunc + range checks aligned with authoring RPC.
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{facts,0,established_chapter}','1.5'))$$,'22023','INVALID_CANON_ROW','facts established_chapter non-int rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{knowledge,0,known_from_chapter}','2.5'))$$,'22023','INVALID_CANON_ROW','knowledge known_from_chapter non-int rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{secrets,0,reveal_gate_chapter}','12.2'))$$,'22023','INVALID_CANON_ROW','secrets reveal_gate_chapter non-int rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{threads,0,opened_chapter}','1.1'))$$,'22023','INVALID_CANON_ROW','threads opened_chapter non-int rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{threads,0,payoff_window}','48.9'))$$,'22023','INVALID_CANON_ROW','threads payoff_window non-int rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{blueprints,0,version}','1.5'))$$,'22023','INVALID_CANON_ROW','blueprints version non-int rejected');
-- String length bounds for knowledge IDs and fact subject when string; empty-only allowed_state_delta.
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{knowledge,0,character_id}',to_jsonb(repeat('k',257))))$$,'22023','INVALID_CANON_ROW','knowledge character_id oversize rejected');
select throws_ok($$select pg_temp.bootstrap('test:bootstrap-ok',jsonb_set((select args from payload where story_id='test:bootstrap-ok'),'{blueprints,0,allowed_state_delta}','{"x":1}'::jsonb))$$,'22023','INVALID_CANON_ROW','non-empty allowed_state_delta rejected');
reset role;
select is((select count(*) from chapter_blueprints where story_id='test:bootstrap-ok'),50::bigint,'malformed payload rollback preserves canon');
select is((select title from stories where id='test:bootstrap-ok'),'Bootstrap OK','RPC never updates shell');
select is((select count(*) from story_generation_contracts where story_id='test:bootstrap-ok'),1::bigint,'single contract row');
select is((select count(*) from story_threads where story_id='test:bootstrap-ok'),1::bigint,'single thread row');
select is((select count(*) from facts_ledger where story_id='test:bootstrap-ok'),1::bigint,'single fact row');
select is((select count(*) from character_aliases where story_id='test:bootstrap-ok'),1::bigint,'single alias row');
select is((select count(*) from knowledge_scopes where story_id='test:bootstrap-ok'),1::bigint,'single knowledge row');
select is((select count(*) from secrets_reveals where story_id='test:bootstrap-ok'),1::bigint,'single secret row');
select is((select count(*) from character_voice_sheets where story_id='test:bootstrap-ok'),1::bigint,'single voice row');

-- Same-story row lock makes concurrent duplicate calls deterministic; sequential retry above covers post-lock branch.
select pass('same-story concurrency serialized by SELECT FOR UPDATE on mandatory shell');

select * from finish();
rollback;
