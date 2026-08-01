import { NextResponse } from "next/server";

/**
 * Middleware (corre en Edge): verifica la cookie de sesión antes de servir páginas.
 * La verificación fuerte (firma + rol) también ocurre en cada API del servidor.
 */

const PUBLICAS = ["/login"];

async function verificar(token, secret) {
  try {
    const [cuerpo, firma] = String(token).split(".");
    if (!cuerpo || !firma) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(cuerpo));
    const esperada = Buffer.from(sig).toString("base64url");
    if (esperada !== firma) return null;
    const payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  // Estáticos y APIs (las APIs se protegen solas con Node crypto)
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("fs_sesion")?.value;
  const sesion = token ? await verificar(token, process.env.AUTH_SECRET || "") : null;

  if (PUBLICAS.includes(pathname)) {
    if (sesion) {
      return NextResponse.redirect(
        new URL(sesion.rol === "admin" ? "/" : "/ventas", req.url)
      );
    }
    return NextResponse.next();
  }

  if (!sesion) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Rutas exclusivas del administrador
  if ((pathname === "/" || pathname.startsWith("/usuarios")) && sesion.rol !== "admin") {
    return NextResponse.redirect(new URL("/ventas", req.url));
  }

  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
