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



CREATE TABLE IF NOT EXISTS "public"."character_aliases" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "character_id" "text" NOT NULL,
    "alias" "text" NOT NULL,
    "alias_type" "text" DEFAULT 'NICKNAME'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "character_aliases_alias_type_check" CHECK (("alias_type" = ANY (ARRAY['NAME'::"text", 'NICKNAME'::"text", 'RELATION'::"text", 'TITLE'::"text"])))
);



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



CREATE TABLE IF NOT EXISTS "public"."character_voice_sheets" (
    "character_id" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "register" "text" DEFAULT ''::"text" NOT NULL,
    "speech_habits" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "forbidden_words" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sample_lines" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



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



CREATE TABLE IF NOT EXISTS "public"."choice_outcomes" (
    "story_id" "text" NOT NULL,
    "chapter_number" integer NOT NULL,
    "choice_id" "text" NOT NULL,
    "consequence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "next_chapter_number" integer,
    "is_ending" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



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



CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "key" "text" NOT NULL,
    "story_id" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."knowledge_scopes" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "character_id" "text" NOT NULL,
    "fact_id" "text" NOT NULL,
    "known_from_chapter" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



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



CREATE TABLE IF NOT EXISTS "public"."retrieval_logs" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "target_chapter" integer NOT NULL,
    "included_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "excluded_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "budget_report" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



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



CREATE TABLE IF NOT EXISTS "public"."story_events" (
    "id" bigint NOT NULL,
    "story_id" "text" NOT NULL,
    "seq" integer NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



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



ALTER TABLE ONLY "public"."retrieval_logs"
    ADD CONSTRAINT "retrieval_logs_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."secrets_reveals"
    ADD CONSTRAINT "secrets_reveals_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



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