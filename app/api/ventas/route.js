import { NextResponse } from "next/server";
import {
  asegurarEstructura, leerTabla, agregarFilas, actualizarFila, ahora,
} from "@/lib/sheets";
import { requerir } from "@/lib/auth";

export const dynamic = "force-dynamic";
const IGV = 0.18;

// GET /api/ventas → historial de comprobantes con sus ítems
export async function GET() {
  const g = requerir();
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    await asegurarEstructura();
    const [ventas, items] = await Promise.all([
      leerTabla("Ventas"),
      leerTabla("VentaItems"),
    ]);
    const conItems = ventas.map((v) => ({
      ...v,
      items: items.filter((i) => i.venta_id === v.id),
    })).reverse();
    return NextResponse.json({ ventas: conItems });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/ventas
// body: { tipo: "BOLETA"|"FACTURA", cliente: {doc,nombre,direccion},
//         metodo_pago, items: [{codigo,cantidad}] }
export async function POST(req) {
  const g = requerir();
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    await asegurarEstructura();
    const { tipo, cliente = {}, metodo_pago = "EFECTIVO", items = [] } = await req.json();

    if (!["BOLETA", "FACTURA"].includes(tipo)) {
      return NextResponse.json({ error: "Tipo de comprobante inválido" }, { status: 400 });
    }
    if (!items.length) {
      return NextResponse.json({ error: "La venta no tiene productos" }, { status: 400 });
    }
    if (tipo === "FACTURA" && !/^\d{11}$/.test(String(cliente.doc || ""))) {
      return NextResponse.json(
        { error: "Una factura requiere RUC de 11 dígitos" }, { status: 400 }
      );
    }

    const productos = await leerTabla("Productos");
    const detalle = [];

    // Validar stock y armar detalle con precios actuales
    for (const it of items) {
      const p = productos.find((x) => String(x.codigo).trim() === String(it.codigo).trim());
      if (!p) {
        return NextResponse.json(
          { error: `Producto no registrado: ${it.codigo}` }, { status: 404 }
        );
      }
      const cant = Number(it.cantidad) || 0;
      if (cant <= 0) continue;
      if (Number(p.stock) < cant) {
        return NextResponse.json(
          { error: `Stock insuficiente de "${p.nombre}" (disponible: ${p.stock})` },
          { status: 409 }
        );
      }
      const precio = Number(p.precio) || 0;
      detalle.push({
        _producto: p, codigo: p.codigo, nombre: p.nombre,
        cantidad: cant, precio_unit: precio,
        total: +(cant * precio).toFixed(2),
      });
    }

    const total = +detalle.reduce((s, d) => s + d.total, 0).toFixed(2);
    const subtotal = +(total / (1 + IGV)).toFixed(2);
    const igv = +(total - subtotal).toFixed(2);

    // Numeración correlativa por tipo: B001-000001 / F001-000001
    const ventas = await leerTabla("Ventas");
    const serie = tipo === "BOLETA" ? "B001" : "F001";
    const nums = ventas
      .filter((v) => v.serie === serie)
      .map((v) => parseInt(v.numero, 10) || 0);
    const numero = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(6, "0");
    const id = `${serie}-${numero}`;

    const venta = {
      id, tipo, serie, numero, fecha: ahora(),
      cliente_doc: cliente.doc || "",
      cliente_nombre: cliente.nombre || (tipo === "BOLETA" ? "CLIENTE VARIOS" : ""),
      cliente_direccion: cliente.direccion || "",
      subtotal, igv, total, metodo_pago,
      num_items: detalle.length,
    };

    await agregarFilas("Ventas", [venta]);
    await agregarFilas("VentaItems", detalle.map(({ _producto, ...d }) => ({ venta_id: id, ...d })));

    // Descontar stock y registrar kardex
    const movimientos = [];
    for (const d of detalle) {
      const p = d._producto;
      const nuevoStock = Number(p.stock) - d.cantidad;
      await actualizarFila("Productos", p._fila, {
        ...p, stock: nuevoStock, fecha_actualizacion: ahora(),
      });
      movimientos.push({
        fecha: ahora(), codigo: d.codigo, tipo: "SALIDA",
        cantidad: -d.cantidad, stock_resultante: nuevoStock,
        referencia: `${tipo} ${id}`,
      });
    }
    await agregarFilas("Movimientos", movimientos);

    return NextResponse.json({
      ok: true,
      venta: { ...venta, items: detalle.map(({ _producto, ...d }) => d) },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
