-- Izinkan status 'refunded' pada credit_orders (Audit BL-2 2026-11-06)
--
-- markOrderRefunded di lib/entitlement/store.server.ts menulis status: 'refunded',
-- namun check constraint lama menolaknya:
-- check (status in ('created', 'paid', 'duplicate', 'failed'))
--
-- Penambahan status 'refunded' memungkinkan webhook refund mencatat status secara akurat.

alter table public.credit_orders drop constraint if exists credit_orders_status_check;

alter table public.credit_orders add constraint credit_orders_status_check
  check (status in ('created', 'paid', 'duplicate', 'failed', 'refunded'));
