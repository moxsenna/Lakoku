-- Penukaran Tinta → Lakoin dalam SATU transaksi ber-lock.
-- (Audit 2026-11-04, temuan B4)
--
-- Sebelumnya: spend_tinta_v1 commit → grant_credits_v1 commit → kompensasi
-- grant_tinta_v1 bila grant gagal. Tiga transaksi independen yang
-- dikoordinasikan Node: server mati setelah langkah 1 menghanguskan Tinta
-- tanpa Lakoin; timeout setelah langkah 2 menduplikasi Lakoin.
--
-- exchange_tinta_to_lakoin_v1 mengunci per-user, memeriksa saldo Tinta
-- (menghormati pending_until, semantik sama dengan spend_tinta_v1), lalu
-- menulis kedua ledger dalam satu transaksi. Format ref dipertahankan
-- persis seperti alur lama: 'exchange:{id}' dan 'tinta_exchange:{id}'.

create or replace function public.exchange_tinta_to_lakoin_v1(
  p_user_id uuid,
  p_exchange_id text,
  p_amount_tinta integer,
  p_lakoin_out integer
) returns text   -- 'ok' | 'duplicate' | 'insufficient'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
begin
  if p_amount_tinta <= 0 or p_lakoin_out <= 0 then
    raise exception 'exchange_tinta_to_lakoin_v1: invalid amounts';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (select 1 from public.tinta_ledger where ref = 'exchange:' || p_exchange_id) then
    return 'duplicate';
  end if;

  select coalesce(sum(case when pending_until is null or pending_until <= now()
                           then delta else 0 end), 0)::int
    into v_available
  from public.tinta_ledger
  where user_id = p_user_id;

  if v_available < p_amount_tinta then
    return 'insufficient';
  end if;

  insert into public.tinta_ledger (user_id, delta, reason, ref)
    values (p_user_id, -p_amount_tinta, 'tinta_exchange', 'exchange:' || p_exchange_id);

  insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, p_lakoin_out, 'tinta_exchange', 'tinta_exchange:' || p_exchange_id);

  return 'ok';
end;
$$;

revoke all on function public.exchange_tinta_to_lakoin_v1(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.exchange_tinta_to_lakoin_v1(uuid, text, integer, integer) to service_role;
