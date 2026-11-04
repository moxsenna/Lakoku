-- Clawback kredit untuk event refund (audit M3).
--
-- grant_credits_v1 menolak delta <= 0, jadi penarikan kredit butuh RPC
-- sendiri. revoke_credits_v1 idempoten via ref unik (paycore-refund:{order_id})
-- dan mengunci per-user seperti spend_credits_v1. Saldo BOLEH minus: kalau
-- kredit hasil refund sudah terpakai, saldo negatif otomatis memblokir
-- spend berikutnya sampai diisi ulang — pencatatan tetap jujur.

create or replace function public.revoke_credits_v1(
  p_user_id uuid,
  p_ref text,
  p_credits integer,
  p_reason text
) returns text   -- 'ok' | 'duplicate'
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_credits <= 0 then
    raise exception 'revoke_credits_v1: credits must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (select 1 from public.credit_ledger where ref = p_ref) then
    return 'duplicate';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, -p_credits, p_reason, p_ref);

  return 'ok';
end;
$$;

revoke all on function public.revoke_credits_v1(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.revoke_credits_v1(uuid, text, integer, text) to service_role;
