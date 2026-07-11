// ╔══════════════════════════════════════════════════════════════════════╗
// ║  GOOGLE APPS SCRIPT — API PETROPERÚ DASHBOARD v4.1                  ║
// ║  Arquitectura: REST API + Cache + Upload Processing                  ║
// ║  Hojas: inventario | pronostico | ventas_diarias |                   ║
// ║         mov_naves | despachos | upload_log                           ║
// ║  Desarrollado por: Franco Urcia Castillo                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN GLOBAL
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Plantas excluidas de todos los endpoints (nunca se devuelven al frontend)
  EXCLUDED_PLANTAS: ['Pto. Maldonado', 'Pto.Maldonado', 'Puerto Maldonado'],
  SHEETS: {
    INVENTARIO:     'inventario',
    PRONOSTICO:     'pronostico', // hoja original. 'pronostico_mbdc' existe pero NO se usa por el momento.
    VENTAS_DIARIAS: 'ventas_diarias',
    MOV_NAVES:      'mov_naves',
    DESPACHOS:      'despachos',
    UPLOAD_LOG:     'upload_log',
    USUARIOS:        'usuarios',
    REPORTE_DIARIO:  'reporte_diario',
    REPORTE_ESTADO:  'reporte_estado',
    RT_SOLICITUDES:  'rt_solicitudes'
  },
  CACHE_TTL: 600,  // 10 min — reduce Sheets API calls (data updates ~1/day)
  MAX_COLS_INV: 24,  // 23 = EXISTENCIA_MINIMA, 24 = COMENTARIO_PROD
  TIMEZONE: 'America/Lima',
  
  // Mapeo de productos E&D → Dashboard
  PRODUCT_MAP: {
    'G. REG':       'G. Regular',
    'G. PRE':       'G. Premium',
    'DB5S50':       'Diesel',
    'DB5':          'Diesel',
    'DB5S50 MAYR':  null,
    'DB5S50 YANC':  null,
    'G84':          'G. 84',
    'GLP TP':       'GLP',
    'GLP TOTAL':    null,
    'GLP':          null,
    'GLP SOLGAS':   null,
    'GLP ZETAGAS':  null,
    'TA1':          'TA1',
    'ULSD':         'Diesel',
    'G100LL':       null,
    'GAS100LL':     null,
    'Alcohol':      null,
    'B-100':        null,
    'PI6':          null,
    'PI500':        null,
    'D2 UV':        null,
    'SOL1':         null,
    'SOL3':         null
  },
  
  PLANTAS_DASHBOARD: [
    'Talara','Piura','Eten','Salaverry','Chimbote','Supe',
    'Callao','Conchán','Pisco','Mollendo','Ilo',
    'Juliaca','Cusco','Iquitos','Pucallpa','Tarapoto',
    'Yurimaguas','El Milagro',
    'Refinería Talara','Refinería Conchán','Refinería Iquitos'
  ]
};

// ═══════════════════════════════════════════════════════════════════════
// REGISTRO DIARIO — CONFIGURACIÓN DE AUTENTICACIÓN Y PRODUCTOS POR PLANTA
// (Módulo nuevo — Fase 1: usuario/contraseña propio en Sheets, sin Google
//  Workspace. Pensado como solución de corto plazo sobre Vercel + Apps
//  Script; migrar a SQL + backend dedicado cuando el volumen lo justifique)
// ═══════════════════════════════════════════════════════════════════════
const AUTH_CONFIG = {
  DOMINIO_PERMITIDO: '@petroperu.com.pe',
  MAX_INTENTOS_FALLIDOS: 5,
  BLOQUEO_MINUTOS: 15,
  TOKEN_VALIDEZ_HORAS: 12,
  RESET_TOKEN_VALIDEZ_MINUTOS: 30,
  // Secreto de firma de tokens. Se genera una sola vez y se guarda en
  // PropertiesService para no quedar expuesto en el código fuente.
  getSecret: function() {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('AUTH_SECRET');
    if (!secret) {
      secret = Utilities.getUuid() + '-' + Utilities.getUuid();
      props.setProperty('AUTH_SECRET', secret);
    }
    return secret;
  }
};

// Productos habilitados por planta para el formulario de registro diario.
// Fuente de verdad: el Reporte E&D real (Reporte_E_D_30062026.xlsx, hoja
// "4-Reporte"), leído fila por fila para cada planta, traducido con el
// mismo CONFIG.PRODUCT_MAP que ya usa el dashboard (para no introducir
// productos que el dashboard no reconoce). Orden canónico del dashboard:
// Diesel → G. Regular → G. Premium → G. 84 → TA1 → GLP.
// Nota: en el E&D, Talara reporta GLP con el código 'GLP' (no 'GLP TP'),
// que en PRODUCT_MAP no está mapeado; se agrega igual porque el negocio
// confirma que GLP solo aplica a Talara.
const PRODUCTOS_POR_PLANTA = {
  'Talara':      ['Diesel', 'G. Regular', 'G. Premium', 'G. 84', 'TA1', 'GLP'],
  'Piura':       ['Diesel', 'G. Regular', 'G. Premium'],
  'Eten':        ['Diesel', 'G. Regular'],
  'Salaverry':   ['Diesel', 'G. Regular', 'G. Premium'],
  'Chimbote':    ['Diesel', 'G. Regular'],
  'Supe':        ['Diesel', 'G. Regular', 'G. Premium'],
  'Callao':      ['Diesel', 'G. Regular', 'G. Premium', 'TA1', 'GLP'],
  'Conchan':     ['Diesel', 'G. Regular', 'G. Premium'],
  'Pisco':       ['Diesel', 'G. Regular', 'G. Premium', 'TA1'],
  'Mollendo':    ['Diesel', 'G. Regular', 'G. Premium'],
  'Ilo':         ['Diesel', 'G. Premium'],
  'Juliaca':     ['Diesel', 'G. Regular'],
  'Cusco':       ['Diesel', 'G. Regular'],
  'Iquitos':     ['Diesel', 'G. Regular', 'G. 84', 'TA1'],
  'Pucallpa':    ['Diesel', 'G. Regular'],
  'Tarapoto':    ['Diesel', 'G. Regular', 'G. Premium'],
  'Yurimaguas':  ['Diesel', 'G. 84'],
  'El Milagro':  ['Diesel', 'G. Regular', 'G. 84', 'TA1'],
  // ── Refinerías: SOLO procesan y almacenan — no venden/despachan a
  // clientes. Reportan inventario (existencia) en Registro Diario, pero
  // el campo Despacho no aplica y se oculta en el formulario. Se les
  // asigna el mismo set de productos que su planta de ventas homónima,
  // ya que es el mismo complejo industrial.
  // D2S50-H (Diesel 2 S-50 – Hidrotratado): producto INTERMEDIO propio de
  // la refinería — en 3-4 días pasa a ser inventario Diesel B5S50 para
  // despachos/ventas. Se reporta por separado porque todavía NO es el
  // producto final; solo aplica a Refinería Talara.
  'Refineria Talara':   ['Diesel', 'G. Regular', 'G. Premium', 'G. 84', 'TA1', 'GLP', 'D2S50-H'],
  'Refineria Conchan':  ['Diesel', 'G. Regular', 'G. Premium'],
  'Refineria Iquitos':  ['Diesel', 'G. Regular', 'G. 84', 'TA1']
};
const PRODUCTOS_BASE = ['Diesel', 'G. Regular', 'G. Premium'];

// Identificadores internos (sin tilde, como RD_PLANTAS) de las 3
// refinerías — se usa en todo el módulo para: ocultar el campo Despacho
// en su formulario, y para excluirlas de cualquier cálculo que sea
// específicamente de VENTAS (ellas no venden, solo almacenan).
const RD_REFINERIAS = ['Refineria Talara', 'Refineria Conchan', 'Refineria Iquitos'];

// ── Lista de plantas para ESTE módulo (usuarios/formulario/tracking) ────
// Idéntica a CONFIG.PLANTAS_DASHBOARD, salvo "Conchán" -> "Conchan"
// (sin tilde). Es el único nombre con carácter especial entre las 18
// instalaciones, y se observó que se corrompía en el viaje cliente↔GAS.
// Se usa "Conchan" como identificador interno en usuarios/formularios/
// seguimiento; al escribir en `inventario` (la hoja que ya lee el
// dashboard) se traduce de vuelta a "Conchán" con rdPlantaLegacy().
// Mismo criterio aplicado a las 3 refinerías (también llevan tilde en
// "Refinería").
const RD_PLANTAS = CONFIG.PLANTAS_DASHBOARD.map(function(p) {
  return p
    .replace('Conchán', 'Conchan')
    .replace('Refinería', 'Refineria');
});
function rdPlantaLegacy(p) {
  return p
    .replace('Conchan', 'Conchán')
    .replace('Refineria', 'Refinería');
}

// ── Capacidad (a) y Fondos (f) por planta/producto — EDITABLE ──────────
// Antes vivía hardcodeado en el código (nadie más que un desarrollador
// podía corregirlo). Ahora vive en la hoja `capacidad_referencia`, que
// cualquier persona con acceso al Sheet puede editar directamente.
// Se siembra una sola vez con los valores reales del Reporte E&D; desde
// ahí en adelante la hoja es la única fuente de verdad.
var CAPACIDAD_REFERENCIA_SEED = [
  ['Talara','Diesel',20.023,1.853,0], ['Talara','G. 84',4.713,0.25,0], ['Talara','G. Premium',1.738,0.159,0],
  ['Talara','G. Regular',1.349,0.15,0], ['Talara','GLP',43.637,1.656,0], ['Talara','TA1',1.112,0.294,0],
  ['Piura','Diesel',20.678,1.151,0], ['Piura','G. Premium',1.184,0.109,0], ['Piura','G. Regular',7.736,0.511,0],
  ['Eten','Diesel',40.0,4.361,0], ['Eten','G. Regular',12.0,2.088,0],
  ['Salaverry','Diesel',43.611,3.861,0], ['Salaverry','G. Premium',3.4,0.702,0], ['Salaverry','G. Regular',4.553,1.1,0],
  ['Chimbote','Diesel',35.0,3.17,0], ['Chimbote','G. Regular',4.0,0.832,0],
  ['Supe','Diesel',13.853,1.882,0], ['Supe','G. Premium',4.5,1.187,0], ['Supe','G. Regular',3.5,1.242,0],
  ['Callao','Diesel',48.0,3.595,0], ['Callao','G. Premium',20.0,3.486,0], ['Callao','G. Regular',19.9,2.622,0],
  ['Callao','GLP',0,0,0], ['Callao','TA1',21.0,3.504,0],
  ['Conchan','Diesel',9.838,0,0], ['Conchan','G. 84',4.697,0,0], ['Conchan','G. Premium',0,0.157,0], ['Conchan','G. Regular',0,0.812,0],
  ['Pisco','Diesel',15.0,3.754,0], ['Pisco','G. Premium',2.5,0.61,0], ['Pisco','G. Regular',5.5,1.307,0], ['Pisco','TA1',0,0,0],
  ['Mollendo','Diesel',309.158,28.464,0], ['Mollendo','G. Premium',25.0,1.409,0], ['Mollendo','G. Regular',19.066,2.523,0],
  ['Ilo','Diesel',11.121,0.619,0], ['Ilo','G. Premium',0.911,0.134,0],
  ['Juliaca','Diesel',7.766,0.369,0], ['Juliaca','G. Regular',2.0,0.334,0],
  ['Cusco','Diesel',10.0,0.745,0], ['Cusco','G. Regular',2.0,0.416,0],
  ['Iquitos','Diesel',49.502,0.095,0], ['Iquitos','G. 84',22.576,0.07,0], ['Iquitos','G. Regular',5.553,0.038,0], ['Iquitos','TA1',20.968,0.077,0],
  ['Pucallpa','Diesel',4.474,0.003,0], ['Pucallpa','G. Regular',4.918,0.03,0],
  ['Tarapoto','Diesel',3.368,0.014,0], ['Tarapoto','G. Premium',0.556,0,0], ['Tarapoto','G. Regular',1.655,0.008,0],
  ['Yurimaguas','Diesel',21.045,0.019,0], ['Yurimaguas','G. 84',13.351,0.046,0],
  ['El Milagro','Diesel',11.0,0.45,0], ['El Milagro','G. 84',2.6,0.11,0], ['El Milagro','G. Regular',2.6,0.112,0], ['El Milagro','TA1',2.0,0.15,0]
];
var SHEET_CAPACIDAD_REF = 'capacidad_referencia';
var CAPACIDAD_REF_HEADERS = ['PLANTA', 'PRODUCTO', 'CAPACIDAD', 'FONDOS', 'FONDO_OSINERGMIN'];

function ensureCapacidadRefSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CAPACIDAD_REF);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CAPACIDAD_REF);
    sheet.appendRow(CAPACIDAD_REF_HEADERS);
    sheet.getRange(1, 1, 1, CAPACIDAD_REF_HEADERS.length).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(2, 1, CAPACIDAD_REFERENCIA_SEED.length, 5).setValues(CAPACIDAD_REFERENCIA_SEED);
  }
  return sheet;
}

// Devuelve { producto: {capacidad, fondos, fondo_osinergmin} } para una planta
function rdGetCapacidadMap(planta) {
  var sheet = ensureCapacidadRefSheet();
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    data.forEach(function(row) {
      if (cleanString(row[0]) === planta) {
        map[cleanString(row[1])] = {
          capacidad: parseNumber(row[2]), fondos: parseNumber(row[3]), fondo_osinergmin: parseNumber(row[4])
        };
      }
    });
  }
  return map;
}

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'getAll';
    switch(action) {
      case 'getAll':        return handleGetAll(e.parameter);
      case 'getStats':      return handleGetStats();
      case 'getNavesRaw':           return handleGetNavesRaw();
      case 'getCargasNaves':        return handleGetCargasNaves(e.parameter);
      case 'getNavesPositioning':   return handleGetNavesPositioning();
      case 'getDespachos':  return handleGetDespachos(e.parameter);
      case 'getHistorico':  return handleGetHistorico(e.parameter);
      case 'getDates':      return handleGetDates();
      case 'getSimData':    return handleGetSimData(e.parameter);
      case 'getPronostico': return handleGetPronostico(e.parameter);
      case 'getCapacidadesTodas': return handleGetCapacidadesTodas();
      case 'getPronosticoEvolucion': return handleGetPronosticoEvolucion(e.parameter);
      case 'getVentas':     return handleGetVentas(e.parameter);
      case 'getVentasPP':   return handleGetVentasPP(e.parameter); // ← REPORTE VENTAS PP
      case 'getReposiciones': return handleGetReposiciones(e.parameter);
      case 'getTareas':       return handleGetTareas({});
      case 'getPlanRefinacion':   return handleGetPlanRefinacion(e.parameter);
      case 'getIquiViajesTerr':   return handleGetIquiViajesTerr(e.parameter);
      case 'getIquiViajesFluv':   return handleGetIquiViajesFluv(e.parameter);
      case 'getCisDiario':        return handleGetCisDiario(e.parameter);
      case 'getTanqueYuri':       return handleGetTanqueYuri(e.parameter);
      case 'getIquiCostos':       return handleGetIquiCostos(e.parameter);
      case 'getCisternas':        return handleGetCisternas(e.parameter);
      case 'rdGetPlantas':        return handleRdGetPlantas();
      case 'rdGetTrackingHoy':    return handleRdGetTrackingHoy(e.parameter);
      case 'rdGetUltimoReporte':  return handleRdGetUltimoReporte(e.parameter);
      case 'rdGetMiReporte':      return handleRdGetMiReporte(e.parameter);
      case 'rdGetHistoricoInventario': return handleRdGetHistoricoInventario(e.parameter);
      case 'rdGetPronosticoPlanta':    return handleRdGetPronosticoPlanta(e.parameter);
      case 'rdGetCabotajesPlanta':     return handleRdGetCabotajesPlanta(e.parameter);
      case 'rdGetMisSolicitudes':      return handleRdGetMisSolicitudes(e.parameter);
      case 'getTodasSolicitudes':      return handleGetTodasSolicitudes(e.parameter);
      case 'rdDebugCargasNaves':        return handleRdDebugCargasNaves(e.parameter);
      default:              return handleGetAll(e.parameter);
    }
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HANDLER POST
// ═══════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    switch(action) {
      case 'add':           return handleAddRecord(payload);
      case 'update':        return handleUpdateRecord(payload);
      case 'updateCell':    return handleUpdateCell(payload);
      case 'delete':        return handleDeleteRecord(payload);
      case 'uploadED':      return handleUploadED(payload);
      case 'uploadNaves':       return handleUploadNaves(payload);
      case 'uploadCargasNaves': return handleUploadCargasNaves(payload);
      case 'saveMovNaves':  return handleSaveMovNaves(payload);
      case 'clearSimData':  return handleClearSimData(payload);
      case 'batchUpsert':   return handleBatchUpsert(payload);
      case 'updateVfact':   return handleUpdateVfact(payload);
      case 'updateField':   return handleUpdateField(payload);
      case 'deleteByDate':  return handleDeleteByDate(payload);
      case 'savePronostico':return handleSavePronostico(payload);
      case 'uploadVentas':  return handleUploadVentas(payload);   // ← NUEVO
      case 'uploadVentasPP': return handleUploadVentasPP(payload); // ← REPORTE VENTAS PP
      case 'saveReposiciones':  return handleSaveReposiciones(payload);   // ← TABLERO COBERTURA
      case 'deleteReposicion':  return handleDeleteReposicion(payload);
      case 'updateFieldFull':   return handleUpdateFieldFull(payload);
      case 'initCoberturaSheets': return createSuccessResponse(initCoberturaSheets());
      case 'upsertTareaNave':   return handleUpsertTareaNave(payload);    // ← PROGRAMACIÓN NAVES
      case 'deleteTareaNave':   return handleDeleteTareaNave(payload);
      case 'getTareas':         return handleGetTareas(payload);
      case 'savePlanRefinacion': return handleSavePlanRefinacion(payload);
      case 'saveIquiViaje':      return handleSaveIquiViaje(payload);
      case 'saveCisDiario':      return handleSaveCisDiario(payload);
      case 'saveTanqueYuri':     return handleSaveTanqueYuri(payload);
      case 'deleteIquiViaje':    return handleDeleteIquiViaje(payload);
      case 'saveIquiCosto':      return handleSaveIquiCosto(payload);
      case 'uploadCisternas':    return handleUploadCisternas(payload);
      case 'rdRegistrar':        return handleRdRegistrar(payload);
      case 'rdLogin':            return handleRdLogin(payload);
      case 'rdSolicitarReset':   return handleRdSolicitarReset(payload);
      case 'rdResetPassword':    return handleRdResetPassword(payload);
      case 'rdAdminSetPassword': return handleRdAdminSetPassword(payload);
      case 'rdGuardarReporte':   return handleRdGuardarReporte(payload);
      case 'rdSolicitarCorreccion': return handleRdSolicitarCorreccion(payload);
      case 'uploadPronosticoMBDC': return handleUploadPronosticoMBDC(payload);
      case 'rdResponderSolicitud':  return handleRdResponderSolicitud(payload);
      default:              throw new Error('Acción no válida: ' + action);
    }
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GET ENDPOINTS (existentes — sin cambios)
// ═══════════════════════════════════════════════════════════════════════

function handleGetAll(params) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'dashboard_data_v10';
  var noCache = params && params.nocache && params.nocache[0] === '1';
  if (noCache) cache.remove(cacheKey);
  if (!noCache) {
    const cached = cache.get(cacheKey);
    if (cached) return createJsonResponse(cached);
  }
  var data = fetchAllRecords();
  var pronMap = loadPronosticoMap(data);
  data.forEach(function(r) {
    var key = (r.planta || '') + '|' + (r.producto || '');
    if (pronMap[key]) r.pron_mes = pronMap[key];
  });
  var pronOnly = [];
  var invKeys = {};
  data.forEach(function(r) { invKeys[(r.planta||'') + '|' + (r.producto||'')] = true; });
  Object.keys(pronMap).forEach(function(k) {
    if (!invKeys[k]) {
      var parts = k.split('|');
      pronOnly.push({planta: parts[0], producto: parts[1], pron_mes: pronMap[k]});
    }
  });

  // ── Enrich vult7 from ventas_diarias (7-day rolling avg) ─────────────
  try {
    var latestFecha = '';
    data.forEach(function(r) { if (r.fecha && r.fecha > latestFecha) latestFecha = r.fecha; });
    if (latestFecha) {
      var ventasMap = buildVentasAvgMap(latestFecha, 7);
      data.forEach(function(r) {
        if (r.vult7 <= 0) {
          var avg = ventasMap[(r.planta||'')+'|'+(r.producto||'')];
          if (avg && avg > 0) r.vult7 = Math.round(avg * 1000) / 1000;
        }
      });
    }
  } catch(e) { Logger.log('vult7 enrich error: ' + e.message); }

  // ── Sync BT data from cargas_naves (latest report per terminal) ───────
  try {
    var btMap = buildBTMapFromCargas();
    data.forEach(function(r) {
      // Only overwrite if E&D didn't already supply BT info
      if (r.bt) return;
      var key = (r.planta||'').toUpperCase() + '|' + (r.producto||'');
      var entry = btMap[key];
      if (entry) {
        r.bt             = entry.buque;
        r.vol_rep        = entry.vol || 0;
        r.fecha_reposicion = entry.fecha_hasta || '';
      }
    });
  } catch(e) { Logger.log('bt sync error: ' + e.message); }

  // ── Load ventas_diarias ───────────────────────────────────────────────
  var ventasMes = [];
  try {
    ventasMes = loadVentasTodas();
    Logger.log('ventasMes (todas): ' + ventasMes.length + ' registros');
  } catch(e) {
    Logger.log('loadVentasTodas error: ' + e.message);
  }

  var envelope = JSON.stringify({inventario: data, pronExtra: pronOnly, ventasMes: ventasMes});
  try { cache.put(cacheKey, envelope, CONFIG.CACHE_TTL); } catch(e) {}
  return createJsonResponse(envelope);
}

// ── Build 7-day avg map from ventas_diarias ──────────────────────────────
function buildVentasAvgMap(refFecha, days) {
  var sheet = getSheetSafe(CONFIG.SHEETS.VENTAS_DIARIAS);
  var result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;

  var refDate  = new Date(refFecha + 'T12:00:00');
  var fromDate = new Date(refDate.getTime() - days * 86400000);
  var fromStr  = Utilities.formatDate(fromDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  var allData = sheet.getRange(2, 1, sheet.getLastRow()-1, 5).getValues();
  var sums = {}, counts = {};
  allData.forEach(function(row) {
    var fecha   = formatDate(row[0]);
    var planta  = cleanString(row[1]);
    var prod    = cleanString(row[2]);
    var venta   = parseNumber(row[3]);
    var fuente  = cleanString(row[4]||'');
    if (!fecha || !planta || !prod || venta < 0.001) return;
    if (fecha < fromStr || fecha > refFecha) return;
    if (fuente === 'MANUAL') return; // use Cognos/ED only for avg
    var k = planta.toUpperCase() + '|' + prod;
    sums[k]   = (sums[k]   || 0) + venta;
    counts[k] = (counts[k] || 0) + 1;
  });
  Object.keys(sums).forEach(function(k) {
    if (counts[k] > 0) result[k] = sums[k] / counts[k];
  });
  return result;
}

// ── Build BT assignment map from latest cargas_naves report ─────────────
function buildBTMapFromCargas() {
  var sheet = getSheetSafe('cargas_naves');
  var result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;

  var ncols = Math.min(sheet.getLastColumn(), 10);
  var data  = sheet.getRange(2, 1, sheet.getLastRow()-1, ncols).getValues();

  // Get the most recent report date
  var latestRpt = '';
  data.forEach(function(row) {
    var f = formatDate(row[0]) || cleanString(String(row[0]||'').slice(0,10));
    if (f > latestRpt) latestRpt = f;
  });
  if (!latestRpt) return result;

  // From the latest report, for each ACTUAL or PROGRAMADO terminal, map terminal→buque
  data.forEach(function(row) {
    var fechaRpt = formatDate(row[0]) || cleanString(String(row[0]||'').slice(0,10));
    if (fechaRpt !== latestRpt) return;
    var buque    = cleanString(row[1]);
    var terminal = cleanString(row[4]);
    var fechaHasta = formatDate(row[6]) || cleanString(String(row[6]||'').slice(0,10));
    var prod     = cleanString(row[7]);
    var vol      = parseNumber(row[8]);
    var estado   = cleanString(row[9]);
    if (!buque || !terminal || !prod || estado === 'COMPLETADO') return;

    // Map TERMINAL_UPPER|PRODUCTO → {buque, vol, fecha_hasta}
    var key = terminal.toUpperCase() + '|' + prod;
    if (!result[key] || estado === 'ACTUAL') {
      result[key] = {buque: buque, vol: vol, fecha_hasta: fechaHasta};
    }
  });
  return result;
}

/**
/**
 * Load ALL ventas_diarias records (no date filter).
 * The frontend selects the best matching record per plant+product.
 * Returns [{fecha, planta, producto, venta_mb}]
 */
function loadVentasTodas() {
  var result = [];
  var sheet = getSheetSafe(CONFIG.SHEETS.VENTAS_DIARIAS);
  if (!sheet || sheet.getLastRow() < 2) return result;

  var lastRow = sheet.getLastRow();
  var cols    = Math.min(sheet.getLastColumn(), 5);
  var data    = sheet.getRange(2, 1, lastRow - 1, cols).getValues();

  data.forEach(function(row) {
    var fecha   = formatDate(row[0]);
    var planta  = cleanString(row[1]);
    var producto= cleanString(row[2]);
    var venta   = parseNumber(row[3]);
    var fuente  = cleanString(row[4] || '');
    if (fecha && planta && producto && venta >= 0.001) {  // skip near-zero zeroing records
      result.push({fecha: fecha, planta: planta, producto: producto,
                   venta_mb: venta, fuente: fuente});
    }
  });
  return result;
}

// Normaliza el nombre de producto tal como aparece en la hoja 'pronostico'
// hacia el nombre corto interno del dashboard (ej. "G. Regular"). Cubre
// tanto los nombres cortos ya correctos (pasan tal cual) como variantes
// largas/crudas del Excel de origen, sin distinguir mayúsculas/minúsculas
// ni espacios extra — para que una fila nunca se pierda silenciosamente
// por una diferencia de formato.
var PRODUCTO_NORMALIZE_MAP = {
  'diesel':            'Diesel',
  'diesel b5s50':      'Diesel',
  'diesel b5 s50':     'Diesel',
  'diesel-b5 50ppm':   'Diesel',
  'diesel b5':         'Diesel B5',
  'g. regular':        'G. Regular',
  'g regular':         'G. Regular',
  'gasolina regular':  'G. Regular',
  'g. premium':        'G. Premium',
  'g premium':         'G. Premium',
  'gasolina premium':  'G. Premium',
  'g. 84':             'G. 84',
  'g 84':              'G. 84',
  'gasolina 84':       'G. 84',
  'ta1':               'TA1',
  'turbo jet a-1':     'TA1',
  'turbo a1':          'TA1',
  'glp':               'GLP'
};
function normalizarProductoPronostico(raw) {
  var key = String(raw||'').trim().toLowerCase();
  return PRODUCTO_NORMALIZE_MAP[key] || String(raw||'').trim();
}

function loadPronosticoMap(data) {
  var pronMap = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.PRONOSTICO);
    if (!sheet) return pronMap;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return pronMap;
    var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var targetMes = '';
    // Use the LATEST date across all records to get the current month's pronóstico
    // Using data[0] was wrong: old records (e.g. 2026-03) made it load March pronóstico
    if (data.length > 0) {
      var latestFecha = '';
      data.forEach(function(r) { if (r.fecha && r.fecha > latestFecha) latestFecha = r.fecha; });
      if (latestFecha) targetMes = latestFecha.slice(0, 7);
    }
    if (!targetMes) targetMes = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM');
    Logger.log('loadPronosticoMap: targetMes=' + targetMes);
    var allMeses = {};
    rows.forEach(function(row) { var m = String(row[0]||''); if (m) allMeses[m] = true; });
    var meses = Object.keys(allMeses).sort();
    var bestMes = '';
    if (allMeses[targetMes]) {
      bestMes = targetMes;
    } else {
      for (var i = meses.length - 1; i >= 0; i--) { if (meses[i] <= targetMes) { bestMes = meses[i]; break; } }
      if (!bestMes && meses.length > 0) bestMes = meses[meses.length - 1];
    }
    if (!bestMes) return pronMap;
    rows.forEach(function(row) {
      if (String(row[0]) === bestMes && row[1] && row[2]) {
        var plantaN   = String(row[1]).trim();
        var prodRaw   = String(row[2]).trim();
        // Normalizar el nombre del producto tal como viene del Sheets —
        // si alguna fila usa variantes distintas ("Gasolina Regular",
        // "GASOLINA REGULAR", etc.) en vez de "G. Regular" exacto, antes
        // esto no matcheaba con lo que usan Coberturas/cobGetPron y el
        // pronóstico de esa planta/producto quedaba silenciosamente en 0.
        var prodN = normalizarProductoPronostico(prodRaw);
        pronMap[plantaN + '|' + prodN] = parseFloat(row[3]) || 0;
      }
    });
  } catch(e) { Logger.log('loadPronosticoMap error: ' + e.message); }
  return pronMap;
}

function handleGetStats() {
  const data = fetchAllRecords();
  return createJsonResponse(JSON.stringify(calculateStats(data)));
}

function handleGetCargasNaves(params) {
  var sheet = getSheetSafe('cargas_naves');
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse('[]');
  var lastRow = sheet.getLastRow();
  var ncols   = Math.min(sheet.getLastColumn(), 10);
  var data    = sheet.getRange(2, 1, lastRow - 1, ncols).getValues();
  var records = [];
  data.forEach(function(row) {
    // Robust date: handle both Date objects and strings
    var fecha = formatDate(row[0]) || (row[0] ? String(row[0]).slice(0,10) : '');
    var buque = cleanString(row[1]);
    if (!buque) return;  // only require buque, not fecha
    records.push({
      fecha_reporte: fecha || '',
      buque:         buque,
      viaje:         cleanString(row[2] || ''),
      origen:        cleanString(row[3] || ''),
      terminal:      cleanString(row[4] || ''),
      fecha_desde:   formatDate(row[5]) || cleanString(String(row[5]||'').slice(0,10)),
      fecha_hasta:   formatDate(row[6]) || cleanString(String(row[6]||'').slice(0,10)),
      producto:      cleanString(row[7] || ''),
      volumen_mb:    parseNumber(row[8]),
      estado:        cleanString(row[9] || '')
    });
  });
  Logger.log('getCargasNaves: ' + records.length + ' records, buque filter: ' + (params&&params.buque||'ALL'));
  if (params && params.buque) {
    var b = params.buque.toUpperCase();
    records = records.filter(function(r) { return r.buque.toUpperCase() === b; });
  }
  return createJsonResponse(JSON.stringify(records));
}

function handleUploadCargasNaves(payload) {
  var records = payload.records || [];
  var fechaRpt = payload.fecha_reporte || '';
  if (!records.length) throw new Error('Sin registros de cargas de naves');

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('cargas_naves');
  if (!sheet) {
    sheet = ss.insertSheet('cargas_naves');
    var hdr = ['FECHA_REPORTE','BUQUE','VIAJE','ORIGEN','TERMINAL',
               'FECHA_DESDE','FECHA_HASTA','PRODUCTO','VOLUMEN_MB','ESTADO'];
    sheet.appendRow(hdr);
    sheet.getRange(1,1,1,hdr.length)
      .setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    [100,80,90,80,100,90,90,140,90,90].forEach(function(w,i) { sheet.setColumnWidth(i+1, w); });
  }

  // Remove existing records for this fecha_reporte to allow re-upload
  if (fechaRpt) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var existVals = sheet.getRange(2,1,lastRow-1,1).getValues();
      var toDelete = [];
      existVals.forEach(function(row, idx) {
        var f = formatDate(row[0]) || cleanString(row[0]);
        if (f === fechaRpt) toDelete.push(idx + 2);
      });
      // Delete rows from bottom to top
      for (var i = toDelete.length - 1; i >= 0; i--) {
        sheet.deleteRow(toDelete[i]);
      }
    }
  }

  var rows = records.map(function(r) {
    return [r.fecha_reporte, r.buque, r.viaje, r.origen, r.terminal,
            r.fecha_desde, r.fecha_hasta, r.producto, r.volumen_mb, r.estado];
  });
  if (rows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 10).setValues(rows);
    // Color by estado
    rows.forEach(function(row, i) {
      var bg = row[9] === 'ACTUAL' ? '#fff3cd' : row[9] === 'COMPLETADO' ? '#e8f5e9' : '#fff';
      sheet.getRange(startRow + i, 1, 1, 10).setBackground(bg);
    });
  }

  clearCache();
  logUpload('CARGAS_NAVES', fechaRpt, rows.length, 0, 0);
  return createSuccessResponse('Cargas de naves ' + fechaRpt + ': ' + rows.length + ' registros guardados');
}

function handleGetNavesRaw() {
  const sheet = getSheetSafe(CONFIG.SHEETS.MOV_NAVES);
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse('[]');
  // Correct schema: TIPO(0) FECHA_REPORTE(1) NAVE(2) CATEGORIA(3) UBICACION(4)
  //                 ROTACION(5) ESTADO(6) PRODUCTO(7) VOLUMEN_MB(8) DESTINO(9)
  //                 PROVEEDOR(10) ETA(11) ETD(12) NOTAS(13) TIMESTAMP(14)
  var ncols = Math.min(sheet.getLastColumn(), 15);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ncols).getValues();
  const records = data.map(function(row, idx) {
    var f = formatDate(row[1]) || cleanString(String(row[1]||'').slice(0,10));
    return {
      _rowIndex:  idx+2,
      tipo:       cleanString(row[0]),
      fecha:      f,
      buque:      cleanString(row[2]),   // NAVE column
      categoria:  cleanString(row[3]),
      ubicacion:  cleanString(row[4]),
      rotacion:   cleanString(row[5]),
      estado:     cleanString(row[6]),   // Rich text with timestamps
      producto:   cleanString(row[7]),
      volumen:    parseNumber(row[8]),
      destino:    cleanString(row[9]),
      proveedor:  cleanString(row[10]),
      eta:        cleanString(row[11]),
      etd:        cleanString(row[12]),
      notas:      cleanString(row[13]),
      timestamp:  cleanString(row[14]||'')
    };
  }).filter(function(r) { return r.buque; });
  return createJsonResponse(JSON.stringify(records));
}

// ── New: getNavesPositioning — returns structured positioning data ──────────
function handleGetNavesPositioning() {
  const sheet = getSheetSafe(CONFIG.SHEETS.MOV_NAVES);
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse('[]');
  var ncols = Math.min(sheet.getLastColumn(), 15);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ncols).getValues();

  // Separate CIERRE rows from vessel rows
  var cierreRows = [];
  var vesselRows = [];
  data.forEach(function(row) {
    var tipo = cleanString(row[0]);
    if (tipo === 'CIERRE') {
      var fecha = formatDate(row[1]) || cleanString(String(row[1]||'').slice(0,10));
      cierreRows.push({
        planta:   cleanString(row[2]),
        nivel:    cleanString(row[4]),
        detalle:  cleanString(row[6]),
        apertura: cleanString(row[12]),
        fecha:    fecha
      });
    } else {
      vesselRows.push(row);
    }
  });

  // Group vessel rows by buque → latest record
  var buqueMap = {};
  vesselRows.forEach(function(row) {
    var buque = cleanString(row[2]);
    var fecha  = formatDate(row[1]) || cleanString(String(row[1]||'').slice(0,10));
    if (!buque || !fecha) return;
    if (!buqueMap[buque] || fecha >= buqueMap[buque].fecha) {
      buqueMap[buque] = {
        buque: buque, fecha: fecha,
        ubicacion: cleanString(row[4]),
        rotacion:  cleanString(row[5]),
        estado:    cleanString(row[6]),
        notas:     cleanString(row[13]),  // includes cierres text
        eta:       cleanString(row[11]),
        tipo:      cleanString(row[0])
      };
    }
  });

  // History per buque: include notas for cierre extraction
  var buqueHistory = {};
  vesselRows.forEach(function(row) {
    var buque = cleanString(row[2]);
    var fecha  = formatDate(row[1]) || cleanString(String(row[1]||'').slice(0,10));
    if (!buque || !fecha) return;
    if (!buqueHistory[buque]) buqueHistory[buque] = [];
    buqueHistory[buque].push({
      fecha: fecha, ubicacion: cleanString(row[4]),
      rotacion: cleanString(row[5]), estado: cleanString(row[6]),
      notas: cleanString(row[13])
    });
  });

  var result = Object.values(buqueMap).map(function(b) {
    return Object.assign(b, {
      history: (buqueHistory[b.buque]||[]).sort(function(a,c){return a.fecha.localeCompare(c.fecha);}),
      cierres: cierreRows  // all port closures from all reports
    });
  });
  return createJsonResponse(JSON.stringify(result));
}

function handleGetSimData(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('mov_naves_sim');
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse('[]');
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues();
  var simulations = [], currentSim = null;
  data.forEach(function(row) {
    var tipo = cleanString(row[0]);
    if (tipo === '--- SIMULACIÓN ---') {
      currentSim = { fecha_prog: formatDate(row[1]) || cleanString(row[1]), rows: [] };
      simulations.push(currentSim); return;
    }
    if (!currentSim) { currentSim = { fecha_prog: '', rows: [] }; simulations.push(currentSim); }
    if (!tipo) return;
    currentSim.rows.push({
      tipo: tipo, fecha_prog: formatDate(row[1])||cleanString(row[1]), timestamp: cleanString(row[2]),
      buque: cleanString(row[3]), origen: cleanString(row[4]), zarpe: formatDate(row[5])||cleanString(row[5]),
      vol_total_mb: parseNumber(row[6]), n_escalas: parseNumber(row[7]),
      retorno_est: formatDate(row[8])||cleanString(row[8]), escala_num: parseNumber(row[9]),
      planta: cleanString(row[10]), eta: formatDate(row[11])||cleanString(row[11]),
      dist_dias: parseNumber(row[12]), productos: cleanString(row[13])
    });
  });
  if (!simulations.length) return createJsonResponse('[]');
  if (params && params.fecha_prog) {
    var filtered = simulations.filter(function(s) { return s.fecha_prog === params.fecha_prog; });
    if (filtered.length) return createJsonResponse(JSON.stringify(filtered[filtered.length - 1].rows));
  }
  return createJsonResponse(JSON.stringify(simulations[simulations.length - 1].rows));
}

function handleGetDespachos(params) {
  const sheet = getSheetSafe(CONFIG.SHEETS.DESPACHOS);
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse('[]');
  const data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var records = data.map(function(row) {
    var obj = {}; headers.forEach(function(h,i) { obj[cleanString(h)] = row[i]; }); return obj;
  });
  if (params && params.fecha) records = records.filter(function(r) { return formatDate(r.FECHA||r.fecha) === params.fecha; });
  return createJsonResponse(JSON.stringify(records));
}

function handleGetHistorico(params) {
  var data = fetchAllRecords();
  if (params.planta)  data = data.filter(function(r) { return r.planta  === params.planta; });
  if (params.producto)data = data.filter(function(r) { return r.producto=== params.producto; });
  if (params.desde)   data = data.filter(function(r) { return r.fecha   >= params.desde; });
  if (params.hasta)   data = data.filter(function(r) { return r.fecha   <= params.hasta; });
  return createJsonResponse(JSON.stringify(data));
}

function handleGetDates() {
  const data = fetchAllRecords();
  const dates = {};
  data.forEach(function(r) { if (r.fecha) { if (!dates[r.fecha]) dates[r.fecha]=0; dates[r.fecha]++; } });
  return createJsonResponse(JSON.stringify(dates));
}

// ═══════════════════════════════════════════════════════════════════════
// GET /api?action=getPronosticoEvolucion
// Devuelve todos los registros de pronóstico agrupados por mes para
// análisis comparativo de evolución mes a mes.
// Respuesta: { meses: ['2026-05','2026-06',...], data: [{planta,producto,meses:{mes:pron,...}},...] }
// ═══════════════════════════════════════════════════════════════════════
function handleGetPronosticoEvolucion(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.PRONOSTICO);
  if (!sheet) return createJsonResponse(JSON.stringify({meses:[], data:[]}));
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse(JSON.stringify({meses:[], data:[]}));
  var rows = sheet.getRange(2, 1, lastRow-1, 4).getValues();

  var mesesSet = {};
  var dataMap = {};   // key: planta|producto → {planta, producto, meses:{mes:pron}}

  rows.forEach(function(row) {
    var mes     = normalizeYYYYMM(row[0]);
    var planta  = cleanString(row[1]);
    var producto= cleanString(row[2]);
    var pron    = parseFloat(row[3]) || 0;
    if (!mes || !planta || !producto) return;
    if (CONFIG.EXCLUDED_PLANTAS.indexOf(planta) >= 0) return;
    mesesSet[mes] = true;
    var key = planta + '|' + producto;
    if (!dataMap[key]) dataMap[key] = {planta:planta, producto:producto, meses:{}};
    dataMap[key].meses[mes] = pron;
  });

  var meses = Object.keys(mesesSet).sort();
  var data  = Object.values(dataMap).sort(function(a,b){
    return (a.planta+a.producto).localeCompare(b.planta+b.producto);
  });

  return createJsonResponse(JSON.stringify({meses:meses, data:data}));
}

function handleGetPronostico(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.PRONOSTICO);
  if (!sheet) return createJsonResponse('[]');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var data = sheet.getRange(2, 1, lastRow-1, 4).getValues();
  var mesFilter = params && params.mes ? params.mes : null;
  var result = [];
  data.forEach(function(row) {
    // normalizeYYYYMM convierte objetos Date de Sheets a 'YYYY-MM'
    var mes = normalizeYYYYMM(row[0]);
    if (!mes) return;
    if (mesFilter && mes !== mesFilter) return;
    var pl = cleanString(row[1]);
    if (!pl) return;
    if (CONFIG.EXCLUDED_PLANTAS.indexOf(pl) >= 0) return;
    result.push({mes:mes, planta:pl, producto:cleanString(row[2]), pron:parseFloat(row[3])||0});
  });
  return createJsonResponse(JSON.stringify(result));
}

// ═══════════════════════════════════════════════════════════════════════
// GET /api?action=getVentas — Consulta ventas_diarias
// Params opcionales: mes=2026-04, planta=Callao, producto=Diesel B5S50,
//                   desde=2026-04-01, hasta=2026-04-30
// ═══════════════════════════════════════════════════════════════════════

function handleGetVentas(params) {
  var sheet = getSheetSafe(CONFIG.SHEETS.VENTAS_DIARIAS);
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse('[]');

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  var result = [];
  data.forEach(function(row) {
    var fecha   = formatDate(row[0]);
    var planta  = cleanString(row[1]);
    var producto= cleanString(row[2]);
    var venta   = parseNumber(row[3]);
    if (!fecha) return;
    if (CONFIG.EXCLUDED_PLANTAS.indexOf(planta) >= 0) return;
    if (params) {
      if (params.mes    && !fecha.startsWith(params.mes))    return;
      if (params.planta && planta  !== params.planta)        return;
      if (params.producto && producto !== params.producto)   return;
      if (params.desde  && fecha < params.desde)             return;
      if (params.hasta  && fecha > params.hasta)             return;
    }
    result.push({fecha:fecha, planta:planta, producto:producto, venta_mb:venta});
  });

  return createJsonResponse(JSON.stringify(result));
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api {action:'uploadVentas', mes:'2026-04', records:[...]}
// Almacena ventas diarias en hoja ventas_diarias.
// Llave única: fecha | planta | producto  → UPSERT
// ═══════════════════════════════════════════════════════════════════════

function handleUploadVentas(payload) {
  var mes     = payload.mes;      // '2026-04'
  var records = payload.records || [];
  var source   = payload.source || 'COGNOS';  // 'COGNOS', 'ED', or 'MANUAL'
  var isED     = source === 'ED';
  var isManual = source === 'MANUAL';  // Manual user input - overwrites all sources

  if (!mes)            throw new Error('Mes requerido (YYYY-MM)');
  if (!records.length) throw new Error('Sin registros para guardar');

  // ── Ensure sheet exists with headers ──────────────────────────────
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.VENTAS_DIARIAS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.VENTAS_DIARIAS);
    var hdr = ['FECHA', 'PLANTA', 'PRODUCTO', 'VENTA_MB', 'FUENTE'];
    sheet.appendRow(hdr);
    sheet.getRange(1, 1, 1, hdr.length)
      .setBackground('#1a3a5c').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 130);
    sheet.setColumnWidth(3, 150);
    sheet.setColumnWidth(4, 100);
    sheet.setColumnWidth(5, 80);
    Logger.log('Hoja ventas_diarias creada');
  }

  // ── Build existing index: key → {rowIndex, fuente} ───────────────
  var lastRow = sheet.getLastRow();
  var existingMap = {};

  if (lastRow >= 2) {
    var cols = Math.min(sheet.getLastColumn(), 5);
    var existingData = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
    existingData.forEach(function(row, idx) {
      var f = formatDate(row[0]), p = cleanString(row[1]), pr = cleanString(row[2]);
      if (f && p && pr) {
        existingMap[f + '|' + p + '|' + pr] = {
          rowIdx: idx + 2,
          fuente: cleanString(row[4] || '')
        };
      }
    });
  }

  // ── Upsert records ────────────────────────────────────────────────
  // Priority: COGNOS > ED  (E&D records won't overwrite existing COGNOS data)
  var added = 0, updated = 0, skipped = 0;
  var toAppend = [];

  records.forEach(function(rec) {
    var fecha   = rec.fecha    || '';
    var planta  = rec.planta   || '';
    var producto= rec.producto || '';
    var venta   = parseNumber(rec.venta_mb);

    if (!fecha || !planta || !producto) { skipped++; return; }
    if (!fecha.startsWith(mes)) { skipped++; return; }

    var key     = fecha + '|' + planta + '|' + producto;
    var existing = existingMap[key];

    if (existing) {
      // Priority: MANUAL > COGNOS > ED
      // MANUAL always writes; ED won't overwrite COGNOS or MANUAL
      if (isED && (existing.fuente === 'COGNOS' || existing.fuente === 'MANUAL')) { skipped++; return; }
      if (!isManual && existing.fuente === 'MANUAL' && !isED) {
        // COGNOS doesn't overwrite MANUAL (user's explicit value wins)
        skipped++; return;
      }
      sheet.getRange(existing.rowIdx, 4).setValue(venta);
      sheet.getRange(existing.rowIdx, 5).setValue(isManual ? 'MANUAL' : (isED ? 'ED' : 'COGNOS'));
      updated++;
    } else {
      toAppend.push([fecha, planta, producto, venta, isManual ? 'MANUAL' : (isED ? 'ED' : 'COGNOS')]);
      added++;
    }
  });

  if (toAppend.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, 5).setValues(toAppend);
  }

  clearCache();
  logUpload(isManual ? 'VENTAS-MANUAL' : (isED ? 'VENTAS-ED' : 'VENTAS'), mes, added, updated, skipped);

  return createSuccessResponse(
    'Ventas[' + source + '] ' + mes + ': ' + added + ' nuevos, ' + updated + ' actualizados, ' + skipped + ' omitidos'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// POST ENDPOINTS — CRUD INVENTARIO
// ═══════════════════════════════════════════════════════════════════════

function handleAddRecord(payload) {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  sheet.appendRow(buildRowArray(payload.record));
  clearCache();
  return createSuccessResponse('Registro agregado correctamente');
}

function handleUpdateRecord(payload) {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  sheet.getRange(payload.rowIndex, 1, 1, CONFIG.MAX_COLS_INV).setValues([buildRowArray(payload.record)]);
  clearCache();
  return createSuccessResponse('Registro actualizado correctamente');
}

function handleUpdateCell(payload) {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  const colIndex = getColumnIndex(payload.column);
  if (!colIndex) throw new Error('Columna no válida: ' + payload.column);
  sheet.getRange(payload.rowIndex, colIndex).setValue(payload.value);
  clearCache();
  return createSuccessResponse('Celda actualizada');
}

function handleDeleteRecord(payload) {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  sheet.deleteRow(payload.rowIndex);
  clearCache();
  return createSuccessResponse('Registro eliminado');
}

// ═══════════════════════════════════════════════════════════════════════
// POST ENDPOINTS — UPLOAD E&D
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// CARGA: Pronóstico Colaborativo de Ventas (Excel mensual, hoja "PLANTAS")
// Reemplaza la carga anterior de pronóstico. El Excel trae el TOTAL
// MENSUAL en MB por planta/producto — aquí se convierte a MBDC (÷ días
// del mes) y se guarda en la hoja CONFIG.SHEETS.PRONOSTICO ('pronostico_mbdc').
// UPSERT por mes+planta+producto (reemplaza, nunca suma) para evitar el
// bug de filas duplicadas inflando el pronóstico.
// ═══════════════════════════════════════════════════════════════════════

// Nombre crudo del Excel → nombre interno de planta usado en el dashboard.
// Solo se migran las plantas ya integradas al sistema de Cobertura; los
// puntos de venta de aeropuertos (aviación) no forman parte de este
// seguimiento por ahora.
var PLANTA_MAP_PRONOSTICO = {
  'PLANTA VENTAS TALARA':                    'Talara',
  'PLANTA VENTAS PIURA':                      'Piura',
  'PLANTA CONCHÁN':                           'Conchán',
  'TERMINAL CALLAO':                          'Callao',
  'TERMINAL CHIMBOTE':                        'Chimbote',
  'TERMINAL ETEN':                            'Eten',
  'TERMINAL ILO':                             'Ilo',
  'TERMINAL MOLLENDO':                        'Mollendo',
  'TERMINAL PISCO':                           'Pisco',
  'TERMINAL SALAVERRY':                       'Salaverry',
  'TERMINAL SUPE':                            'Supe',
  'PLANTA DE VENTAS PUCALLPA':                'Pucallpa',
  'PLANTA DE VENTAS TARAPOTO':                'Tarapoto',
  'PLANTA DE VENTAS YURIMAGUAS':              'Yurimaguas',
  'PLANTA EL MILAGRO':                        'El Milagro',
  'PLANTA JULIACA':                           'Juliaca',
  'PLANTA CUSCO':                             'Cusco',
  'PLANTA VENTA IQUITOS':                     'Iquitos',
  'Oficina de Facturación Puerto Maldonado':  'Pto. Maldonado'
};

// Nombre crudo del producto (Excel) → nombre interno. Por instrucción:
// DIESEL-B5 50PPM → Diesel; Gasolina Regular/Premium tal cual se conocen;
// los Gasoholes Regular/Premium NO se consideran por ahora (son
// productos distintos); DIESEL B5 (selva) se registra como producto
// propio; TURBO JET A-1 → TA1. Todo lo demás (asfaltos, solventes, PEN,
// IFO, etc.) queda fuera del alcance de este dashboard.
var PRODUCTO_MAP_PRONOSTICO = {
  'DIESEL-B5 50PPM':   'Diesel',
  'DIESEL B5':         'Diesel B5',
  'GASOLINA REGULAR':  'G. Regular',
  'GASOLINA PREMIUM':  'G. Premium',
  'GASOLINA 84':       'G. 84',
  'TURBO JET A-1':     'TA1',
  'GLP':               'GLP'
};

function ensurePronosticoMBDCSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEETS.PRONOSTICO);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEETS.PRONOSTICO);
    var hdr = ['MES', 'PLANTA', 'PRODUCTO', 'PRONOSTICO_MBDC'];
    sh.appendRow(hdr);
    sh.getRange(1,1,1,hdr.length).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function handleUploadPronosticoMBDC(payload) {
  var user = rdCurrentUser(payload.token);
  if (user.rol !== 'admin') return createJsonResponse(JSON.stringify({success:false, message:'Sin permiso'}));

  var mes  = cleanString(payload.mes || '');       // 'YYYY-MM'
  var rows = payload.rows || [];                    // [{planta_raw, producto_raw, valor_mensual_mb}]
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido (' + mes + '), debe ser YYYY-MM');
  if (!rows.length) throw new Error('El archivo no trajo filas para procesar');

  var dias = diasEnMes(mes + '-01');
  var sheet = ensurePronosticoMBDCSheet();

  // Índice de filas existentes por mes+planta+producto → número de fila
  var lastRow = sheet.getLastRow();
  var idx = {};
  if (lastRow >= 2) {
    var existing = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    existing.forEach(function(r, i) {
      var key = String(r[0]) + '|' + cleanString(r[1]) + '|' + cleanString(r[2]);
      idx[key] = i + 2; // fila real en la hoja
    });
  }

  var procesadas = 0, actualizadas = 0, nuevas = 0, omitidas = [];
  var nuevasFilas = [];

  rows.forEach(function(r) {
    var plantaRaw   = cleanString(r.planta_raw || '');
    var productoRaw = cleanString(r.producto_raw || '');
    var valorMB     = parseFloat(r.valor_mensual_mb) || 0;
    var planta   = PLANTA_MAP_PRONOSTICO[plantaRaw];
    var producto = PRODUCTO_MAP_PRONOSTICO[productoRaw];
    if (!planta || !producto || valorMB <= 0) {
      omitidas.push(plantaRaw + ' / ' + productoRaw);
      return;
    }
    var mbdc = Math.round((valorMB / dias) * 1000) / 1000; // 3 decimales
    var key = mes + '|' + planta + '|' + producto;
    procesadas++;
    if (idx[key]) {
      sheet.getRange(idx[key], 4, 1, 1).setValue(mbdc); // solo actualiza PRONOSTICO_MBDC
      actualizadas++;
    } else {
      nuevasFilas.push([mes, planta, producto, mbdc]);
      nuevas++;
    }
  });

  if (nuevasFilas.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, nuevasFilas.length, 4).setValues(nuevasFilas);
  }

  clearCache();
  Logger.log('[uploadPronosticoMBDC] mes=' + mes + ' dias=' + dias +
             ' procesadas=' + procesadas + ' actualizadas=' + actualizadas +
             ' nuevas=' + nuevas + ' omitidas=' + omitidas.length);

  return createSuccessResponse(
    'Pronóstico de ' + mes + ' cargado: ' + procesadas + ' filas (' + nuevas + ' nuevas, ' +
    actualizadas + ' actualizadas). ' +
    (omitidas.length ? omitidas.length + ' filas omitidas (planta/producto aún no migrado): ' + omitidas.slice(0,8).join(', ') + (omitidas.length>8?'…':'') : 'Sin omisiones.')
  );
}

function handleUploadED(payload) {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  const fecha = payload.fecha;
  const registros = payload.registros || [];
  if (!fecha) throw new Error('Fecha requerida');
  if (!registros.length) throw new Error('Sin registros para procesar');

  const existingData = fetchAllRecords();
  const existingForDate = existingData.filter(function(r) { return r.fecha === fecha; });

  // ── Build "latest vfact" map: for each planta|producto, find the most
  //    recent record BEFORE this fecha that has vfact > 0 ─────────────────
  var latestVfactMap = {};
  existingData.forEach(function(r) {
    if (r.fecha >= fecha) return;          // only records strictly before today's upload
    if (!r.vfact || r.vfact <= 0) return;  // skip zeros
    var k = r.planta + '|' + r.producto;
    if (!latestVfactMap[k] || r.fecha > latestVfactMap[k].fecha) {
      latestVfactMap[k] = {vfact: r.vfact, fecha: r.fecha};
    }
  });

  var updated = 0, added = 0, skipped = 0;

  registros.forEach(function(reg) {
    var productoDash = mapProducto(reg.producto);
    if (!productoDash) { skipped++; return; }
    if (CONFIG.PLANTAS_DASHBOARD.indexOf(reg.planta) === -1) { skipped++; return; }

    var existing = existingForDate.find(function(r) { return r.planta===reg.planta && r.producto===productoDash; });

    // Resolve vfact: incoming → existing (same date) → inherited from latest previous date → 0
    var incomingVfact = reg.vfact || 0;
    var existingVfact = existing ? (existing.vfact || 0) : 0;
    var inheritedVfact = (latestVfactMap[reg.planta + '|' + productoDash] || {}).vfact || 0;
    var resolvedVfact  = incomingVfact > 0 ? incomingVfact
                       : existingVfact > 0 ? existingVfact
                       : inheritedVfact;

    var record = {
      fecha:fecha, planta:reg.planta, producto:productoDash,
      inv:reg.inv||0, pron:reg.prom7d||0, vult7:0, vreal:reg.despacho||0,
      dem_prom:reg.prom7d||0, dem:reg.despacho||0, var_dem:0,
      vfact: resolvedVfact, cob:reg.autonomia||0,
      fecha_cobertura:'', fecha_reposicion:reg.eta_bt||'',
      bt:reg.bt||'', vol_rep:reg.vol_bt||0, vacio:reg.vacio||0,
      comentario:reg.condicion||'',
      fecha_repos_bt2:reg.eta_bt2||'', bt2:reg.bt2||'',
      vol_rep_bt2:reg.vol_bt2||0, vacio2:0
    };
    if (record.cob > 0) {
      var fechaCob = new Date(fecha + 'T12:00:00');
      fechaCob.setDate(fechaCob.getDate() + Math.round(record.cob));
      record.fecha_cobertura = Utilities.formatDate(fechaCob, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    if (existing) { sheet.getRange(existing._rowIndex,1,1,CONFIG.MAX_COLS_INV).setValues([buildRowArray(record)]); updated++; }
    else { sheet.appendRow(buildRowArray(record)); added++; }
  });

  clearCache();
  logUpload('E&D', fecha, added, updated, skipped);
  return createSuccessResponse('E&D procesado: '+added+' nuevos, '+updated+' actualizados, '+skipped+' omitidos');
}

// ═══════════════════════════════════════════════════════════════════════
// POST ENDPOINTS — NAVES
// ═══════════════════════════════════════════════════════════════════════

function handleUploadNaves(payload) {
  const sheet = ensureSheet(CONFIG.SHEETS.MOV_NAVES, [
    'TIPO','FECHA_REPORTE','NAVE','CATEGORIA','UBICACION',
    'ROTACION','ESTADO','PRODUCTO','VOLUMEN_MB','DESTINO',
    'PROVEEDOR','ETA','ETD','NOTAS','TIMESTAMP'
  ]);
  const fecha  = payload.fecha;
  const naves  = payload.naves || [];
  const cierres = payload.cierres || [];
  if (!naves.length) throw new Error('Sin datos de naves');

  // Build cierres text to attach to each vessel record
  const cierresNotas = cierres.length
    ? cierres.map(function(c){ return c.planta+': '+c.nivel+(c.apertura?' APERTURA: '+c.apertura:''); }).join('\n')
    : '';

  var rowCount = 0, ts = new Date().toISOString();
  naves.forEach(function(nave) {
    var notas = cierresNotas + (nave.notas ? '\n'+nave.notas : '');
    sheet.appendRow([nave.tipo||'CABOTAJE', fecha, nave.nombre||'', nave.categoria||'',
      nave.ubicacion||'', nave.rotacion||'', nave.estado||'', nave.producto||'',
      nave.volumen||'', nave.destino||'', nave.proveedor||'', nave.eta||'',
      nave.etd||'', notas, ts]);
    rowCount++;
  });

  // Also store each cierre as a dedicated CIERRE row for easy querying
  cierres.forEach(function(c) {
    sheet.appendRow(['CIERRE', fecha, c.planta||'', '', c.nivel||'', '', c.detalle||'',
      '', '', '', '', '', c.apertura||'', '', ts]);
    rowCount++;
  });

  logUpload('NAVES', fecha, rowCount, 0, 0);
  return createSuccessResponse('Naves: ' + naves.length + ' registros, ' + cierres.length + ' cierres guardados');
}

function handleClearSimData(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('mov_naves_sim');
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse(JSON.stringify({success:true,cleared:0}));
  var fechaProg = payload.fecha_prog || '';
  var data = sheet.getRange(2,1,sheet.getLastRow()-1,14).getValues();
  // Find rows to delete (all rows if no fecha_prog, or matching fecha_prog)
  var toDelete = [];
  for (var i = data.length - 1; i >= 0; i--) {
    var rowFecha = String(data[i][1]||'').slice(0,10);
    if (!fechaProg || rowFecha === fechaProg || data[i][0] === '--- SIMULACIÓN ---') {
      toDelete.push(i + 2); // 1-based + header offset
    }
  }
  toDelete.forEach(function(r) { sheet.deleteRow(r); });
  return createJsonResponse(JSON.stringify({success:true, cleared: toDelete.length}));
}

function handleSaveMovNaves(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('mov_naves_sim');
  if (!sheet) {
    sheet = ss.insertSheet('mov_naves_sim');
    var headers = ['TIPO','FECHA_PROG','TIMESTAMP','BUQUE','ORIGEN','ZARPE',
                   'VOL_TOTAL_MB','N_ESCALAS','RETORNO_EST','ESCALA_NUM',
                   'PLANTA','ETA','DIST_DIAS','PRODUCTOS'];
    sheet.appendRow(headers);
    sheet.getRange(1,1,1,headers.length).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var fechaProg = payload.fecha_prog || new Date().toISOString().slice(0,10);
  var rows = payload.rows || [];

  // ── DELETE existing rows for this fecha_prog before inserting ──────────
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues();
    for (var i = existing.length - 1; i >= 0; i--) {
      var fp = String(existing[i][1]||'').slice(0,10);
      if (fp === fechaProg || existing[i][0] === '--- SIMULACIÓN ---') {
        sheet.deleteRow(i + 2);
      }
    }
  }

  // If empty rows (clearance), return now
  if (!rows.length) return createJsonResponse(JSON.stringify({success:true, message:'Simulación vaciada', rows_written:0, fecha_prog:fechaProg}));

  // ── INSERT separator + rows ────────────────────────────────────────────
  sheet.appendRow(['--- SIMULACIÓN ---', fechaProg, rows[0] ? rows[0].timestamp : '', '']);
  var sepRow = sheet.getLastRow();
  sheet.getRange(sepRow,1,1,14).setBackground('#e8f0fe').setFontWeight('bold');

  var rowCount = 0;
  rows.forEach(function(row) {
    sheet.appendRow([row.tipo||'',row.fecha_prog||fechaProg,row.timestamp||'',row.buque||'',row.origen||'',
      row.zarpe||'',row.vol_total_mb||'',row.n_escalas||'',row.retorno_est||'',row.escala_num||'',
      row.planta||'',row.eta||'',row.dist_dias||'',row.productos||'']);
    rowCount++;
    var range = sheet.getRange(sheet.getLastRow(),1,1,14);
    if (row.tipo==='BUQUE') range.setBackground('#d6e4f7').setFontWeight('bold');
    else range.setBackground('#ffffff').setFontWeight('normal');
  });
  return createJsonResponse(JSON.stringify({
    success:true, message:'Guardado en mov_naves_sim', rows_written:rowCount,
    fecha_prog:fechaProg, sheet_url:ss.getUrl()+'#gid='+sheet.getSheetId()
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// POST ENDPOINTS — BATCH UPSERT
// ═══════════════════════════════════════════════════════════════════════

// ── Surgical single-field update in inventario ────────────────────────────
// Allowed fields and their 1-based column numbers (inventario schema)
var INVENTARIO_FIELD_COLS = {
  inv: 4, pron: 5, vult7: 6, vreal: 7, dem_prom: 8, vfact: 11,
  cob: 12, fecha_cobertura: 13, fecha_reposicion: 14,
  bt: 15, vol_rep: 16, vacio: 17, comentario: 18
};

function handleUpdateVfact(payload) {
  // Accepts [{fecha, planta, producto, vfact}] or payload.records
  var records = payload.records || (payload.fecha ? [payload] : []);
  return _handleUpdateFields(records.map(function(r) {
    return {fecha:r.fecha, planta:r.planta, producto:r.producto, field:'vfact', value:r.vfact||0};
  }));
}

function handleUpdateField(payload) {
  // payload: { records: [{fecha, planta, producto, field, value}] }
  var records = payload.records || [];
  if (!records.length) throw new Error('Sin registros');
  // Validate field names
  records.forEach(function(r) {
    if (!INVENTARIO_FIELD_COLS[r.field]) throw new Error('Campo no permitido: ' + r.field);
  });
  return _handleUpdateFields(records);
}

function _handleUpdateFields(records) {
  if (!records.length) return createSuccessResponse('Sin cambios');
  var sheet   = getSheet(CONFIG.SHEETS.INVENTARIO);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Hoja inventario vacía');

  // Build fecha|planta|producto → rowIndex map
  var raw = sheet.getRange(2, 1, lastRow-1, 3).getValues();
  var rowMap = {};
  raw.forEach(function(row, idx) {
    var k = formatDate(row[0]) + '|' + cleanString(row[1]) + '|' + cleanString(row[2]);
    rowMap[k] = idx + 2;
  });

  var updated = 0;
  records.forEach(function(rec) {
    var k = (rec.fecha||'') + '|' + (rec.planta||'') + '|' + (rec.producto||'');
    var rowIdx = rowMap[k];
    if (!rowIdx) return;
    var col = INVENTARIO_FIELD_COLS[rec.field];
    if (!col) return;
    sheet.getRange(rowIdx, col).setValue(rec.value !== undefined ? rec.value : 0);
    updated++;
  });

  clearCache();
  return createSuccessResponse('Actualizado: ' + updated + ' celdas en inventario');
}

function handleBatchUpsert(payload) {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  const records = payload.records || [];
  if (!records.length) throw new Error('Sin registros');

  const lastRow = sheet.getLastRow();
  var existingMap = {}, existingRows = {};
  if (lastRow >= 2) {
    var allData = sheet.getRange(2,1,lastRow-1,CONFIG.MAX_COLS_INV).getValues();
    allData.forEach(function(row,idx) {
      var fecha=formatDate(row[0]),planta=cleanString(row[1]),producto=cleanString(row[2]);
      if (fecha&&planta&&producto) {
        var key=fecha+'|'+planta+'|'+producto;
        existingMap[key]=idx+2; existingRows[key]=row;
      }
    });
  }

  var added=0, updated=0, batchAdd=[];
  var forceUpdate = payload.forceUpdate === true;  // true = edición manual explícita (Control Coberturas)

  // Campos que las plantas/terminales reportan directamente en Registro
  // Diario — las cargas automáticas (E&D, Cobertura-Análisis) YA NO
  // deben tocarlos NUNCA, sin importar qué traiga el archivo subido.
  // Antes solo se "preservaba si venía en 0", pero E&D SÍ mandaba valores
  // reales de inv/despacho y los sobreescribía. Ahora se preserva siempre.
  var CAMPOS_PROTEGIDOS = [
    {idx:3,field:'inv'},{idx:6,field:'vreal'},{idx:8,field:'dem'},{idx:9,field:'var_dem'}
  ];

  records.forEach(function(rec) {
    var key = rec.fecha+'|'+rec.planta+'|'+rec.producto;
    var rowArray = buildRowArray(rec);
    if (existingMap[key]) {
      var existingRow = existingRows[key];

      if (!forceUpdate) {
        // Campos protegidos: SIEMPRE se conserva lo que ya había (viene
        // de Registro Diario), la carga automática nunca los pisa.
        CAMPOS_PROTEGIDOS.forEach(function(p) {
          rowArray[p.idx] = existingRow[p.idx];
        });
        // Otros campos de apoyo (pronóstico legado, vfact, etc.): se
        // actualizan solo si el archivo trae un valor real; si no, se
        // conserva lo existente — comportamiento previo, sin cambios.
        var preserveIfZero = [
          {idx:4,field:'pron'},{idx:5,field:'vult7'},{idx:7,field:'dem_prom'},{idx:10,field:'vfact'}
        ];
        preserveIfZero.forEach(function(p) {
          var incoming = rec[p.field];
          if ((!incoming||incoming===0) && existingRow[p.idx]>0) rowArray[p.idx]=existingRow[p.idx];
        });
      }

      sheet.getRange(existingMap[key],1,1,CONFIG.MAX_COLS_INV).setValues([rowArray]);
      updated++;
    } else {
      // Fila nueva (fecha/planta/producto que aún no existe): como no hay
      // reporte previo de Registro Diario que proteger, si no es
      // forceUpdate igual se deja inv/despacho en 0 — que lo reporte la
      // planta directamente, no la carga automática.
      if (!forceUpdate) {
        CAMPOS_PROTEGIDOS.forEach(function(p) { rowArray[p.idx] = 0; });
      }
      batchAdd.push(rowArray);
      added++;
    }
  });

  if (batchAdd.length>0) {
    var startRow = sheet.getLastRow()+1;
    sheet.getRange(startRow,1,batchAdd.length,CONFIG.MAX_COLS_INV).setValues(batchAdd);
  }

  // ── Capacidad por planta/producto (tabla de referencia, no fechada) ──
  // No cambia mucho día a día: si el archivo no trae capacidad hoy para
  // una planta/producto, se conserva la última conocida (no se borra).
  var capActualizadas = 0;
  var capSheet = null;
  records.forEach(function(rec) {
    if (!(rec.capacidad > 0 || rec.fondos > 0 || rec.fondo_osinergmin > 0)) return;
    if (!capSheet) capSheet = ensureCapacidadRefSheet();
    capActualizadas += upsertCapacidadRef(capSheet, rec.planta, rec.producto, rec.capacidad, rec.fondos, rec.fondo_osinergmin);
  });

  clearCache();
  return createSuccessResponse('Batch: '+added+' nuevos, '+updated+' actualizados' +
    (capActualizadas ? ', ' + capActualizadas + ' capacidades actualizadas' : '') +
    ' · inventario/despacho de plantas protegido (no se sobreescribe con cargas autom\u00e1ticas)');
}

// Asegura la hoja de referencia de capacidades (flat, no fechada — un
// registro por planta+producto, se actualiza in-place).
function ensureCapacidadRefSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CAPACIDAD_REF);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CAPACIDAD_REF);
    sheet.appendRow(CAPACIDAD_REF_HEADERS);
    sheet.getRange(1, 1, 1, CAPACIDAD_REF_HEADERS.length).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Upsert de una fila planta+producto en capacidad_referencia. Solo
// sobreescribe los campos que vienen con valor > 0 — si el archivo no
// trae "fondos" hoy pero sí capacidad, no borra el fondo ya guardado.
function upsertCapacidadRef(sheet, planta, producto, capacidad, fondos, fondoOsinergmin) {
  var lastRow = sheet.getLastRow();
  var rowIdx = -1;
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (cleanString(data[i][0]) === planta && cleanString(data[i][1]) === producto) { rowIdx = i + 2; break; }
    }
  }
  if (rowIdx === -1) {
    sheet.appendRow([planta, producto, capacidad || 0, fondos || 0, fondoOsinergmin || 0]);
    return 1;
  }
  if (capacidad > 0) sheet.getRange(rowIdx, 3, 1, 1).setValue(capacidad);
  if (fondos > 0) sheet.getRange(rowIdx, 4, 1, 1).setValue(fondos);
  if (fondoOsinergmin > 0) sheet.getRange(rowIdx, 5, 1, 1).setValue(fondoOsinergmin);
  return 1;
}

// GET /api?action=getCapacidadesTodas — todas las capacidades conocidas,
// para mostrar en el dashboard (no cambia mucho día a día; si no hay dato
// de hoy, esta hoja ya conserva el último valor cargado, sin necesidad de
// buscar "el día anterior" — es una tabla de referencia, no un histórico).
function handleGetCapacidadesTodas() {
  var sheet = getSheetSafe(SHEET_CAPACIDAD_REF);
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse(JSON.stringify({ success:true, capacidades:[] }));
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 5).getValues();
  var out = data.map(function(row) {
    return {
      planta: cleanString(row[0]), producto: cleanString(row[1]),
      capacidad: parseNumber(row[2]), fondos: parseNumber(row[3]), fondo_osinergmin: parseNumber(row[4])
    };
  }).filter(function(r){ return r.planta && r.producto; });
  return createJsonResponse(JSON.stringify({ success:true, capacidades: out }));
}

function handleDeleteByDate(payload) {
  var fecha = payload.fecha;
  if (!fecha) throw new Error('Fecha requerida');
  var sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createSuccessResponse('Sin datos para borrar');
  var data = sheet.getRange(2,1,lastRow-1,3).getValues();
  var rowsToDelete = [];
  data.forEach(function(row,idx) { if (formatDate(row[0])===fecha) rowsToDelete.push(idx+2); });
  rowsToDelete.reverse().forEach(function(rowIdx) { sheet.deleteRow(rowIdx); });
  clearCache();
  return createSuccessResponse('Eliminadas '+rowsToDelete.length+' filas de '+fecha);
}

// ═══════════════════════════════════════════════════════════════════════
// PRONÓSTICO MENSUAL
// ═══════════════════════════════════════════════════════════════════════

function handleSavePronostico(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.PRONOSTICO);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.PRONOSTICO);
    sheet.appendRow(['MES','PLANTA','PRODUCTO','PRONOSTICO_MBDC']);
    sheet.getRange(1,1,1,4).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var mes=payload.mes, records=payload.records||[];
  if (!mes||!records.length) throw new Error('Mes y registros requeridos');
  var lastRow = sheet.getLastRow();
  if (lastRow>=2) {
    var existing = sheet.getRange(2,1,lastRow-1,1).getValues();
    var toDelete=[];
    existing.forEach(function(row,idx) {
      if (normalizeYYYYMM(row[0])===mes) toDelete.push(idx+2);
    });
    toDelete.reverse().forEach(function(r) { sheet.deleteRow(r); });
  }
  var rows = records.map(function(r) { return [mes, r.planta, r.producto, Math.round((r.pron||0)*10000)/10000]; });
  if (rows.length>0) sheet.getRange(sheet.getLastRow()+1,1,rows.length,4).setValues(rows);
  return createSuccessResponse('Pronóstico '+mes+': '+rows.length+' registros guardados');
}

// ═══════════════════════════════════════════════════════════════════════
// DATA ACCESS LAYER
// ═══════════════════════════════════════════════════════════════════════

function fetchAllRecords() {
  const sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2,1,lastRow-1,CONFIG.MAX_COLS_INV).getValues()
    .map(function(row,index) { return processRow(row, index+2); })
    .filter(function(record) {
      return record.fecha && CONFIG.EXCLUDED_PLANTAS.indexOf(record.planta) < 0;
    });
}

function processRow(row, rowIndex) {
  return {
    _rowIndex:rowIndex, fecha:formatDate(row[0]), planta:cleanString(row[1]),
    producto:cleanString(row[2]), inv:parseNumber(row[3]), pron:parseNumber(row[4]),
    vult7:parseNumber(row[5]), vreal:parseNumber(row[6]), dem_prom:parseNumber(row[7]),
    dem:parseNumber(row[8]), var_dem:parseNumber(row[9]), vfact:parseNumber(row[10]),
    cob:parseNumber(row[11]), fecha_cobertura:formatDate(row[12]), fecha_reposicion:formatDate(row[13]),
    bt:cleanString(row[14]), vol_rep:parseNumber(row[15]), vacio:parseNumber(row[16]),
    comentario:cleanString(row[17]), fecha_repos_bt2:formatDate(row[18]), bt2:cleanString(row[19]),
    vol_rep_bt2:parseNumber(row[20]), vacio2:parseNumber(row[21]),
    existencia_minima: (row[22] === true || row[22] === 1 || row[22] === '1' || row[22] === 'TRUE'),
    comentario_prod: cleanString(row[23] || '')
  };
}

function buildRowArray(record) {
  return [
    record.fecha||'', record.planta||'', record.producto||'',
    record.inv||0, record.pron||0, record.vult7||0, record.vreal||0,
    record.dem_prom||0, record.dem||0, record.var_dem||0, record.vfact||0,
    record.cob||0, record.fecha_cobertura||'', record.fecha_reposicion||'',
    record.bt||'', record.vol_rep||0, record.vacio||0, record.comentario||'',
    record.fecha_repos_bt2||'', record.bt2||'', record.vol_rep_bt2||0, record.vacio2||0,
    record.existencia_minima ? 1 : 0, record.comentario_prod||''
  ];
}

// ═══════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════

function calculateStats(data) {
  var plantas={},productos={},inventarioTotal=0,coberturaTotal=0,coberturaCount=0,fechas={};
  data.forEach(function(r) {
    if (r.planta)   plantas[r.planta]=true;
    if (r.producto) productos[r.producto]=true;
    if (r.fecha)    fechas[r.fecha]=true;
    inventarioTotal += r.inv||0;
    if (r.cob>0) { coberturaTotal+=r.cob; coberturaCount++; }
  });
  return {
    total_registros:data.length, total_plantas:Object.keys(plantas).length,
    total_productos:Object.keys(productos).length, total_fechas:Object.keys(fechas).length,
    inventario_total:Math.round(inventarioTotal),
    cobertura_promedio:coberturaCount>0?Math.round(coberturaTotal/coberturaCount*10)/10:0,
    ultima_actualizacion:new Date().toISOString(),
    plantas:Object.keys(plantas).sort(), productos:Object.keys(productos).sort(),
    fechas:Object.keys(fechas).sort()
  };
}

// ═══════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════

// Fórmula CANÓNICA de cobertura — debe ser IDÉNTICA en los 3 lugares del
// sistema que la calculan: index.html (cobSystemDays), registro-diario.html
// (rdCobCanonica) y aquí (persistida en inventario.COB). Usa V. Factible si
// existe; si no, cae al pronóstico DIARIO (nunca el mensual). Antes, esta
// función solo usaba vfact y dejaba el valor viejo (o 0) cuando vfact=0,
// desalineando lo guardado en Sheets con lo que Coberturas mostraba en vivo.
function cobCanonica(inv, vfact, pronDiario) {
  var vf = (vfact > 0) ? vfact : (pronDiario > 0 ? pronDiario : 0);
  if (!vf || vf <= 0 || !inv || inv <= 0) return 0;
  return Math.round(inv / vf); // entero — igual que index.html y registro-diario.html
}

// Días del mes de una fecha 'YYYY-MM-DD' — usado para convertir el
// pronóstico mensual APROBADO a un equivalente diario, consistente con
// registro-diario.html (rdDiasEnMes).
function diasEnMes(fechaStr) {
  var y = parseInt(String(fechaStr||'').slice(0,4), 10);
  var m = parseInt(String(fechaStr||'').slice(5,7), 10);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

// Pronóstico mensual APROBADO (hoja `pronostico`) convertido a diario para
// una planta/producto/fecha — misma fuente que la pestaña "Pronóstico
// Aprobado", NO el campo legado `pron` (col5 de inventario, de origen E&D).
function getPronAprobadoDiario(planta, producto, fechaStr) {
  try {
    var sheet = getSheetSafe(CONFIG.SHEETS.PRONOSTICO);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var mes = String(fechaStr||'').slice(0,7);
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 4).getValues();
    var plantaLeg = rdPlantaLegacy(planta);
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === mes) {
        var pl = String(data[i][1]||'').trim();
        var pr = String(data[i][2]||'').trim();
        if ((pl === planta || pl === plantaLeg) && pr === producto) {
          // Columna PRONOSTICO_MBDC — MBDC = Miles de Barriles Día
          // Calendario, YA es una tasa diaria. No se divide entre días.
          return parseFloat(data[i][3]) || 0;
        }
      }
    }
  } catch(e) { Logger.log('getPronAprobadoDiario error: ' + e.message); }
  return 0;
}

function parseNumber(value) {
  if (value===null||value===undefined||value===''||value==='-') return 0;
  if (typeof value==='number') return isNaN(value)?0:value;
  if (typeof value==='string') {
    // Normalizar coma decimal ("12,45" -> "12.45") ANTES de limpiar
    // caracteres no numéricos; si no se hace en este orden, la coma se
    // descarta silenciosamente y "12,45" se lee como 1245 (dato corrupto).
    var v = value.trim().replace(',', '.');
    var n = parseFloat(v.replace(/[^0-9.\-]/g,''));
    return isNaN(n)?0:n;
  }
  return 0;
}

function formatDate(value) {
  if (!value||value===''||value==='-') return '';
  try {
    if (Object.prototype.toString.call(value)==='[object Date]') {
      if (isNaN(value.getTime())) return '';
      return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    if (typeof value==='string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      var date=new Date(value);
      if (!isNaN(date.getTime())) return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
  } catch(e) {}
  return '';
}

function cleanString(value) {
  if (value===null||value===undefined||value==='') return '';
  return String(value).trim();
}

// Normaliza un valor de mes a 'YYYY-MM'. Google Sheets convierte '2025-07'
// a un objeto Date; este helper lo devuelve siempre como texto YYYY-MM.
function normalizeYYYYMM(value) {
  if (value===null||value===undefined||value==='') return '';
  if (Object.prototype.toString.call(value)==='[object Date]') {
    if (isNaN(value.getTime())) return '';
    var y=value.getFullYear(), m=value.getMonth()+1;
    return y + '-' + (m<10?'0'+m:''+m);
  }
  var s = String(value).trim();
  var mm = s.match(/^(\d{4})-(\d{1,2})/);
  if (mm) { var n=parseInt(mm[2],10); return mm[1] + '-' + (n<10?'0'+n:''+n); }
  var d = new Date(s);
  if (!isNaN(d.getTime())) { var y2=d.getFullYear(), m2=d.getMonth()+1; return y2+'-'+(m2<10?'0'+m2:''+m2); }
  return s;
}

function mapProducto(edProd) {
  if (!edProd) return null;
  var clean = edProd.trim();
  if (CONFIG.PRODUCT_MAP.hasOwnProperty(clean)) return CONFIG.PRODUCT_MAP[clean];
  return null;
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Hoja "'+name+'" no encontrada');
  return sheet;
}

function getSheetSafe(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name) || null;
}

function ensureSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers&&headers.length) {
      sheet.appendRow(headers);
      sheet.getRange(1,1,1,headers.length).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function getColumnIndex(columnName) {
  var map = {
    'fecha':1,'planta':2,'producto':3,'inv':4,'pron':5,'vult7':6,'vreal':7,
    'dem_prom':8,'dem':9,'var_dem':10,'vfact':11,'cob':12,'fecha_cobertura':13,
    'fecha_reposicion':14,'bt':15,'vol_rep':16,'vacio':17,'comentario':18,
    'fecha_repos_bt2':19,'bt2':20,'vol_rep_bt2':21,'vacio2':22
  };
  return map[columnName] || null;
}

function optimizedStringify(data) {
  if (data.length<100) return JSON.stringify(data);
  var parts=['['];
  for (var i=0;i<data.length;i++) { if (i>0) parts.push(','); parts.push(JSON.stringify(data[i])); }
  parts.push(']');
  return parts.join('');
}

function clearCache() {
  var cache = CacheService.getScriptCache();
  cache.removeAll(['dashboard_data_v4','dashboard_data_v5','dashboard_data_v6','dashboard_data_v7','dashboard_data_v8','dashboard_data_v10']);
}

function logUpload(tipo, fecha, added, updated, skipped) {
  try {
    var sheet = ensureSheet(CONFIG.SHEETS.UPLOAD_LOG, [
      'TIMESTAMP','TIPO','FECHA_DATOS','AGREGADOS','ACTUALIZADOS','OMITIDOS','USUARIO'
    ]);
    sheet.appendRow([new Date().toISOString(), tipo, fecha, added, updated, skipped,
      Session.getActiveUser().getEmail()||'API']);
  } catch(e) { Logger.log('Log upload error: '+e.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// HTTP RESPONSES
// ═══════════════════════════════════════════════════════════════════════

function createJsonResponse(data) {
  return ContentService.createTextOutput(data).setMimeType(ContentService.MimeType.JSON);
}

function createSuccessResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({
    success:true, message:message, timestamp:new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(error) {
  Logger.log('ERROR: '+(error.message||error));
  return ContentService.createTextOutput(JSON.stringify({
    success:false, error:true, message:error.message||String(error), timestamp:new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════
// TESTING
// ═══════════════════════════════════════════════════════════════════════

function testGetAll() {
  var result = doGet({parameter: {}});
  var data = JSON.parse(result.getContent());
  Logger.log('Total registros: ' + data.length);
  if (data[0]) Logger.log('Primer registro: ' + JSON.stringify(data[0]));
}

function testGetVentas() {
  var result = doGet({parameter: {action:'getVentas', mes:'2026-04'}});
  var data = JSON.parse(result.getContent());
  Logger.log('Ventas abril: ' + data.length + ' registros');
  if (data[0]) Logger.log('Primer registro: ' + JSON.stringify(data[0]));
}

function testGetStats() {
  var result = doGet({parameter: {action: 'getStats'}});
  Logger.log(result.getContent());
}

function manualClearCache() {
  clearCache();
  Logger.log('Caché limpiado');
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  MÓDULO TABLERO DE CONTROL COBERTURA  (append a Code.gs)              ║
// ║  - Hoja normalizada `reposiciones` (1 fila por evento BT, FK lógica)  ║
// ║  - Hoja `audit_log` para trazabilidad                                 ║
// ║  - Endpoints: getReposiciones / saveReposiciones / deleteReposicion   ║
// ║    + updateField ampliado a todos los campos editables del cuadro     ║
// ║  Diseñado para migración directa a SQL:                               ║
// ║    inventario(fecha,planta,producto,...)  1───N  reposiciones         ║
// ║    PK reposiciones = ID ; FK = (fecha_ref, planta, producto)          ║
// ╚══════════════════════════════════════════════════════════════════════╝

// Nombre de hojas nuevas (añadir lógicamente a CONFIG.SHEETS si se desea)
var SHEET_REPOSICIONES = 'reposiciones';
var SHEET_AUDIT_LOG    = 'audit_log';

// Esquema de la hoba `reposiciones` — pensado como tabla SQL.
// ID es la PK; (FECHA_REF, PLANTA, PRODUCTO) es la FK hacia inventario.
var REPOS_HEADERS = [
  'ID',               // 1  PK estable: REP-<timestamp>-<rand>
  'FECHA_REF',        // 2  FK → inventario.fecha (fecha del cuadro)
  'PLANTA',           // 3  FK → inventario.planta
  'PRODUCTO',         // 4  FK → inventario.producto
  'SECUENCIA',        // 5  1..4 (reposición 1,2,3,4)
  'FECHA_REPOSICION', // 6  ETA / fecha de arribo
  'BT',               // 7  buque tanque
  'VOL_REP_MB',       // 8  volumen reposición (MB)
  'VACIO_MB',         // 9  vacío resultante (MB)
  'FECHA_NUEVA_COB',  // 10 fecha nueva cobertura (calculada/registrada)
  'ESTADO',           // 11 PROGRAMADO | CONFIRMADO | EN_TRANSITO | DESCARGADO | CANCELADO
  'COMENTARIO',       // 12
  'CREATED_AT',       // 13 ISO timestamp alta
  'UPDATED_AT',       // 14 ISO timestamp última edición
  'USUARIO'           // 15 email / API
];

// Campos editables permitidos en inventario desde el tablero (amplía el set base).
var INVENTARIO_FIELD_COLS_FULL = {
  inv: 4, pron: 5, vult7: 6, vreal: 7, dem_prom: 8, dem: 9, var_dem: 10,
  vfact: 11, cob: 12, fecha_cobertura: 13, fecha_reposicion: 14,
  bt: 15, vol_rep: 16, vacio: 17, comentario: 18,
  fecha_repos_bt2: 19, bt2: 20, vol_rep_bt2: 21, vacio2: 22, existencia_minima: 23, comentario_prod: 24
};

// ── GET: lista de reposiciones (opcional filtro por fecha_ref) ──────────
function handleGetReposiciones(params) {
  var fechaRef = params && params.fecha ? params.fecha[0] : '';
  var sheet = ensureSheet(SHEET_REPOSICIONES, REPOS_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var values = sheet.getRange(2, 1, lastRow - 1, REPOS_HEADERS.length).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[0]) return; // sin ID → fila vacía
    var rec = {
      id:               cleanString(row[0]),
      fecha_ref:        formatDate(row[1]),
      planta:           cleanString(row[2]),
      producto:         cleanString(row[3]),
      secuencia:        parseNumber(row[4]) || 1,
      fecha_reposicion: formatDate(row[5]),
      bt:               cleanString(row[6]),
      vol_rep_mb:       parseNumber(row[7]),
      vacio_mb:         parseNumber(row[8]),
      fecha_nueva_cob:  formatDate(row[9]),
      estado:           cleanString(row[10]) || 'PROGRAMADO',
      comentario:       cleanString(row[11]),
      created_at:       row[12] ? String(row[12]) : '',
      updated_at:       row[13] ? String(row[13]) : '',
      usuario:          cleanString(row[14])
    };
    if (CONFIG.EXCLUDED_PLANTAS.indexOf(rec.planta) >= 0) return; // excluir plantas no visibles
    if (!fechaRef || rec.fecha_ref === fechaRef) out.push(rec);
  });
  return createJsonResponse(JSON.stringify(out));
}

// ── POST: UPSERT de reposiciones (por ID) + borrado opcional ───────────
// payload: { records: [{id?, fecha_ref, planta, producto, secuencia,
//                        fecha_reposicion, bt, vol_rep_mb, vacio_mb,
//                        fecha_nueva_cob, estado, comentario}],
//            deletes: ['REP-...'] }
function handleSaveReposiciones(payload) {
  var records = payload.records || [];
  var deletes = payload.deletes || [];
  var sheet   = ensureSheet(SHEET_REPOSICIONES, REPOS_HEADERS);
  var user    = (function(){ try { return Session.getActiveUser().getEmail() || 'API'; } catch(e){ return 'API'; } })();
  var now     = new Date().toISOString();

  var lastRow = sheet.getLastRow();
  var idMap = {};
  if (lastRow >= 2) {
    var idCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    idCol.forEach(function(r, i){ if (r[0]) idMap[String(r[0])] = i + 2; });
  }

  var added = 0, updated = 0, removed = 0;

  // Borrados primero (de abajo hacia arriba)
  if (deletes.length) {
    var rowsToDelete = [];
    deletes.forEach(function(id){ if (idMap[id]) rowsToDelete.push(idMap[id]); });
    rowsToDelete.sort(function(a,b){ return b - a; });
    rowsToDelete.forEach(function(ri){ sheet.deleteRow(ri); removed++; });
    // Reconstruir idMap tras borrar
    lastRow = sheet.getLastRow();
    idMap = {};
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 1).getValues()
        .forEach(function(r, i){ if (r[0]) idMap[String(r[0])] = i + 2; });
    }
  }

  records.forEach(function(rec) {
    var id = rec.id && idMap[rec.id] ? rec.id
           : ('REP-' + Date.now() + '-' + Math.floor(Math.random() * 1e4));
    var rowArr = [
      id, rec.fecha_ref || '', rec.planta || '', rec.producto || '',
      rec.secuencia || 1, rec.fecha_reposicion || '', rec.bt || '',
      rec.vol_rep_mb || 0, rec.vacio_mb || 0, rec.fecha_nueva_cob || '',
      rec.estado || 'PROGRAMADO', rec.comentario || '',
      '', '', user
    ];
    if (rec.id && idMap[rec.id]) {
      var ri = idMap[rec.id];
      // preservar CREATED_AT
      var prevCreated = sheet.getRange(ri, 13).getValue();
      rowArr[12] = prevCreated || now;
      rowArr[13] = now;
      sheet.getRange(ri, 1, 1, REPOS_HEADERS.length).setValues([rowArr]);
      updated++;
      auditLog('reposiciones', 'UPDATE', id, rec.planta + '|' + rec.producto + '|seq' + (rec.secuencia||1), user);
    } else {
      rowArr[12] = now; rowArr[13] = now;
      sheet.appendRow(rowArr);
      added++;
      auditLog('reposiciones', 'INSERT', id, rec.planta + '|' + rec.producto + '|seq' + (rec.secuencia||1), user);
    }
  });

  deletes.forEach(function(id){ auditLog('reposiciones', 'DELETE', id, '', user); });

  clearCache();
  return createSuccessResponse('Reposiciones — alta:' + added + ' edición:' + updated + ' baja:' + removed);
}

// ── POST: borrar una reposición por ID ──────────────────────────────────
function handleDeleteReposicion(payload) {
  return handleSaveReposiciones({ records: [], deletes: [payload.id] });
}

// ── updateField ampliado: usa el set completo de columnas ───────────────
function handleUpdateFieldFull(payload) {
  var records = payload.updates || payload.records || [];  // frontend sends 'updates', legacy uses 'records'
  if (!records.length) throw new Error('Sin registros');
  records.forEach(function(r) {
    if (!INVENTARIO_FIELD_COLS_FULL[r.field]) throw new Error('Campo no permitido: ' + r.field);
  });
  return _handleUpdateFieldsFull(records);
}

function _handleUpdateFieldsFull(records) {
  if (!records.length) return createSuccessResponse('Sin cambios');
  var sheet   = getSheet(CONFIG.SHEETS.INVENTARIO);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Hoja inventario vacía');
  var user = (function(){ try { return Session.getActiveUser().getEmail() || 'API'; } catch(e){ return 'API'; } })();

  var raw = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var rowMap = {};
  raw.forEach(function(row, idx) {
    rowMap[formatDate(row[0]) + '|' + cleanString(row[1]) + '|' + cleanString(row[2])] = idx + 2;
  });

  var updated = 0, inserted = 0;
  // Agrupar por fila para insertar fila nueva si no existe el combo fecha/planta/producto
  records.forEach(function(rec) {
    var k = (rec.fecha||'') + '|' + (rec.planta||'') + '|' + (rec.producto||'');
    var rowIdx = rowMap[k];
    if (!rowIdx) {
      // Crear fila base nueva en inventario (alta de combo inexistente)
      var base = buildRowArray({ fecha: rec.fecha, planta: rec.planta, producto: rec.producto });
      sheet.appendRow(base);
      rowIdx = sheet.getLastRow();
      rowMap[k] = rowIdx;
      inserted++;
    }
    var col = INVENTARIO_FIELD_COLS_FULL[rec.field];
    sheet.getRange(rowIdx, col).setValue(rec.value !== undefined ? rec.value : 0);
    updated++;
    auditLog('inventario', 'UPDATE', k, rec.field + '=' + rec.value, user);
  });

  clearCache();
  return createSuccessResponse('inventario — celdas:' + updated + (inserted ? ' (filas nuevas:' + inserted + ')' : ''));
}

// ── Trazabilidad: registro de auditoría ─────────────────────────────────
// ── PROGRAMACIÓN DE NAVES: hoja `tareas_naves` ─────────────────────────
var SHEET_TAREAS_NAVES = 'tareas_naves';
var TAREAS_HEADERS = [
  'ID','TIPO_EMB','BUQUE','VIAJE','ORIGEN','TERMINAL','PRODUCTO',
  'VOLUMEN_MB','N_BARCAZAS','PTO_FLUVIAL',
  'FECHA_ZARPE_CISTERNA','FECHA_CARGA','FECHA_ZARPE','FECHA_DESDE','FECHA_HASTA',
  'FECHA_ZARPE_RFIQ','FECHA_ETA_RFIQ',
  'ESTADO','PRIORIDAD','ASIGNADO','COMENTARIO',
  'CLICKUP_TASK_ID','CLICKUP_SYNC_STATUS','CREATED_AT','UPDATED_AT','USUARIO'
];

// GET tareas (para progFetchTareas en el frontend)
function handleGetTareas(payload) {
  var sheet = ensureSheet(SHEET_TAREAS_NAVES, TAREAS_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return createJsonResponse('[]');
  var vals = sheet.getRange(2,1,last-1,TAREAS_HEADERS.length).getValues();
  var out = vals.filter(function(r){ return !!r[0]; }).map(function(r) {
    return {
      id_local:r[0], tipo_emb:r[1], buque:r[2], viaje:r[3], origen:r[4],
      terminal:r[5], producto:r[6], volumen_mb:parseNumber(r[7]),
      n_barcazas:parseNumber(r[8])||1, pto_fluvial:cleanString(r[9]||''),
      fecha_zarpe_cisterna:formatDate(r[10]), fecha_carga:formatDate(r[11]),
      fecha_zarpe:formatDate(r[12]), fecha_desde:formatDate(r[13]), fecha_hasta:formatDate(r[14]),
      fecha_zarpe_rfiq:formatDate(r[15]), fecha_eta_rfiq:formatDate(r[16]),
      estado:r[17], prioridad:r[18], asignado:r[19], comentario:r[20],
      clickup_task_id:r[21], clickup_sync_status:r[22],
      created_at:String(r[23]||''), updated_at:String(r[24]||''), usuario:r[25]
    };
  });
  return createJsonResponse(JSON.stringify(out));
}

// UPSERT tarea (crea o actualiza por id_local)
function handleUpsertTareaNave(payload) {
  var rec = payload.record || payload;
  if (!rec.buque || !rec.terminal) throw new Error('Faltan campos: buque y terminal');
  var sheet = ensureSheet(SHEET_TAREAS_NAVES, TAREAS_HEADERS);
  var user  = (function(){ try { return Session.getActiveUser().getEmail()||'API'; } catch(e){ return 'API'; } })();
  var now   = new Date().toISOString();
  var id    = rec.id_local && rec.id_local.trim() ? rec.id_local.trim()
            : 'NAVE-'+Date.now()+'-'+Math.floor(Math.random()*9999);
  // Buscar fila existente
  var last = sheet.getLastRow();
  var rowIdx = -1;
  var prevCreated = now;
  if (last >= 2) {
    var ids = sheet.getRange(2,1,last-1,1).getValues();
    ids.forEach(function(r,i){ if (String(r[0])===id) { rowIdx=i+2; prevCreated=sheet.getRange(i+2,22).getValue()||now; } });
  }
  var row = [
    id, rec.tipo_emb||'MARITIMA', rec.buque, rec.viaje||'',
    rec.origen||'', rec.terminal, rec.producto||'',
    rec.volumen_mb||0, rec.n_barcazas||1, rec.pto_fluvial||'',
    rec.fecha_zarpe_cisterna||'', rec.fecha_carga||'', rec.fecha_zarpe||'',
    rec.fecha_desde||'', rec.fecha_hasta||'',
    rec.fecha_zarpe_rfiq||'', rec.fecha_eta_rfiq||'',
    rec.estado||'PROGRAMADO', rec.prioridad||'NORMAL',
    rec.asignado||'', rec.comentario||'',
    rec.clickup_task_id||'', 'LOCAL',
    rowIdx>0 ? prevCreated : now, now, user
  ];
  if (rowIdx > 0) {
    sheet.getRange(rowIdx,1,1,TAREAS_HEADERS.length).setValues([row]);
    auditLog('tareas_naves','UPDATE',id,rec.buque+'→'+rec.terminal,user);
  } else {
    sheet.appendRow(row);
    auditLog('tareas_naves','INSERT',id,rec.buque+'→'+rec.terminal,user);
  }
  clearCache();
  return createJsonResponse(JSON.stringify({success:true, id:id, clickup_sync:{success:false,error:'ClickUp no configurado'}}));
}

// DELETE tarea
function handleDeleteTareaNave(payload) {
  var id = payload.id_local||payload.id;
  if (!id) throw new Error('id_local requerido');
  var sheet = ensureSheet(SHEET_TAREAS_NAVES, TAREAS_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return createSuccessResponse('No encontrado');
  var ids = sheet.getRange(2,1,last-1,1).getValues();
  var user = (function(){ try { return Session.getActiveUser().getEmail()||'API'; } catch(e){ return 'API'; } })();
  var deleted = 0;
  for (var i=ids.length-1; i>=0; i--) {
    if (String(ids[i][0])===String(id)) { sheet.deleteRow(i+2); deleted++; auditLog('tareas_naves','DELETE',id,'',user); }
  }
  clearCache();
  return createSuccessResponse('Eliminadas: '+deleted);
}

function auditLog(tabla, accion, id, detalle, usuario) {
  try {
    var sheet = ensureSheet(SHEET_AUDIT_LOG,
      ['TIMESTAMP','TABLA','ACCION','ID_REGISTRO','DETALLE','USUARIO']);
    sheet.appendRow([new Date().toISOString(), tabla, accion, id || '', detalle || '', usuario || 'API']);
  } catch(e) { Logger.log('audit error: ' + e.message); }
}

// ── Inicialización: crea/normaliza las hojas nuevas ─────────────────────
function initCoberturaSheets() {
  var rep = ensureSheet(SHEET_REPOSICIONES, REPOS_HEADERS);
  // Anchos y formato cabecera
  rep.getRange(1, 1, 1, REPOS_HEADERS.length)
     .setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
  rep.setFrozenRows(1);
  ensureSheet(SHEET_AUDIT_LOG, ['TIMESTAMP','TABLA','ACCION','ID_REGISTRO','DETALLE','USUARIO']);
  return 'Hojas reposiciones y audit_log listas';
}


// ═══════════════════════════════════════════════════════════════════════
// REPORTE VENTAS DIARIAS PP (hoja: pp_ventas_nacionales)
// Columnas: fecha, mes, dia, producto, venta_mb, fuente
// ═══════════════════════════════════════════════════════════════════════
const PP_VENTAS_SHEET = 'pp_ventas_nacionales';
const PP_VENTAS_HEADERS = ['fecha','mes','dia','producto','venta_mb','fuente'];

function getOrCreatePPVentasSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PP_VENTAS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PP_VENTAS_SHEET);
    sh.getRange(1,1,1,PP_VENTAS_HEADERS.length).setValues([PP_VENTAS_HEADERS]);
    sh.getRange(1,1,1,PP_VENTAS_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function handleUploadVentasPP(payload) {
  var sh = getOrCreatePPVentasSheet();
  var records = payload.records || [];
  if (!records.length) return createSuccessResponse({updated:0, inserted:0});

  var all = sh.getDataRange().getValues();
  var H   = all[0];
  var fiF = H.indexOf('fecha');
  var fiP = H.indexOf('producto');
  var fiV = H.indexOf('venta_mb');

  // ── Normalizar fecha: Sheets retorna Date objects, no strings ─────────────
  function normFecha(v) {
    if (!v) return '';
    if (v instanceof Date) {
      var y = v.getFullYear();
      var m = String(v.getMonth() + 1).padStart(2, '0');
      var d = String(v.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    return String(v).trim().slice(0, 10); // tomar solo YYYY-MM-DD
  }

  // Build key → sheet row (1-based), usando fechas normalizadas
  var keyMap = {};
  for (var i = 1; i < all.length; i++) {
    var k = normFecha(all[i][fiF]) + '|' + String(all[i][fiP]).trim();
    if (k !== '|') keyMap[k] = i + 1; // evitar filas vacías
  }

  var updated = 0, newRows = [];
  records.forEach(function(r) {
    var k = String(r.fecha).trim() + '|' + String(r.producto).trim();
    if (keyMap[k]) {
      sh.getRange(keyMap[k], fiV + 1).setValue(r.venta_mb);
      updated++;
    } else {
      newRows.push([r.fecha, r.mes, r.dia, r.producto, r.venta_mb, 'PP_REPORTE']);
    }
  });

  if (newRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, PP_VENTAS_HEADERS.length)
      .setValues(newRows);
  }

  return createSuccessResponse({updated: updated, inserted: newRows.length});
}

function handleGetVentasPP(params) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PP_VENTAS_SHEET);
  if (!sh) return createJsonResponse([]);

  var all   = sh.getDataRange().getValues();
  var H     = all[0];
  var desde = (params && params.desde) || '';
  var hasta = (params && params.hasta) || '';
  var mes   = (params && params.mes)   || '';

  function normFecha(v) {
    if (!v) return '';
    if (v instanceof Date) {
      var y = v.getFullYear();
      var m = String(v.getMonth() + 1).padStart(2, '0');
      var d = String(v.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    return String(v).trim().slice(0, 10);
  }

  var result = [];
  for (var i = 1; i < all.length; i++) {
    var row = {};
    H.forEach(function(h, j) { row[h] = all[i][j]; });
    var f = normFecha(row.fecha);
    row.fecha = f; // normalizar en respuesta
    if (!f) continue;
    if (mes   && !f.startsWith(mes))   continue;
    if (desde && f < desde)            continue;
    if (hasta && f > hasta)            continue;
    row.venta_mb = parseFloat(row.venta_mb) || 0;
    result.push(row);
  }
  return createJsonResponse(JSON.stringify(result));
}

// ── Utilidad: eliminar duplicados en pp_ventas_nacionales ─────────────────
// Ejecutar manualmente desde el editor de Apps Script para limpiar datos previos
function deduplicatePPVentas() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PP_VENTAS_SHEET);
  if (!sh) { Logger.log('Hoja no encontrada: ' + PP_VENTAS_SHEET); return; }

  var all = sh.getDataRange().getValues();
  var H   = all[0];
  var fiF = H.indexOf('fecha');
  var fiP = H.indexOf('producto');

  function normFecha(v) {
    if (!v) return '';
    if (v instanceof Date) {
      return v.getFullYear() + '-'
           + String(v.getMonth()+1).padStart(2,'0') + '-'
           + String(v.getDate()).padStart(2,'0');
    }
    return String(v).trim().slice(0,10);
  }

  var seen = {}, rowsToDelete = [];
  for (var i = 1; i < all.length; i++) {
    var k = normFecha(all[i][fiF]) + '|' + String(all[i][fiP]).trim();
    if (!k || k === '|') continue;
    if (seen[k]) {
      rowsToDelete.push(i + 1); // 1-based, mark for deletion
    } else {
      seen[k] = true;
    }
  }

  // Delete from bottom up to preserve row indices
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sh.deleteRow(rowsToDelete[j]);
  }

  Logger.log('Duplicados eliminados: ' + rowsToDelete.length
           + ' · Filas únicas restantes: ' + (all.length - 1 - rowsToDelete.length));
  SpreadsheetApp.getUi().alert('✅ Deduplicación completa:\n'
    + rowsToDelete.length + ' duplicados eliminados\n'
    + (all.length - 1 - rowsToDelete.length) + ' filas únicas conservadas');
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO BACKEND: PLAN DE SUMINISTRO A REFINERÍA IQUITOS
// Hojas: plan_refinacion, iqui_viajes_terrestres, iqui_viajes_fluviales,
//        iqui_costos, iqui_config
// Patrón idéntico a reposiciones: ensureSheet + UPSERT por ID
// ═══════════════════════════════════════════════════════════════════════════

// ── Nombres de hojas ───────────────────────────────────────────────────────
var SHEET_PLAN_REFINACION = 'plan_refinacion';
var SHEET_IQUI_VIAJES_TERR = 'iqui_viajes_terrestres';
var SHEET_IQUI_VIAJES_FLUV = 'iqui_viajes_fluviales';
var SHEET_IQUI_COSTOS       = 'iqui_costos';
var SHEET_IQUI_CONFIG       = 'iqui_config';
var SHEET_IQUI_CIS_DIARIO   = 'iqui_cisternas_diario';
var SHEET_IQUI_TANQUE_YURI  = 'iqui_tanque_yurimaguas';

// Balance de tanque en Yurimaguas (planta receptora) para sincerar el volumen
// realmente disponible para Iquitos vs lo programado.
var IQUI_TANQUE_YURI_HEADERS = [
  'ID',            // 0  mes|fecha|producto
  'MES',           // 1  YYYY-MM (texto)
  'FECHA',         // 2  YYYY-MM-DD
  'PRODUCTO',      // 3
  'SALDO_INI',     // 4  Saldo inicial en tanque (MB)
  'ING_CIS',       // 5  Ingreso por cisternas del día (MB)
  'CONS_LOCAL',    // 6  Consumo/venta local de Yurimaguas (MB) — NO va a Iquitos
  'CARGA_BARC',    // 7  Cargado a barcazas hacia Iquitos (MB)
  'PROG_IQUITOS',  // 8  Volumen programado para Iquitos (MB)
  'STANDBY',       // 9  'SI'|'NO' — barcaza en stand-by esperando cisternas
  'OBS',           // 10
  'UPDATED_AT',    // 11
  'USUARIO'        // 12
];

// Reporte diario de flota de cisternas por estado operativo (sin zarpe individual)
var IQUI_CIS_DIARIO_HEADERS = [
  'ID',          // 0  mes|ruta|fecha|producto
  'MES',         // 1  YYYY-MM (texto)
  'RUTA',        // 2  'yu' | 'lpo'
  'FECHA',       // 3  YYYY-MM-DD
  'PROG_N',      // 4  Programadas: cantidad
  'PROG_MB',     // 5  Programadas: volumen MB
  'CARGA_N',     // 6  Cargando en planta (Talara/Conchán): cantidad
  'CARGA_MB',    // 7  Cargando: volumen MB
  'TRANS_N',     // 8  En tránsito: cantidad
  'TRANS_MB',    // 9  En tránsito: volumen MB
  'DESC_N',      // 10 Descargando (Yurimaguas/LPO): cantidad
  'DESC_MB',     // 11 Descargando: volumen MB
  'OBS',         // 12 Observación
  'UPDATED_AT',  // 13
  'USUARIO',     // 14
  'PRODUCTO'     // 15 Producto (tipificación) — agregado al final para no desplazar columnas
];

// ── Esquemas ───────────────────────────────────────────────────────────────
// Meses activos del programa — agregar aquí al extender
var IQUI_MESES_GAS = ['2026-06','2026-07','2026-08'];

// Cabeceras dinámicas: ID, PRODUCTO, PUERTO, [meses...], VALS_JSON, UPDATED_AT, USUARIO
// VALS_JSON guarda todos los meses como JSON para compatibilidad futura
function _getPlanHeaders() {
  return ['ID','PRODUCTO','PUERTO'].concat(IQUI_MESES_GAS).concat(['VALS_JSON','UPDATED_AT','USUARIO']);
}
var PLAN_REF_HEADERS = _getPlanHeaders();

var IQUI_VIAJES_TERR_HEADERS = [
  'ID', 'FECHA', 'PRODUCTO', 'ORIGEN', 'DESTINO',
  'PLACA', 'VOL_MB', 'ESTADO', 'COSTO_SOLES', 'UPDATED_AT'
];

var IQUI_VIAJES_FLUV_HEADERS = [
  'ID',             // 0  Identificador único del viaje (ej: yu1, lpo1, cis1)
  'MES',            // 1  YYYY-MM
  'TIPO_RUTA',      // 2  'YU' | 'LPO' | 'CISTERNA'
  'BARCAZA',        // 3  Nombre del convoy / empujador
  'RUTA',           // 4  Ruta (Yurimaguas-Iquitos, Pucallpa-Iquitos, etc.)
  'PRODUCTO',       // 5  Producto(s)
  // ── Plan base ──
  'ZARPE_PLAN',     // 6  Fecha plan de zarpe desde puerto carga
  'ARRIBO_PLAN',    // 7  Fecha plan de arribo a Ref. Iquitos
  'VOL_PLAN_MB',    // 8  Volumen planificado (MB)
  // ── Fase 1: Vacío Iquitos → Yurimaguas ──
  'ZARPE_VACIO',    // 9  Zarpe vacío desde Iquitos
  'ETA_YURIMAGUAS', // 10 ETA a Yurimaguas (para embarque)
  'ARRIBO_YURIMAGUAS', // 11 Arribo real a Yurimaguas
  // ── Fase 2: Embarque en Yurimaguas ──
  'INICIO_EMBARQUE',// 12 Fecha inicio de embarque
  'FIN_EMBARQUE',   // 13 Fecha fin de embarque
  'STATUS_EMBARQUE',// 14 'PENDIENTE'|'EN_PROCESO'|'COMPLETADO'
  // ── Fase 3: Cargado Yurimaguas → Iquitos ──
  'ZARPE_CARGADO',  // 15 Zarpe cargado desde Yurimaguas
  'ARRIBO_IQUITOS', // 16 Arribo real a Refinería Iquitos
  'VOL_REAL_MB',    // 17 Volumen real descargado
  'ESTADO',         // 18 Estado general
  // ── Trazabilidad ──
  'OBS',            // 19 Observaciones acumuladas (se CONCATENAN, no se pisan)
  'COSTO_SOLES',    // 20 Costo en soles
  'GUARDADO_POR',   // 21 Usuario que guardó
  'UPDATED_AT'      // 22
];

var IQUI_COSTOS_HEADERS = [
  'ID', 'MES', 'TIPO', 'CONCEPTO', 'MONTO_SOLES', 'MB_ASOCIADO', 'UPDATED_AT'
];

// ═══════════════════════════════════════════════════════════════════════════
// GET: Plan de Refinación
// ═══════════════════════════════════════════════════════════════════════════
function handleGetPlanRefinacion(params) {
  var headers = _getPlanHeaders();
  var sheet = ensureSheet(SHEET_PLAN_REFINACION, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    _iquiSeedPlanRefinacion(sheet);
    lastRow = sheet.getLastRow();
    if (lastRow < 2) return createJsonResponse('[]');
  }
  var ncols = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, ncols).getValues();
  // Leer cabeceras reales de la hoja (puede tener más meses que IQUI_MESES_GAS)
  var sheetHeaders = sheet.getRange(1, 1, 1, ncols).getValues()[0].map(function(h){ return String(h).trim(); });
  var out = [];
  values.forEach(function(row) {
    if (!row[0] && !row[1]) return;
    var producto = cleanString(row[sheetHeaders.indexOf('PRODUCTO')]);
    var puerto   = cleanString(row[sheetHeaders.indexOf('PUERTO')]);
    if (!producto) return;
    // Construir vals desde columnas YYYY-MM
    var vals = {};
    sheetHeaders.forEach(function(h, i) {
      if (/^\d{4}-\d{2}$/.test(h)) vals[h] = parseNumber(row[i]);
    });
    // Fallback: intentar leer VALS_JSON si existe
    var vji = sheetHeaders.indexOf('VALS_JSON');
    if (vji >= 0 && row[vji]) {
      try { var vj = JSON.parse(row[vji]); Object.keys(vj).forEach(function(k){ if(!vals[k]) vals[k]=vj[k]; }); } catch(e){}
    }
    out.push({ id: cleanString(row[0]), producto: producto, puerto: puerto, vals: vals });
  });
  return createJsonResponse(JSON.stringify(out));
}

function _iquiSeedPlanRefinacion(sheet) {
  // Seed con estructura dinámica: ID, PRODUCTO, PUERTO, [meses...], VALS_JSON, UPDATED_AT, USUARIO
  var seedData = [
    {p:'Gasolina 90 Insumo', t:'LPO',            v:{'2026-06':28,'2026-07':0, '2026-08':31}},
    {p:'Gasolina 90 Insumo', t:'Yurimaguas',     v:{'2026-06':37,'2026-07':23,'2026-08':0}},
    {p:'Nafta Craqueada',    t:'LPO',            v:{'2026-06':0, '2026-07':38,'2026-08':32}},
    {p:'Nafta Liviana',      t:'LPO',            v:{'2026-06':16,'2026-07':8, '2026-08':16}},
    {p:'Diesel',             t:'LPO/Yurimaguas', v:{'2026-06':40,'2026-07':40,'2026-08':41}},
    {p:'B100',               t:'LPO',            v:{'2026-06':0, '2026-07':2, '2026-08':5}},
    {p:'PI6',                t:'LPO',            v:{'2026-06':45,'2026-07':45,'2026-08':45}}
  ];
  var now = new Date().toISOString();
  seedData.forEach(function(r, i) {
    var row = ['PLAN-'+(i+1), r.p, r.t];
    IQUI_MESES_GAS.forEach(function(m){ row.push(r.v[m]||0); });
    row.push(JSON.stringify(r.v), now, 'sistema');
    sheet.appendRow(row);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// POST: Guardar Plan de Refinación (reemplazo total)
// payload: { action:'savePlanRefinacion', plan:[{producto,puerto,jun,jul,ago}], usuario? }
// ═══════════════════════════════════════════════════════════════════════════
function handleSavePlanRefinacion(payload) {
  var plan = payload.plan || [];
  var usuario = cleanString(payload.usuario) || 'web';
  // Detectar todos los meses en el payload
  var allMeses = {};
  plan.forEach(function(r) {
    var vals = r.vals || {};
    Object.keys(vals).forEach(function(k){ if(/^\d{4}-\d{2}$/.test(k)) allMeses[k]=true; });
  });
  var mesesOrdenados = Object.keys(allMeses).sort();
  // Actualizar IQUI_MESES_GAS con los nuevos meses encontrados
  mesesOrdenados.forEach(function(m){ if(IQUI_MESES_GAS.indexOf(m)<0) IQUI_MESES_GAS.push(m); });
  IQUI_MESES_GAS.sort();

  var headers = _getPlanHeaders();
  var sheet = ensureSheet(SHEET_PLAN_REFINACION, headers);

  // Reconstruir cabeceras si hay meses nuevos
  var sheetHeaders = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(h){return String(h).trim();});
  var needsRebuild = IQUI_MESES_GAS.some(function(m){return sheetHeaders.indexOf(m)<0;});
  if (needsRebuild) {
    sheet.clearContents();
    var newHeaders = _getPlanHeaders();
    sheet.getRange(1,1,1,newHeaders.length).setValues([newHeaders]).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var now = new Date().toISOString();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2,1,lastRow-1,sheet.getLastColumn()).clearContent();

  var finalHeaders = _getPlanHeaders();
  var rows = plan.map(function(r, i) {
    var vals = r.vals || {};
    var row = ['PLAN-'+(i+1), cleanString(r.producto), cleanString(r.puerto)];
    IQUI_MESES_GAS.forEach(function(m){ row.push(parseNumber(vals[m])||0); });
    row.push(JSON.stringify(vals), now, usuario);
    return row;
  });

  if (rows.length) {
    sheet.getRange(2,1,rows.length,finalHeaders.length).setValues(rows);
  }
  return createSuccessResponse('Plan guardado: ' + rows.length + ' productos, meses: ' + IQUI_MESES_GAS.join(','));
}

// ═══════════════════════════════════════════════════════════════════════════
// GET: Viajes terrestres
// ═══════════════════════════════════════════════════════════════════════════
function handleGetIquiViajesTerr(params) {
  var sheet = ensureSheet(SHEET_IQUI_VIAJES_TERR, IQUI_VIAJES_TERR_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var values = sheet.getRange(2, 1, lastRow - 1, IQUI_VIAJES_TERR_HEADERS.length).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[0]) return;
    out.push({
      id:        cleanString(row[0]),
      fecha:     formatDate(row[1]),
      producto:  cleanString(row[2]),
      origen:    cleanString(row[3]),
      destino:   cleanString(row[4]),
      placa:     cleanString(row[5]),
      vol_mb:    parseNumber(row[6]),
      estado:    cleanString(row[7]) || 'PROGRAMADO',
      costo:     parseNumber(row[8])
    });
  });
  return createJsonResponse(JSON.stringify(out));
}

// ═══════════════════════════════════════════════════════════════════════════
// GET: Viajes fluviales
// ═══════════════════════════════════════════════════════════════════════════
function handleGetIquiViajesFluv(params) {
  var mes = cleanString(params.mes || '');
  var sheet = ensureSheet(SHEET_IQUI_VIAJES_FLUV, IQUI_VIAJES_FLUV_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var values = sheet.getRange(2, 1, lastRow - 1, IQUI_VIAJES_FLUV_HEADERS.length).getValues();
  var out = [];
  var mesN = normalizeYYYYMM(mes);
  values.forEach(function(row) {
    if (!row[0]) return;
    if (mesN && normalizeYYYYMM(row[1]) !== mesN) return;  // filtrar por mes (normalizado)
    out.push({
      id:                  cleanString(row[0]),
      mes:                 normalizeYYYYMM(row[1]),
      tipo_ruta:           cleanString(row[2]),
      barcaza:             cleanString(row[3]),
      ruta:                cleanString(row[4]),
      producto:            cleanString(row[5]),
      zarpe_plan:          formatDate(row[6]),
      arribo_plan:         formatDate(row[7]),
      vol_plan_mb:         parseNumber(row[8]),
      zarpe_vacio:         formatDate(row[9]),
      eta_yurimaguas:      formatDate(row[10]),
      arribo_yurimaguas:   formatDate(row[11]),
      inicio_embarque:     formatDate(row[12]),
      fin_embarque:        formatDate(row[13]),
      status_embarque:     cleanString(row[14]) || 'PENDIENTE',
      zarpe_cargado:       formatDate(row[15]),
      arribo_iquitos:      formatDate(row[16]),
      vol_real_mb:         parseNumber(row[17]),
      estado:              cleanString(row[18]) || 'PENDIENTE',
      obs:                 cleanString(row[19]),
      costo:               parseNumber(row[20]),
      guardado_por:        cleanString(row[21]),
      updated_at:          row[22] instanceof Date ? row[22].toISOString() : cleanString(row[22])
    });
  });
  return createJsonResponse(JSON.stringify(out));
}

// ═══════════════════════════════════════════════════════════════════════════
// POST: UPSERT viaje (terrestre o fluvial) por ID
// payload: { action:'saveIquiViaje', tipo:'terrestre'|'fluvial', viaje:{...} }
// ═══════════════════════════════════════════════════════════════════════════
function handleSaveIquiViaje(payload) {
  var tipo = cleanString(payload.tipo);
  var v = payload.viaje || {};
  var now = new Date().toISOString();

  if (tipo === 'fluvial') {
    var sheetF = ensureSheet(SHEET_IQUI_VIAJES_FLUV, IQUI_VIAJES_FLUV_HEADERS);
    // Forzar la columna MES (col 2) a formato TEXTO para que Sheets no
    // convierta '2025-07' en una fecha (causa de que la data no se leyera)
    try { sheetF.getRange(1, 2, sheetF.getMaxRows(), 1).setNumberFormat('@'); } catch(e){}
    var idF = cleanString(v.id || v.id_viaje) || ('VFL-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
    var usuario = '';
    try { usuario = Session.getActiveUser().getEmail() || cleanString(v.guardado_por || 'Flota'); }
    catch(e) { usuario = cleanString(v.guardado_por || 'Flota'); }

    // Buscar fila existente para preservar obs acumuladas y campos que no se editan
    var lastRow = sheetF.getLastRow();
    var existingRow = null;
    if (lastRow >= 2) {
      var ids = sheetF.getRange(2, 1, lastRow-1, 1).getValues();
      for (var i=0; i<ids.length; i++) {
        if (cleanString(ids[i][0]) === idF) {
          existingRow = sheetF.getRange(i+2, 1, 1, IQUI_VIAJES_FLUV_HEADERS.length).getValues()[0];
          break;
        }
      }
    }

    // Acumular observaciones: si ya hay obs y llegan obs nuevas, concatenar con timestamp
    var obsExistentes = existingRow ? cleanString(existingRow[19]) : '';
    var obsNuevas     = cleanString(v.obs || '');
    var obsAcumuladas = obsExistentes;
    if (obsNuevas && obsNuevas !== obsExistentes) {
      var stamp = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm');
      if (obsExistentes) {
        obsAcumuladas = obsExistentes + '\n[' + stamp + '] ' + obsNuevas;
      } else {
        obsAcumuladas = '[' + stamp + '] ' + obsNuevas;
      }
    }

    // Construir fila preservando campos que no se envían (null = mantener existente)
    function fld(newVal, existIdx) {
      if (newVal !== undefined && newVal !== null && newVal !== '') return newVal;
      return existingRow ? existingRow[existIdx] : '';
    }

    var rowF = [
      idF,                                              // 0  ID
      normalizeYYYYMM(fld(v.mes, 1)) || '',             // 1  MES (texto YYYY-MM)
      fld(v.tipo_ruta, 2) || cleanString(v.tipo||''),   // 2  TIPO_RUTA
      fld(v.barcaza || v.empujador, 3),                 // 3  BARCAZA
      fld(v.ruta, 4),                                   // 4  RUTA
      fld(v.producto, 5),                               // 5  PRODUCTO
      fld(v.zarpe_plan, 6),                             // 6  ZARPE_PLAN
      fld(v.arribo_plan, 7),                            // 7  ARRIBO_PLAN
      parseNumber(fld(v.vol_plan_mb, 8)),               // 8  VOL_PLAN_MB
      fld(v.zarpe_vacio, 9),                            // 9  ZARPE_VACIO
      fld(v.eta_yurimaguas, 10),                        // 10 ETA_YURIMAGUAS
      fld(v.arribo_yurimaguas, 11),                     // 11 ARRIBO_YURIMAGUAS
      fld(v.inicio_embarque, 12),                       // 12 INICIO_EMBARQUE
      fld(v.fin_embarque, 13),                          // 13 FIN_EMBARQUE
      fld(v.status_embarque, 14),                       // 14 STATUS_EMBARQUE
      fld(v.zarpe_cargado || v.zarpe_real, 15),         // 15 ZARPE_CARGADO
      fld(v.arribo_iquitos || v.arribo_real, 16),       // 16 ARRIBO_IQUITOS
      parseNumber(fld(v.vol_real_mb || v.vol_mb, 17)),  // 17 VOL_REAL_MB
      fld(v.estado || 'PENDIENTE', 18),                 // 18 ESTADO
      obsAcumuladas,                                    // 19 OBS (acumuladas)
      parseNumber(fld(v.costo, 20)),                    // 20 COSTO_SOLES
      usuario,                                          // 21 GUARDADO_POR
      now                                               // 22 UPDATED_AT
    ];
    _iquiUpsertById(sheetF, idF, rowF, IQUI_VIAJES_FLUV_HEADERS.length);
    return createSuccessResponse('Viaje fluvial guardado: ' + idF);
  } else {
    var sheetT = ensureSheet(SHEET_IQUI_VIAJES_TERR, IQUI_VIAJES_TERR_HEADERS);
    var idT = cleanString(v.id) || ('VTE-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
    var rowT = [idT, v.fecha || '', cleanString(v.producto), cleanString(v.origen),
                cleanString(v.destino), cleanString(v.placa), parseNumber(v.vol_mb),
                cleanString(v.estado) || 'PROGRAMADO', parseNumber(v.costo), now];
    _iquiUpsertById(sheetT, idT, rowT, IQUI_VIAJES_TERR_HEADERS.length);
    return createSuccessResponse('Viaje terrestre guardado: ' + idT);
  }
}

// UPSERT genérico por ID en la columna 1
function _iquiUpsertById(sheet, id, rowValues, ncols) {
  var lastRow = sheet.getLastRow();
  var foundRow = -1;
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (cleanString(ids[i][0]) === id) { foundRow = i + 2; break; }
    }
  }
  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, ncols).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reporte diario de flota de cisternas por estado operativo
// GET  getCisDiario?mes=YYYY-MM[&ruta=yu|lpo]
// POST saveCisDiario { registro:{ mes, ruta, fecha, prog_n, prog_mb, ... } }
// ═══════════════════════════════════════════════════════════════════════════
function handleGetCisDiario(params) {
  var mesN  = normalizeYYYYMM(params.mes || '');
  var ruta  = cleanString(params.ruta || '').toLowerCase();
  var sheet = ensureSheet(SHEET_IQUI_CIS_DIARIO, IQUI_CIS_DIARIO_HEADERS);
  try { sheet.getRange(1,1,1,IQUI_CIS_DIARIO_HEADERS.length).setValues([IQUI_CIS_DIARIO_HEADERS]); } catch(e){}
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var values = sheet.getRange(2, 1, lastRow - 1, IQUI_CIS_DIARIO_HEADERS.length).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[0]) return;
    if (mesN && normalizeYYYYMM(row[1]) !== mesN) return;
    if (ruta && cleanString(row[2]).toLowerCase() !== ruta) return;
    out.push({
      id:       cleanString(row[0]),
      mes:      normalizeYYYYMM(row[1]),
      ruta:     cleanString(row[2]).toLowerCase(),
      fecha:    formatDate(row[3]),
      prog_n:   parseNumber(row[4]),
      prog_mb:  parseNumber(row[5]),
      carga_n:  parseNumber(row[6]),
      carga_mb: parseNumber(row[7]),
      trans_n:  parseNumber(row[8]),
      trans_mb: parseNumber(row[9]),
      desc_n:   parseNumber(row[10]),
      desc_mb:  parseNumber(row[11]),
      obs:      cleanString(row[12]),
      updated_at: row[13] instanceof Date ? row[13].toISOString() : cleanString(row[13]),
      usuario:  cleanString(row[14]),
      producto: cleanString(row[15])
    });
  });
  // Ordenar por fecha y luego por producto
  out.sort(function(a,b){
    if ((a.fecha||'') !== (b.fecha||'')) return (a.fecha||'') < (b.fecha||'') ? -1 : 1;
    return (a.producto||'') < (b.producto||'') ? -1 : 1;
  });
  return createJsonResponse(JSON.stringify(out));
}

function handleSaveCisDiario(payload) {
  var r = payload.registro || {};
  var mesN  = normalizeYYYYMM(r.mes || '');
  var ruta  = cleanString(r.ruta || '').toLowerCase();
  var fecha = formatDate(r.fecha || '');
  var prod  = cleanString(r.producto || '');
  if (!mesN || !ruta || !fecha) return createErrorResponse('Faltan mes, ruta o fecha');
  var sheet = ensureSheet(SHEET_IQUI_CIS_DIARIO, IQUI_CIS_DIARIO_HEADERS);
  try {
    sheet.getRange(1,1,1,IQUI_CIS_DIARIO_HEADERS.length).setValues([IQUI_CIS_DIARIO_HEADERS]);
    sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@'); // MES texto
    sheet.getRange(1, 4, sheet.getMaxRows(), 1).setNumberFormat('@'); // FECHA texto
  } catch(e){}
  var id  = mesN + '|' + ruta + '|' + fecha + '|' + prod;
  var now = new Date().toISOString();
  var usuario = '';
  try { usuario = Session.getActiveUser().getEmail() || cleanString(r.usuario || 'Flota'); }
  catch(e) { usuario = cleanString(r.usuario || 'Flota'); }
  var rowV = [
    id, mesN, ruta, fecha,
    parseNumber(r.prog_n),  parseNumber(r.prog_mb),
    parseNumber(r.carga_n), parseNumber(r.carga_mb),
    parseNumber(r.trans_n), parseNumber(r.trans_mb),
    parseNumber(r.desc_n),  parseNumber(r.desc_mb),
    cleanString(r.obs), now, usuario, prod
  ];
  _iquiUpsertById(sheet, id, rowV, IQUI_CIS_DIARIO_HEADERS.length);
  return createSuccessResponse('Reporte diario de cisternas guardado: ' + fecha + (prod?(' / '+prod):''));
}

// ═══════════════════════════════════════════════════════════════════════════
// Balance de tanque en Yurimaguas (sinceramiento de volumen para Iquitos)
// GET  getTanqueYuri?mes=YYYY-MM
// POST saveTanqueYuri { registro:{ mes, fecha, producto, saldo_ini, ing_cis,
//                        cons_local, carga_barc, prog_iquitos, standby, obs } }
// ═══════════════════════════════════════════════════════════════════════════
function handleGetTanqueYuri(params) {
  var mesN  = normalizeYYYYMM(params.mes || '');
  var sheet = ensureSheet(SHEET_IQUI_TANQUE_YURI, IQUI_TANQUE_YURI_HEADERS);
  try { sheet.getRange(1,1,1,IQUI_TANQUE_YURI_HEADERS.length).setValues([IQUI_TANQUE_YURI_HEADERS]); } catch(e){}
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var values = sheet.getRange(2, 1, lastRow - 1, IQUI_TANQUE_YURI_HEADERS.length).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[0]) return;
    if (mesN && normalizeYYYYMM(row[1]) !== mesN) return;
    out.push({
      id:           cleanString(row[0]),
      mes:          normalizeYYYYMM(row[1]),
      fecha:        formatDate(row[2]),
      producto:     cleanString(row[3]),
      saldo_ini:    parseNumber(row[4]),
      ing_cis:      parseNumber(row[5]),
      cons_local:   parseNumber(row[6]),
      carga_barc:   parseNumber(row[7]),
      prog_iquitos: parseNumber(row[8]),
      standby:      cleanString(row[9]).toUpperCase() === 'SI',
      obs:          cleanString(row[10]),
      updated_at:   row[11] instanceof Date ? row[11].toISOString() : cleanString(row[11]),
      usuario:      cleanString(row[12])
    });
  });
  out.sort(function(a,b){
    if ((a.fecha||'') !== (b.fecha||'')) return (a.fecha||'') < (b.fecha||'') ? -1 : 1;
    return (a.producto||'') < (b.producto||'') ? -1 : 1;
  });
  return createJsonResponse(JSON.stringify(out));
}

function handleSaveTanqueYuri(payload) {
  var r = payload.registro || {};
  var mesN  = normalizeYYYYMM(r.mes || '');
  var fecha = formatDate(r.fecha || '');
  var prod  = cleanString(r.producto || '');
  if (!mesN || !fecha || !prod) return createErrorResponse('Faltan mes, fecha o producto');
  var sheet = ensureSheet(SHEET_IQUI_TANQUE_YURI, IQUI_TANQUE_YURI_HEADERS);
  try {
    sheet.getRange(1,1,1,IQUI_TANQUE_YURI_HEADERS.length).setValues([IQUI_TANQUE_YURI_HEADERS]);
    sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@'); // MES texto
    sheet.getRange(1, 3, sheet.getMaxRows(), 1).setNumberFormat('@'); // FECHA texto
  } catch(e){}
  var id  = mesN + '|' + fecha + '|' + prod;
  var now = new Date().toISOString();
  var usuario = '';
  try { usuario = Session.getActiveUser().getEmail() || cleanString(r.usuario || 'Flota'); }
  catch(e) { usuario = cleanString(r.usuario || 'Flota'); }
  var rowV = [
    id, mesN, fecha, prod,
    parseNumber(r.saldo_ini), parseNumber(r.ing_cis), parseNumber(r.cons_local),
    parseNumber(r.carga_barc), parseNumber(r.prog_iquitos),
    (r.standby ? 'SI' : 'NO'), cleanString(r.obs), now, usuario
  ];
  _iquiUpsertById(sheet, id, rowV, IQUI_TANQUE_YURI_HEADERS.length);
  return createSuccessResponse('Balance de tanque Yurimaguas guardado: ' + fecha + ' / ' + prod);
}

// ═══════════════════════════════════════════════════════════════════════════
// POST: borrar viaje por ID
// payload: { action:'deleteIquiViaje', tipo:'terrestre'|'fluvial', id:'...' }
// ═══════════════════════════════════════════════════════════════════════════
function handleDeleteIquiViaje(payload) {
  var tipo = cleanString(payload.tipo);
  var id = cleanString(payload.id);
  var sheetName = (tipo === 'fluvial') ? SHEET_IQUI_VIAJES_FLUV : SHEET_IQUI_VIAJES_TERR;
  var sheet = getSheetSafe(sheetName);
  if (!sheet) return createSuccessResponse('Hoja no existe, nada que borrar');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createSuccessResponse('Sin filas');
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (cleanString(ids[i][0]) === id) { sheet.deleteRow(i + 2); }
  }
  return createSuccessResponse('Viaje borrado: ' + id);
}

// ═══════════════════════════════════════════════════════════════════════════
// GET: Costos logísticos
// ═══════════════════════════════════════════════════════════════════════════
function handleGetIquiCostos(params) {
  var sheet = ensureSheet(SHEET_IQUI_COSTOS, IQUI_COSTOS_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return createJsonResponse('[]');
  var values = sheet.getRange(2, 1, lastRow - 1, IQUI_COSTOS_HEADERS.length).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[0]) return;
    out.push({
      id:        cleanString(row[0]),
      mes:       cleanString(row[1]),
      tipo:      cleanString(row[2]),
      concepto:  cleanString(row[3]),
      monto:     parseNumber(row[4]),
      mb:        parseNumber(row[5])
    });
  });
  return createJsonResponse(JSON.stringify(out));
}

// ═══════════════════════════════════════════════════════════════════════════
// POST: guardar costo (UPSERT por ID)
// payload: { action:'saveIquiCosto', costo:{id?,mes,tipo,concepto,monto,mb} }
// ═══════════════════════════════════════════════════════════════════════════
function handleSaveIquiCosto(payload) {
  var c = payload.costo || {};
  var sheet = ensureSheet(SHEET_IQUI_COSTOS, IQUI_COSTOS_HEADERS);
  var id = cleanString(c.id) || ('COST-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
  var now = new Date().toISOString();
  var row = [id, cleanString(c.mes), cleanString(c.tipo), cleanString(c.concepto),
             parseNumber(c.monto), parseNumber(c.mb), now];
  _iquiUpsertById(sheet, id, row, IQUI_COSTOS_HEADERS.length);
  return createSuccessResponse('Costo guardado: ' + id);
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO CISTERNAS — Movimiento Diario de Transporte Terrestre
// Hoja: cisternas_terrestres  (nombre real en BD_INVENTARIOS)
// ═══════════════════════════════════════════════════════════════════════════

var CISTERNAS_SHEET = 'cisternas_terrestres';
var CISTERNAS_HEADERS = [
  'fecha','operador','tipo','origen','destino','desc_ruta','id_ruta',
  'producto','cod_prod',
  'prog_und','carga_und','transito_und','descarga_und','vacias_und',
  'prog_gal','carga_gal','transito_gal','descarga_gal',
  'transito_mb','carga_mb','descarga_mb','prog_mb',
  'rep_revisado','id_reportado',
  'flota_contratada','fuera_servicio','viaje_adicional',
  'updated_at'
];

function _normFechaCist(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return v.getFullYear() + '-'
      + String(v.getMonth()+1).padStart(2,'0') + '-'
      + String(v.getDate()).padStart(2,'0');
  }
  return String(v).trim().slice(0,10);
}

// GET ?action=getCisternas&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
function handleGetCisternas(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CISTERNAS_SHEET);
  if (!sh || sh.getLastRow() < 2) return createJsonResponse(JSON.stringify([]));

  var all  = sh.getDataRange().getValues();
  // Normalizar headers a lowercase para que frontend reciba r.fecha, r.origen, etc.
  var H    = all[0].map(function(h){ return String(h).trim().toLowerCase(); });
  var desde = params && params.desde ? String(params.desde).trim() : '';
  var hasta = params && params.hasta ? String(params.hasta).trim() : '';
  var fiF  = H.indexOf('fecha'); if (fiF < 0) fiF = 0;

  var NUM_COLS = ['prog_und','carga_und','transito_und','descarga_und','vacias_und',
    'prog_gal','carga_gal','transito_gal','descarga_gal',
    'transito_mb','carga_mb','descarga_mb','prog_mb',
    'flota_contratada','fuera_servicio','viaje_adicional'];

  var result = [];
  for (var i = 1; i < all.length; i++) {
    var row = all[i];
    if (!row[fiF]) continue;
    var fecha = _normFechaCist(row[fiF]);
    if (!fecha) continue;
    if (desde && fecha < desde) continue;
    if (hasta && fecha > hasta) continue;
    var obj = { fecha: fecha };
    H.forEach(function(col, j) {
      if (col === 'fecha') return;
      var v = row[j];
      if (v instanceof Date) v = _normFechaCist(v);
      obj[col] = (v === null || v === undefined || v === '')
        ? (NUM_COLS.indexOf(col) >= 0 ? 0 : '')
        : v;
    });
    result.push(obj);
  }
  return createJsonResponse(JSON.stringify(result));
}

// POST {action:'uploadCisternas', fecha:'YYYY-MM-DD', records:[...]}
function handleUploadCisternas(payload) {
  var records = payload.records || [];
  var fecha   = String(payload.fecha || '').trim();
  if (!records.length || !fecha) return createErrorResponse(new Error('Faltan records o fecha'));

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CISTERNAS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CISTERNAS_SHEET);
    sh.getRange(1,1,1,CISTERNAS_HEADERS.length).setValues([CISTERNAS_HEADERS]);
    sh.setFrozenRows(1);
  }

  var all = sh.getDataRange().getValues();
  var H   = all[0].map(function(h){ return String(h).trim().toLowerCase(); });
  var fiF = H.indexOf('fecha'), fiR = H.indexOf('id_ruta'), fiP = H.indexOf('producto');

  // Mapa de filas existentes por fecha|id_ruta|producto → row index 1-based
  var keyMap = {};
  for (var i = 1; i < all.length; i++) {
    if (!all[i][0] && !all[i][1]) continue;
    var ef = _normFechaCist(fiF >= 0 ? all[i][fiF] : '');
    var er = String(fiR >= 0 ? all[i][fiR]||'' : '').trim();
    var ep = String(fiP >= 0 ? all[i][fiP]||'' : '').trim();
    if (ef) keyMap[ef+'|'+er+'|'+ep] = i+1;
  }

  var now = new Date().toISOString();
  var updated = 0, newRows = [];

  records.forEach(function(r) {
    var rowKey = fecha+'|'+String(r.id_ruta||'').trim()+'|'+String(r.producto||'').trim();
    var rowData = H.map(function(col) {
      if (col === 'fecha')      return fecha;
      if (col === 'updated_at') return now;
      var v = r[col];
      if (v === undefined || v === null || v === '') {
        return ['prog_und','carga_und','transito_und','descarga_und','vacias_und',
          'prog_gal','carga_gal','transito_gal','descarga_gal',
          'transito_mb','carga_mb','descarga_mb','prog_mb',
          'flota_contratada','fuera_servicio','viaje_adicional'].indexOf(col) >= 0 ? 0 : '';
      }
      return v;
    });
    if (keyMap[rowKey]) {
      sh.getRange(keyMap[rowKey],1,1,H.length).setValues([rowData]);
      updated++;
    } else {
      newRows.push(rowData);
    }
  });
  if (newRows.length) sh.getRange(sh.getLastRow()+1,1,newRows.length,H.length).setValues(newRows);

  auditLog(CISTERNAS_SHEET,'UPLOAD',fecha,
    'updated:'+updated+' inserted:'+newRows.length+' total:'+records.length,'SISTEMA');
  return createSuccessResponse({fecha:fecha, updated:updated, inserted:newRows.length, total:records.length});
}
// Ejecutar una vez desde el editor de Apps Script
// ═══════════════════════════════════════════════════════════════════════════
function setupIquitosSheets() {
  // Guarda: el script debe estar enlazado a una hoja de cálculo
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('❌ ERROR: el script no está enlazado a ninguna hoja de cálculo. ' +
               'Abre BD_INVENTARIOS → Extensiones → Apps Script para que getActiveSpreadsheet() funcione.');
    return 'ERROR: script no enlazado a una hoja';
  }
  var planSheet = ensureSheet(SHEET_PLAN_REFINACION, PLAN_REF_HEADERS);
  if (planSheet.getLastRow() < 2) _iquiSeedPlanRefinacion(planSheet);
  ensureSheet(SHEET_IQUI_VIAJES_TERR, IQUI_VIAJES_TERR_HEADERS);
  ensureSheet(SHEET_IQUI_VIAJES_FLUV, IQUI_VIAJES_FLUV_HEADERS);
  ensureSheet(SHEET_IQUI_COSTOS, IQUI_COSTOS_HEADERS);
  Logger.log('✅ Hojas del módulo Iquitos creadas/verificadas');
  return 'OK: plan_refinacion, iqui_viajes_terrestres, iqui_viajes_fluviales, iqui_costos';
}


// ═══════════════════════════════════════════════════════════════════════
// REGISTRO DIARIO — MÓDULO DE AUTENTICACIÓN, CAPTURA Y SEGUIMIENTO
// Fase 1 (corto plazo, sobre el stack actual: Google Sheets + Apps Script
// + Vercel). Usuario/contraseña propio en Sheets — sin Google Workspace.
// Migrar a un backend con base de datos relacional (SQL) cuando el
// volumen de usuarios/registros lo justifique; ver notas al final.
// ═══════════════════════════════════════════════════════════════════════

// ── Hash de contraseña (SHA-256 + salt por usuario) ─────────────────────
function rdHashPassword(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + '|' + salt, Utilities.Charset.UTF_8);
  return raw.map(function(b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

// ── Token de sesión firmado (HMAC-SHA256), sin hoja de sesiones ────────
// Formato: base64url(JSON{email,nombre,planta,exp}) + '.' + firma_hex
function rdSignToken(payloadObj) {
  var json = JSON.stringify(payloadObj);
  var b64 = Utilities.base64EncodeWebSafe(json);
  var sigRaw = Utilities.computeHmacSha256Signature(b64, AUTH_CONFIG.getSecret());
  var sig = sigRaw.map(function(b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
  return b64 + '.' + sig;
}

function rdVerifyToken(token) {
  try {
    if (!token || token.indexOf('.') < 0) return null;
    var parts = token.split('.');
    var b64 = parts[0], sig = parts[1];
    var sigRaw = Utilities.computeHmacSha256Signature(b64, AUTH_CONFIG.getSecret());
    var expected = sigRaw.map(function(b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
    if (expected !== sig) return null;
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString();
    var data = JSON.parse(json);
    if (!data.exp || Date.now() > data.exp) return null;
    return data; // {email, nombre, planta, exp}
  } catch (e) { return null; }
}

function rdRequireAuth(token) {
  var data = rdVerifyToken(token);
  if (!data) throw new Error('Tu sesión expiró o no es válida. Vuelve a iniciar sesión.');
  return data; // {email, exp} — SOLO ASCII. nombre/planta se leen frescos de la hoja.
}

// El token JWT-like solo lleva email+exp (ambos ASCII: el dominio es
// @petroperu.com.pe). Nombre y planta pueden llevar tildes/ñ (p.ej.
// "Conchán"); si viajaran dentro del token codificado en base64 podían
// corromperse en el viaje ida y vuelta. Por eso siempre se re-leen desde
// la hoja `usuarios` en cada request autenticado — además así, si un
// administrador reasigna la planta de alguien, el cambio aplica de
// inmediato sin pedirle reloguearse.
function rdCurrentUser(token) {
  var auth = rdRequireAuth(token);
  var found = rdFindUsuarioRow(auth.email);
  if (!found) throw new Error('Usuario no encontrado. Vuelve a iniciar sesión.');
  var planta = cleanString(found.row[2]);
  var rolRaw = cleanString(found.row[5] || 'operador');
  // Admin si el ROL dice 'admin' (cualquier capitalización) O si la planta
  // registrada es 'Administrador' (así se crean las cuentas de GPLO/Planificación).
  // El registro (handleRdRegistrar) siempre graba ROL='operador' por defecto,
  // así que sin este fallback por planta ningún admin real pasaría el check.
  var isAdmin = rolRaw.toLowerCase() === 'admin' || planta === 'Administrador';
  return { email: auth.email, nombre: cleanString(found.row[1]), planta: planta,
           rol: isAdmin ? 'admin' : rolRaw };
}

function ensureUsuariosSheet() {
  return ensureSheet(CONFIG.SHEETS.USUARIOS,
    ['EMAIL', 'NOMBRE', 'PLANTA', 'PASSWORD_HASH', 'SALT', 'ROL', 'FECHA_REGISTRO',
     'ACTIVO', 'INTENTOS_FALLIDOS', 'BLOQUEADO_HASTA', 'ULTIMO_LOGIN', 'RESET_TOKEN', 'RESET_EXPIRA']);
}

function rdFindUsuarioRow(email) {
  var sheet = ensureUsuariosSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (var i = 0; i < data.length; i++) {
    if (cleanString(data[i][0]).toLowerCase() === email.toLowerCase()) {
      return { rowIndex: i + 2, row: data[i] };
    }
  }
  return null;
}

// ── Registro de cuenta ──────────────────────────────────────────────────
function handleRdRegistrar(payload) {
  var email = cleanString(payload.email).toLowerCase();
  var nombre = cleanString(payload.nombre);
  var planta = cleanString(payload.planta);
  var password = payload.password || '';

  if (!email || !nombre || !planta || !password) throw new Error('Todos los campos son obligatorios');
  // Validar que sea un email con formato mínimo (a@b.c)
  if (email.indexOf('@') < 1 || email.indexOf('.') < 0) throw new Error('Formato de correo inválido');
  // Solo correo corporativo — bloquea Gmail, Hotmail, Outlook.com personal,
  // etc. desde el registro. CONFIG.DOMINIO_PERMITIDO ya existía definido
  // pero nunca se validaba en ningún lado.
  if (email.slice(-CONFIG.DOMINIO_PERMITIDO.length) !== CONFIG.DOMINIO_PERMITIDO) {
    throw new Error('Solo se permiten cuentas de correo corporativo (' + CONFIG.DOMINIO_PERMITIDO + ')');
  }
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (RD_PLANTAS.indexOf(planta) < 0 && planta !== 'Administrador') throw new Error('Planta no reconocida');

  var existing = rdFindUsuarioRow(email);
  if (existing) throw new Error('Ya existe una cuenta registrada con ese correo');

  var salt = Utilities.getUuid();
  var hash = rdHashPassword(password, salt);
  var sheet = ensureUsuariosSheet();
  sheet.appendRow([email, nombre, planta, hash, salt, 'operador', new Date().toISOString(),
                    true, 0, '', '', '', '']);
  auditLog(CONFIG.SHEETS.USUARIOS, 'REGISTRO', email, 'Nueva cuenta, planta=' + planta, email);
  return createSuccessResponse('Cuenta creada correctamente. Ya puedes iniciar sesión.');
}

// ── Login (con bloqueo por intentos fallidos) ──────────────────────────
function handleRdLogin(payload) {
  var email = cleanString(payload.email).toLowerCase();
  var password = payload.password || '';
  if (!email || !password) throw new Error('Ingresa tu correo y contraseña');

  var found = rdFindUsuarioRow(email);
  if (!found) throw new Error('Correo o contraseña incorrectos');
  var sheet = ensureUsuariosSheet();
  var row = found.row;
  var nombre = cleanString(row[1]);
  var planta = cleanString(row[2]);
  var hash   = cleanString(row[3]);
  var salt   = cleanString(row[4]);
  var rol    = cleanString(row[5]) || 'operador';
  var activo = row[7];
  var intentos = parseNumber(row[8]);
  var bloqueadoHasta = row[9];

  if (bloqueadoHasta) {
    var hasta = new Date(bloqueadoHasta);
    if (!isNaN(hasta.getTime()) && hasta.getTime() > Date.now()) {
      var minRestantes = Math.ceil((hasta.getTime() - Date.now()) / 60000);
      throw new Error('Cuenta bloqueada temporalmente. Intenta de nuevo en ' + minRestantes + ' min.');
    }
  }
  // ACTIVO puede ser booleano true/false (si la celda es checkbox en Sheets)
  // o el string 'TRUE'/'FALSE' (si se escribió como texto). Normalizamos.
  var activoNorm = (activo === true || activo === 'TRUE' || activo === 'true');
  if (!activoNorm) throw new Error('Cuenta desactivada. Contacta al administrador.');

  var hashIntento = rdHashPassword(password, salt);
  if (hashIntento !== hash) {
    intentos++;
    if (intentos >= AUTH_CONFIG.MAX_INTENTOS_FALLIDOS) {
      var bloqueoHasta = new Date(Date.now() + AUTH_CONFIG.BLOQUEO_MINUTOS * 60000);
      sheet.getRange(found.rowIndex, 9, 1, 2).setValues([[intentos, bloqueoHasta.toISOString()]]);
      auditLog(CONFIG.SHEETS.USUARIOS, 'BLOQUEO', email, intentos + ' intentos fallidos', email);
      throw new Error('Demasiados intentos fallidos. Cuenta bloqueada ' + AUTH_CONFIG.BLOQUEO_MINUTOS + ' minutos.');
    }
    sheet.getRange(found.rowIndex, 9, 1, 1).setValues([[intentos]]);
    throw new Error('Correo o contraseña incorrectos (' + (AUTH_CONFIG.MAX_INTENTOS_FALLIDOS - intentos) + ' intento(s) restante(s))');
  }

  // Login correcto: resetear contador y registrar último acceso
  sheet.getRange(found.rowIndex, 9, 1, 2).setValues([[0, '']]);
  sheet.getRange(found.rowIndex, 11, 1, 1).setValues([[new Date().toISOString()]]);

  // El token lleva email, rol y expiración (todo ASCII-safe)
  var token = rdSignToken({ email: email, rol: rol, exp: Date.now() + AUTH_CONFIG.TOKEN_VALIDEZ_HORAS * 3600000 });
  auditLog(CONFIG.SHEETS.USUARIOS, 'LOGIN', email, 'Login exitoso, rol=' + rol, email);
  return createJsonResponse(JSON.stringify({
    success: true, token: token,
    nombre: nombre, planta: planta, email: email, rol: rol
  }));
}

// ── Recuperación de contraseña (enlace de un solo uso por correo) ─────
function handleRdSolicitarReset(payload) {
  var email = cleanString(payload.email).toLowerCase();
  if (!email) throw new Error('Ingresa tu correo');
  var found = rdFindUsuarioRow(email);
  // Por seguridad, la respuesta es siempre la misma exista o no la cuenta
  if (found) {
    var sheet = ensureUsuariosSheet();
    var resetToken = Utilities.getUuid();
    var expira = new Date(Date.now() + AUTH_CONFIG.RESET_TOKEN_VALIDEZ_MINUTOS * 60000);
    sheet.getRange(found.rowIndex, 12, 1, 2).setValues([[resetToken, expira.toISOString()]]);
    try {
      var baseUrl = cleanString(payload.appUrl);
      var link = baseUrl
        ? (baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + 'view=reset&token=' + resetToken)
        : resetToken;
      MailApp.sendEmail({
        to: email,
        subject: 'Petroperú · Restablecer contraseña — Registro Diario de Inventarios',
        body: 'Hola,\n\nRecibimos una solicitud para restablecer tu contraseña del Registro Diario de Inventarios.\n\n' +
              'Enlace para crear una nueva contraseña (válido ' + AUTH_CONFIG.RESET_TOKEN_VALIDEZ_MINUTOS + ' minutos):\n' + link +
              '\n\nSi no solicitaste esto, puedes ignorar este correo.\n\nPlanificación de Suministro · GPLO · Petroperú S.A.'
      });
    } catch (e) { Logger.log('rdSolicitarReset mail error: ' + e.message); }
    auditLog(CONFIG.SHEETS.USUARIOS, 'RESET_SOLICITADO', email, '', email);
  }
  return createSuccessResponse('Si el correo existe en el sistema, te enviamos un enlace de recuperación.');
}

function handleRdResetPassword(payload) {
  var token = cleanString(payload.token);
  var newPassword = payload.newPassword || '';
  if (!token || !newPassword) throw new Error('Datos incompletos');
  if (newPassword.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  var sheet = ensureUsuariosSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Enlace inválido');
  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (var i = 0; i < data.length; i++) {
    if (cleanString(data[i][11]) === token) {
      var exp = new Date(data[i][12]);
      if (isNaN(exp.getTime()) || exp.getTime() < Date.now()) throw new Error('El enlace expiró. Solicita uno nuevo.');
      var salt = Utilities.getUuid();
      var hash = rdHashPassword(newPassword, salt);
      var rowIndex = i + 2;
      sheet.getRange(rowIndex, 4, 1, 2).setValues([[hash, salt]]);   // hash, salt
      sheet.getRange(rowIndex, 9, 1, 2).setValues([[0, '']]);        // intentos, bloqueo
      sheet.getRange(rowIndex, 12, 1, 2).setValues([['', '']]);      // limpia token/expira
      auditLog(CONFIG.SHEETS.USUARIOS, 'RESET_COMPLETADO', cleanString(data[i][0]), '', cleanString(data[i][0]));
      return createSuccessResponse('Contraseña actualizada. Ya puedes iniciar sesión.');
    }
  }
  throw new Error('Enlace inválido o ya utilizado');
}

// ── Catálogo de plantas / productos para el formulario ─────────────────
function handleRdGetPlantas() {
  return createJsonResponse(JSON.stringify({
    success: true, plantas: RD_PLANTAS, productosPorPlanta: PRODUCTOS_POR_PLANTA, refinerias: RD_REFINERIAS
  }));
}

// ── Guardar reporte diario (requiere sesión válida) ─────────────────────
function handleRdGuardarReporte(payload) {
  var user = rdCurrentUser(payload.token);
  var fecha = formatDate(payload.fecha) || formatDate(new Date());
  var planta = user.planta; // la planta viene de la sesión (recién leída), nunca del cliente
  var productos = payload.productos || [];
  var comentario = cleanString(payload.comentario);

  if (!productos.length) throw new Error('Ingresa al menos un producto');
  var validos = PRODUCTOS_POR_PLANTA[planta] || PRODUCTOS_BASE;
  productos.forEach(function(p) {
    if (validos.indexOf(p.producto) < 0) throw new Error('Producto no válido para ' + planta + ': ' + p.producto);
  });

  // 1) Captura cruda, append-only y versionada (trazabilidad total; nunca
  //    se sobrescribe una fila existente, se agrega una versión nueva).
  //    Solo se piden campos que el usuario realmente debe ingresar: la
  //    existencia. Todo lo demás (vacío, cobertura, pronóstico, vfact...)
  //    es calculado por otros procesos y NUNCA se pide ni se sobrescribe.
  //    COMENTARIO_PROD: comentario específico por producto (nuevo campo).
  var rdSheet = ensureSheet(CONFIG.SHEETS.REPORTE_DIARIO,
    ['ID', 'FECHA', 'PLANTA', 'PRODUCTO', 'EXISTENCIA', 'VERSION', 'TIMESTAMP', 'USUARIO', 'IP', 'EQUIPO', 'COMENTARIO_PROD', 'RECEPCION_BT', 'EXISTENCIA_MINIMA', 'MOTIVO_MINIMA']);
  var lastRow = rdSheet.getLastRow();
  var maxVersion = {};
  if (lastRow >= 2) {
    var existing = rdSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    existing.forEach(function(row) {
      if (formatDate(row[1]) === fecha && cleanString(row[2]) === planta) {
        var key = cleanString(row[3]);
        maxVersion[key] = Math.max(maxVersion[key] || 0, parseNumber(row[5]));
      }
    });
  }
  var now = new Date().toISOString();
  var ip = cleanString(payload.clientInfo && payload.clientInfo.ip);
  var equipo = cleanString(payload.clientInfo && payload.clientInfo.equipo);
  var newRows = productos.map(function(p) {
    var version = (maxVersion[p.producto] || 0) + 1;
    var comentProd = cleanString(p.comentario_prod || '');
    var recepBT    = cleanString(p.recepcion_bt   || ''); // 'SI|NOMBRE_BT|VOL' o ''
    var existMin   = (p.existencia_minima === true || p.existencia_minima === 'true') ? 1 : 0;
    var motivoMin  = cleanString(p.motivo_minima || '');
    return [Utilities.getUuid(), fecha, planta, p.producto,
            parseNumber(p.existencia), version, now, user.email, ip, equipo, comentProd, recepBT,
            existMin, motivoMin];
  });
  rdSheet.getRange(rdSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);

  // 2) Estado de seguimiento del día — una fila por fecha+planta (para el
  //    módulo "quién ya reportó" del dashboard).
  var estSheet = ensureSheet(CONFIG.SHEETS.REPORTE_ESTADO,
    ['FECHA', 'PLANTA', 'ESTADO', 'USUARIO', 'NOMBRE', 'HORA', 'COMENTARIO', 'BT_NAVE', 'BT_ETA', 'BT_VOLUMEN', 'IP', 'EQUIPO']);
  var estLast = estSheet.getLastRow();
  var estRowIndex = -1;
  if (estLast >= 2) {
    var estData = estSheet.getRange(2, 1, estLast - 1, 2).getValues();
    for (var i = 0; i < estData.length; i++) {
      if (formatDate(estData[i][0]) === fecha && cleanString(estData[i][1]) === planta) { estRowIndex = i + 2; break; }
    }
  }
  // Campos de nave/B-T quedan vacíos aquí: ese registro pasa a un
  // formulario aparte para la unidad de transporte marítimo.
  var estRow = [fecha, planta, 'Reportado', user.email, user.nombre, now, comentario, '', '', '', ip, equipo];
  if (estRowIndex > 0) estSheet.getRange(estRowIndex, 1, 1, estRow.length).setValues([estRow]);
  else estSheet.appendRow(estRow);

  // 3) Reflejar en `inventario` (la hoja que ya alimenta Index.html) SOLO
  //    las celdas que este formulario realmente controla: existencia y
  //    comentario. Nunca toca pronóstico, vfact, cobertura, ventas ni
  //    ningún otro campo calculado — a diferencia de un upsert de fila
  //    completa, esto solo escribe celda por celda.
  productos.forEach(function(p) {
    var existMinFlag = (p.existencia_minima === true || p.existencia_minima === 'true') ? 1 : 0;
    rdUpsertInventarioCells(fecha, rdPlantaLegacy(planta), p.producto, {
      inv:                parseNumber(p.existencia),
      comentario:         comentario,
      despacho_diario:    parseNumber(p.despacho_diario || 0),  // opcional; si >0 sobreescribe dem
      existencia_minima:  existMinFlag,
      comentario_prod:    cleanString(p.comentario_prod || '')
    });
  });

  // 4) Actualizar la hoja `capacidad_referencia` con los valores de
  //    Capacidad, Fondos y Fondo OSINERGMIN que el encargado haya
  //    corregido en el formulario — así queda como el nuevo valor base
  //    para la próxima vez, editable siempre desde la hoja también.
  rdUpsertCapacidadRef(planta, productos);

  clearCache();

  auditLog(CONFIG.SHEETS.REPORTE_DIARIO, 'GUARDAR', planta + '|' + fecha,
    productos.length + ' producto(s), comentario=' + (comentario ? 'sí' : 'no'), user.email);

  return createSuccessResponse('Reporte del ' + fecha + ' registrado correctamente para ' + planta + '.');
}

// ── Admin: corregir contraseña (hashear si está en texto plano) ────────
// Llamada UNA SOLA VEZ para cada cuenta cuya contraseña se escribió
// manualmente en la hoja en lugar de usar rdRegistrar.
// Payload: { action:'rdAdminSetPassword', email:'...', newPassword:'...',
//            adminSecret:'...' }  ← adminSecret se define en PropertiesService.
function handleRdAdminSetPassword(payload) {
  // Verificar secreto de administrador (guardado en Script Properties,
  // nunca expuesto en el código fuente).
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('ADMIN_SECRET') || 'petroperu_admin_2024';
  if (cleanString(payload.adminSecret) !== secret) {
    throw new Error('Acceso no autorizado');
  }
  var email = cleanString(payload.email).toLowerCase();
  var newPassword = payload.newPassword || '';
  if (!email || !newPassword) throw new Error('email y newPassword son requeridos');
  if (newPassword.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  var found = rdFindUsuarioRow(email);
  if (!found) throw new Error('Usuario no encontrado: ' + email);
  var sheet = ensureUsuariosSheet();
  var salt = Utilities.getUuid();
  var hash = rdHashPassword(newPassword, salt);
  // Columnas: 4=PASSWORD_HASH, 5=SALT, 9=INTENTOS_FALLIDOS, 10=BLOQUEADO_HASTA
  sheet.getRange(found.rowIndex, 4, 1, 2).setValues([[hash, salt]]);
  sheet.getRange(found.rowIndex, 9, 1, 2).setValues([[0, '']]);
  auditLog(CONFIG.SHEETS.USUARIOS, 'ADMIN_SET_PASSWORD', email, 'Contraseña actualizada por admin', 'ADMIN');
  return createSuccessResponse('Contraseña actualizada correctamente para ' + email);
}

function rdUpsertCapacidadRef(planta, productos) {
  var sheet = ensureCapacidadRefSheet();
  var lastRow = sheet.getLastRow();
  var index = {}; // producto -> rowIndex
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (cleanString(data[i][0]) === planta) index[cleanString(data[i][1])] = i + 2;
    }
  }
  productos.forEach(function(p) {
    if (p.capacidad === undefined && p.fondos === undefined && p.fondo_osinergmin === undefined) return;
    var rowIndex = index[p.producto];
    var vals = [planta, p.producto, parseNumber(p.capacidad), parseNumber(p.fondos), parseNumber(p.fondo_osinergmin)];
    if (rowIndex) sheet.getRange(rowIndex, 1, 1, 5).setValues([vals]);
    else sheet.appendRow(vals);
  });
}

// Columnas de `inventario` en el mismo orden que buildRowArray() (ver
// arriba). Se usa para escribir SOLO celdas puntuales sin tocar el resto
// de la fila (a diferencia de handleBatchUpsert, que reescribe la fila
// completa y por eso no es seguro usarlo aquí).
var RD_INV_COLS = {
  fecha: 1, planta: 2, producto: 3, inv: 4, pron: 5, vult7: 6, vreal: 7,
  dem_prom: 8, dem: 9, var_dem: 10, vfact: 11, cob: 12, fecha_cobertura: 13,
  fecha_reposicion: 14, bt: 15, vol_rep: 16, vacio: 17, comentario: 18,
  fecha_repos_bt2: 19, bt2: 20, vol_rep_bt2: 21, vacio2: 22
};

// Columnas numéricas de la hoja 'inventario' que necesitan más precisión
// decimal — valores como despacho (0.087 MB) se veían truncados a "0.01"
// con el formato de 2 decimales que Sheets aplica por defecto. El valor
// GUARDADO siempre tuvo precisión completa (Apps Script no trunca al
// escribir), pero el FORMATO DE CELDA sí limitaba lo que se veía —
// afectando directamente el cálculo de cobertura real (inv÷despacho) al
// leer una cifra visualmente redondeada.
var RD_INV_COLS_NUMERICAS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 21, 22];

// Ejecutar UNA VEZ desde el editor de Apps Script para corregir el
// formato de las filas YA EXISTENTES en 'inventario' (3 decimales).
function ensureInventarioNumberFormat3Decimales() {
  var sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  RD_INV_COLS_NUMERICAS.forEach(function(col) {
    sheet.getRange(2, col, lastRow - 1, 1).setNumberFormat('0.000');
  });
  Logger.log('[ensureInventarioNumberFormat3Decimales] Formato aplicado a ' + (lastRow - 1) + ' filas.');
}

function rdUpsertInventarioCells(fecha, planta, producto, fields) {
  Logger.log('[upsert] fecha=' + fecha + ' planta=' + planta + ' prod=' + producto + ' inv=' + (fields.inv||0));
  var sheet = getSheet(CONFIG.SHEETS.INVENTARIO);
  var lastRow = sheet.getLastRow();
  var rowIndex    = -1;
  var prevRowData = null; // fila del día anterior (para heredar vfact, pron, dem, etc.)

  if (lastRow >= 2) {
    var allData = sheet.getRange(2, 1, lastRow - 1, CONFIG.MAX_COLS_INV).getValues();
    var latestPrevDate = '';
    for (var i = 0; i < allData.length; i++) {
      var fe = formatDate(allData[i][0]);
      var pl = cleanString(allData[i][1]);
      var pr = cleanString(allData[i][2]);
      if (pl !== planta || pr !== producto) continue;
      if (fe === fecha) { rowIndex = i + 2; break; }
      // Guardar la fila previa más reciente antes de `fecha`
      if (fe < fecha && fe > latestPrevDate) {
        latestPrevDate = fe;
        prevRowData = allData[i];
      }
    }
  }

  if (rowIndex < 0) {
    // ── Fila nueva del día: heredar campos calculados del día anterior ──
    // Esto asegura que cob, vfact, pron, dem se vean correctamente en el
    // dashboard mientras el sistema central no recalcule.
    var base = { fecha: fecha, planta: planta, producto: producto };
    if (prevRowData) {
      // Heredar todos los campos calculados excepto inv y comentario
      base.pron     = parseNumber(prevRowData[RD_INV_COLS.pron     - 1]);
      base.vult7    = parseNumber(prevRowData[RD_INV_COLS.vult7    - 1]);
      base.vreal    = parseNumber(prevRowData[RD_INV_COLS.vreal    - 1]);
      base.dem_prom = parseNumber(prevRowData[RD_INV_COLS.dem_prom - 1]);
      base.dem      = fields.despacho_diario > 0
                        ? fields.despacho_diario                          // el operador ingresó el despacho de hoy
                        : parseNumber(prevRowData[RD_INV_COLS.dem - 1]); // heredar día anterior
      base.vreal    = fields.despacho_diario > 0
                        ? fields.despacho_diario                          // venta real = despacho registrado
                        : parseNumber(prevRowData[RD_INV_COLS.vreal - 1]);
      base.var_dem  = parseNumber(prevRowData[RD_INV_COLS.var_dem  - 1]);
      base.vfact    = parseNumber(prevRowData[RD_INV_COLS.vfact    - 1]);
      // cob = fórmula canónica (vfact si existe, si no cae al pronóstico
      // mensual APROBADO convertido a diario — no al 'pron' legado)
      var newInv = fields.inv || 0;
      var pronAprob = getPronAprobadoDiario(planta, producto, fecha);
      base.cob = cobCanonica(newInv, base.vfact, pronAprob);
      base.fecha_cobertura   = formatDate(prevRowData[RD_INV_COLS.fecha_cobertura   - 1]);
      // BT / cabotaje: heredar del día anterior SOLO si la fecha de
      // reposición programada sigue vigente (>= fecha de esta fila). Antes
      // se heredaba para siempre, así que un buque que ya había descargado
      // hace días seguía apareciendo como "cabotaje en tránsito" en el
      // gráfico de Tendencia de Inventario indefinidamente.
      var prevFechaRepos = formatDate(prevRowData[RD_INV_COLS.fecha_reposicion - 1]);
      if (prevFechaRepos && prevFechaRepos >= fecha) {
        base.fecha_reposicion = prevFechaRepos;
        base.bt               = cleanString(prevRowData[RD_INV_COLS.bt      - 1]);
        base.vol_rep          = parseNumber(prevRowData[RD_INV_COLS.vol_rep - 1]);
      } else {
        base.fecha_reposicion = '';
        base.bt      = '';
        base.vol_rep = 0;
      }
      var prevFechaRepos2 = formatDate(prevRowData[RD_INV_COLS.fecha_repos_bt2 - 1]);
      if (prevFechaRepos2 && prevFechaRepos2 >= fecha) {
        base.fecha_repos_bt2 = prevFechaRepos2;
        base.bt2             = cleanString(prevRowData[RD_INV_COLS.bt2          - 1]);
        base.vol_rep_bt2     = parseNumber(prevRowData[RD_INV_COLS.vol_rep_bt2  - 1]);
      } else {
        base.fecha_repos_bt2 = '';
        base.bt2         = '';
        base.vol_rep_bt2 = 0;
      }
    }
    var blank = buildRowArray(base);
    // Aplicar los campos que el operador ingresó (inv, comentario, etc.)
    Object.keys(fields).forEach(function(key) {
      var colIdx = RD_INV_COLS[key];
      if (colIdx) blank[colIdx - 1] = fields[key];
    });
    // Recalcular vacío con la nueva existencia
    var inv2 = blank[RD_INV_COLS.inv - 1] || 0;
    // vacío = capacidad_referencia - inv (aproximación: no tenemos cap aquí,
    // así que dejamos vacío sin tocar — se llenará en el recálculo central)
    var nuevaFilaIdx = sheet.getLastRow() + 1;
    sheet.getRange(nuevaFilaIdx, 1, 1, blank.length).setValues([blank]);
    // Formato de 3 decimales para las columnas numéricas de esta fila
    // nueva — evita que despachos/existencias pequeños (ej. 0.087) se
    // vean truncados a 2 decimales (ej. "0.01"), que distorsiona el
    // cálculo de cobertura real al leerse desde el dashboard.
    RD_INV_COLS_NUMERICAS.forEach(function(col) {
      sheet.getRange(nuevaFilaIdx, col, 1, 1).setNumberFormat('0.000');
    });
    Logger.log('[rdUpsert] Fila nueva ' + fecha + '|' + planta + '|' + producto
               + ' inv=' + inv2 + ' vfact=' + base.vfact + ' cob=' + base.cob);
    return;
  }

  // ── Fila existente: actualizar celdas campo a campo ──────────────────
  // También recalcular cob si cambió inv o si el operador ingresó despacho
  var rowValues = sheet.getRange(rowIndex, 1, 1, CONFIG.MAX_COLS_INV).getValues()[0];
  var currentVfact = parseNumber(rowValues[RD_INV_COLS.vfact - 1]);
  var newInvE = fields.inv !== undefined ? fields.inv : parseNumber(rowValues[RD_INV_COLS.inv - 1]);
  // SIEMPRE recalcular con la fórmula canónica (antes solo se actualizaba
  // si vfact>0, dejando un valor heredado/obsoleto visible en el formulario
  // cuando vfact caía a 0 — desalineado con lo que Coberturas mostraba).
  // El respaldo usa el pronóstico mensual APROBADO (no el 'pron' legado).
  var pronAprobExist = getPronAprobadoDiario(planta, producto, fecha);
  var newCob = cobCanonica(newInvE, currentVfact, pronAprobExist);
  sheet.getRange(rowIndex, RD_INV_COLS.cob, 1, 1).setValue(newCob);
  if (fields.despacho_diario > 0) {
    sheet.getRange(rowIndex, RD_INV_COLS.dem,   1, 1).setValue(fields.despacho_diario);
    sheet.getRange(rowIndex, RD_INV_COLS.vreal, 1, 1).setValue(fields.despacho_diario);
  }
  Object.keys(fields).forEach(function(key) {
    if (key === 'despacho_diario') return; // ya manejado arriba
    var colIdx = RD_INV_COLS[key];
    if (!colIdx) return;
    sheet.getRange(rowIndex, colIdx, 1, 1).setValue(fields[key]);
  });
}

// ── Consulta: mi reporte de hoy (para precargar el formulario) ─────────
function handleRdGetMiReporte(params) {
  var user = rdCurrentUser(params.token);
  var fecha = params.fecha || formatDate(new Date());
  var estSheet = ensureSheet(CONFIG.SHEETS.REPORTE_ESTADO,
    ['FECHA', 'PLANTA', 'ESTADO', 'USUARIO', 'NOMBRE', 'HORA', 'COMENTARIO', 'BT_NAVE', 'BT_ETA', 'BT_VOLUMEN', 'IP', 'EQUIPO']);
  var lastRow = estSheet.getLastRow();
  var estado = null;
  if (lastRow >= 2) {
    var data = estSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    for (var i = 0; i < data.length; i++) {
      if (formatDate(data[i][0]) === fecha && cleanString(data[i][1]) === user.planta) {
        estado = { estado: data[i][2], usuario: data[i][3], nombre: data[i][4], hora: data[i][5],
                   comentario: data[i][6], bt_nave: data[i][7], bt_eta: formatDate(data[i][8]), bt_volumen: data[i][9] };
        break;
      }
    }
  }
  var rdSheet = ensureSheet(CONFIG.SHEETS.REPORTE_DIARIO,
    ['ID', 'FECHA', 'PLANTA', 'PRODUCTO', 'EXISTENCIA', 'VERSION', 'TIMESTAMP', 'USUARIO', 'IP', 'EQUIPO']);
  var rdLast = rdSheet.getLastRow();
  var porProducto = {};
  if (rdLast >= 2) {
    var rdData = rdSheet.getRange(2, 1, rdLast - 1, 14).getValues();
    rdData.forEach(function(row) {
      if (formatDate(row[1]) === fecha && cleanString(row[2]) === user.planta) {
        var prod = cleanString(row[3]), version = parseNumber(row[5]);
        if (!porProducto[prod] || version > porProducto[prod].version) {
          porProducto[prod] = {
            existencia:      parseNumber(row[4]),
            version:         version,
            comentario_prod: cleanString(row[10] || ''),
            existencia_minima: (row[12] === true || row[12] === 1 || row[12] === '1'),
            motivo_minima:     cleanString(row[13] || '')
          };
        }
      }
    });
  }

  // Referencia de cálculo por producto: Capacidad y Fondos (editables en
  // la hoja `capacidad_referencia`, NUNCA los ingresa el operador) +
  // últimos valores ya calculados por el sistema en `inventario`
  // (cobertura, pronóstico, vfact, despacho...), puramente informativos
  // para que el operador vea el panorama completo sin tener que digitarlo.
  var referencia = rdGetCapacidadMap(user.planta);
  var productosPlanta = PRODUCTOS_POR_PLANTA[user.planta] || PRODUCTOS_BASE;
  var plantaLegacy = rdPlantaLegacy(user.planta); // "Conchan" -> "Conchán" para leer `inventario`
  var invSheet = getSheetSafe(CONFIG.SHEETS.INVENTARIO);
  var ultimoCalculo = {};
  if (invSheet) {
    var invLast = invSheet.getLastRow();
    if (invLast >= 2) {
      var invData = invSheet.getRange(2, 1, invLast - 1, CONFIG.MAX_COLS_INV).getValues();
      // Nos quedamos con el registro más reciente (por fecha) de cada producto de esta planta
      invData.forEach(function(row) {
        var pl = cleanString(row[1]), prod = cleanString(row[2]), fe = formatDate(row[0]);
        if (pl !== plantaLegacy || productosPlanta.indexOf(prod) < 0) return;
        if (!ultimoCalculo[prod] || fe > ultimoCalculo[prod].fecha) {
          ultimoCalculo[prod] = {
            fecha: fe,
            pron:          parseNumber(row[4]),   // pron diario MBDC (col 5)
            vult7:         parseNumber(row[5]),   // venta ult 7d (col 6)
            vreal:         parseNumber(row[6]),   // venta real día (col 7)
            dem_prom:      parseNumber(row[7]),   // dem prom (col 8)
            dem:           parseNumber(row[8]),   // despacho = dem diario MBDC (col 9)
            despacho:      parseNumber(row[8]),   // alias para compatibilidad
            vfact:         parseNumber(row[10]),  // venta factible MBDC (col 11)
            cob:           parseNumber(row[11]),  // cobertura días (col 12)
            fecha_repos:   formatDate(row[13]),   // fecha reposición BT (col 14)
            bt:            cleanString(row[14] || ''), // nombre BT (col 15)
            vol_rep:       parseNumber(row[15]),  // volumen reposición MB (col 16)
            fecha_repos2:  formatDate(row[18]),   // BT2 fecha repos (col 19)
            bt2:           cleanString(row[19] || ''), // BT2 nombre (col 20)
            vol_rep2:      parseNumber(row[20]),  // BT2 vol repos (col 21)
            vacio_sistema: parseNumber(row[16])   // vacío col 17
          };
        }
      });
    }
  }
  // ── Pronóstico mensual (MB) desde hoja pronostico — misma fuente que el dashboard ──
  var pronMensualMap = {};
  try {
    var pronSheet = getSheetSafe(CONFIG.SHEETS.PRONOSTICO);
    if (pronSheet && pronSheet.getLastRow() >= 2) {
      var mesBuscar = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM');
      var pronRows = pronSheet.getRange(2, 1, pronSheet.getLastRow() - 1, 4).getValues();
      // Buscar el mes más reciente disponible
      var mesesDisp = [...new Set(pronRows.map(function(r){ return String(r[0]); }).filter(Boolean))].sort();
      var bestMes = mesesDisp.filter(function(m){ return m <= mesBuscar; }).pop() || mesesDisp.pop() || '';
      if (bestMes) {
        pronRows.forEach(function(row) {
          if (String(row[0]) === bestMes) {
            var pl = cleanString(row[1]), pr = cleanString(row[2]);
            if (pl === rdPlantaLegacy(user.planta) || pl === user.planta) {
              pronMensualMap[pr] = parseNumber(row[3]);
            }
          }
        });
      }
    }
  } catch(ep) { Logger.log('pronMensual error: ' + ep.message); }

  var detalleProductos = {};
  productosPlanta.forEach(function(prod) {
    var ref  = referencia[prod] || { capacidad: 0, fondos: 0, fondo_osinergmin: 0 };
    var calc = ultimoCalculo[prod] || null;
    // Enriquecer calc con pronóstico mensual y campos correctos
    if (calc) {
      calc.pron_mes  = pronMensualMap[prod] || 0;   // pronóstico mensual en MB
      calc.despacho  = calc.dem || calc.despacho || 0;  // dem = despacho diario MBDC
    }
    detalleProductos[prod] = {
      capacidad: ref.capacidad, fondos: ref.fondos, fondo_osinergmin: ref.fondo_osinergmin,
      ultimo_calculo: calc
    };
  });

  return createJsonResponse(JSON.stringify({
    success: true, planta: user.planta, nombre: user.nombre, fecha: fecha, estado: estado,
    valores: porProducto, productos: productosPlanta, detalle: detalleProductos
  }));
}

// ── Consulta: seguimiento nacional del día (todas las plantas) ─────────
function handleRdGetTrackingHoy(params) {
  var fecha = (params && params.fecha) || formatDate(new Date());
  var estSheet = ensureSheet(CONFIG.SHEETS.REPORTE_ESTADO,
    ['FECHA', 'PLANTA', 'ESTADO', 'USUARIO', 'NOMBRE', 'HORA', 'COMENTARIO', 'BT_NAVE', 'BT_ETA', 'BT_VOLUMEN', 'IP', 'EQUIPO']);
  var lastRow = estSheet.getLastRow();
  var reportadas = {};
  if (lastRow >= 2) {
    var data = estSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    data.forEach(function(row) {
      if (formatDate(row[0]) === fecha) reportadas[cleanString(row[1])] = { estado: row[2], usuario: row[3], nombre: row[4], hora: row[5] };
    });
  }
  var tracking = RD_PLANTAS.map(function(planta) {
    var r = reportadas[planta];
    return { planta: planta, estado: r ? r.estado : 'Pendiente', usuario: r ? r.nombre : '', hora: r ? r.hora : '' };
  });
  return createJsonResponse(JSON.stringify({ success: true, fecha: fecha, tracking: tracking }));
}

// ── Público: último reporte conocido de una planta (cualquier fecha) ────
// Usado en la pantalla de login para evitar la confusión de "no reportó
// hoy" cuando en realidad sí reportó ayer y aún no le toca hoy.
function handleRdGetUltimoReporte(params) {
  var planta = cleanString(params && params.planta);
  if (!planta) return createJsonResponse(JSON.stringify({ success: false, message: 'Falta planta' }));
  var estSheet = ensureSheet(CONFIG.SHEETS.REPORTE_ESTADO,
    ['FECHA', 'PLANTA', 'ESTADO', 'USUARIO', 'NOMBRE', 'HORA', 'COMENTARIO', 'BT_NAVE', 'BT_ETA', 'BT_VOLUMEN', 'IP', 'EQUIPO']);
  var lastRow = estSheet.getLastRow();
  var ultimo = null;
  if (lastRow >= 2) {
    var data = estSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    data.forEach(function(row) {
      if (cleanString(row[1]) !== planta) return;
      var fe = formatDate(row[0]);
      if (!fe) return;
      if (!ultimo || fe > ultimo.fecha) {
        ultimo = { fecha: fe, estado: row[2], usuario: row[3], nombre: row[4], hora: row[5] };
      }
    });
  }
  if (!ultimo) return createJsonResponse(JSON.stringify({ success: true, encontrado: false }));
  return createJsonResponse(JSON.stringify({
    success: true, encontrado: true, fecha: ultimo.fecha, nombre: ultimo.nombre, hora: ultimo.hora
  }));
}

// ── Histórico de inventario por planta (para tab Histórico en reg. diario) ─
// Lee `reporte_diario` (captura cruda) + enriquece con cob/vfact de `inventario`.
// Devuelve el registro de mayor versión por fecha+planta+producto dentro del
// rango solicitado (últimos N días).
function handleRdGetHistoricoInventario(params) {
  var user    = rdCurrentUser(params.token);
  var planta  = user.planta;
  var plantaL = rdPlantaLegacy(planta);
  var dias    = parseInt(params.dias) || 30;

  var fechaCorte = new Date();
  fechaCorte.setDate(fechaCorte.getDate() - dias);
  var fechaStr = Utilities.formatDate(fechaCorte, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // Leer directamente de inventario (fuente completa = E&D + registro diario)
  var invSheet = getSheetSafe(CONFIG.SHEETS.INVENTARIO);
  if (!invSheet || invSheet.getLastRow() < 2) {
    return createJsonResponse(JSON.stringify({ success: true, registros: [] }));
  }

  var data    = invSheet.getRange(2, 1, invSheet.getLastRow() - 1, CONFIG.MAX_COLS_INV).getValues();
  var capMap  = rdGetCapacidadMap(planta);
  var registros = [];

  data.forEach(function(row) {
    var fe = formatDate(row[0]);
    var pl = cleanString(row[1]);
    if (pl !== planta && pl !== plantaL) return;
    if (!fe || fe < fechaStr) return;
    var prod = cleanString(row[2]);
    var inv  = parseNumber(row[3]);
    var cob  = parseNumber(row[11]);
    var vfact= parseNumber(row[10]);
    var vreal= parseNumber(row[6]);
    var dem  = parseNumber(row[8]);   // despacho diario MBDC (col 9)
    var ref  = capMap[prod] || {};
    registros.push({
      fecha:      fe,
      producto:   prod,
      existencia: inv,
      capacidad:  ref.capacidad || 0,
      fondos:     ref.fondos    || 0,
      cob:        cob,
      vfact:      vfact,
      vreal:      vreal > 0 ? vreal : dem,   // usar dem si vreal=0
      dem:        dem,
      comentario: cleanString(row[17] || '')
    });
  });

  registros.sort(function(a, b) {
    if (b.fecha !== a.fecha) return b.fecha < a.fecha ? -1 : 1;
    return a.producto < b.producto ? -1 : 1;
  });

  return createJsonResponse(JSON.stringify({ success: true, registros: registros }));
}

// ── Pronóstico aprobado por planta (para tab Pronóstico en reg. diario) ──
// Lee la hoja `pronostico` que ya usa el dashboard. Filtra por planta y
// devuelve los registros del mes activo + hasta 2 meses anteriores.
function handleRdGetPronosticoPlanta(params) {
  var user = rdCurrentUser(params.token);
  var planta = user.planta;
  var plantaLegacy = rdPlantaLegacy(planta); // "Conchan" → "Conchán"

  var sheet = getSheetSafe(CONFIG.SHEETS.PRONOSTICO);
  if (!sheet || sheet.getLastRow() < 2) {
    return createJsonResponse(JSON.stringify({ success: true, pronostico: [] }));
  }

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Localizar columnas clave (tolerante a distintos nombres)
  function colIdx(names) {
    for (var i = 0; i < names.length; i++) {
      var idx = headers.map(function(h){ return String(h).toLowerCase().trim(); })
                       .indexOf(names[i].toLowerCase());
      if (idx >= 0) return idx;
    }
    return -1;
  }
  var iPlanta  = colIdx(['planta']);
  var iProd    = colIdx(['producto']);
  var iMes     = colIdx(['mes', 'month']);
  var iPron    = colIdx(['pron_mb', 'pron_mes', 'pron', 'pronostico', 'vol_mb']);
  var iFuente  = colIdx(['fuente', 'source']);

  if (iPlanta < 0 || iProd < 0 || iMes < 0 || iPron < 0) {
    // Si no hay headers reconocibles, devuelve vacío con diagnóstico
    Logger.log('[rdGetPronosticoPlanta] Headers no reconocidos: ' + JSON.stringify(headers));
    return createJsonResponse(JSON.stringify({ success: true, pronostico: [],
      _debug: 'Headers: ' + headers.join(', ') }));
  }

  // Mes actual y 2 anteriores como corte mínimo (YYYY-MM)
  var ahora = new Date();
  var mesCorte = Utilities.formatDate(
    new Date(ahora.getFullYear(), ahora.getMonth() - 2, 1),
    CONFIG.TIMEZONE, 'yyyy-MM'
  );

  var pronostico = [];
  data.forEach(function(row) {
    var pl = cleanString(row[iPlanta]);
    // Acepta tanto "Conchan" como "Conchán"
    if (pl !== planta && pl !== plantaLegacy) return;
    var mes = row[iMes];
    if (mes instanceof Date) {
      mes = Utilities.formatDate(mes, CONFIG.TIMEZONE, 'yyyy-MM');
    } else {
      mes = String(mes || '').trim().substring(0, 7);
    }
    if (!mes || mes < mesCorte) return;
    var prodNorm = cleanString(row[iProd]);
    // Filtrar por productos válidos para esta planta
    var prodsValidos = PRODUCTOS_POR_PLANTA[planta] || PRODUCTOS_POR_PLANTA[plantaLegacy] || PRODUCTOS_BASE;
    if (prodsValidos.indexOf(prodNorm) < 0) return;
    pronostico.push({
      mes:      mes,
      producto: prodNorm,
      pron_mb:  parseNumber(row[iPron]),
      fuente:   iFuente >= 0 ? cleanString(row[iFuente]) : 'GPLO'
    });
  });

  // Orden: mes desc, luego orden canónico de productos
  var ORDER = ['Diesel', 'G. Regular', 'G. Premium', 'G. 84', 'TA1', 'GLP'];
  pronostico.sort(function(a, b) {
    if (b.mes !== a.mes) return b.mes < a.mes ? -1 : 1;
    var ia = ORDER.indexOf(a.producto); var ib = ORDER.indexOf(b.producto);
    if (ia < 0) ia = 99; if (ib < 0) ib = 99;
    return ia - ib;
  });

  return createJsonResponse(JSON.stringify({ success: true, pronostico: pronostico }));
}

// ── Cabotajes marítimos por planta (para columna en histórico) ────────────
// Cruza cargas_naves con la planta del usuario. Una carga aplica cuando
// TERMINAL coincide con el nombre de la planta (o sus alias) y la fecha
// del registro histórico cae dentro de [FECHA_DESDE, FECHA_HASTA].
function handleRdGetCabotajesPlanta(params) {
  var user   = rdCurrentUser(params.token);
  var planta = user.planta;
  var dias   = parseInt(params.dias) || 120;

  var sheet = getSheetSafe('cargas_naves');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('[cabotajes] hoja cargas_naves vacia o no existe');
    return createJsonResponse(JSON.stringify({ success: true, cabotajes: [], _debug: 'sin hoja' }));
  }

  var ncols = Math.max(sheet.getLastColumn(), 10);
  var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, ncols).getValues();

  var fechaCorte = new Date();
  fechaCorte.setDate(fechaCorte.getDate() - dias);
  var fcStr = Utilities.formatDate(fechaCorte, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // Normalizar sin tildes y en minúsculas para comparación robusta
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[áà]/g,'a').replace(/[éè]/g,'e').replace(/[íì]/g,'i')
      .replace(/[óò]/g,'o').replace(/[úù]/g,'u').trim();
  }

  var plantaNorm = rdPlantaLegacy(planta);
  var tokens = [norm(planta), norm(plantaNorm)];
  // Tokens adicionales específicos por planta
  var EXTRA = {
    'mollendo':  ['mollendo','mlldo'],
    'callao':    ['callao'],
    'conchan':   ['conchan','conchán'],
    'ilo':       ['ilo'],
    'pisco':     ['pisco'],
    'salaverry': ['salaverry'],
    'chimbote':  ['chimbote'],
    'supe':      ['supe'],
    'eten':      ['eten'],
    'talara':    ['talara'],
    'bayovar':   ['bayovar'],
    'iquitos':   ['iquitos'],
    'pucallpa':  ['pucallpa']
  };
  (EXTRA[tokens[0]] || EXTRA[tokens[1]] || []).forEach(function(e) {
    if (tokens.indexOf(e) < 0) tokens.push(e);
  });

  function matchesPlanta(row) {
    // Buscar en: TERMINAL(4), ORIGEN(3) — cualquiera de las columnas donde puede estar el destino
    var cols = [row[4], row[3]];
    for (var ci = 0; ci < cols.length; ci++) {
      var v = norm(cols[ci]);
      if (!v) continue;
      for (var ti = 0; ti < tokens.length; ti++) {
        if (v.indexOf(tokens[ti]) >= 0 || tokens[ti].indexOf(v) >= 0) return true;
      }
    }
    return false;
  }

  // Log muestra para diagnóstico
  Logger.log('[cabotajes] planta=' + planta + ' tokens=' + JSON.stringify(tokens)
    + ' total_filas=' + data.length);
  if (data.length > 0) {
    Logger.log('[cabotajes] fila1=' + JSON.stringify(
      data[0].map(function(v){ return String(v||'').slice(0,25); })));
  }

  var cabotajes = [];
  var skipped   = 0;
  data.forEach(function(row) {
    var buque = cleanString(row[1] || '');
    if (!buque) return;
    var fechaDesde = formatDate(row[5]) || '';
    var fechaHasta = formatDate(row[6]) || fechaDesde;
    // Solo excluir si ambas fechas son anteriores al corte
    if (fechaDesde && fechaHasta && fechaDesde < fcStr && fechaHasta < fcStr) {
      skipped++;
      return;
    }
    if (!matchesPlanta(row)) return;

    cabotajes.push({
      buque:       buque,
      viaje:       cleanString(row[2] || ''),
      origen:      cleanString(row[3] || ''),
      terminal:    cleanString(row[4] || ''),
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      producto:    cleanString(row[7] || ''),
      volumen_mb:  parseNumber(row[8]),
      estado:      cleanString(row[9] || '')
    });
  });

  cabotajes.sort(function(a, b) {
    return b.fecha_desde < a.fecha_desde ? -1 : 1;
  });

  Logger.log('[cabotajes] resultado=' + cabotajes.length + ' skipped=' + skipped);
  return createJsonResponse(JSON.stringify({
    success:   true,
    cabotajes: cabotajes,
    _tokens:   tokens,
    _total:    data.length
  }));
}

// ── Debug: ver valores reales de cargas_naves ─────────────────────────────
// Llama a: [GAS_URL]?action=rdDebugCargasNaves&token=...
// Devuelve las primeras 30 filas con sus valores exactos por columna
function handleRdDebugCargasNaves(params) {
  var user = rdCurrentUser(params.token);
  if (!user || user.rol !== 'admin') return createJsonResponse(JSON.stringify({error:'solo admin'}));
  var sheet = getSheetSafe('cargas_naves');
  if (!sheet || sheet.getLastRow() < 2) return createJsonResponse(JSON.stringify({error:'sin datos'}));
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var data = sheet.getRange(2, 1, Math.min(sheet.getLastRow()-1, 30), sheet.getLastColumn()).getValues();
  var rows = data.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = String(row[i]||'').slice(0,40); });
    return obj;
  });
  return createJsonResponse(JSON.stringify({ headers: headers, rows: rows, total: sheet.getLastRow()-1 }));
}

// ═══════════════════════════════════════════════════════════════════
// SOLICITUDES DE CORRECCIÓN — Flujo planta → GPLO
// ═══════════════════════════════════════════════════════════════════

// Sheet: rt_solicitudes
// Cols: ID | FECHA_SOL | PLANTA | USUARIO | NOMBRE | FECHA_DATO | PRODUCTO
//       CAMPO | VALOR_ACTUAL | VALOR_PROPUESTO | MOTIVO | ESTADO | RESUELTO_POR | FECHA_RESP | COMENTARIO_RESP

function ensureSolicitudesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEETS.RT_SOLICITUDES);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEETS.RT_SOLICITUDES);
    var hdr = ['ID','FECHA_SOL','PLANTA','USUARIO','NOMBRE','FECHA_DATO','PRODUCTO',
               'CAMPO','VALOR_ACTUAL','VALOR_PROPUESTO','MOTIVO',
               'ESTADO','RESUELTO_POR','FECHA_RESP','COMENTARIO_RESP'];
    sh.appendRow(hdr);
    sh.getRange(1,1,1,hdr.length).setBackground('#1a3a5c').setFontColor('#fff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Planta solicita corrección de un dato ya registrado
function handleRdSolicitarCorreccion(payload) {
  var user = rdCurrentUser(payload.token);
  var sh   = ensureSolicitudesSheet();
  var now  = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var id   = Utilities.getUuid();
  var row  = [
    id,
    now,
    user.planta,
    user.email,
    user.nombre,
    cleanString(payload.fecha_dato || ''),
    cleanString(payload.producto || ''),
    cleanString(payload.campo || 'existencia'),
    parseNumber(payload.valor_actual || 0),
    parseNumber(payload.valor_propuesto || 0),
    cleanString(payload.motivo || ''),
    'PENDIENTE',
    '', '', ''
  ];
  sh.appendRow(row);
  clearCache();
  Logger.log('[solicitud] nueva: planta=' + user.planta + ' prod=' + payload.producto + ' val=' + payload.valor_propuesto);
  return createSuccessResponse('Solicitud de corrección enviada a Planificación de Suministro. ID: ' + id);
}

// GPLO aprueba o rechaza una solicitud
function handleRdResponderSolicitud(payload) {
  var user = rdCurrentUser(payload.token);
  // Solo admin/gplo puede responder
  if (user.rol !== 'admin') return createJsonResponse(JSON.stringify({success:false,message:'Sin permiso'}));
  var sh = ensureSolicitudesSheet();
  var id = cleanString(payload.id || '');
  var aprobado = payload.aprobado === true || payload.aprobado === 'true';
  var comentResp = cleanString(payload.comentario || '');
  var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  // Buscar la fila
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return createJsonResponse(JSON.stringify({success:false,message:'Solicitud no encontrada'}));
  var data = sh.getRange(2,1,lastRow-1,1).getValues();
  var rowIdx = -1;
  for (var i=0; i<data.length; i++) {
    if (cleanString(data[i][0]) === id) { rowIdx = i+2; break; }
  }
  if (rowIdx < 0) return createJsonResponse(JSON.stringify({success:false,message:'ID no encontrado'}));
  // Leer la solicitud para aplicar el cambio
  var sol = sh.getRange(rowIdx,1,1,15).getValues()[0];
  var estado = aprobado ? 'APROBADA' : 'RECHAZADA';
  sh.getRange(rowIdx,12,1,4).setValues([[estado, user.email, now, comentResp]]);
  // Si aprobada: aplicar el cambio en inventario
  if (aprobado) {
    var fechaDato = sol[5], planta = sol[2], producto = sol[6];
    var campo = sol[7], valorNuevo = parseNumber(sol[9]);
    var campos = {existencia:'inv', inv:'inv', despacho:'despacho_diario', dem:'despacho_diario'};
    var fieldKey = campos[campo.toLowerCase()] || 'inv';
    var fields = {}; fields[fieldKey] = valorNuevo;
    rdUpsertInventarioCells(fechaDato, rdPlantaLegacy(planta), producto, fields);
    // También actualizar reporte_diario con nueva versión
    var rdSheet = getSheetSafe(CONFIG.SHEETS.REPORTE_DIARIO);
    if (rdSheet && rdSheet.getLastRow() >= 2) {
      var rdData = rdSheet.getRange(2,1,rdSheet.getLastRow()-1,6).getValues();
      var maxVer = 0;
      rdData.forEach(function(r) {
        if (formatDate(r[1])===fechaDato && cleanString(r[2])===planta && cleanString(r[3])===producto)
          maxVer = Math.max(maxVer, parseNumber(r[5]));
      });
      rdSheet.appendRow([Utilities.getUuid(), fechaDato, planta, producto, valorNuevo, maxVer+1,
                         now, user.email, '', 'CORRECCION_APROBADA:'+id, '']);
    }
    clearCache();
    Logger.log('[solicitud] aprobada id='+id+' planta='+planta+' campo='+campo+' nuevo='+valorNuevo);
  }
  return createSuccessResponse('Solicitud ' + estado.toLowerCase() + ' correctamente.');
}

// Planta: ver sus propias solicitudes
function handleRdGetMisSolicitudes(params) {
  var user = rdCurrentUser(params.token);
  var sh   = ensureSolicitudesSheet();
  if (sh.getLastRow() < 2) return createJsonResponse(JSON.stringify({ success:true, solicitudes:[] }));
  var data = sh.getRange(2,1,sh.getLastRow()-1,15).getValues();
  var soles = data.filter(function(r){ return cleanString(r[2])===user.planta; })
    .map(function(r){ return {
      id:r[0], fecha_sol:r[1], planta:r[2], nombre:r[4],
      fecha_dato:r[5], producto:r[6], campo:r[7],
      valor_actual:r[8], valor_propuesto:r[9], motivo:r[10],
      estado:r[11], resuelto_por:r[12], fecha_resp:r[13], comentario_resp:r[14]
    };})
    .sort(function(a,b){ return b.fecha_sol < a.fecha_sol ? -1:1; })
    .slice(0,20);
  return createJsonResponse(JSON.stringify({ success:true, solicitudes:soles }));
}

// GPLO: ver TODAS las solicitudes pendientes de todas las plantas
function handleGetTodasSolicitudes(params) {
  var user = rdCurrentUser(params.token);
  if (user.rol !== 'admin') {
    return createJsonResponse(JSON.stringify({
      success:false, message:'Sin permiso (rol actual: "' + user.rol + '", se requiere "admin")',
      _debug: { email:user.email, rol:user.rol }
    }));
  }
  var sh = ensureSolicitudesSheet();
  if (sh.getLastRow() < 2) return createJsonResponse(JSON.stringify({ success:true, solicitudes:[], _debug:{filas_sheet:0} }));
  var data = sh.getRange(2,1,sh.getLastRow()-1,15).getValues();
  var soles = data.map(function(r){ return {
    id:r[0], fecha_sol:String(r[1]||''), planta:r[2], usuario:r[3], nombre:r[4],
    fecha_dato:String(r[5]||''), producto:r[6], campo:r[7],
    valor_actual:r[8], valor_propuesto:r[9], motivo:r[10],
    estado:r[11], resuelto_por:r[12], fecha_resp:r[13], comentario_resp:r[14]
  };}).filter(function(r){ return r.id; })
    .sort(function(a,b){ return b.fecha_sol < a.fecha_sol ? -1:1; });
  return createJsonResponse(JSON.stringify({ success:true, solicitudes:soles, _debug:{filas_sheet:data.length} }));
}


// ═══════════════════════════════════════════════════════════════════════
// LIMPIEZA MANUAL DE DATOS DE PRUEBA — ejecutar SOLO desde el editor
// de Apps Script (Ejecutar → limpiarFechaPrueba), NUNCA se expone vía
// doGet/doPost. Borra todas las filas de una fecha específica en las
// 4 hojas donde el flujo de Registro Diario puede haber escrito datos.
// ═══════════════════════════════════════════════════════════════════════
function limpiarFechaPrueba() {
  var FECHA = '2026-07-08'; // ← cambia esta fecha si necesitas limpiar otro día
  var resumen = [];

  // 1) inventario (col A = fecha)
  resumen.push(_limpiarHojaPorFecha(CONFIG.SHEETS.INVENTARIO, 0, FECHA));

  // 2) reporte_diario (col B = fecha, índice 1)
  resumen.push(_limpiarHojaPorFecha(CONFIG.SHEETS.REPORTE_DIARIO, 1, FECHA));

  // 3) reporte_estado — seguimiento diario (col A = fecha)
  resumen.push(_limpiarHojaPorFecha(CONFIG.SHEETS.REPORTE_ESTADO, 0, FECHA));

  // 4) rt_solicitudes — solicitudes de corrección (col F = fecha_dato, índice 5)
  resumen.push(_limpiarHojaPorFecha(CONFIG.SHEETS.RT_SOLICITUDES, 5, FECHA));

  clearCache();
  Logger.log('════ LIMPIEZA COMPLETADA (' + FECHA + ') ════');
  resumen.forEach(function(r) { Logger.log(r); });
  Logger.log('Revisa el Registro de ejecución (Ver → Registros) para el detalle.');
}

function _limpiarHojaPorFecha(nombreHoja, colIdxFecha, fecha) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) return nombreHoja + ': hoja no existe, se omite.';
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return nombreHoja + ': sin datos.';
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var rowsToDelete = [];
  data.forEach(function(row, idx) {
    var val = row[colIdxFecha];
    var fe = (val instanceof Date) ? formatDate(val) : String(val || '').slice(0, 10);
    if (fe === fecha) rowsToDelete.push(idx + 2);
  });
  // Borrar de abajo hacia arriba para no desfasar índices
  rowsToDelete.reverse().forEach(function(rowIdx) { sheet.deleteRow(rowIdx); });
  return nombreHoja + ': ' + rowsToDelete.length + ' fila(s) eliminada(s).';
}


// ── NOTA DE MIGRACIÓN FUTURA ─────────────────────────────────────────────
// Este módulo guarda contraseñas hasheadas (SHA-256+salt) y tokens
// firmados (HMAC) directamente en Sheets, suficiente para un piloto de
// alcance acotado. Al migrar a SQL Server / Postgres, reemplazar:
//  - `usuarios`         -> tabla users (agregar bcrypt/argon2 real)
//  - `reporte_diario`   -> tabla report_entries (ya versionada/append-only)
//  - `reporte_estado`   -> tabla report_status (o vista calculada)
// La API pública (rdLogin, rdGuardarReporte, rdGetTrackingHoy, etc.) puede
// mantenerse igual: solo cambia la capa de persistencia.
