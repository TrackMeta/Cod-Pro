-- =====================================================================
-- KONTROL · Telegram (notificación de pedido confirmado)
-- Ejecutar UNA VEZ en Supabase → SQL Editor.
-- =====================================================================
-- Guarda el bot token y el chat_id por tienda. La Edge Function
-- `notify-telegram` los lee con service role y envía el mensaje. Si
-- Telegram falla, NO afecta el flujo (la llamada es fire-and-forget).

alter table public.integraciones add column if not exists telegram_token   text;
alter table public.integraciones add column if not exists telegram_chat_id text;
