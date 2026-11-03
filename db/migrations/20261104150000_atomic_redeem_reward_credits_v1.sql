-- Penukaran saldo imbalan (Rp) → Lakoin dalam SATU transaksi ber-lock.
-- (Audit 2026-11-04, temuan B3)
--
-- Sebelumnya: cek saldo dilakukan di Node tanpa lock, lalu deduksi via
-- grant_reward_v1 (tanpa cek saldo) dan grant kredit via grant_credits_v1
-- sebagai dua transaksi terpisah. Lima request paralel dengan saldo Rp1.000
-- semuanya lolos cek → saldo minus + Lakoin 5x lipat.
--
-- redeem_reward_credits_v1 mengunci per-user (advisory xact lock, pola yang
-- sama dengan spend_credits_v1/spend_tinta_v1), memeriksa saldo DI DALAM
-- lock, dan menulis kedua ledger dalam satu transaksi. Retry dengan
-- redeem id yang sama bersifat idempoten ('duplicate').

create or replace function public.redeem_reward_credits_v1(
  p_user_id uuid,
  p_redeem_id text,
  p_amount_idr integer,
  p_credits integer
) returns text   -- 'ok' | 'duplicate' | 'insufficient'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount_idr <= 0 or p_credits <= 0 then
    raise exception 'redeem_reward_credits_v1: invalid amounts';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (select 1 from public.reward_ledger where ref = 'redeem:' || p_redeem_id) then
    return 'duplicate';
  end if;

  select coalesce(sum(delta_idr), 0)::int into v_balance
  from public.reward_ledger
  where user_id = p_user_id;

  if v_balance < p_amount_idr then
    return 'insufficient';
  end if;

  insert into public.reward_ledger (user_id, delta_idr, reason, ref)
    values (p_user_id, -p_amount_idr, 'redeem_credits', 'redeem:' || p_redeem_id);

  insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, p_credits, 'reward_redeem', 'reward_redeem:' || p_redeem_id);

  return 'ok';
end;
$$;

revoke all on function public.redeem_reward_credits_v1(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.redeem_reward_credits_v1(uuid, text, integer, integer) to service_role;
