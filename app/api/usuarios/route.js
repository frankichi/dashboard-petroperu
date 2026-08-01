import { NextResponse } from "next/server";
import { asegurarEstructura, leerTabla, agregarFilas, actualizarFila, ahora } from "@/lib/sheets";
import { requerir, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
const err = (t, s = 400) => NextResponse.json({ error: t }, { status: s });

// GET /api/usuarios → lista de usuarios (sin hashes) + solicitudes de recuperación
export async function GET() {
  const g = requerir("admin");
  if (g.error) return err(g.error, g.status);
  try {
    await asegurarEstructura();
    const usuarios = await leerTabla("Usuarios");
    return NextResponse.json({
      usuarios: usuarios.map((u) => ({
        usuario: u.usuario, nombre: u.nombre, rol: u.rol, estado: u.estado,
        fecha_creacion: u.fecha_creacion, creado_por: u.creado_por,
        recuperacion:
          u.codigo_recuperacion && Number(u.recuperacion_expira) > Date.now()
            ? u.codigo_recuperacion
            : null,
      })),
    });
  } catch (e) {
    return err(e.message, 500);
  }
}

// POST /api/usuarios → crear cuenta nueva
export async function POST(req) {
  const g = requerir("admin");
  if (g.error) return err(g.error, g.status);
  try {
    const { usuario, nombre, rol, password } = await req.json();
    if (!usuario || !password || password.length < 6) {
      return err("Usuario y contraseña (mínimo 6 caracteres) son obligatorios");
    }
    if (!["admin", "empleado"].includes(rol)) return err("Rol inválido");
    const usuarios = await leerTabla("Usuarios");
    const clave = usuario.trim().toLowerCase();
    if (usuarios.some((u) => u.usuario === clave)) {
      return err("Ya existe un usuario con ese nombre", 409);
    }
    await agregarFilas("Usuarios", [{
      usuario: clave, nombre: nombre || usuario, rol,
      password_hash: hashPassword(password),
      estado: "ACTIVO", fecha_creacion: ahora(), creado_por: g.sesion.usuario,
    }]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e.message, 500);
  }
}

// PUT /api/usuarios → editar cuenta: rol, estado o nueva contraseña
export async function PUT(req) {
  const g = requerir("admin");
  if (g.error) return err(g.error, g.status);
  try {
    const { usuario, rol, estado, password } = await req.json();
    const usuarios = await leerTabla("Usuarios");
    const u = usuarios.find((x) => x.usuario === String(usuario).trim().toLowerCase());
    if (!u) return err("Usuario no encontrado", 404);

    // Evitar quedarse sin administradores
    const admins = usuarios.filter((x) => x.rol === "admin" && x.estado === "ACTIVO");
    const esUltimoAdmin = admins.length === 1 && admins[0].usuario === u.usuario;
    if (esUltimoAdmin && ((rol && rol !== "admin") || estado === "INACTIVO")) {
      return err("No puedes degradar o desactivar al único administrador activo");
    }

    const actualizado = { ...u };
    if (rol && ["admin", "empleado"].includes(rol)) actualizado.rol = rol;
    if (estado && ["ACTIVO", "INACTIVO"].includes(estado)) actualizado.estado = estado;
    if (password) {
      if (password.length < 6) return err("La contraseña debe tener mínimo 6 caracteres");
      actualizado.password_hash = hashPassword(password);
      actualizado.codigo_recuperacion = "";
      actualizado.recuperacion_expira = "";
    }
    await actualizarFila("Usuarios", u._fila, actualizado);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e.message, 500);
  }
}
