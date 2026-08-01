import { NextResponse } from "next/server";
import { asegurarEstructura, leerTabla, agregarFilas, actualizarFila, ahora } from "@/lib/sheets";
import { requerir } from "@/lib/auth";

export const dynamic = "force-dynamic";
const err = (t, s = 400) => NextResponse.json({ error: t }, { status: s });

// GET /api/clientes            → todos los clientes
// GET /api/clientes?doc=XXXX   → un cliente por documento (RUC/DNI)
export async function GET(req) {
  const g = requerir();
  if (g.error) return err(g.error, g.status);
  try {
    await asegurarEstructura();
    const clientes = await leerTabla("Clientes");
    const doc = new URL(req.url).searchParams.get("doc");
    if (doc) {
      const c = clientes.find((x) => String(x.doc).trim() === String(doc).trim());
      return NextResponse.json({ cliente: c || null });
    }
    return NextResponse.json({ clientes });
  } catch (e) {
    return err(e.message, 500);
  }
}

// POST /api/clientes → guarda un cliente nuevo (o actualiza si el doc ya existe)
export async function POST(req) {
  const g = requerir();
  if (g.error) return err(g.error, g.status);
  try {
    await asegurarEstructura();
    const data = await req.json();
    if (!data.doc || !data.nombre) {
      return err("Documento y nombre son obligatorios");
    }
    const clientes = await leerTabla("Clientes");
    const existente = clientes.find((c) => String(c.doc).trim() === String(data.doc).trim());

    if (existente) {
      await actualizarFila("Clientes", existente._fila, {
        ...existente, ...data,
        fecha_registro: existente.fecha_registro,
      });
      return NextResponse.json({ ok: true, actualizado: true });
    }

    await agregarFilas("Clientes", [{
      ...data,
      fecha_registro: ahora(),
      creado_por: g.sesion.usuario,
    }]);
    return NextResponse.json({ ok: true, actualizado: false });
  } catch (e) {
    return err(e.message, 500);
  }
}
