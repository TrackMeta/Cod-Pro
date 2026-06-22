/**
 * =====================================================================
 * KONTROL · Sincronización Google Sheets → Supabase (vía Edge Function)
 * =====================================================================
 * Empuja las filas nuevas del Sheet a KONTROL de forma SEGURA: usa un
 * TOKEN por tienda (no la service key). El token solo sirve para insertar
 * en TU tienda.
 *
 * 👉 Lo más fácil: copia este script YA PERSONALIZADO desde la app
 *    (KONTROL → Integraciones → Google Sheets → "Copiar script").
 *    Ahí FUNCTION_URL y SYNC_TOKEN vienen rellenos.
 *
 * INSTALACIÓN MANUAL:
 * 1. Google Sheet → Extensiones → Apps Script. Pega este archivo.
 * 2. Rellena FUNCTION_URL y SYNC_TOKEN (los da la app en Integraciones).
 * 3. Verifica SHEET_NAME y el mapeo COL contra tu hoja.
 * 4. Ejecuta `setupTriggers` ▶ (autoriza la 1ª vez).
 * 5. Prueba con `syncToSupabase` ▶ y revisa KONTROL → Pedidos Brutos.
 * =====================================================================
 */

// ===================== CONFIG (RELLENAR) =============================
const FUNCTION_URL = 'https://axdmpgjizaetclludnak.supabase.co/functions/v1/ingest';
const SYNC_TOKEN   = 'PEGA_AQUI_TU_TOKEN'; // KONTROL → Integraciones
const SHEET_NAME   = '';        // '' = primera pestaña; o p.ej. 'Hoja 1'
const HEADER_ROWS  = 1;
const TIMEZONE     = 'America/Lima';

// Mapeo de columnas (1 = A, 2 = B, ...). Ajusta según tu Sheet.
const COL = {
  fecha: 1, nombre: 2, celular: 3, direccion: 4,
  ciudad: 5, provincia: 6, producto: 7, precio: 8,
  order_id: 0  // 0 = no existe. Si agregas Order ID, pon su columna.
};
// ====================================================================

function toISO(v){ if(v instanceof Date) return isNaN(v)?null:v.toISOString(); if(!v) return null; var d=new Date(v); return isNaN(d)?null:d.toISOString(); }
function cell(row, idx){ return (idx && idx>0) ? row[idx-1] : ''; }

function syncToSupabase(){
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(5000)) return;
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
    if(!sh){ Logger.log('No se encontró la hoja.'); return; }
    var lastRow = sh.getLastRow();
    if(lastRow <= HEADER_ROWS) return;

    var props = PropertiesService.getScriptProperties();
    var from = parseInt(props.getProperty('lastRow') || HEADER_ROWS, 10);
    if(isNaN(from) || from < HEADER_ROWS) from = HEADER_ROWS;
    from = Math.min(from, Math.max(HEADER_ROWS, lastRow - 50)); // reprocesa últimas 50 (dedup evita duplicar)
    if(from >= lastRow) return;

    var cols = Object.keys(COL).map(function(k){ return COL[k]; }).filter(function(n){ return n>0; });
    var maxCol = Math.max.apply(null, cols);
    var rows = sh.getRange(from+1, 1, lastRow-from, maxCol).getValues();

    var payload = [];
    rows.forEach(function(row){
      var celular = String(cell(row, COL.celular) || '').trim();
      var nombre  = String(cell(row, COL.nombre)  || '').trim();
      if(!celular && !nombre) return;
      payload.push({
        fecha_hora: toISO(cell(row, COL.fecha)),
        nombre: nombre,
        celular: celular,
        direccion: String(cell(row, COL.direccion) || '').trim(),
        ciudad: String(cell(row, COL.ciudad) || '').trim(),
        provincia_raw: String(cell(row, COL.provincia) || '').trim(),
        producto_raw: String(cell(row, COL.producto) || '').trim(),
        precio: parseFloat(cell(row, COL.precio)) || null,
        order_id: COL.order_id ? (String(cell(row, COL.order_id) || '').trim() || null) : null
      });
    });

    if(!payload.length){ props.setProperty('lastRow', String(lastRow)); return; }

    var res = UrlFetchApp.fetch(FUNCTION_URL + '?src=sheets', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-token': SYNC_TOKEN },
      payload: JSON.stringify({ rows: payload }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if(code >= 200 && code < 300){
      props.setProperty('lastRow', String(lastRow));
      Logger.log('OK: ' + res.getContentText());
    } else {
      Logger.log('Error ' + code + ': ' + res.getContentText()); // no avanza checkpoint → reintenta
    }
  } finally { lock.releaseLock(); }
}

function onChangeTrigger(e){ syncToSupabase(); }

function setupTriggers(){
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onChangeTrigger').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('syncToSupabase').timeBased().everyMinutes(1).create();
  Logger.log('Triggers creados: onChange + cada 1 minuto.');
}

function resyncTodo(){
  PropertiesService.getScriptProperties().deleteProperty('lastRow');
  syncToSupabase();
}
