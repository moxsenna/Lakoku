-- Bonus top-up pertama harus memperhitungkan SEMUA kanal berbayar.
-- (Audit 2026-11-04, temuan M4)
--
-- Sebelumnya has_paid_topup_v1 hanya mengenali ref 'paycore:%' (web), padahal
-- kanal Android menulis 'playbilling:{token}' (play_billing_channel_model).
-- Akibatnya pembeli Play Billing selalu dianggap belum pernah top-up dan
-- menerima bonus top-up pertama berulang-ulang.

create or replace function public.has_paid_topup_v1(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.credit_ledger
    where user_id = p_user_id
      and delta > 0
      and (ref like 'paycore:%' or ref like 'playbilling:%')
  );
$$;

grant execute on function public.has_paid_topup_v1(uuid) to service_role;
