import { NextResponse } from "next/server";
import { asegurarEstructura, leerTabla } from "@/lib/sheets";
import { requerir } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Convierte "31/07/2026, 14:22:05" (es-PE) a "2026-07-31"
function fechaISO(f) {
  const m = String(f).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export async function GET() {
  const g = requerir("admin");
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    await asegurarEstructura();
    const [productos, ventas, items] = await Promise.all([
      leerTabla("Productos"),
      leerTabla("Ventas"),
      leerTabla("VentaItems"),
    ]);

    const hoy = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Lima" })
    );
    const hoyStr = hoy.toISOString().slice(0, 10);
    const mesStr = hoyStr.slice(0, 7);

    const valorInventario = productos.reduce(
      (s, p) => s + (Number(p.costo) || 0) * (Number(p.stock) || 0), 0
    );
    const valorVentaInventario = productos.reduce(
      (s, p) => s + (Number(p.precio) || 0) * (Number(p.stock) || 0), 0
    );

    const ventasConISO = ventas.map((v) => ({ ...v, iso: fechaISO(v.fecha) }));
    const ventasHoy = ventasConISO.filter((v) => v.iso === hoyStr);
    const ventasMes = ventasConISO.filter((v) => v.iso.startsWith(mesStr));

    // Ventas de los últimos 14 días
    const porDia = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(hoy); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const delDia = ventasConISO.filter((v) => v.iso === iso);
      porDia.push({
        dia: iso.slice(5).split("-").reverse().join("/"),
        total: +delDia.reduce((s, v) => s + (Number(v.total) || 0), 0).toFixed(2),
        cantidad: delDia.length,
      });
    }

    // Top 8 productos más vendidos (por unidades)
    const acumulado = {};
    for (const it of items) {
      const k = it.codigo;
      acumulado[k] = acumulado[k] || { codigo: k, nombre: it.nombre, unidades: 0, soles: 0 };
      acumulado[k].unidades += Number(it.cantidad) || 0;
      acumulado[k].soles += Number(it.total) || 0;
    }
    const topProductos = Object.values(acumulado)
      .sort((a, b) => b.unidades - a.unidades).slice(0, 8)
      .map((t) => ({ ...t, soles: +t.soles.toFixed(2) }));

    // Stock por categoría
    const porCategoria = {};
    for (const p of productos) {
      const c = p.categoria || "Sin categoría";
      porCategoria[c] = (porCategoria[c] || 0) + (Number(p.stock) || 0);
    }
    const stockCategorias = Object.entries(porCategoria)
      .map(([categoria, unidades]) => ({ categoria, unidades }))
      .sort((a, b) => b.unidades - a.unidades);

    const bajoStock = productos
      .filter((p) => Number(p.stock) <= (Number(p.stock_minimo) || 0))
      .map((p) => ({
        codigo: p.codigo, nombre: p.nombre,
        stock: Number(p.stock) || 0,
        stock_minimo: Number(p.stock_minimo) || 0,
      }))
      .sort((a, b) => a.stock - b.stock);

    return NextResponse.json({
      kpis: {
        totalProductos: productos.length,
        unidadesEnStock: productos.reduce((s, p) => s + (Number(p.stock) || 0), 0),
        valorInventario: +valorInventario.toFixed(2),
        valorVentaInventario: +valorVentaInventario.toFixed(2),
        ventasHoy: +ventasHoy.reduce((s, v) => s + (Number(v.total) || 0), 0).toFixed(2),
        comprobantesHoy: ventasHoy.length,
        ventasMes: +ventasMes.reduce((s, v) => s + (Number(v.total) || 0), 0).toFixed(2),
        comprobantesMes: ventasMes.length,
        alertasStock: bajoStock.length,
      },
      porDia, topProductos, stockCategorias, bajoStock,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
