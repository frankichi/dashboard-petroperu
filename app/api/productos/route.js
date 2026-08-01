import { NextResponse } from "next/server";
import {
  asegurarEstructura, leerTabla, agregarFilas, actualizarFila, eliminarFila, ahora,
} from "@/lib/sheets";
import { requerir } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/productos            → todos los productos
// GET /api/productos?codigo=XYZ → un producto por código escaneado
export async function GET(req) {
  const g = requerir();
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    await asegurarEstructura();
    const productos = await leerTabla("Productos");
    const codigo = new URL(req.url).searchParams.get("codigo");
    if (codigo) {
      const p = productos.find(
        (x) => String(x.codigo).trim() === String(codigo).trim()
      );
      return NextResponse.json({ producto: p || null });
    }
    return NextResponse.json({ productos });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/productos → crea un producto nuevo
export async function POST(req) {
  const g = requerir();
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    await asegurarEstructura();
    const data = await req.json();
    if (!data.codigo || !data.nombre) {
      return NextResponse.json(
        { error: "Código y nombre son obligatorios" }, { status: 400 }
      );
    }
    const productos = await leerTabla("Productos");
    if (productos.some((p) => String(p.codigo).trim() === String(data.codigo).trim())) {
      return NextResponse.json(
        { error: "Ya existe un producto con ese código" }, { status: 409 }
      );
    }
    const nuevo = {
      ...data,
      stock: Number(data.stock) || 0,
      fecha_registro: ahora(),
      fecha_actualizacion: ahora(),
    };
    await agregarFilas("Productos", [nuevo]);
    if (Number(data.stock) > 0) {
      await agregarFilas("Movimientos", [{
        fecha: ahora(), codigo: data.codigo, tipo: "ENTRADA",
        cantidad: Number(data.stock), stock_resultante: Number(data.stock),
        referencia: "Registro inicial",
      }]);
    }
    return NextResponse.json({ ok: true, producto: nuevo });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/productos → actualiza un producto (por código); soporta ajuste de stock
export async function PUT(req) {
  const g = requerir("admin");
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const data = await req.json();
    const productos = await leerTabla("Productos");
    const actual = productos.find(
      (p) => String(p.codigo).trim() === String(data.codigo).trim()
    );
    if (!actual) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    const stockAnterior = Number(actual.stock) || 0;
    const actualizado = {
      ...actual, ...data,
      fecha_registro: actual.fecha_registro,
      fecha_actualizacion: ahora(),
    };
    await actualizarFila("Productos", actual._fila, actualizado);

    const stockNuevo = Number(actualizado.stock) || 0;
    if (stockNuevo !== stockAnterior) {
      const dif = stockNuevo - stockAnterior;
      await agregarFilas("Movimientos", [{
        fecha: ahora(), codigo: data.codigo,
        tipo: dif > 0 ? "ENTRADA" : "AJUSTE",
        cantidad: dif, stock_resultante: stockNuevo,
        referencia: data._referencia || "Edición manual",
      }]);
    }
    return NextResponse.json({ ok: true, producto: actualizado });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/productos?codigo=XYZ → elimina un producto (solo admin)
export async function DELETE(req) {
  const g = requerir("admin");
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const codigo = new URL(req.url).searchParams.get("codigo");
    const productos = await leerTabla("Productos");
    const p = productos.find((x) => String(x.codigo).trim() === String(codigo).trim());
    if (!p) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    await eliminarFila("Productos", p._fila);
    await agregarFilas("Movimientos", [{
      fecha: ahora(), codigo, tipo: "ELIMINADO",
      cantidad: -(Number(p.stock) || 0), stock_resultante: 0,
      referencia: `Eliminado por ${g.sesion.usuario}`,
    }]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
