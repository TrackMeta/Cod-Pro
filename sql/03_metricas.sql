-- =====================================================================
-- KONTROL · Métricas de conversión (ranking de vendedores)
-- Ejecutar UNA VEZ en Supabase → SQL Editor.
-- =====================================================================
-- Devuelve, por asesor, cuántos brutos cerró/rechazó/perdió y su total
-- trabajado (asignado). La efectividad se calcula en la app:
--   efectividad = registrados / total_trabajado.
-- La conversión se atribuye a quien CERRÓ (asesor_id se fija al registrar).

create or replace function public.brutos_metricas(p_ws uuid)
returns table(asesor_id text, registrados bigint, rechazados bigint, perdidos bigint, total bigint)
language sql stable security invoker as $$
  select
    asesor_id,
    count(*) filter (where estado = 'registrado')::bigint,
    count(*) filter (where estado = 'rechazado')::bigint,
    count(*) filter (where estado = 'perdido')::bigint,
    count(*)::bigint
  from public.pedidos_brutos
  where workspace_id = p_ws
  group by asesor_id;
$$;
