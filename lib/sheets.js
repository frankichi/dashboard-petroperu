/**
 * Conexión con Google Sheets (base de datos del sistema) vía Google Apps Script.
 *
 * Por qué Apps Script y no la API directa: algunas organizaciones (Google
 * Workspace) bloquean la creación de claves de cuenta de servicio por política
 * de seguridad (iam.disableServiceAccountKeyCreation). Apps Script evita ese
 * problema por completo: el "backend" vive DENTRO de tu propia hoja de
 * cálculo (Extensiones → Apps Script), se despliega como aplicación web, y
 * este sistema le habla mediante un token secreto que tú defines.
 *
 * Pestañas:
 *  - Productos:   catálogo e inventario
 *  - Ventas:      cabeceras de boletas/facturas
 *  - VentaItems:  detalle de cada comprobante
 *  - Movimientos: kardex (entradas/salidas de stock)
 *  - Usuarios:    cuentas del sistema (admin/empleado)
 */

const URL_SCRIPT = () => {
  const u = process.env.APPS_SCRIPT_URL;
  if (!u) throw new Error("Falta la variable de entorno APPS_SCRIPT_URL");
  return u;
};
const TOKEN = () => {
  const t = process.env.APPS_SCRIPT_TOKEN;
  if (!t) throw new Error("Falta la variable de entorno APPS_SCRIPT_TOKEN");
  return t;
};

/** Llama a la Web App de Apps Script con una acción y devuelve su respuesta JSON. */
async function llamar(action, payload = {}) {
  let res;
  try {
    res = await fetch(URL_SCRIPT(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN(), action, ...payload }),
      redirect: "follow",
    });
  } catch (e) {
    throw new Error(
      "No se pudo contactar al Apps Script. Revisa APPS_SCRIPT_URL: " + e.message
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      "El Apps Script no devolvió JSON válido (¿el despliegue es correcto y público?)."
    );
  }
  if (data.error) throw new Error(data.error);
  return data;
}

/** Crea las pestañas y cabeceras si no existen todavía. */
export async function asegurarEstructura() {
  await llamar("ensureStructure");
}

/** Lee una pestaña completa y la devuelve como arreglo de objetos. */
export async function leerTabla(tabla) {
  const data = await llamar("read", { table: tabla });
  return data.filas || [];
}

/** Agrega una o varias filas al final de una pestaña. */
export async function agregarFilas(tabla, objetos) {
  await llamar("append", { table: tabla, rows: objetos });
}

/** Sobrescribe una fila específica de una pestaña. */
export async function actualizarFila(tabla, numFila, objeto) {
  await llamar("update", { table: tabla, rowNumber: numFila, data: objeto });
}

/** Elimina una fila específica de una pestaña (borrado real, solo admin). */
export async function eliminarFila(tabla, numFila) {
  await llamar("delete", { table: tabla, rowNumber: numFila });
}

export function ahora() {
  return new Date().toLocaleString("es-PE", {
    timeZone: "America/Lima",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

export function hoyISO() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  return d.toISOString().slice(0, 10);
}
