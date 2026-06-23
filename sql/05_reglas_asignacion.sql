-- =====================================================================
-- KONTROL · Reglas de asignación por producto
-- Ejecutar UNA VEZ en Supabase → SQL Editor.
-- =====================================================================
-- Si el producto de un bruto entrante CONTIENE el "patron", se asigna
-- automáticamente a ese vendedor al ingresar (lo aplica la Edge Function).

create table if not exists public.reglas_asignacion (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null,
  patron       text not null,      -- texto a buscar en el nombre del producto
  asesor_id    text not null,      -- vendedor destino
  created_at   timestamptz not null default now()
);

create index if not exists ix_reglas_ws on public.reglas_asignacion(workspace_id);

alter table public.reglas_asignacion enable row level security;

drop policy if exists reglas_all on public.reglas_asignacion;
create policy reglas_all on public.reglas_asignacion for all
  using (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()))
  with check (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()));
