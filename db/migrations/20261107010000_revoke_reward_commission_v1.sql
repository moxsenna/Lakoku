-- Clawback komisi referral untuk event refund (audit M-A5).
--
-- Komisi referral di-grant via grant_reward_v1 dengan ref `commission:{order_id}`
-- (lib/rewards/commission.server.ts). Saat order di-refund, kredit pembeli sudah
-- dicabut via revoke_credits_v1, tetapi komisi referrer belum — vektor perputaran
-- uang: beli besar → komisi 10% cair → refund → komisi tetap cair.
--
-- revoke_reward_commission_v1 mencari baris komisi berdasarkan order, lalu
-- menulis delta_idr negatif ber-ref unik `commission-refund:{order_id}`
-- (idempoten, advisory lock per-user, saldo reward BOLEH minus).

create or replace function public.revoke_reward_commission_v1(
  p_order_id text
) returns text   -- 'ok' | 'duplicate' | 'not_found'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant record;
begin
  select user_id, delta_idr into v_grant
  from public.reward_ledger
  where ref = 'commission:' || p_order_id
  limit 1;

  if not found then
    return 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_grant.user_id::text));

  if exists (select 1 from public.reward_ledger where ref = 'commission-refund:' || p_order_id) then
    return 'duplicate';
  end if;

  insert into public.reward_ledger (user_id, delta_idr, reason, ref)
    values (v_grant.user_id, -v_grant.delta_idr, 'refund:commission', 'commission-refund:' || p_order_id);

  return 'ok';
end;
$$;

revoke all on function public.revoke_reward_commission_v1(text) from public, anon, authenticated;
grant execute on function public.revoke_reward_commission_v1(text) to service_role;
