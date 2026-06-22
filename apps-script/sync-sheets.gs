/**
 * =====================================================================
 * KONTROL · Sincronización Google Sheets → Supabase (pedidos_brutos)
 * =====================================================================
 * Empuja las filas nuevas del Sheet a la tabla `pedidos_brutos`.
 * - PUSH casi instantáneo vía trigger onChange + respaldo cada 1 min.
 * - Dedup por "huella" en Supabase: si una fila ya existe, se ignora.
 * - La service_role key vive SOLO aquí (en Google), nunca en la web.
 *
 * ───────────────────────────────────────────────────────────────────
 * CÓMO INSTALARLO (una sola vez):
 * 1. Abre tu Google Sheet → menú Extensiones → Apps Script.
 * 2. Borra lo que haya y PEGA todo este archivo.
 * 3. Rellena las 3 constantes de CONFIG (abajo):
 *      - SUPABASE_SERVICE_KEY: Supabase → Project Settings → API →
 *        "service_role" secret (NO la anon).
 *      - WORKSPACE_ID: en KONTROL abre la consola (F12) y escribe
 *        SESSION.workspace_id  → copia el UUID.
 *      - SHEET_NAME: el nombre exacto de la pestaña (o déjalo '' para
 *        usar la primera).
 * 4. Verifica el mapeo de COLUMNAS (COL) contra tu Sheet.
 * 5. Arriba selecciona la función `setupTriggers` y dale ▶ Run.
 *    Google pedirá autorización la primera vez → acéptala.
 * 6. (Prueba) selecciona `syncToSupabase` y dale ▶ Run. Revisa que las
 *    filas aparezcan en KONTROL → Pedidos Brutos.
 * ───────────────────────────────────────────────────────────────────
 */

// ===================== CONFIG (RELLENAR) =============================
const SUPABASE_URL = 'https://axdmpgjizaetclludnak.supabase.co';
const SUPABASE_SERVICE_KEY = 'PEGA_AQUI_TU_SERVICE_ROLE_KEY';
const WORKSPACE_ID = 'PEGA_AQUI_TU_WORKSPACE_ID';
const SHEET_NAME = '';        // '' = primera pestaña; o p.ej. 'Hoja 1'
const HEADER_ROWS = 1;        // filas de encabezado a saltar
const TIMEZONE = 'America/Lima';

// Mapeo de columnas (número de columna, 1 = A, 2 = B, ...)
// Ajusta según tu Sheet "Leds de shopify Bebocha".
const COL = {
  fecha: 1,      // A · Fecha y hora
  nombre: 2,     // B · Nombre
  celular: 3,    // C · Número telefónico
  direccion: 4,  // D · Dirección
  ciudad: 5,     // E · Ciudad
  provincia: 6,  // F · Provincia
  producto: 7,   // G · Nombre de Producto
  precio: 8,     // H · Precio
  order_id: 0    // 0 = no existe. Si algún día agregas Order ID, pon su columna.
};
// ====================================================================

function norm(s){
  return (s == null ? '' : String(s)).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '').trim();
}
function toISO(v){
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}
function toDia(v){
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d)) return '';
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}
function cell(row, idx){ return (idx && idx > 0) ? row[idx - 1] : ''; }

function syncToSupabase(){
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // otra ejecución en curso
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
    if (!sh) { Logger.log('No se encontró la hoja.'); return; }

    const lastRow = sh.getLastRow();
    if (lastRow <= HEADER_ROWS) return;

    const props = PropertiesService.getScriptProperties();
    let from = parseInt(props.getProperty('lastRow') || HEADER_ROWS, 10);
    if (isNaN(from) || from < HEADER_ROWS) from = HEADER_ROWS;
    // Reprocesa siempre las últimas 50 por si hubo ediciones (el dedup evita duplicar)
    from = Math.min(from, Math.max(HEADER_ROWS, lastRow - 50));
    if (from >= lastRow) return;

    const maxCol = Math.max.apply(null, Object.values(COL).filter(function(n){ return n > 0; }));
    const numRows = lastRow - from;
    const rows = sh.getRange(from + 1, 1, numRows, maxCol).getValues();

    const payload = [];
    rows.forEach(function(row){
      const celular = String(cell(row, COL.celular) || '').trim();
      const nombre  = String(cell(row, COL.nombre)  || '').trim();
      const producto = String(cell(row, COL.producto) || '').trim();
      if (!celular && !nombre) return; // fila vacía
      const dia = toDia(cell(row, COL.fecha));
      const orderId = COL.order_id ? String(cell(row, COL.order_id) || '').trim() : '';
      payload.push({
        workspace_id: WORKSPACE_ID,
        order_id: orderId || null,
        huella: norm(celular) + '|' + norm(producto) + '|' + dia,
        fecha_hora: toISO(cell(row, COL.fecha)),
        nombre: nombre,
        celular: celular,
        direccion: String(cell(row, COL.direccion) || '').trim(),
        ciudad: String(cell(row, COL.ciudad) || '').trim(),
        provincia_raw: String(cell(row, COL.provincia) || '').trim(),
        producto_raw: producto,
        precio: parseFloat(cell(row, COL.precio)) || null
      });
    });

    if (!payload.length) { props.setProperty('lastRow', String(lastRow)); return; }

    const res = UrlFetchApp.fetch(
      SUPABASE_URL + '/rest/v1/pedidos_brutos?on_conflict=workspace_id,huella',
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          Prefer: 'resolution=ignore-duplicates,return=minimal'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      props.setProperty('lastRow', String(lastRow));
      Logger.log('OK: enviadas ' + payload.length + ' fila(s) (duplicadas ignoradas).');
    } else {
      // No mover el checkpoint → se reintenta en el siguiente ciclo
      Logger.log('Error Supabase ' + code + ': ' + res.getContentText());
    }
  } finally {
    lock.releaseLock();
  }
}

// Trigger por evento (cambios en la hoja)
function onChangeTrigger(e){ syncToSupabase(); }

// Crea/recrea los triggers: onChange (instantáneo) + cada 1 min (respaldo)
function setupTriggers(){
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onChangeTrigger').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('syncToSupabase').timeBased().everyMinutes(1).create();
  Logger.log('Triggers creados: onChange + cada 1 minuto.');
}

// Útil para pruebas: reenvía TODO desde cero (resetea el checkpoint)
function resyncTodo(){
  PropertiesService.getScriptProperties().deleteProperty('lastRow');
  syncToSupabase();
}
