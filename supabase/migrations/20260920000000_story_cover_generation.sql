-- Sampul cerita (generate berbayar + unggah gratis), 2026-09-20.
--
-- Prinsip yang dipertahankan dari ekonomi Lakoin yang sudah ada:
--   * harga tunggal fail-closed dari feature_credit_costs (tanpa fallback diam-diam)
--   * uang bergerak lewat reserve -> capture/release, bukan spend langsung
--   * advisory lock per user diambil PERTAMA supaya bebas deadlock
--   * penghitung percobaan (n) diturunkan di DB, tidak pernah dari klien

-- -----------------------------------------------------------------------
-- 1) Izinkan jenis reservasi baru.
-- -----------------------------------------------------------------------
alter table public.credit_reservations
  drop constraint if exists credit_reservations_reservation_kind_check;

alter table public.credit_reservations
  add constraint credit_reservations_reservation_kind_check
  check (reservation_kind in ('CHAPTER_UNLOCK', 'STORY_START', 'STORY_COVER'));

-- -----------------------------------------------------------------------
-- 2) Harga: muncul otomatis di dashboard admin (feature_credit_costs).
-- -----------------------------------------------------------------------
insert into public.feature_credit_costs (
  feature_key,
  credits_required,
  is_active,
  pricing_version
)
values ('story_cover', 20, true, '2026-09-cover-v1')
on conflict (feature_key) do nothing;

-- -----------------------------------------------------------------------
-- 3) Rute model gambar (satu route aktif per use_case).
-- -----------------------------------------------------------------------
insert into public.ai_model_routes (
  use_case,
  provider,
  model_id,
  fallback_models,
  is_active,
  route_version,
  notes
)
values (
  'story_cover',
  'custom',
  'ag/gemini-3.1-flash-image',
  '{}',
  true,
  '2026-09-cover-v1',
  'Sampul cerita: endpoint gambar terpisah, bukan jalur prosa.'
)
on conflict do nothing;

-- -----------------------------------------------------------------------
-- 4) Penghitung percobaan sampul, diturunkan DB.
--
-- Dipanggil hanya dari dalam fungsi yang sudah memegang advisory lock user.
-- Menghitung nomor percobaan berikutnya dari ledger DAN reservasi, supaya
-- reservasi yang sedang berjalan tidak dipakai ulang nomornya.
-- -----------------------------------------------------------------------
create or replace function public.next_story_cover_attempt_v1(
  p_story_id text
) returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(max(n), 0)::int + 1
  from (
    -- substring ber-offset, bukan regex: story id bisa memuat titik/garis
    -- yang berarti lain di pola regex. Escape % dan _ untuk LIKE.
    select (substring(ref from length('cover:' || p_story_id || ':') + 1))::int as n
    from public.credit_ledger
    where ref like 'cover:' || replace(replace(p_story_id, '%', '\%'), '_', '\_') || ':%'
    union all
    select (substring(ref from length('story-cover-reservation:' || p_story_id || ':') + 1))::int as n
    from public.credit_reservations
    where reservation_kind = 'STORY_COVER' and story_id = p_story_id
  ) attempts;
$$;

-- -----------------------------------------------------------------------
-- 5) RPC: reserve_story_cover_v1
--
-- TTL pendek (300 detik): generate gambar terukur 12-16 detik, jadi
-- reservasi yang menggantung tidak perlu menahan Lakoin selama setengah jam.
-- -----------------------------------------------------------------------
create or replace function public.reserve_story_cover_v1(
  p_user_id  uuid,
  p_story_id text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cost          integer;
  v_available     integer;
  v_attempt       integer;
  v_canonical_ref text;
  v_existing      public.credit_reservations%rowtype;
  v_story_owner   uuid;
  c_ttl_seconds   constant integer := 300;
begin
  if p_user_id is null or p_story_id is null or trim(p_story_id) = '' then
    raise exception 'reserve_story_cover_v1: invalid arguments';
  end if;

  -- Advisory lock user PERTAMA (urutan seragam, bebas deadlock).
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select owner_user_id into v_story_owner
  from public.stories
  where id = p_story_id;

  if not found or v_story_owner is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STORY_OWNER');
  end if;

  -- Harga fail-closed. is_active = false berarti fitur dimatikan admin.
  select credits_required into v_cost
  from public.feature_credit_costs
  where feature_key = 'story_cover' and is_active = true;

  if not found or v_cost is null then
    return jsonb_build_object('ok', false, 'reason', 'FEATURE_DISABLED');
  end if;

  perform public.expire_user_reservations_lazy_v1(p_user_id);

  -- Klik ganda tidak boleh jadi dua tagihan: reservasi ACTIVE yang masih
  -- hidup untuk cerita ini dipakai ulang, bukan dibuat baru.
  select * into v_existing
  from public.credit_reservations
  where user_id = p_user_id
    and story_id = p_story_id
    and reservation_kind = 'STORY_COVER'
    and status = 'ACTIVE'
    and expires_at > clock_timestamp()
  order by created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', true, 'status', 'RESERVED', 'ref', v_existing.ref,
      'cost', v_existing.amount, 'attempt', v_existing.chapter_number, 'replayed', true
    );
  end if;

  v_available := public.available_credit_balance_v1(p_user_id);
  if v_available < v_cost then
    return jsonb_build_object(
      'ok', false, 'reason', 'INSUFFICIENT_CREDITS',
      'available', v_available, 'required', v_cost
    );
  end if;

  v_attempt := public.next_story_cover_attempt_v1(p_story_id);
  v_canonical_ref := 'story-cover-reservation:' || p_story_id || ':' || v_attempt::text;

  insert into public.credit_reservations (
    user_id, story_id, chapter_number, reservation_kind, amount, status, ref, expires_at
  ) values (
    p_user_id, p_story_id, v_attempt, 'STORY_COVER', v_cost, 'ACTIVE', v_canonical_ref,
    clock_timestamp() + (c_ttl_seconds * interval '1 second')
  );

  return jsonb_build_object(
    'ok', true, 'status', 'RESERVED', 'ref', v_canonical_ref,
    'cost', v_cost, 'attempt', v_attempt, 'replayed', false
  );
end;
$$;

-- -----------------------------------------------------------------------
-- 6) Capture generik TIDAK BOLEH menyentuh STORY_COVER.
--
-- capture_credit_reservation_v1 memetakan setiap reservasi ke ref ledger
-- 'unlock:<story>:<chapter>'. Untuk sampul itu salah total, jadi dijaga
-- eksplisit seperti STORY_START.
-- -----------------------------------------------------------------------
create or replace function public.capture_credit_reservation_v1(
  p_ref text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_res           public.credit_reservations%rowtype;
  v_ledger_row    public.credit_ledger%rowtype;
  v_canonical_ref text;
  v_reason        text;
begin
  if p_ref is null or trim(p_ref) = '' then
    raise exception 'capture_credit_reservation_v1: invalid arguments';
  end if;

  select * into v_res from public.credit_reservations where ref = p_ref;

  if not found then
    return 'not_found';
  end if;

  if v_res.reservation_kind = 'STORY_START' then
    return 'requires_story_finalize';
  end if;

  if v_res.reservation_kind = 'STORY_COVER' then
    return 'requires_cover_finalize';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_res.user_id::text));

  select * into v_res from public.credit_reservations where id = v_res.id for update;

  if v_res.status = 'CAPTURED' then
    return 'duplicate';
  end if;

  if v_res.status = 'EXPIRED' or v_res.expires_at <= clock_timestamp() then
    update public.credit_reservations set status = 'EXPIRED', updated_at = clock_timestamp() where id = v_res.id;
    return 'expired';
  end if;

  if v_res.status <> 'ACTIVE' then
    return 'not_active';
  end if;

  v_canonical_ref := 'unlock:' || v_res.story_id || ':' || coalesce(v_res.chapter_number::text, '1');
  v_reason := 'unlock_chapter';

  select * into v_ledger_row from public.credit_ledger where ref = v_canonical_ref;
  if found then
    if v_ledger_row.user_id = v_res.user_id and v_ledger_row.delta = -v_res.amount and v_ledger_row.reason = v_reason then
      update public.credit_reservations set status = 'CAPTURED', updated_at = clock_timestamp() where id = v_res.id;
      return 'duplicate';
    else
      raise exception 'IDEMPOTENCY_CONFLICT: canonical ledger ref % mismatched existing entry', v_canonical_ref;
    end if;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (v_res.user_id, -v_res.amount, v_reason, v_canonical_ref);

  update public.credit_reservations
  set status = 'CAPTURED',
      updated_at = clock_timestamp()
  where id = v_res.id;

  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------
-- 7) RPC: capture_story_cover_reservation_v1
--
-- Ref ledger 'cover:<story>:<n>' unik, jadi percobaan yang sama tidak
-- pernah menagih dua kali sekalipun route dipanggil ulang.
-- -----------------------------------------------------------------------
create or replace function public.capture_story_cover_reservation_v1(
  p_ref text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_res           public.credit_reservations%rowtype;
  v_ledger_row    public.credit_ledger%rowtype;
  v_canonical_ref text;
  c_reason        constant text := 'story_cover';
begin
  if p_ref is null or trim(p_ref) = '' then
    raise exception 'capture_story_cover_reservation_v1: invalid arguments';
  end if;

  select * into v_res from public.credit_reservations where ref = p_ref;

  if not found then
    return 'not_found';
  end if;

  if v_res.reservation_kind <> 'STORY_COVER' then
    return 'wrong_kind';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_res.user_id::text));

  select * into v_res from public.credit_reservations where id = v_res.id for update;

  if v_res.status = 'CAPTURED' then
    return 'duplicate';
  end if;

  if v_res.status = 'EXPIRED' or v_res.expires_at <= clock_timestamp() then
    update public.credit_reservations set status = 'EXPIRED', updated_at = clock_timestamp() where id = v_res.id;
    return 'expired';
  end if;

  if v_res.status <> 'ACTIVE' then
    return 'not_active';
  end if;

  v_canonical_ref := 'cover:' || v_res.story_id || ':' || v_res.chapter_number::text;

  select * into v_ledger_row from public.credit_ledger where ref = v_canonical_ref;
  if found then
    if v_ledger_row.user_id = v_res.user_id and v_ledger_row.delta = -v_res.amount and v_ledger_row.reason = c_reason then
      update public.credit_reservations set status = 'CAPTURED', updated_at = clock_timestamp() where id = v_res.id;
      return 'duplicate';
    else
      raise exception 'IDEMPOTENCY_CONFLICT: canonical ledger ref % mismatched existing entry', v_canonical_ref;
    end if;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (v_res.user_id, -v_res.amount, c_reason, v_canonical_ref);

  update public.credit_reservations
  set status = 'CAPTURED',
      updated_at = clock_timestamp()
  where id = v_res.id;

  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------
-- 8) Bucket penyimpanan sampul.
--
-- Publik untuk dibaca (getPublicUrl), tulis hanya lewat service-role yang
-- melewati RLS — tidak ada policy tulis untuk klien. File yang diunggah
-- sudah dinormalisasi WebP di server, jadi allowlist MIME cukup ketat.
-- -----------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-covers', 'story-covers', true, 2097152, array['image/webp'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------
-- 9) ACL: hanya service_role (server) yang boleh memanggil.
-- -----------------------------------------------------------------------
revoke all on function public.next_story_cover_attempt_v1(text) from public, anon, authenticated;
revoke all on function public.reserve_story_cover_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.capture_story_cover_reservation_v1(text) from public, anon, authenticated;
