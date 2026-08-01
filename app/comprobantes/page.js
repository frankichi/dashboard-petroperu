"use client";
import { useEffect, useState } from "react";
import Ticket from "@/components/Ticket";

export default function Comprobantes() {
  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState(null);

  useEffect(() => {
    fetch("/api/ventas")
      .then((r) => r.json())
      .then((d) => { setVentas(d.ventas || []); setCargando(false); });
  }, []);

  const filtradas = ventas.filter((v) => {
    const q = busqueda.toLowerCase();
    return (
      !q ||
      v.id?.toLowerCase().includes(q) ||
      v.cliente_nombre?.toLowerCase().includes(q) ||
      v.cliente_doc?.includes(q)
    );
  });

  if (seleccion) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <Ticket venta={seleccion} />
        <div className="flex gap-2 justify-center print:hidden">
          <button className="btn-ink" onClick={() => window.print()}>Imprimir</button>
          <button className="btn-ghost" onClick={() => setSeleccion(null)}>Volver</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase">Comprobantes</h1>
          <p className="text-sm text-neutral-500">
            Historial de boletas y facturas emitidas. Selecciona una para reimprimirla.
          </p>
        </div>
        <input
          className="input !w-72"
          placeholder="Buscar por número, cliente o documento…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar comprobante"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-fondo text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5">Comprobante</th>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5 text-center">Ítems</th>
                <th className="px-4 py-2.5">Pago</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  Cargando comprobantes…
                </td></tr>
              )}
              {!cargando && !filtradas.length && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  Todavía no se han emitido comprobantes.
                </td></tr>
              )}
              {filtradas.map((v) => (
                <tr key={v.id} className="border-t border-linea hover:bg-fondo/60">
                  <td className="px-4 py-2.5">
                    <span className={`tag mr-2 ${v.tipo === "FACTURA" ? "bg-electrico-pale text-electrico" : "bg-volt-pale text-cobre"}`}>
                      {v.tipo}
                    </span>
                    <span className="font-mono font-semibold">{v.id}</span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">{v.fecha}</td>
                  <td className="px-4 py-2.5">
                    <div>{v.cliente_nombre || "—"}</div>
                    <div className="text-xs text-neutral-500 font-mono">{v.cliente_doc}</div>
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono">{v.num_items}</td>
                  <td className="px-4 py-2.5 text-neutral-600">{v.metodo_pago}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">
                    S/ {Number(v.total).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="btn-ghost !py-1 !px-3 text-xs" onClick={() => setSeleccion(v)}>
                      Ver / imprimir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
