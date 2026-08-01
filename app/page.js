"use client";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, AreaChart, Area,
} from "recharts";

const sol = (n) =>
  "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Kpi({ titulo, valor, detalle, alerta }) {
  return (
    <div className={`card p-4 ${alerta ? "border-l-4 border-l-alerta" : "border-l-4 border-l-volt"}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{titulo}</div>
      <div className="font-display text-3xl font-bold mt-1">{valor}</div>
      {detalle && <div className="text-xs text-neutral-500 mt-0.5">{detalle}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="card p-6 border-l-4 border-l-alerta">
        <h1 className="font-display text-2xl font-bold uppercase mb-2">
          No se pudo conectar con Google Sheets
        </h1>
        <p className="text-sm text-neutral-600">
          Revisa las variables de entorno (SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
          GOOGLE_PRIVATE_KEY) y que la hoja esté compartida con la cuenta de servicio.
        </p>
        <p className="font-mono text-xs text-alerta mt-3 bg-red-50 rounded p-2">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-4 h-24 animate-pulse bg-neutral-100" />
        ))}
      </div>
    );
  }

  const { kpis, porDia, topProductos, stockCategorias, bajoStock } = data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase">Dashboard</h1>
        <p className="text-sm text-neutral-500">Resumen del negocio en tiempo real, alimentado desde Google Sheets.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi titulo="Ventas de hoy" valor={sol(kpis.ventasHoy)}
          detalle={`${kpis.comprobantesHoy} comprobante(s)`} />
        <Kpi titulo="Ventas del mes" valor={sol(kpis.ventasMes)}
          detalle={`${kpis.comprobantesMes} comprobante(s)`} />
        <Kpi titulo="Valor del inventario" valor={sol(kpis.valorInventario)}
          detalle={`${kpis.unidadesEnStock} unidades · ${kpis.totalProductos} productos`} />
        <Kpi titulo="Alertas de stock" valor={kpis.alertasStock}
          detalle="productos en o bajo el mínimo" alerta={kpis.alertasStock > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-display text-lg font-bold uppercase mb-3">
            Ventas · últimos 14 días
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={porDia} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gVolt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F5B301" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#F5B301" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#DDDFDA" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={55} />
                <Tooltip formatter={(v) => sol(v)} labelFormatter={(l) => `Día ${l}`} />
                <Area type="monotone" dataKey="total" name="Ventas"
                  stroke="#D99C00" strokeWidth={2} fill="url(#gVolt)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-display text-lg font-bold uppercase mb-3">
            Top productos vendidos
          </h2>
          <div className="h-64">
            {topProductos.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductos} layout="vertical"
                  margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DDDFDA" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="nombre" width={140}
                    tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, n) => (n === "Unidades" ? v : sol(v))} />
                  <Bar dataKey="unidades" name="Unidades" fill="#1D5FD1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-neutral-400 h-full flex items-center justify-center">
                Aún no hay ventas registradas.
              </p>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-display text-lg font-bold uppercase mb-3">
            Stock por categoría
          </h2>
          <div className="h-64">
            {stockCategorias.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockCategorias} margin={{ top: 5, right: 5, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DDDFDA" />
                  <XAxis dataKey="categoria" tick={{ fontSize: 10 }} angle={-25}
                    textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} width={45} />
                  <Tooltip />
                  <Bar dataKey="unidades" name="Unidades" fill="#F5B301" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-neutral-400 h-full flex items-center justify-center">
                Registra productos para ver esta gráfica.
              </p>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-display text-lg font-bold uppercase mb-3">
            Reponer stock <span className="text-alerta">({bajoStock.length})</span>
          </h2>
          <div className="h-64 overflow-y-auto">
            {bajoStock.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-neutral-500 sticky top-0 bg-panel">
                    <th className="py-1.5">Producto</th>
                    <th className="py-1.5 text-right">Stock</th>
                    <th className="py-1.5 text-right">Mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {bajoStock.map((p) => (
                    <tr key={p.codigo} className="border-t border-linea">
                      <td className="py-2">
                        <div className="font-semibold">{p.nombre}</div>
                        <span className="codigo">{p.codigo}</span>
                      </td>
                      <td className="py-2 text-right font-mono text-alerta font-bold">{p.stock}</td>
                      <td className="py-2 text-right font-mono text-neutral-500">{p.stock_minimo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-neutral-400 h-full flex items-center justify-center">
                Todo el inventario está por encima del mínimo.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
