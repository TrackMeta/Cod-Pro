-- =====================================================================
-- KONTROL · Integraciones de ingesta (Google Sheets + Shopify)
-- Ejecutar UNA VEZ en Supabase → SQL Editor.
-- =====================================================================
-- Cada workspace tiene UN token de ingesta (sirve para Sheets y Shopify).
-- La Edge Function `ingest` valida el token → sabe a qué tienda insertar,
-- usando la service key OCULTA en el servidor. Así ningún admin maneja la
-- service key (que es llave maestra de TODAS las tiendas).

create extension if not exists pgcrypto;

-- La huella pasa a ser la ÚNICA llave de dedup (Shopify la arma como
-- 'shopify:<order_id>'; Sheets como 'celular|producto|fecha'). Quitamos el
-- índice único de order_id para que los upsert con ignore-duplicates no
-- choquen contra dos constraints a la vez. order_id queda como dato.
drop index if exists public.ux_brutos_orderid;

create table if not exists public.integraciones (
  workspace_id   uuid primary key,
  token          uuid not null default gen_random_uuid(),  -- llave de ingesta
  shopify_secret text,                                      -- secreto HMAC del webhook Shopify
  col_map        jsonb,                                     -- mapeo de columnas del Sheet (opcional)
  sheets_activo  boolean not null default true,
  shopify_activo boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists ux_integraciones_token on public.integraciones(token);

drop trigger if exists trg_integraciones_updated on public.integraciones;
create trigger trg_integraciones_updated
  before update on public.integraciones
  for each row execute function public.set_updated_at();

alter table public.integraciones enable row level security;

-- Solo el admin del workspace ve/gestiona su propia integración.
drop policy if exists intg_all on public.integraciones;
create policy intg_all on public.integraciones for all
  using (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()))
  with check (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()));

-- =====================================================================
-- FIN. La Edge Function lee esta tabla con service role (salta RLS).
-- =====================================================================
