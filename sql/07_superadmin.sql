-- =====================================================================
-- KONTROL · Super Admin — lectura TOTAL de todas las tiendas
-- Ejecutar UNA VEZ en: Supabase → SQL Editor → New query → Run
-- =====================================================================
-- Problema que resuelve: las tablas pedidos / pedidos_brutos / user_profiles
-- solo dejan leer el workspace PROPIO (RLS). Por eso el Super Admin veía las
-- tiendas vacías (los pedidos ya no viven en workspaces.db_data desde Fase 3).
--
-- Estas políticas dan SOLO LECTURA al Super Admin, identificado por su email
-- de login. NO se otorga escritura: el SA no puede modificar ni dañar datos
-- de las tiendas (la app además bloquea el guardado en modo SA).
--
-- ⚠️ Si cambias el email del Super Admin, actualízalo aquí Y en la constante
--    SUPER_ADMINS dentro del HTML.
-- =====================================================================

create or replace function public.es_superadmin()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email','')) = 'rodrigometa4800@gmail.com';
$$;

-- ── Pedidos (tabla real, Fase 3) ──────────────────────────────────────
drop policy if exists sa_select_pedidos on public.pedidos;
create policy sa_select_pedidos on public.pedidos
  for select using (public.es_superadmin());

-- ── Pedidos brutos (leads / Mi Día) ───────────────────────────────────
drop policy if exists sa_select_brutos on public.pedidos_brutos;
create policy sa_select_brutos on public.pedidos_brutos
  for select using (public.es_superadmin());

-- ── Perfiles de usuarios (pestaña Usuarios de cada tienda) ────────────
drop policy if exists sa_select_profiles on public.user_profiles;
create policy sa_select_profiles on public.user_profiles
  for select using (public.es_superadmin());

-- ── Integraciones (ver estado de Sheets/Shopify/Telegram por tienda) ──
drop policy if exists sa_select_integraciones on public.integraciones;
create policy sa_select_integraciones on public.integraciones
  for select using (public.es_superadmin());

-- ── Workspaces (refuerzo; normalmente ya legible para el SA) ──────────
drop policy if exists sa_select_workspaces on public.workspaces;
create policy sa_select_workspaces on public.workspaces
  for select using (public.es_superadmin());

-- ── Reglas de asignación (modal de reglas en Brutos) ──────────────────
drop policy if exists sa_select_reglas on public.reglas_asignacion;
create policy sa_select_reglas on public.reglas_asignacion
  for select using (public.es_superadmin());

-- =====================================================================
-- FIN. El Super Admin ahora ve pedidos, Mi Día, brutos, usuarios e
-- integraciones de TODAS las tiendas (solo lectura).
-- =====================================================================
