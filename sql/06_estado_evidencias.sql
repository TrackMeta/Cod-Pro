-- =====================================================================
-- KONTROL · Mejoras 2026-07
-- 1) Columna sub_estado en pedidos_brutos ("Estado del Pedido" / etapa)
-- 2) Bucket de Storage 'evidencias' (testimonios de pago + fotos de guía)
-- Ejecutar UNA VEZ en: Supabase → SQL Editor → New query → Run
-- =====================================================================

-- ── 1. Etapa de atención del asesor (Conversando, Compromiso de pago, etc.) ──
alter table public.pedidos_brutos
  add column if not exists sub_estado text;

-- ── 2. Bucket público para evidencias ─────────────────────────────────
-- Las imágenes se comprimen en el navegador antes de subir (~100 KB c/u).
-- El pedido guarda solo la URL, así el JSON del workspace no crece.
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', true)
on conflict (id) do nothing;

-- Lectura pública (las URLs solo las conoce quien usa la app)
drop policy if exists evidencias_select on storage.objects;
create policy evidencias_select on storage.objects for select
  using (bucket_id = 'evidencias');

-- Subida: solo usuarios logueados, y solo dentro de la carpeta de SU workspace
drop policy if exists evidencias_insert on storage.objects;
create policy evidencias_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and (storage.foldername(name))[1] =
        (select workspace_id::text from public.user_profiles where id = auth.uid())
  );

-- Borrado: misma regla que la subida
drop policy if exists evidencias_delete on storage.objects;
create policy evidencias_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidencias'
    and (storage.foldername(name))[1] =
        (select workspace_id::text from public.user_profiles where id = auth.uid())
  );

-- =====================================================================
-- FIN. Si no hubo errores, la app queda lista para etapas + evidencias.
-- =====================================================================
