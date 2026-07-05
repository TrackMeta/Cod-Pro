-- =====================================================================
-- KONTROL · Múltiples tiendas Shopify por workspace
-- Añade una columna jsonb con la lista de tiendas Shopify (cada una con
-- su propio secreto de webhook). El token del workspace sigue siendo el
-- mismo para todas; la Edge Function `ingest` valida el HMAC contra
-- cualquiera de los secretos guardados.
--
-- Estructura de cada elemento de shopify_tiendas:
--   { "id": 1699999999999, "nombre": "Mi tienda", "secret": "shpss_..." }
--
-- Ejecutar UNA vez en Supabase (SQL Editor). Es idempotente.
-- =====================================================================
alter table public.integraciones
  add column if not exists shopify_tiendas jsonb not null default '[]'::jsonb;

-- Migra el secreto único legado (shopify_secret) a la lista, si aún no está.
update public.integraciones
set shopify_tiendas = jsonb_build_array(
      jsonb_build_object(
        'id', (extract(epoch from now())*1000)::bigint,
        'nombre', 'Tienda principal',
        'secret', shopify_secret
      ))
where coalesce(shopify_secret, '') <> ''
  and (shopify_tiendas is null or jsonb_array_length(shopify_tiendas) = 0);
