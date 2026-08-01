import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Autenticación del sistema.
 * - Contraseñas: hash scrypt + salt (nunca se guardan en texto plano).
 * - Sesión: token firmado con HMAC-SHA256 en cookie httpOnly (12 horas).
 * - Roles: "admin" (CRUD total) y "empleado" (registrar y leer).
 */

const COOKIE = "fs_sesion";
const DURACION_HRS = 12;

const SECRET = () => {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("Falta la variable de entorno AUTH_SECRET");
  return s;
};

// ── Contraseñas ─────────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verificarPassword(password, guardado) {
  const [salt, hash] = String(guardado).split(":");
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(calc, "hex"));
  } catch {
    return false;
  }
}

// ── Tokens de sesión ────────────────────────────────────────
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function crearToken(sesion) {
  const payload = { ...sesion, exp: Date.now() + DURACION_HRS * 3600 * 1000 };
  const cuerpo = b64u(JSON.stringify(payload));
  const firma = b64u(crypto.createHmac("sha256", SECRET()).update(cuerpo).digest());
  return `${cuerpo}.${firma}`;
}

export function verificarToken(token) {
  try {
    const [cuerpo, firma] = String(token).split(".");
    const esperada = b64u(crypto.createHmac("sha256", SECRET()).update(cuerpo).digest());
    if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
    const payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload; // { usuario, nombre, rol, exp }
  } catch {
    return null;
  }
}

// ── Sesión en rutas API ─────────────────────────────────────
export function obtenerSesion() {
  const token = cookies().get(COOKIE)?.value;
  return token ? verificarToken(token) : null;
}

export function guardarSesionCookie(sesion) {
  cookies().set(COOKIE, crearToken(sesion), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_HRS * 3600,
  });
}

export function borrarSesionCookie() {
  cookies().delete(COOKIE);
}

/** Devuelve la sesión o un objeto de error listo para responder. */
export function requerir(rol = null) {
  const s = obtenerSesion();
  if (!s) return { error: "Sesión expirada. Vuelve a iniciar sesión.", status: 401 };
  if (rol && s.rol !== rol) {
    return { error: "No tienes permisos para esta acción (solo administrador).", status: 403 };
  }
  return { sesion: s };
}

/** Código de recuperación de 6 dígitos. */
export function codigoRecuperacion() {
  return String(crypto.randomInt(100000, 1000000));
}
