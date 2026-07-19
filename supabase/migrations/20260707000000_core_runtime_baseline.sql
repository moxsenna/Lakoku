-- Verified pre-history public baseline. Existing installs are validation-only.
do $baseline_guard$
declare
  v_owned_tables constant text[] := array['act_rollups','chapter_blueprints','chapters','character_aliases','character_states','character_voice_sheets','characters','choice_outcomes','facts_ledger','generation_leases','idempotency_keys','knowledge_scopes','outbox','reader_states','retrieval_logs','secrets_reveals','stories','story_events','story_threads','timeline_events'];
  v_owned_sequences constant text[] := array['act_rollups_id_seq','chapter_blueprints_id_seq','character_aliases_id_seq','knowledge_scopes_id_seq','outbox_id_seq','retrieval_logs_id_seq','story_events_id_seq','timeline_events_id_seq'];
  v_owned_functions constant text[] := array['acquire_generation_lease(text,integer,text,integer,text)','release_generation_lease(text,uuid)','publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)','story_is_public(text)','story_is_owned_by_auth(text)'];
  v_owned_count integer;
begin
  select count(*) into v_owned_count from (
    select pg_catalog.to_regclass('public.'||x)::oid oid from unnest(v_owned_tables||v_owned_sequences) x
    union all select pg_catalog.to_regprocedure('public.'||x)::oid from unnest(v_owned_functions) x
  ) owned where oid is not null;

  if v_owned_count = 0 then
    null;
  elsif v_owned_count <> cardinality(v_owned_tables)+cardinality(v_owned_sequences)+cardinality(v_owned_functions) then
    raise exception using errcode='P0001', message='BASELINE_SCHEMA_DRIFT';
  else
    if (select count(*) from (values
        ('act_rollups','id'),
        ('act_rollups','story_id'),
        ('act_rollups','act_number'),
        ('act_rollups','summary'),
        ('act_rollups','state_delta'),
        ('act_rollups','covers_from_chapter'),
        ('act_rollups','covers_to_chapter'),
        ('act_rollups','created_at'),
        ('chapter_blueprints','id'),
        ('chapter_blueprints','story_id'),
        ('chapter_blueprints','chapter_number'),
        ('chapter_blueprints','version'),
        ('chapter_blueprints','phase'),
        ('chapter_blueprints','chapter_goal'),
        ('chapter_blueprints','mandatory_beats'),
        ('chapter_blueprints','forbidden_reveals'),
        ('chapter_blueprints','allowed_state_delta'),
        ('chapter_blueprints','introduces_characters'),
        ('chapter_blueprints','reconciled_from_version'),
        ('chapter_blueprints','reconciliation_reason'),
        ('chapter_blueprints','created_at'),
        ('chapters','story_id'),
        ('chapters','number'),
        ('chapters','title'),
        ('chapters','paragraphs'),
        ('chapters','choice_prompt'),
        ('chapters','choices'),
        ('chapters','created_at'),
        ('character_aliases','id'),
        ('character_aliases','story_id'),
        ('character_aliases','character_id'),
        ('character_aliases','alias'),
        ('character_aliases','alias_type'),
        ('character_aliases','created_at'),
        ('character_states','character_id'),
        ('character_states','status'),
        ('character_states','as_of_chapter'),
        ('character_states','attributes'),
        ('character_states','updated_at'),
        ('character_voice_sheets','character_id'),
        ('character_voice_sheets','story_id'),
        ('character_voice_sheets','register'),
        ('character_voice_sheets','speech_habits'),
        ('character_voice_sheets','forbidden_words'),
        ('character_voice_sheets','sample_lines'),
        ('character_voice_sheets','created_at'),
        ('characters','id'),
        ('characters','story_id'),
        ('characters','canonical_name'),
        ('characters','role'),
        ('characters','motivation'),
        ('characters','introduced_chapter'),
        ('characters','created_at'),
        ('choice_outcomes','story_id'),
        ('choice_outcomes','chapter_number'),
        ('choice_outcomes','choice_id'),
        ('choice_outcomes','consequence'),
        ('choice_outcomes','next_chapter_number'),
        ('choice_outcomes','is_ending'),
        ('choice_outcomes','created_at'),
        ('facts_ledger','id'),
        ('facts_ledger','story_id'),
        ('facts_ledger','statement'),
        ('facts_ledger','subject_character_id'),
        ('facts_ledger','established_chapter'),
        ('facts_ledger','salience'),
        ('facts_ledger','load_bearing'),
        ('facts_ledger','paid_off'),
        ('facts_ledger','created_at'),
        ('generation_leases','id'),
        ('generation_leases','story_id'),
        ('generation_leases','chapter_number'),
        ('generation_leases','status'),
        ('generation_leases','holder'),
        ('generation_leases','expires_at'),
        ('generation_leases','created_at'),
        ('idempotency_keys','key'),
        ('idempotency_keys','story_id'),
        ('idempotency_keys','scope'),
        ('idempotency_keys','result'),
        ('idempotency_keys','created_at'),
        ('knowledge_scopes','id'),
        ('knowledge_scopes','story_id'),
        ('knowledge_scopes','character_id'),
        ('knowledge_scopes','fact_id'),
        ('knowledge_scopes','known_from_chapter'),
        ('knowledge_scopes','created_at'),
        ('outbox','id'),
        ('outbox','topic'),
        ('outbox','payload'),
        ('outbox','processed_at'),
        ('outbox','created_at'),
        ('reader_states','user_id'),
        ('reader_states','story_id'),
        ('reader_states','status'),
        ('reader_states','current_chapter'),
        ('reader_states','jejak'),
        ('reader_states','ending_name'),
        ('reader_states','updated_at'),
        ('reader_states','created_at'),
        ('retrieval_logs','id'),
        ('retrieval_logs','story_id'),
        ('retrieval_logs','target_chapter'),
        ('retrieval_logs','included_ids'),
        ('retrieval_logs','excluded_ids'),
        ('retrieval_logs','budget_report'),
        ('retrieval_logs','created_at'),
        ('secrets_reveals','id'),
        ('secrets_reveals','story_id'),
        ('secrets_reveals','description'),
        ('secrets_reveals','reveal_gate_chapter'),
        ('secrets_reveals','revealed'),
        ('secrets_reveals','created_at'),
        ('stories','id'),
        ('stories','title'),
        ('stories','cover'),
        ('stories','tagline'),
        ('stories','role'),
        ('stories','tropes'),
        ('stories','total_chapters'),
        ('stories','synopsis'),
        ('stories','status'),
        ('stories','current_chapter'),
        ('stories','jejak'),
        ('stories','ending_name'),
        ('stories','created_at'),
        ('stories','owner_user_id'),
        ('stories','visibility'),
        ('story_events','id'),
        ('story_events','story_id'),
        ('story_events','seq'),
        ('story_events','type'),
        ('story_events','payload'),
        ('story_events','created_at'),
        ('story_threads','id'),
        ('story_threads','story_id'),
        ('story_threads','title'),
        ('story_threads','status'),
        ('story_threads','opened_chapter'),
        ('story_threads','last_touched_chapter'),
        ('story_threads','payoff_window'),
        ('story_threads','is_main_mystery'),
        ('story_threads','created_at'),
        ('story_threads','stale'),
        ('story_threads','stale_since_chapter'),
        ('timeline_events','id'),
        ('timeline_events','story_id'),
        ('timeline_events','chapter_number'),
        ('timeline_events','ordinal'),
        ('timeline_events','description'),
        ('timeline_events','is_flashback'),
        ('timeline_events','occurs_at'),
        ('timeline_events','created_at')
      ) required(table_name,column_name)) <> 153
      or (select md5(string_agg(required.table_name||'|'||required.column_name||'|'||coalesce(pg_catalog.format_type(a.atttypid,a.atttypmod),'')||'|'||coalesce(a.attnotnull::text,'')||'|'||coalesce(a.attidentity::text,'')||'|'||coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),''),E'
' order by required.table_name,required.column_name))
          from (values
        ('act_rollups','id'),
        ('act_rollups','story_id'),
        ('act_rollups','act_number'),
        ('act_rollups','summary'),
        ('act_rollups','state_delta'),
        ('act_rollups','covers_from_chapter'),
        ('act_rollups','covers_to_chapter'),
        ('act_rollups','created_at'),
        ('chapter_blueprints','id'),
        ('chapter_blueprints','story_id'),
        ('chapter_blueprints','chapter_number'),
        ('chapter_blueprints','version'),
        ('chapter_blueprints','phase'),
        ('chapter_blueprints','chapter_goal'),
        ('chapter_blueprints','mandatory_beats'),
        ('chapter_blueprints','forbidden_reveals'),
        ('chapter_blueprints','allowed_state_delta'),
        ('chapter_blueprints','introduces_characters'),
        ('chapter_blueprints','reconciled_from_version'),
        ('chapter_blueprints','reconciliation_reason'),
        ('chapter_blueprints','created_at'),
        ('chapters','story_id'),
        ('chapters','number'),
        ('chapters','title'),
        ('chapters','paragraphs'),
        ('chapters','choice_prompt'),
        ('chapters','choices'),
        ('chapters','created_at'),
        ('character_aliases','id'),
        ('character_aliases','story_id'),
        ('character_aliases','character_id'),
        ('character_aliases','alias'),
        ('character_aliases','alias_type'),
        ('character_aliases','created_at'),
        ('character_states','character_id'),
        ('character_states','status'),
        ('character_states','as_of_chapter'),
        ('character_states','attributes'),
        ('character_states','updated_at'),
        ('character_voice_sheets','character_id'),
        ('character_voice_sheets','story_id'),
        ('character_voice_sheets','register'),
        ('character_voice_sheets','speech_habits'),
        ('character_voice_sheets','forbidden_words'),
        ('character_voice_sheets','sample_lines'),
        ('character_voice_sheets','created_at'),
        ('characters','id'),
        ('characters','story_id'),
        ('characters','canonical_name'),
        ('characters','role'),
        ('characters','motivation'),
        ('characters','introduced_chapter'),
        ('characters','created_at'),
        ('choice_outcomes','story_id'),
        ('choice_outcomes','chapter_number'),
        ('choice_outcomes','choice_id'),
        ('choice_outcomes','consequence'),
        ('choice_outcomes','next_chapter_number'),
        ('choice_outcomes','is_ending'),
        ('choice_outcomes','created_at'),
        ('facts_ledger','id'),
        ('facts_ledger','story_id'),
        ('facts_ledger','statement'),
        ('facts_ledger','subject_character_id'),
        ('facts_ledger','established_chapter'),
        ('facts_ledger','salience'),
        ('facts_ledger','load_bearing'),
        ('facts_ledger','paid_off'),
        ('facts_ledger','created_at'),
        ('generation_leases','id'),
        ('generation_leases','story_id'),
        ('generation_leases','chapter_number'),
        ('generation_leases','status'),
        ('generation_leases','holder'),
        ('generation_leases','expires_at'),
        ('generation_leases','created_at'),
        ('idempotency_keys','key'),
        ('idempotency_keys','story_id'),
        ('idempotency_keys','scope'),
        ('idempotency_keys','result'),
        ('idempotency_keys','created_at'),
        ('knowledge_scopes','id'),
        ('knowledge_scopes','story_id'),
        ('knowledge_scopes','character_id'),
        ('knowledge_scopes','fact_id'),
        ('knowledge_scopes','known_from_chapter'),
        ('knowledge_scopes','created_at'),
        ('outbox','id'),
        ('outbox','topic'),
        ('outbox','payload'),
        ('outbox','processed_at'),
        ('outbox','created_at'),
        ('reader_states','user_id'),
        ('reader_states','story_id'),
        ('reader_states','status'),
        ('reader_states','current_chapter'),
        ('reader_states','jejak'),
        ('reader_states','ending_name'),
        ('reader_states','updated_at'),
        ('reader_states','created_at'),
        ('retrieval_logs','id'),
        ('retrieval_logs','story_id'),
        ('retrieval_logs','target_chapter'),
        ('retrieval_logs','included_ids'),
        ('retrieval_logs','excluded_ids'),
        ('retrieval_logs','budget_report'),
        ('retrieval_logs','created_at'),
        ('secrets_reveals','id'),
        ('secrets_reveals','story_id'),
        ('secrets_reveals','description'),
        ('secrets_reveals','reveal_gate_chapter'),
        ('secrets_reveals','revealed'),
        ('secrets_reveals','created_at'),
        ('stories','id'),
        ('stories','title'),
        ('stories','cover'),
        ('stories','tagline'),
        ('stories','role'),
        ('stories','tropes'),
        ('stories','total_chapters'),
        ('stories','synopsis'),
        ('stories','status'),
        ('stories','current_chapter'),
        ('stories','jejak'),
        ('stories','ending_name'),
        ('stories','created_at'),
        ('stories','owner_user_id'),
        ('stories','visibility'),
        ('story_events','id'),
        ('story_events','story_id'),
        ('story_events','seq'),
        ('story_events','type'),
        ('story_events','payload'),
        ('story_events','created_at'),
        ('story_threads','id'),
        ('story_threads','story_id'),
        ('story_threads','title'),
        ('story_threads','status'),
        ('story_threads','opened_chapter'),
        ('story_threads','last_touched_chapter'),
        ('story_threads','payoff_window'),
        ('story_threads','is_main_mystery'),
        ('story_threads','created_at'),
        ('story_threads','stale'),
        ('story_threads','stale_since_chapter'),
        ('timeline_events','id'),
        ('timeline_events','story_id'),
        ('timeline_events','chapter_number'),
        ('timeline_events','ordinal'),
        ('timeline_events','description'),
        ('timeline_events','is_flashback'),
        ('timeline_events','occurs_at'),
        ('timeline_events','created_at')
          ) required(table_name,column_name)
          left join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass('public.'||required.table_name) and a.attname=required.column_name and a.attnum>0 and not a.attisdropped
          left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum) not in ('676945a7272a69eda3602104b0dc1945','9dba1f4c604ae168f1d4fa944c72e189')
    then raise exception using errcode='P0001', message='BASELINE_SCHEMA_DRIFT'; end if;

    if (select count(*) from pg_catalog.pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text=any(v_owned_tables) and conname<>all(array['stories_source_story_id_fkey','stories_story_contract_version_check','stories_story_mode_check','stories_generation_status_check','choice_outcomes_choice_kind_check','generation_leases_job_id_fkey']))<>60
      or (select md5(string_agg(conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_catalog.pg_get_constraintdef(oid,true),E'\n' order by conrelid::regclass::text,conname)) from pg_catalog.pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text=any(v_owned_tables) and conname<>all(array['stories_source_story_id_fkey','stories_story_contract_version_check','stories_story_mode_check','stories_generation_status_check','choice_outcomes_choice_kind_check','generation_leases_job_id_fkey']))<>'43e8607ae0e97120a842f56b7d89a446'
      or (select md5(string_agg(indexname||'|'||indexdef,E'\n' order by indexname)) from pg_catalog.pg_indexes where schemaname='public' and indexname=any(array['chapter_blueprints_story_idx','character_aliases_char_idx','character_aliases_unique_ci','characters_story_idx','facts_ledger_loadbearing_idx','facts_ledger_story_idx','generation_leases_one_active','retrieval_logs_story_idx','stories_owner_user_id_idx','stories_visibility_idx','story_events_story_idx','story_threads_active_idx','story_threads_story_idx','timeline_events_story_idx']))<>'bae2dbb562d31ef7115ffcae2a1b939a'
    then raise exception using errcode='P0001', message='BASELINE_SCHEMA_DRIFT'; end if;

    if (select md5(string_agg(c.relname||'|'||pg_catalog.pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity::text||'|'||coalesce(array_to_string(c.relacl,','),''),E'\n' order by c.relname)) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(v_owned_tables))not in ('cf4d8e1722ca3c5afdb956d4977bf31d','888eb2e11b7fe073d7bf7fbaa80365b3')
      or (select md5(string_agg(tablename||'|'||policyname||'|'||permissive||'|'||array_to_string(roles,',')||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''),E'\n' order by tablename,policyname)) from pg_catalog.pg_policies where schemaname='public' and tablename=any(array['stories','chapters','choice_outcomes','reader_states']))<>'0eb868a242fd3e29fe6ae8a7913029af'
      or (select md5(string_agg(c.relname||'|'||pg_catalog.pg_get_userbyid(c.relowner)||'|'||coalesce(array_to_string(c.relacl,','),''),E'\n' order by c.relname)) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' and c.relname=any(v_owned_sequences))<>'ce4822c8f0294dafd8faec3a0e802ae2'
    then raise exception using errcode='P0001', message='BASELINE_SCHEMA_DRIFT'; end if;

    if md5(pg_catalog.pg_get_functiondef('public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure))<>'a510dcaf674b178782dfe971aea57be2'
      or md5(pg_catalog.pg_get_functiondef('public.release_generation_lease(text,uuid)'::regprocedure))<>'aa4b498641464d7d56479860d51a7ec9'
      or md5(pg_catalog.pg_get_functiondef('public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure))<>'e8f33f2aaca0b3343f8fe51200fc402b'
      or md5(pg_catalog.pg_get_functiondef('public.story_is_public(text)'::regprocedure)) not in ('73310f024aff9df0dcfd3995648954ad','ba1f41bb9236238ca89ebe6a786bcfba')
      or md5(pg_catalog.pg_get_functiondef('public.story_is_owned_by_auth(text)'::regprocedure)) not in ('25bf18127829a221b1db9d9dc67dcd85','53168e0fce2e14b5346a58bf96571648')
      or (select count(*) from pg_catalog.pg_proc p where p.oid=any(array(select pg_catalog.to_regprocedure('public.'||x) from unnest(v_owned_functions[1:3]) x)) and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=public'])<>3
      or (select count(*) from pg_catalog.pg_proc p where p.oid=any(array[pg_catalog.to_regprocedure('public.acquire_generation_lease(text,integer,text,integer,text)'),pg_catalog.to_regprocedure('public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)')]) and ((p.proacl @> array['postgres=X/postgres','service_role=X/postgres']::aclitem[] and p.proacl <@ array['postgres=X/postgres','service_role=X/postgres']::aclitem[]) or (p.proacl @> array['=X/postgres','postgres=X/postgres','service_role=X/postgres']::aclitem[] and p.proacl <@ array['=X/postgres','postgres=X/postgres','service_role=X/postgres']::aclitem[])))<>2
      or (select count(*) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.release_generation_lease(text,uuid)') and p.proacl=array['postgres=X/postgres','service_role=X/postgres']::aclitem[])<>1
      or (select count(*) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.story_is_public(text)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""'] and p.proacl=array['postgres=X/postgres','service_role=X/postgres','anon=X/postgres','authenticated=X/postgres']::aclitem[])<>1
      or (select count(*) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.story_is_owned_by_auth(text)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""'] and p.proacl=array['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[])<>1
      or not has_function_privilege('service_role','public.acquire_generation_lease(text,integer,text,integer,text)','EXECUTE')
      or has_function_privilege('anon','public.release_generation_lease(text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.release_generation_lease(text,uuid)','EXECUTE') or not has_function_privilege('service_role','public.release_generation_lease(text,uuid)','EXECUTE')
      or not has_function_privilege('service_role','public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)','EXECUTE')
      or not has_function_privilege('anon','public.story_is_public(text)','EXECUTE') or not has_function_privilege('authenticated','public.story_is_public(text)','EXECUTE') or has_function_privilege('anon','public.story_is_owned_by_auth(text)','EXECUTE') or not has_function_privilege('authenticated','public.story_is_owned_by_auth(text)','EXECUTE')
    then raise exception using errcode='P0001', message='BASELINE_SCHEMA_DRIFT'; end if;

    return;
  end if;

  execute $baseline_ddl$
CREATE TABLE IF NOT EXISTS "public"."act_rollups" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "act_number" integer NOT NULL,
    "summary" "text" NOT NULL,
    "state_delta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "covers_from_chapter" integer NOT NULL,
    "covers_to_chapter" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."act_rollups" OWNER TO "postgres";


ALTER TABLE "public"."act_rollups" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."act_rollups_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."chapter_blueprints" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "chapter_number" integer NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "phase" "text" DEFAULT ''::"text" NOT NULL,
    "chapter_goal" "text" DEFAULT ''::"text" NOT NULL,
    "mandatory_beats" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "forbidden_reveals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "allowed_state_delta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "introduces_characters" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "reconciled_from_version" integer,
    "reconciliation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chapter_blueprints" OWNER TO "postgres";


ALTER TABLE "public"."chapter_blueprints" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chapter_blueprints_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."chapters" (
    "story_id" "text" NOT NULL,
    "number" integer NOT NULL,
    "title" "text" NOT NULL,
    "paragraphs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "choice_prompt" "text",
    "choices" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chapters_number_check" CHECK (("number" >= 1))
);


ALTER TABLE "public"."chapters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."character_aliases" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "character_id" "text" NOT NULL,
    "alias" "text" NOT NULL,
    "alias_type" "text" DEFAULT 'NICKNAME'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "character_aliases_alias_type_check" CHECK (("alias_type" = ANY (ARRAY['NAME'::"text", 'NICKNAME'::"text", 'RELATION'::"text", 'TITLE'::"text"])))
);


ALTER TABLE "public"."character_aliases" OWNER TO "postgres";


ALTER TABLE "public"."character_aliases" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."character_aliases_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."character_states" (
    "character_id" "text" NOT NULL,
    "status" "text" DEFAULT 'ALIVE'::"text" NOT NULL,
    "as_of_chapter" integer DEFAULT 1 NOT NULL,
    "attributes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "character_states_status_check" CHECK (("status" = ANY (ARRAY['ALIVE'::"text", 'DEAD'::"text", 'INACTIVE'::"text"])))
);


ALTER TABLE "public"."character_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."character_voice_sheets" (
    "character_id" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "register" "text" DEFAULT ''::"text" NOT NULL,
    "speech_habits" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "forbidden_words" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sample_lines" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."character_voice_sheets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."characters" (
    "id" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "canonical_name" "text" NOT NULL,
    "role" "text" DEFAULT ''::"text" NOT NULL,
    "motivation" "text" DEFAULT ''::"text" NOT NULL,
    "introduced_chapter" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "characters_introduced_chapter_check" CHECK (("introduced_chapter" >= 1))
);


ALTER TABLE "public"."characters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."choice_outcomes" (
    "story_id" "text" NOT NULL,
    "chapter_number" integer NOT NULL,
    "choice_id" "text" NOT NULL,
    "consequence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "next_chapter_number" integer,
    "is_ending" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."choice_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facts_ledger" (
    "id" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "statement" "text" NOT NULL,
    "subject_character_id" "text",
    "established_chapter" integer DEFAULT 1 NOT NULL,
    "salience" real DEFAULT 0.5 NOT NULL,
    "load_bearing" boolean DEFAULT false NOT NULL,
    "paid_off" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."facts_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."generation_leases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "story_id" "text" NOT NULL,
    "chapter_number" integer NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "holder" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "generation_leases_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'RELEASED'::"text", 'EXPIRED'::"text"])))
);


ALTER TABLE "public"."generation_leases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "key" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_scopes" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "character_id" "text" NOT NULL,
    "fact_id" "text" NOT NULL,
    "known_from_chapter" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."knowledge_scopes" OWNER TO "postgres";


ALTER TABLE "public"."knowledge_scopes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."knowledge_scopes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."outbox" (
    "id" bigint NOT NULL,
    "topic" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."outbox" OWNER TO "postgres";


ALTER TABLE "public"."outbox" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."outbox_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."reader_states" (
    "user_id" "uuid" NOT NULL,
    "story_id" "text" NOT NULL,
    "status" "text" DEFAULT 'BERJALAN'::"text" NOT NULL,
    "current_chapter" integer DEFAULT 1 NOT NULL,
    "jejak" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ending_name" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reader_states_current_chapter_check" CHECK (("current_chapter" >= 1)),
    CONSTRAINT "reader_states_status_check" CHECK (("status" = ANY (ARRAY['BARU'::"text", 'BERJALAN'::"text", 'SELESAI'::"text"])))
);


ALTER TABLE "public"."reader_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."retrieval_logs" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "target_chapter" integer NOT NULL,
    "included_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "excluded_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "budget_report" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."retrieval_logs" OWNER TO "postgres";


ALTER TABLE "public"."retrieval_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."retrieval_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."secrets_reveals" (
    "id" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "description" "text" NOT NULL,
    "reveal_gate_chapter" integer NOT NULL,
    "revealed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "secrets_reveals_reveal_gate_chapter_check" CHECK (("reveal_gate_chapter" >= 1))
);


ALTER TABLE "public"."secrets_reveals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stories" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "cover" "text" DEFAULT ''::"text" NOT NULL,
    "tagline" "text" DEFAULT ''::"text" NOT NULL,
    "role" "text" DEFAULT ''::"text" NOT NULL,
    "tropes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_chapters" integer DEFAULT 50 NOT NULL,
    "synopsis" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'BARU'::"text" NOT NULL,
    "current_chapter" integer DEFAULT 1 NOT NULL,
    "jejak" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ending_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_user_id" "uuid",
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    CONSTRAINT "stories_status_check" CHECK (("status" = ANY (ARRAY['BARU'::"text", 'BERJALAN'::"text", 'SELESAI'::"text"]))),
    CONSTRAINT "stories_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'unlisted'::"text", 'public'::"text"])))

);


ALTER TABLE "public"."stories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_events" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "seq" integer NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."story_events" OWNER TO "postgres";


ALTER TABLE "public"."story_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."story_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."story_threads" (
    "id" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "opened_chapter" integer DEFAULT 1 NOT NULL,
    "last_touched_chapter" integer DEFAULT 1 NOT NULL,
    "payoff_window" integer,
    "is_main_mystery" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stale" boolean DEFAULT false NOT NULL,
    "stale_since_chapter" integer,
    CONSTRAINT "story_threads_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'DEVELOPING'::"text", 'PAYOFF_DUE'::"text", 'RESOLVED'::"text", 'ABANDONED_APPROVED'::"text"])))
);


ALTER TABLE "public"."story_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline_events" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "chapter_number" integer NOT NULL,
    "ordinal" integer DEFAULT 0 NOT NULL,
    "description" "text" NOT NULL,
    "is_flashback" boolean DEFAULT false NOT NULL,
    "occurs_at" real,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."timeline_events" OWNER TO "postgres";


ALTER TABLE "public"."timeline_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."timeline_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


ALTER TABLE ONLY "public"."act_rollups"
    ADD CONSTRAINT "act_rollups_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."act_rollups"
    ADD CONSTRAINT "act_rollups_story_id_act_number_key" UNIQUE ("story_id", "act_number");


ALTER TABLE ONLY "public"."chapter_blueprints"
    ADD CONSTRAINT "chapter_blueprints_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."chapter_blueprints"
    ADD CONSTRAINT "chapter_blueprints_story_id_chapter_number_version_key" UNIQUE ("story_id", "chapter_number", "version");


ALTER TABLE ONLY "public"."chapters"
    ADD CONSTRAINT "chapters_pkey" PRIMARY KEY ("story_id", "number");


ALTER TABLE ONLY "public"."character_aliases"
    ADD CONSTRAINT "character_aliases_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."character_states"
    ADD CONSTRAINT "character_states_pkey" PRIMARY KEY ("character_id", "as_of_chapter");


ALTER TABLE ONLY "public"."character_voice_sheets"
    ADD CONSTRAINT "character_voice_sheets_pkey" PRIMARY KEY ("character_id");


ALTER TABLE ONLY "public"."characters"
    ADD CONSTRAINT "characters_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."choice_outcomes"
    ADD CONSTRAINT "choice_outcomes_pkey" PRIMARY KEY ("story_id", "chapter_number", "choice_id");


ALTER TABLE ONLY "public"."facts_ledger"
    ADD CONSTRAINT "facts_ledger_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."generation_leases"
    ADD CONSTRAINT "generation_leases_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key");


ALTER TABLE ONLY "public"."knowledge_scopes"
    ADD CONSTRAINT "knowledge_scopes_character_id_fact_id_key" UNIQUE ("character_id", "fact_id");


ALTER TABLE ONLY "public"."knowledge_scopes"
    ADD CONSTRAINT "knowledge_scopes_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."reader_states"
    ADD CONSTRAINT "reader_states_pkey" PRIMARY KEY ("user_id", "story_id");


ALTER TABLE ONLY "public"."retrieval_logs"
    ADD CONSTRAINT "retrieval_logs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."secrets_reveals"
    ADD CONSTRAINT "secrets_reveals_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."stories"
    ADD CONSTRAINT "stories_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_story_id_seq_key" UNIQUE ("story_id", "seq");


ALTER TABLE ONLY "public"."story_threads"
    ADD CONSTRAINT "story_threads_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."timeline_events"
    ADD CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id");


CREATE INDEX "chapter_blueprints_story_idx" ON "public"."chapter_blueprints" USING "btree" ("story_id", "chapter_number");


CREATE INDEX "character_aliases_char_idx" ON "public"."character_aliases" USING "btree" ("character_id");


CREATE UNIQUE INDEX "character_aliases_unique_ci" ON "public"."character_aliases" USING "btree" ("story_id", "lower"("alias"));


CREATE INDEX "characters_story_idx" ON "public"."characters" USING "btree" ("story_id");


CREATE INDEX "facts_ledger_loadbearing_idx" ON "public"."facts_ledger" USING "btree" ("story_id") WHERE ("load_bearing" AND (NOT "paid_off"));


CREATE INDEX "facts_ledger_story_idx" ON "public"."facts_ledger" USING "btree" ("story_id");


CREATE UNIQUE INDEX "generation_leases_one_active" ON "public"."generation_leases" USING "btree" ("story_id") WHERE ("status" = 'ACTIVE'::"text");


CREATE INDEX "retrieval_logs_story_idx" ON "public"."retrieval_logs" USING "btree" ("story_id", "target_chapter");


CREATE INDEX "stories_owner_user_id_idx" ON "public"."stories" USING "btree" ("owner_user_id", "created_at" DESC);


CREATE INDEX "stories_visibility_idx" ON "public"."stories" USING "btree" ("visibility") WHERE ("visibility" = 'public'::"text");


CREATE INDEX "story_events_story_idx" ON "public"."story_events" USING "btree" ("story_id", "seq");


CREATE INDEX "story_threads_active_idx" ON "public"."story_threads" USING "btree" ("story_id") WHERE ("status" = ANY (ARRAY['OPEN'::"text", 'DEVELOPING'::"text", 'PAYOFF_DUE'::"text"]));


CREATE INDEX "story_threads_story_idx" ON "public"."story_threads" USING "btree" ("story_id", "status");


CREATE INDEX "timeline_events_story_idx" ON "public"."timeline_events" USING "btree" ("story_id", "chapter_number", "ordinal");


ALTER TABLE ONLY "public"."act_rollups"
    ADD CONSTRAINT "act_rollups_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."chapter_blueprints"
    ADD CONSTRAINT "chapter_blueprints_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."chapters"
    ADD CONSTRAINT "chapters_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."character_aliases"
    ADD CONSTRAINT "character_aliases_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."character_aliases"
    ADD CONSTRAINT "character_aliases_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."character_states"
    ADD CONSTRAINT "character_states_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."character_voice_sheets"
    ADD CONSTRAINT "character_voice_sheets_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."character_voice_sheets"
    ADD CONSTRAINT "character_voice_sheets_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."characters"
    ADD CONSTRAINT "characters_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."choice_outcomes"
    ADD CONSTRAINT "choice_outcomes_story_id_chapter_number_fkey" FOREIGN KEY ("story_id", "chapter_number") REFERENCES "public"."chapters"("story_id", "number") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."facts_ledger"
    ADD CONSTRAINT "facts_ledger_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."facts_ledger"
    ADD CONSTRAINT "facts_ledger_subject_character_id_fkey" FOREIGN KEY ("subject_character_id") REFERENCES "public"."characters"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."generation_leases"
    ADD CONSTRAINT "generation_leases_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."knowledge_scopes"
    ADD CONSTRAINT "knowledge_scopes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."knowledge_scopes"
    ADD CONSTRAINT "knowledge_scopes_fact_id_fkey" FOREIGN KEY ("fact_id") REFERENCES "public"."facts_ledger"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."knowledge_scopes"
    ADD CONSTRAINT "knowledge_scopes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."reader_states"
    ADD CONSTRAINT "reader_states_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."reader_states"
    ADD CONSTRAINT "reader_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."retrieval_logs"
    ADD CONSTRAINT "retrieval_logs_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."secrets_reveals"
    ADD CONSTRAINT "secrets_reveals_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."stories"
    ADD CONSTRAINT "stories_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."story_threads"
    ADD CONSTRAINT "story_threads_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."timeline_events"
    ADD CONSTRAINT "timeline_events_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;


create or replace function public.acquire_generation_lease(p_story_id text, p_chapter_number integer, p_holder text, p_ttl_seconds integer, p_idempotency_key text) returns jsonb
    language plpgsql security definer
    set search_path to public
    AS $$
declare
  v_existing jsonb;
  v_lease_id uuid;
begin
  -- Idempotensi: jika key sudah ada, kembalikan hasil sebelumnya (tidak double-acquire).
  select result into v_existing from public.idempotency_keys where key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  -- Bersihkan lease kedaluwarsa agar tidak menghalangi.
  update public.generation_leases
    set status = 'EXPIRED'
    where story_id = p_story_id and status = 'ACTIVE' and expires_at < now();

  begin
    insert into public.generation_leases (story_id, chapter_number, holder, expires_at)
    values (p_story_id, p_chapter_number, p_holder, now() + make_interval(secs => p_ttl_seconds))
    returning id into v_lease_id;
  exception when unique_violation then
    -- Sudah ada generasi aktif untuk story ini.
    return jsonb_build_object('ok', false, 'reason', 'LEASE_HELD');
  end;

  v_existing := jsonb_build_object('ok', true, 'lease_id', v_lease_id, 'chapter_number', p_chapter_number);
  insert into public.idempotency_keys (key, story_id, scope, result)
  values (p_idempotency_key, p_story_id, 'acquire_lease', v_existing);
  return v_existing;
end;
$$;


ALTER FUNCTION "public"."acquire_generation_lease"("p_story_id" "text", "p_chapter_number" integer, "p_holder" "text", "p_ttl_seconds" integer, "p_idempotency_key" "text") OWNER TO "postgres";


create or replace function public.release_generation_lease(p_story_id text, p_lease_id uuid) returns jsonb
    language plpgsql security definer
    set search_path to public
    AS $$
declare
  v_rows int;
begin
  update public.generation_leases
     set status = 'RELEASED'
   where id = p_lease_id
     and story_id = p_story_id
     and status = 'ACTIVE';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'released', v_rows);
end;
$$;


ALTER FUNCTION "public"."release_generation_lease"("p_story_id" "text", "p_lease_id" "uuid") OWNER TO "postgres";

create or replace function public.publish_chapter(p_story_id text, p_chapter_number integer, p_title text, p_paragraphs jsonb, p_choice_prompt text, p_choices jsonb, p_outcomes jsonb, p_lease_id uuid, p_idempotency_key text) returns jsonb
    language plpgsql security definer
    set search_path to public
    AS $$
declare
  v_existing jsonb;
  v_seq int;
  v_outcome jsonb;
  v_result jsonb;
begin
  -- Idempotensi: publish berulang mengembalikan hasil pertama tanpa efek ganda.
  select result into v_existing from public.idempotency_keys where key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  -- Chapter harus belum ada (anti double-publish untuk bab yang sama).
  if exists (select 1 from public.chapters where story_id = p_story_id and number = p_chapter_number) then
    return jsonb_build_object('ok', false, 'reason', 'CHAPTER_EXISTS');
  end if;

  -- Tulis chapter.
  insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
  values (p_story_id, p_chapter_number, p_title, coalesce(p_paragraphs,'[]'::jsonb), p_choice_prompt, p_choices);

  -- Tulis outcomes (bila ada).
  if p_outcomes is not null then
    for v_outcome in select * from jsonb_array_elements(p_outcomes)
    loop
      insert into public.choice_outcomes
        (story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending)
      values (
        p_story_id,
        p_chapter_number,
        v_outcome->>'choiceId',
        coalesce(v_outcome->'consequence','[]'::jsonb),
        nullif(v_outcome->>'nextChapterNumber','')::int,
        coalesce((v_outcome->>'isEnding')::boolean, false)
      );
    end loop;
  end if;

  -- Append event dengan sequence monotonic.
  select coalesce(max(seq),0)+1 into v_seq from public.story_events where story_id = p_story_id;
  insert into public.story_events (story_id, seq, type, payload)
  values (p_story_id, v_seq, 'CHAPTER_PUBLISHED',
          jsonb_build_object('chapter_number', p_chapter_number, 'lease_id', p_lease_id));

  -- Release lease bila diberikan.
  if p_lease_id is not null then
    update public.generation_leases set status = 'RELEASED'
      where id = p_lease_id and status = 'ACTIVE';
  end if;

  -- Outbox untuk efek samping (mis. notifikasi) — diproses terpisah.
  insert into public.outbox (topic, payload)
  values ('chapter.published', jsonb_build_object('story_id', p_story_id, 'chapter_number', p_chapter_number));

  v_result := jsonb_build_object('ok', true, 'chapter_number', p_chapter_number, 'seq', v_seq);
  insert into public.idempotency_keys (key, story_id, scope, result)
  values (p_idempotency_key, p_story_id, 'publish_chapter', v_result);
  return v_result;
end;
$$;


ALTER FUNCTION "public"."publish_chapter"("p_story_id" "text", "p_chapter_number" integer, "p_title" "text", "p_paragraphs" "jsonb", "p_choice_prompt" "text", "p_choices" "jsonb", "p_outcomes" "jsonb", "p_lease_id" "uuid", "p_idempotency_key" "text") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."publish_chapter"("p_story_id" "text", "p_chapter_number" integer, "p_title" "text", "p_paragraphs" "jsonb", "p_choice_prompt" "text", "p_choices" "jsonb", "p_outcomes" "jsonb", "p_lease_id" "uuid", "p_idempotency_key" "text") TO "service_role";




CREATE OR REPLACE FUNCTION "public"."story_is_owned_by_auth"("p_story_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.stories s
    where s.id = p_story_id
      and s.owner_user_id = auth.uid()
  );
$$;

ALTER FUNCTION "public"."story_is_owned_by_auth"("p_story_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."story_is_public"("p_story_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.stories s
    where s.id = p_story_id
      and s.visibility = 'public'
  );
$$;

ALTER FUNCTION "public"."story_is_public"("p_story_id" "text") OWNER TO "postgres";


ALTER TABLE "public"."act_rollups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chapter_blueprints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chapters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chapters_public_read" ON "public"."chapters" FOR SELECT TO "authenticated", "anon" USING ("public"."story_is_public"("story_id"));


ALTER TABLE "public"."character_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."character_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."character_voice_sheets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."characters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."choice_outcomes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "choice_outcomes_public_read" ON "public"."choice_outcomes" FOR SELECT TO "authenticated", "anon" USING ("public"."story_is_public"("story_id"));


ALTER TABLE "public"."facts_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generation_leases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."idempotency_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."knowledge_scopes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reader_states_delete_own" ON "public"."reader_states" FOR DELETE USING (("auth"."uid"() = "user_id"));


CREATE POLICY "reader_states_insert_own" ON "public"."reader_states" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


CREATE POLICY "reader_states_select_own" ON "public"."reader_states" FOR SELECT USING (("auth"."uid"() = "user_id"));


CREATE POLICY "reader_states_update_own" ON "public"."reader_states" FOR UPDATE USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."retrieval_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."secrets_reveals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stories_public_read" ON "public"."stories" FOR SELECT TO "authenticated", "anon" USING (("visibility" = 'public'::"text"));

CREATE POLICY "stories_owner_read" ON "public"."stories" FOR SELECT TO "authenticated" USING (("owner_user_id" = "auth"."uid"()));

CREATE POLICY "chapters_owner_read" ON "public"."chapters" FOR SELECT TO "authenticated" USING ("public"."story_is_owned_by_auth"("story_id"));

CREATE POLICY "choice_outcomes_owner_read" ON "public"."choice_outcomes" FOR SELECT TO "authenticated" USING ("public"."story_is_owned_by_auth"("story_id"));


ALTER TABLE "public"."story_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."story_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timeline_events" ENABLE ROW LEVEL SECURITY;


REVOKE ALL ON FUNCTION "public"."story_is_owned_by_auth"("p_story_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."story_is_owned_by_auth"("p_story_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."story_is_owned_by_auth"("p_story_id" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."story_is_public"("p_story_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."story_is_public"("p_story_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."story_is_public"("p_story_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."story_is_public"("p_story_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."acquire_generation_lease"("p_story_id" "text", "p_chapter_number" integer, "p_holder" "text", "p_ttl_seconds" integer, "p_idempotency_key" "text") TO "service_role";


REVOKE ALL ON FUNCTION "public"."release_generation_lease"("p_story_id" "text", "p_lease_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_generation_lease"("p_story_id" "text", "p_lease_id" "uuid") TO "service_role";


GRANT ALL ON TABLE "public"."act_rollups" TO "anon";
GRANT ALL ON TABLE "public"."act_rollups" TO "authenticated";
GRANT ALL ON TABLE "public"."act_rollups" TO "service_role";


GRANT ALL ON TABLE "public"."chapter_blueprints" TO "anon";
GRANT ALL ON TABLE "public"."chapter_blueprints" TO "authenticated";
GRANT ALL ON TABLE "public"."chapter_blueprints" TO "service_role";


GRANT ALL ON TABLE "public"."chapters" TO "anon";
GRANT ALL ON TABLE "public"."chapters" TO "authenticated";
GRANT ALL ON TABLE "public"."chapters" TO "service_role";


GRANT ALL ON TABLE "public"."character_aliases" TO "anon";
GRANT ALL ON TABLE "public"."character_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."character_aliases" TO "service_role";


GRANT ALL ON TABLE "public"."character_states" TO "anon";
GRANT ALL ON TABLE "public"."character_states" TO "authenticated";
GRANT ALL ON TABLE "public"."character_states" TO "service_role";


GRANT ALL ON TABLE "public"."character_voice_sheets" TO "anon";
GRANT ALL ON TABLE "public"."character_voice_sheets" TO "authenticated";
GRANT ALL ON TABLE "public"."character_voice_sheets" TO "service_role";


GRANT ALL ON TABLE "public"."characters" TO "anon";
GRANT ALL ON TABLE "public"."characters" TO "authenticated";
GRANT ALL ON TABLE "public"."characters" TO "service_role";


GRANT ALL ON TABLE "public"."choice_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."choice_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."choice_outcomes" TO "service_role";


GRANT ALL ON TABLE "public"."facts_ledger" TO "anon";
GRANT ALL ON TABLE "public"."facts_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."facts_ledger" TO "service_role";


GRANT ALL ON TABLE "public"."generation_leases" TO "anon";
GRANT ALL ON TABLE "public"."generation_leases" TO "authenticated";
GRANT ALL ON TABLE "public"."generation_leases" TO "service_role";


GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";


GRANT ALL ON TABLE "public"."knowledge_scopes" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_scopes" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_scopes" TO "service_role";


GRANT ALL ON TABLE "public"."outbox" TO "anon";
GRANT ALL ON TABLE "public"."outbox" TO "authenticated";
GRANT ALL ON TABLE "public"."outbox" TO "service_role";


GRANT ALL ON TABLE "public"."reader_states" TO "anon";
GRANT ALL ON TABLE "public"."reader_states" TO "authenticated";
GRANT ALL ON TABLE "public"."reader_states" TO "service_role";


GRANT ALL ON TABLE "public"."retrieval_logs" TO "anon";
GRANT ALL ON TABLE "public"."retrieval_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."retrieval_logs" TO "service_role";


GRANT ALL ON TABLE "public"."secrets_reveals" TO "anon";
GRANT ALL ON TABLE "public"."secrets_reveals" TO "authenticated";
GRANT ALL ON TABLE "public"."secrets_reveals" TO "service_role";


GRANT ALL ON TABLE "public"."stories" TO "anon";
GRANT ALL ON TABLE "public"."stories" TO "authenticated";
GRANT ALL ON TABLE "public"."stories" TO "service_role";


GRANT ALL ON TABLE "public"."story_events" TO "anon";
GRANT ALL ON TABLE "public"."story_events" TO "authenticated";
GRANT ALL ON TABLE "public"."story_events" TO "service_role";


GRANT ALL ON TABLE "public"."story_threads" TO "anon";
GRANT ALL ON TABLE "public"."story_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."story_threads" TO "service_role";


GRANT ALL ON TABLE "public"."timeline_events" TO "anon";
GRANT ALL ON TABLE "public"."timeline_events" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline_events" TO "service_role";


-- EXACT publish_chapter OWNER / GRANTS (function body in publish-chapter.sql)

ALTER FUNCTION "public"."publish_chapter"("p_story_id" "text", "p_chapter_number" integer, "p_title" "text", "p_paragraphs" "jsonb", "p_choice_prompt" "text", "p_choices" "jsonb", "p_outcomes" "jsonb", "p_lease_id" "uuid", "p_idempotency_key" "text") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."publish_chapter"("p_story_id" "text", "p_chapter_number" integer, "p_title" "text", "p_paragraphs" "jsonb", "p_choice_prompt" "text", "p_choices" "jsonb", "p_outcomes" "jsonb", "p_lease_id" "uuid", "p_idempotency_key" "text") TO "service_role";

REVOKE ALL ON FUNCTION public.acquire_generation_lease(text, integer, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_generation_lease(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_chapter(text, integer, text, jsonb, text, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_generation_lease(text, integer, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_generation_lease(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_chapter(text, integer, text, jsonb, text, jsonb, jsonb, uuid, text) TO service_role;

GRANT ALL ON SEQUENCE public.act_rollups_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.chapter_blueprints_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.character_aliases_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.knowledge_scopes_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.outbox_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.retrieval_logs_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.story_events_id_seq TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.timeline_events_id_seq TO anon, authenticated, service_role;

$baseline_ddl$;
end
$baseline_guard$;
