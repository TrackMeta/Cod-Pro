-- =====================================================================
-- KONTROL · Fase Operativa · Paso 1
-- Tabla pedidos_brutos (capa previa de validación)
-- Ejecutar UNA VEZ en: Supabase → SQL Editor → New query → Run
-- =====================================================================
-- Reglas:
--   · Aislada: NUNCA afecta stock/finanzas/métricas/liquidaciones.
--   · Query-driven: se lee paginada, los contadores vienen de consultas.
--   · El Apps Script inserta con service_role (salta RLS).
--   · La app (usuarios logueados) lee/edita vía RLS por workspace.
-- =====================================================================

create table if not exists public.pedidos_brutos (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null,

  -- ── Dedup ──────────────────────────────────────────────
  order_id          text,            -- Order ID Shopify (a futuro; puede ser null)
  huella            text not null,   -- hash tel+producto+fecha (respaldo de dedup)

  -- ── Datos crudos del Google Sheet ──────────────────────
  fecha_hora        timestamptz,     -- col A (cuándo entró el lead)
  nombre            text,
  celular           text,
  direccion         text,
  ciudad            text,            -- col E (puede venir sucia)
  provincia_raw     text,            -- col F (puede venir sucia)
  producto_raw      text,            -- col G (texto libre del Sheet)
  precio            numeric,         -- col H
  raw               jsonb,           -- fila cruda completa (tolera cambios de columnas)

  -- ── Gestión interna KONTROL ────────────────────────────
  estado            text not null default 'por_contactar',
    -- por_contactar | no_contesta | no_responde_wa | reintento
    -- | rechazado | registrado | perdido
  asesor_id         text,            -- quién lo tomó (null = está en el pool)
  zona              text,            -- 'lima' | 'provincia' (detectada, corregible)
  producto_id       bigint,          -- match con catálogo interno (null = sin match)
  intentos          int  not null default 0,
  proximo_reintento timestamptz,     -- cuándo reaparece en cola "Reintentos"
  pedido_numero     int,             -- numero del pedido real generado al registrar
  historial         jsonb not null default '[]'::jsonb, -- trazabilidad del pool

  created_at        timestamptz not null default now(), -- cuándo se importó a KONTROL
  updated_at        timestamptz not null default now()
);

-- ── Dedup (capas 1 y 2 del diseño) ───────────────────────
-- Capa 1: Order ID único por workspace (solo cuando exista)
create unique index if not exists ux_brutos_orderid
  on public.pedidos_brutos (workspace_id, order_id)
  where order_id is not null;

-- Capa 2: huella única por workspace (siempre)
create unique index if not exists ux_brutos_huella
  on public.pedidos_brutos (workspace_id, huella);

-- ── Índices para listado query-driven ────────────────────
create index if not exists ix_brutos_ws_estado
  on public.pedidos_brutos (workspace_id, estado, created_at desc);
create index if not exists ix_brutos_ws_asesor
  on public.pedidos_brutos (workspace_id, asesor_id);
create index if not exists ix_brutos_ws_reintento
  on public.pedidos_brutos (workspace_id, proximo_reintento);

-- ── updated_at automático ────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_brutos_updated on public.pedidos_brutos;
create trigger trg_brutos_updated
  before update on public.pedidos_brutos
  for each row execute function public.set_updated_at();

-- ── RLS (scoping por workspace, igual que la tabla pedidos) ──
alter table public.pedidos_brutos enable row level security;

drop policy if exists brutos_select on public.pedidos_brutos;
create policy brutos_select on public.pedidos_brutos for select
  using (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()));

drop policy if exists brutos_insert on public.pedidos_brutos;
create policy brutos_insert on public.pedidos_brutos for insert
  with check (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()));

drop policy if exists brutos_update on public.pedidos_brutos;
create policy brutos_update on public.pedidos_brutos for update
  using (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()));

drop policy if exists brutos_delete on public.pedidos_brutos;
create policy brutos_delete on public.pedidos_brutos for delete
  using (workspace_id = (select workspace_id from public.user_profiles where id = auth.uid()));

-- ── Realtime (INSERT/UPDATE/DELETE en vivo, igual que pedidos) ──
alter publication supabase_realtime add table public.pedidos_brutos;

-- ── RPC: contadores por estado en una sola llamada (sin descargar filas) ──
create or replace function public.brutos_counts(p_ws uuid)
returns table(estado text, n bigint)
language sql stable security invoker as $$
  select estado, count(*)::bigint
  from public.pedidos_brutos
  where workspace_id = p_ws
  group by estado;
$$;

-- =====================================================================
-- FIN. Si no hubo errores, la tabla está lista.
-- =====================================================================
