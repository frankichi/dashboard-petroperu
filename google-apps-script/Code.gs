/**
 * ELECTRO INDUSTRIA A&Z — Backend de Google Sheets vía Apps Script
 * ------------------------------------------------------------------
 * Este script convierte tu propia hoja de cálculo en el "servidor" de
 * datos del sistema web, sin necesidad de una clave de cuenta de servicio.
 *
 * INSTALACIÓN / ACTUALIZACIÓN:
 * 1. Abre tu hoja "ElectroIndustriaAZ BD".
 * 2. Menú Extensiones → Apps Script.
 * 3. Borra el contenido de "Código.gs" y pega TODO este archivo.
 * 4. Revisa que la constante TOKEN (abajo) tenga tu clave secreta actual.
 * 5. Botón "Implementar" → "Gestionar implementaciones" → ícono ✏️ (editar)
 *    de tu implementación existente → en "Versión" elige "Nueva versión"
 *    → Implementar. (Si es tu primera vez, usa "Nueva implementación" en
 *    vez de editar una existente: Tipo "Aplicación web", Ejecutar como
 *    "Yo", Acceso "Cualquier usuario").
 * 6. La URL de la aplicación web NO cambia al crear una nueva versión,
 *    así que no necesitas tocar nada en Vercel tras actualizar el script.
 *
 * CAMBIOS DE ESTA VERSIÓN:
 *  - Arregla el bug de "se pierde el 0 a la izquierda" en códigos de
 *    barras: todas las columnas se fuerzan a formato de texto plano,
 *    así Sheets ya no las convierte en número automáticamente.
 *  - Agrega la pestaña "Clientes" (para guardar clientes por RUC/DNI).
 */

// ⚠️ Debe coincidir exactamente con APPS_SCRIPT_TOKEN en Vercel.
const TOKEN = "Rominit@14ua#";

const CABECERAS = {
  Productos: [
    "codigo", "nombre", "descripcion", "categoria", "marca", "unidad",
    "voltaje", "amperaje", "peso", "medidas", "stock", "stock_minimo",
    "costo", "precio", "ubicacion", "fecha_registro", "fecha_actualizacion",
  ],
  Ventas: [
    "id", "tipo", "serie", "numero", "fecha", "cliente_doc", "cliente_nombre",
    "cliente_direccion", "subtotal", "igv", "total", "metodo_pago", "num_items",
  ],
  VentaItems: [
    "venta_id", "codigo", "nombre", "cantidad", "precio_unit", "total",
  ],
  Movimientos: ["fecha", "codigo", "tipo", "cantidad", "stock_resultante", "referencia"],
  Usuarios: [
    "usuario", "nombre", "rol", "password_hash", "estado",
    "fecha_creacion", "creado_por", "codigo_recuperacion", "recuperacion_expira",
  ],
  Clientes: [
    "doc", "tipo_doc", "nombre", "direccion", "estado_sunat", "condicion_sunat",
    "fecha_registro", "creado_por",
  ],
};

function doPost(e) {
  var salida;
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) {
      salida = { error: "Token inválido. Revisa APPS_SCRIPT_TOKEN." };
      return responder(salida);
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    switch (body.action) {
      case "ensureStructure":
        ensureStructure(ss);
        salida = { ok: true };
        break;
      case "read":
        salida = { filas: leerTabla(ss, body.table) };
        break;
      case "append":
        agregarFilas(ss, body.table, body.rows || []);
        salida = { ok: true };
        break;
      case "update":
        actualizarFila(ss, body.table, body.rowNumber, body.data || {});
        salida = { ok: true };
        break;
      case "delete":
        eliminarFila(ss, body.table, body.rowNumber);
        salida = { ok: true };
        break;
      default:
        salida = { error: "Acción no reconocida: " + body.action };
    }
  } catch (err) {
    salida = { error: "Error en Apps Script: " + err.message };
  }
  return responder(salida);
}

// Atajo útil para probar en el navegador que el script responde (no expone datos).
function doGet(e) {
  return responder({ ok: true, mensaje: "Apps Script de Electro Industria A&Z activo." });
}

function responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Crea las pestañas que falten y fuerza TODAS las columnas a formato de
 * texto plano ("@"), para que los códigos de barra, RUC, DNI y códigos de
 * recuperación con ceros a la izquierda nunca se conviertan en número.
 * Corre una sola vez por script (se recuerda con PropertiesService) salvo
 * que se cree una pestaña nueva, para no repetir trabajo en cada llamada.
 */
function ensureStructure(ss) {
  var props = PropertiesService.getScriptProperties();
  var existentes = ss.getSheets().map(function (s) { return s.getName(); });
  var creoAlguna = false;

  Object.keys(CABECERAS).forEach(function (nombre) {
    if (existentes.indexOf(nombre) === -1) {
      var hoja = ss.insertSheet(nombre);
      hoja.getRange(1, 1, 1, CABECERAS[nombre].length).setValues([CABECERAS[nombre]]);
      hoja.setFrozenRows(1);
      hoja.getRange(1, 1, 1, CABECERAS[nombre].length)
        .setFontWeight("bold").setBackground("#1A1D21").setFontColor("#F5B301");
      creoAlguna = true;
    }
  });

  var VERSION_FORMATO = "v2-texto-plano";
  if (creoAlguna || props.getProperty("formato_aplicado") !== VERSION_FORMATO) {
    Object.keys(CABECERAS).forEach(function (nombre) {
      var hoja = ss.getSheetByName(nombre);
      if (!hoja) return;
      var numCols = CABECERAS[nombre].length;
      var numFilas = Math.max(hoja.getMaxRows(), 3000);
      hoja.getRange(1, 1, numFilas, numCols).setNumberFormat("@");
    });
    props.setProperty("formato_aplicado", VERSION_FORMATO);
  }
}

function leerTabla(ss, nombre) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) return [];
  var datos = hoja.getDataRange().getDisplayValues(); // texto tal cual se ve en la celda
  if (datos.length < 2) return [];
  var cab = datos[0];
  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    // Saltar filas totalmente vacías
    if (datos[i].every(function (v) { return v === ""; })) continue;
    var obj = { _fila: i + 1 }; // fila real en la hoja (1-indexada)
    for (var j = 0; j < cab.length; j++) {
      obj[cab[j]] = datos[i][j];
    }
    filas.push(obj);
  }
  return filas;
}

function agregarFilas(ss, nombre, objetos) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) throw new Error("No existe la pestaña " + nombre);
  var cab = CABECERAS[nombre];
  var matriz = objetos.map(function (o) {
    return cab.map(function (c) {
      var v = (o[c] !== undefined && o[c] !== null) ? o[c] : "";
      return String(v); // fuerza texto: nunca pierde ceros a la izquierda
    });
  });
  if (!matriz.length) return;
  var ultimaFila = hoja.getLastRow();
  hoja.getRange(ultimaFila + 1, 1, matriz.length, cab.length).setNumberFormat("@").setValues(matriz);
}

function actualizarFila(ss, nombre, numFila, objeto) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) throw new Error("No existe la pestaña " + nombre);
  var cab = CABECERAS[nombre];
  var fila = cab.map(function (c) {
    var v = (objeto[c] !== undefined && objeto[c] !== null) ? objeto[c] : "";
    return String(v);
  });
  hoja.getRange(numFila, 1, 1, cab.length).setNumberFormat("@").setValues([fila]);
}

function eliminarFila(ss, nombre, numFila) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) throw new Error("No existe la pestaña " + nombre);
  hoja.deleteRow(numFila);
}
