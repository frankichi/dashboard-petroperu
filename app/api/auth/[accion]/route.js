import { NextResponse } from "next/server";
import { asegurarEstructura, leerTabla, agregarFilas, actualizarFila, ahora } from "@/lib/sheets";
import {
  hashPassword, verificarPassword, guardarSesionCookie, borrarSesionCookie,
  obtenerSesion, codigoRecuperacion,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const err = (texto, status = 400) => NextResponse.json({ error: texto }, { status });

async function buscarUsuario(usuario) {
  const usuarios = await leerTabla("Usuarios");
  return usuarios.find(
    (u) => String(u.usuario).trim().toLowerCase() === String(usuario).trim().toLowerCase()
  );
}

// GET /api/auth/yo → sesión actual (para el frontend)
export async function GET(req, { params }) {
  if (params.accion === "yo") {
    const s = obtenerSesion();
    return NextResponse.json({ sesion: s || null });
  }
  if (params.accion === "estado") {
    // ¿Ya existe algún usuario? (para mostrar la pantalla de primer admin)
    await asegurarEstructura();
    const usuarios = await leerTabla("Usuarios");
    return NextResponse.json({ inicializado: usuarios.length > 0 });
  }
  return err("Acción no válida", 404);
}

export async function POST(req, { params }) {
  const { accion } = params;
  const body = await req.json().catch(() => ({}));

  try {
    await asegurarEstructura();

    // ── Crear el PRIMER administrador (solo si no existe ningún usuario) ──
    if (accion === "inicial") {
      const usuarios = await leerTabla("Usuarios");
      if (usuarios.length > 0) return err("El sistema ya está inicializado", 403);
      const { usuario, nombre, password } = body;
      if (!usuario || !password || password.length < 6) {
        return err("Usuario y contraseña (mínimo 6 caracteres) son obligatorios");
      }
      await agregarFilas("Usuarios", [{
        usuario: usuario.trim().toLowerCase(), nombre: nombre || usuario,
        rol: "admin", password_hash: hashPassword(password),
        estado: "ACTIVO", fecha_creacion: ahora(), creado_por: "sistema",
      }]);
      guardarSesionCookie({ usuario: usuario.trim().toLowerCase(), nombre: nombre || usuario, rol: "admin" });
      return NextResponse.json({ ok: true });
    }

    // ── Iniciar sesión ──
    if (accion === "login") {
      const { usuario, password } = body;
      const u = await buscarUsuario(usuario);
      if (!u || !verificarPassword(password, u.password_hash)) {
        return err("Usuario o contraseña incorrectos", 401);
      }
      if (u.estado !== "ACTIVO") return err("Esta cuenta está desactivada. Consulta al administrador.", 403);
      guardarSesionCookie({ usuario: u.usuario, nombre: u.nombre, rol: u.rol });
      return NextResponse.json({ ok: true, rol: u.rol });
    }

    // ── Cerrar sesión ──
    if (accion === "logout") {
      borrarSesionCookie();
      return NextResponse.json({ ok: true });
    }

    // ── Solicitar recuperación: genera código de 6 dígitos (30 min) ──
    // El administrador lo ve en su panel de Usuarios y se lo entrega al empleado.
    if (accion === "recuperar") {
      const u = await buscarUsuario(body.usuario);
      // Respuesta neutra para no revelar qué usuarios existen
      if (u) {
        const codigo = codigoRecuperacion();
        await actualizarFila("Usuarios", u._fila, {
          ...u,
          codigo_recuperacion: codigo,
          recuperacion_expira: String(Date.now() + 30 * 60 * 1000),
        });
      }
      return NextResponse.json({
        ok: true,
        mensaje: "Solicitud registrada. Pide el código de 6 dígitos a tu administrador e ingrésalo abajo.",
      });
    }

    // ── Restablecer contraseña con el código ──
    if (accion === "restablecer") {
      const { usuario, codigo, password } = body;
      if (!password || password.length < 6) return err("La nueva contraseña debe tener mínimo 6 caracteres");
      const u = await buscarUsuario(usuario);
      if (!u || !u.codigo_recuperacion || u.codigo_recuperacion !== String(codigo).trim()) {
        return err("Código incorrecto", 401);
      }
      if (Number(u.recuperacion_expira) < Date.now()) {
        return err("El código expiró (dura 30 minutos). Solicita uno nuevo.", 401);
      }
      await actualizarFila("Usuarios", u._fila, {
        ...u, password_hash: hashPassword(password),
        codigo_recuperacion: "", recuperacion_expira: "",
      });
      return NextResponse.json({ ok: true });
    }

    // ── Cambiar mi propia contraseña (con sesión activa) ──
    if (accion === "cambiar") {
      const s = obtenerSesion();
      if (!s) return err("Sesión expirada", 401);
      const { actual, nueva } = body;
      if (!nueva || nueva.length < 6) return err("La nueva contraseña debe tener mínimo 6 caracteres");
      const u = await buscarUsuario(s.usuario);
      if (!u || !verificarPassword(actual, u.password_hash)) {
        return err("La contraseña actual no es correcta", 401);
      }
      await actualizarFila("Usuarios", u._fila, { ...u, password_hash: hashPassword(nueva) });
      return NextResponse.json({ ok: true });
    }

    return err("Acción no válida", 404);
  } catch (e) {
    return err(e.message, 500);
  }
}
