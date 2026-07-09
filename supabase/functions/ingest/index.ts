// =====================================================================
// KONTROL · Edge Function `ingest`
// Punto único de ingesta de pedidos brutos (Google Sheets + Shopify).
// Valida un token por tienda → inserta con service role (oculta aquí).
// =====================================================================
// DESPLIEGUE (Supabase Dashboard → Edge Functions → "Deploy a new function"):
//   - Nombre: ingest
//   - Pega este archivo.
//   - IMPORTANTE: desactiva "Verify JWT" (los webhooks no mandan JWT;
//     la auth la hacemos con el token de la tabla integraciones).
//   - No requiere secretos extra: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
//     ya están disponibles automáticamente.
// URL resultante:  https://<proyecto>.supabase.co/functions/v1/ingest
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function norm(s: unknown) {
  return (s ?? "").toString().toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}
function diaLima(iso?: string) {
  try {
    const d = iso ? new Date(iso) : new Date();
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch { return ""; }
}
async function verifyShopify(secret: string, rawBody: string, hmacHeader: string) {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return b64 === hmacHeader;
  } catch { return false; }
}

function mapSheet(r: any, ws: string) {
  const celular = (r.celular ?? "").toString().trim();
  const nombre = (r.nombre ?? "").toString().trim();
  const producto = (r.producto_raw ?? "").toString().trim();
  if (!celular && !nombre) return null;
  return {
    workspace_id: ws,
    order_id: r.order_id ? String(r.order_id) : null,
    huella: norm(celular) + "|" + norm(producto) + "|" + diaLima(r.fecha_hora),
    fecha_hora: r.fecha_hora || null,
    nombre, celular,
    direccion: (r.direccion ?? "").toString().trim(),
    ciudad: (r.ciudad ?? "").toString().trim(),
    provincia_raw: (r.provincia_raw ?? "").toString().trim(),
    producto_raw: producto,
    precio: (r.precio != null && r.precio !== "") ? Number(r.precio) : null,
  };
}
// Los formularios COD (EasySell, Releasit, etc.) suelen mandar los datos del
// cliente en note_attributes en vez de shipping_address. Este helper los indexa
// por nombre normalizado para poder buscarlos con alias.
function attrsMap(o: any): Record<string, string> {
  const out: Record<string, string> = {};
  const push = (arr: any) => {
    if (!Array.isArray(arr)) return;
    for (const a of arr) {
      const k = norm(a?.name ?? a?.key);
      const v = (a?.value ?? "").toString().trim();
      if (k && v && !out[k]) out[k] = v;
    }
  };
  push(o.note_attributes);
  push(o.attributes);
  return out;
}
function attrPick(attrs: Record<string, string>, aliases: string[]) {
  for (const a of aliases) { const k = norm(a); if (attrs[k]) return attrs[k]; }
  // búsqueda parcial (p.ej. "numerodetelefono" contiene "telefono")
  for (const key of Object.keys(attrs)) {
    for (const a of aliases) { const k = norm(a); if (k && key.includes(k)) return attrs[key]; }
  }
  return "";
}
function mapShopify(o: any, ws: string) {
  const sa = o.shipping_address || o.billing_address || {};
  const cust = o.customer || {};
  const attrs = attrsMap(o);
  // Prioridad por campo: shipping_address (estructurado) > note_attributes
  // (formulario COD EasySell/Releasit) > customer. Si difieren, gana el más
  // estructurado y el resto queda en raw para revisión manual en la app.
  const nombre = (sa.name
    || [cust.first_name, cust.last_name].filter(Boolean).join(" ")
    || attrPick(attrs, ["full name", "nombre completo", "nombre", "name", "nombres y apellidos"])
    || "").trim();
  const celular = (sa.phone || o.phone || cust.phone
    || attrPick(attrs, ["phone", "telefono", "celular", "numero de telefono", "whatsapp", "movil"])
    || "").toString().trim();
  const direccion = ([sa.address1, sa.address2].filter(Boolean).join(" ").trim()
    || attrPick(attrs, ["address", "direccion", "domicilio"]));
  const ciudad = ((sa.city || "").toString().trim()
    || attrPick(attrs, ["city", "ciudad", "distrito", "district"]));
  const provincia = ((sa.province || "").toString().trim()
    || attrPick(attrs, ["province", "provincia", "departamento", "region", "state", "estado"]));
  const items = Array.isArray(o.line_items) ? o.line_items : [];
  const producto = items.map((li: any) => `${li.title}${li.quantity > 1 ? " ×" + li.quantity : ""}`).join(", ");
  const orderId = o.id != null ? String(o.id) : (o.name || "");
  return {
    workspace_id: ws,
    order_id: orderId || null,
    huella: "shopify:" + orderId,
    fecha_hora: o.created_at || null,
    nombre, celular,
    direccion, ciudad,
    provincia_raw: provincia,
    producto_raw: producto,
    precio: o.total_price != null ? Number(o.total_price) : null,
    raw: {
      shopify_name: o.name,
      // Ítems con cantidad/variante/precio → la app los usa para autocompletar
      items: items.map((li: any) => ({
        title: (li.title || "").toString(),
        quantity: li.quantity != null ? Number(li.quantity) : 1,
        price: li.price != null ? Number(li.price) : null,
        sku: (li.sku || "").toString(),
        variant: (li.variant_title || "").toString(),
      })),
      // Datos del formulario COD tal cual, por si algo no se mapeó
      note_attributes: attrs,
      note: (o.note || "").toString().slice(0, 500),
      financial_status: (o.financial_status || "").toString(),
      gateway: (o.gateway || (Array.isArray(o.payment_gateway_names) ? o.payment_gateway_names.join(",") : "")).toString(),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const src = (url.searchParams.get("src") || "sheets").toLowerCase();
    const token = url.searchParams.get("token") || req.headers.get("x-sync-token") || "";
    if (!token) return json({ error: "falta token" }, 401);

    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: intg } = await supa.from("integraciones").select("*").eq("token", token).maybeSingle();
    if (!intg) return json({ error: "token inválido" }, 401);
    const ws = intg.workspace_id;

    if (src === "test") return json({ ok: true, workspace_id: ws });

    let brutos: any[] = [];
    if (src === "shopify") {
      const raw = await req.text();
      // Lista de secretos: tiendas de la app (workspaces.cfg_data.shopifyTiendas) + legado (integraciones.shopify_secret)
      const secrets: { nombre: string; secret: string }[] = [];
      try {
        const { data: wsRow } = await supa.from("workspaces").select("cfg_data").eq("id", ws).maybeSingle();
        const cfg = (wsRow && wsRow.cfg_data) || {};
        const tiendas = Array.isArray(cfg.shopifyTiendas) ? cfg.shopifyTiendas : [];
        for (const t of tiendas) if (t && t.secret) secrets.push({ nombre: (t.nombre || "").toString(), secret: String(t.secret) });
      } catch (_) { /* sin cfg: continúa */ }
      if (intg.shopify_secret && !secrets.some((s) => s.secret === intg.shopify_secret)) secrets.push({ nombre: "", secret: String(intg.shopify_secret) });
      let matched: { nombre: string; secret: string } | null = null;
      if (secrets.length) {
        const hmac = req.headers.get("x-shopify-hmac-sha256") || "";
        for (const s of secrets) { if (await verifyShopify(s.secret, raw, hmac)) { matched = s; break; } }
        if (!matched) return json({ error: "HMAC inválido" }, 401);
      }
      const o = JSON.parse(raw || "{}");
      const b = mapShopify(o, ws);
      const dom = req.headers.get("x-shopify-shop-domain") || "";
      const tiendaNombre = (matched && matched.nombre) || dom || "";
      if (tiendaNombre) b.raw = { ...(b.raw || {}), tienda: tiendaNombre };
      brutos = [b];
    } else {
      const body = await req.json().catch(() => ({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      brutos = rows.map((r: any) => mapSheet(r, ws)).filter(Boolean);
    }

    if (!brutos.length) return json({ recibidos: 0, inserted: 0 });

    // Reglas de asignación por producto → auto-asignar vendedor al entrar
    try {
      const { data: reglas } = await supa.from("reglas_asignacion").select("patron, asesor_id").eq("workspace_id", ws);
      if (reglas && reglas.length) {
        for (const b of brutos) {
          if (b && !b.asesor_id) {
            const pn = norm(b.producto_raw);
            for (const r of reglas) { if (pn && norm(r.patron) && pn.includes(norm(r.patron))) { b.asesor_id = r.asesor_id; break; } }
          }
        }
      }
    } catch (_) { /* sin reglas o tabla ausente: continúa */ }

    const { data, error } = await supa.from("pedidos_brutos")
      .upsert(brutos, { onConflict: "workspace_id,huella", ignoreDuplicates: true })
      .select("id");
    if (error) return json({ error: error.message }, 500);
    const inserted = data?.length || 0;
    return json({ recibidos: brutos.length, inserted, duplicados: brutos.length - inserted });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
