// =====================================================================
// KONTROL · Edge Function `notify-telegram`
// Envía a Telegram el aviso de pedido confirmado (solo al admin).
// =====================================================================
// DESPLIEGUE (Supabase → Edge Functions → Deploy new function):
//   - Nombre: notify-telegram
//   - Pega este archivo. Desactiva "Verify JWT".
//   - No requiere secretos extra (usa SUPABASE_SERVICE_ROLE_KEY auto).
// El bot token y el chat_id se guardan por tienda en `integraciones`
// (desde KONTROL → Integraciones → Telegram).
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
function esc(s: unknown) {
  return (s ?? "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtMonto(v: unknown) {
  const n = Number(v);
  return isNaN(n) ? "" : "S/ " + n.toFixed(2);
}
function formatPedido(p: any) {
  const lugar = p.zona === "provincia" ? (p.prov || "") : (p.dist || "");
  const lineas = [
    "🟢 <b>PEDIDO CONFIRMADO</b>",
    "👤 " + esc(p.nombre || "—"),
    p.producto ? "📦 " + esc(p.producto) : "",
    p.precio != null ? "💰 " + fmtMonto(p.precio) : "",
    lugar ? "📍 " + esc(lugar) + (p.zona === "provincia" ? " (Prov.)" : " (Lima)") : "",
    p.vendedor ? "🧑‍💼 " + esc(p.vendedor) : "",
    p.id != null ? "🔖 Pedido #" + esc(p.id) : "",
  ];
  return lineas.filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || req.headers.get("x-sync-token") || "";
    if (!token) return json({ error: "falta token" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: intg } = await supa.from("integraciones")
      .select("telegram_token, telegram_chat_id").eq("token", token).maybeSingle();
    if (!intg) return json({ error: "token inválido" }, 401);
    if (!intg.telegram_token || !intg.telegram_chat_id) return json({ error: "Telegram no configurado" }, 400);

    const body = await req.json().catch(() => ({}));
    let text = "";
    if (body.test) text = "✅ KONTROL conectado a Telegram. Las notificaciones están activas.";
    else if (body.pedido) text = formatPedido(body.pedido);
    else return json({ error: "nada que enviar" }, 400);

    const tg = await fetch(`https://api.telegram.org/bot${intg.telegram_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: intg.telegram_chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const tj = await tg.json().catch(() => ({}));
    if (!tj.ok) return json({ error: tj.description || "error de Telegram" }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
