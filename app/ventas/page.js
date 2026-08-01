"use client";
import { useState } from "react";
import CampoEscaneo from "@/components/CampoEscaneo";
import Ticket from "@/components/Ticket";

const IGV = 0.18;

export default function PuntoDeVenta() {
  const [carrito, setCarrito] = useState([]);
  const [tipo, setTipo] = useState("BOLETA");
  const [cliente, setCliente] = useState({ doc: "", nombre: "", direccion: "" });
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [clienteEncontrado, setClienteEncontrado] = useState(null); // "local" | "sunat" | null
  const [msjCliente, setMsjCliente] = useState(null);
  const [metodoPago, setMetodoPago] = useState("EFECTIVO");
  const [buscando, setBuscando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [msj, setMsj] = useState(null);
  const [comprobante, setComprobante] = useState(null); // venta emitida

  async function buscarCliente() {
    const doc = cliente.doc.trim();
    setMsjCliente(null);
    setClienteEncontrado(null);
    if (!doc) return;

    const esRuc = /^\d{11}$/.test(doc);
    const esDni = /^\d{8}$/.test(doc);
    if (!esRuc && !esDni) {
      setMsjCliente({ tipo: "error", texto: "El documento debe tener 8 dígitos (DNI) u 11 dígitos (RUC)." });
      return;
    }

    setBuscandoCliente(true);
    try {
      // 1) Buscar primero en los clientes ya guardados
      const local = await fetch(`/api/clientes?doc=${encodeURIComponent(doc)}`).then((r) => r.json());
      if (local.cliente) {
        setCliente({ doc, nombre: local.cliente.nombre, direccion: local.cliente.direccion || "" });
        setClienteEncontrado("local");
        setMsjCliente({ tipo: "ok", texto: "Cliente encontrado en tu registro." });
        setBuscandoCliente(false);
        return;
      }

      // 2) Si no está guardado y parece RUC/DNI válido, consultar SUNAT/RENIEC
      const tipoDoc = esRuc ? "ruc" : "dni";
      const r = await fetch(`/api/sunat?tipo=${tipoDoc}&numero=${doc}`);
      const data = await r.json();
      if (!r.ok) {
        setMsjCliente({ tipo: "error", texto: data.error || "No se pudo consultar SUNAT." });
        setBuscandoCliente(false);
        return;
      }
      setCliente({ doc, nombre: data.resultado.nombre, direccion: data.resultado.direccion });
      setClienteEncontrado("sunat");
      setMsjCliente({
        tipo: "ok",
        texto: esRuc
          ? `Datos obtenidos de SUNAT (estado: ${data.resultado.estado_sunat || "—"}).`
          : "Datos obtenidos de RENIEC.",
      });
    } catch (e) {
      setMsjCliente({ tipo: "error", texto: "No se pudo completar la búsqueda." });
    }
    setBuscandoCliente(false);
  }

  async function guardarCliente() {
    if (!cliente.doc || !cliente.nombre) return;
    setBuscandoCliente(true);
    const r = await fetch("/api/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc: cliente.doc,
        tipo_doc: cliente.doc.length === 11 ? "RUC" : "DNI",
        nombre: cliente.nombre,
        direccion: cliente.direccion,
      }),
    });
    setBuscandoCliente(false);
    if (r.ok) {
      setClienteEncontrado("local");
      setMsjCliente({ tipo: "ok", texto: "Cliente guardado. La próxima vez se autocompleta al instante." });
    }
  }

  async function agregarPorCodigo(codigo) {
    setMsj(null);
    // Si ya está en el carrito, solo suma 1 (escaneo repetido = +1 unidad)
    const idx = carrito.findIndex((c) => c.codigo === codigo);
    if (idx >= 0) {
      cambiarCantidad(idx, carrito[idx].cantidad + 1);
      return;
    }
    setBuscando(true);
    const r = await fetch(`/api/productos?codigo=${encodeURIComponent(codigo)}`)
      .then((x) => x.json());
    setBuscando(false);
    if (!r.producto) {
      setMsj({
        tipo: "error",
        texto: `El código ${codigo} no está registrado. Regístralo primero en Inventario.`,
      });
      return;
    }
    const p = r.producto;
    if (Number(p.stock) <= 0) {
      setMsj({ tipo: "error", texto: `"${p.nombre}" no tiene stock disponible.` });
      return;
    }
    setCarrito((c) => [
      ...c,
      {
        codigo: p.codigo, nombre: p.nombre, unidad: p.unidad,
        precio: Number(p.precio) || 0, stock: Number(p.stock) || 0,
        cantidad: 1,
      },
    ]);
  }

  function cambiarCantidad(idx, cant) {
    setCarrito((c) =>
      c.map((it, i) => {
        if (i !== idx) return it;
        const nueva = Math.max(1, Math.min(Number(cant) || 1, it.stock));
        if (Number(cant) > it.stock) {
          setMsj({ tipo: "error", texto: `Stock máximo de "${it.nombre}": ${it.stock}` });
        }
        return { ...it, cantidad: nueva };
      })
    );
  }

  function quitar(idx) {
    setCarrito((c) => c.filter((_, i) => i !== idx));
  }

  const total = carrito.reduce((s, it) => s + it.precio * it.cantidad, 0);
  const subtotal = total / (1 + IGV);
  const igv = total - subtotal;

  async function emitir() {
    setMsj(null);
    if (!carrito.length) return;
    if (tipo === "FACTURA" && !/^\d{11}$/.test(cliente.doc)) {
      setMsj({ tipo: "error", texto: "Para factura, ingresa el RUC del cliente (11 dígitos)." });
      return;
    }
    setProcesando(true);
    const r = await fetch("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo, cliente, metodo_pago: metodoPago,
        items: carrito.map((c) => ({ codigo: c.codigo, cantidad: c.cantidad })),
      }),
    });
    const data = await r.json();
    setProcesando(false);
    if (!r.ok) {
      setMsj({ tipo: "error", texto: data.error || "No se pudo emitir el comprobante" });
      return;
    }
    setComprobante(data.venta);
    setCarrito([]);
    setCliente({ doc: "", nombre: "", direccion: "" });
    setClienteEncontrado(null);
    setMsjCliente(null);
  }

  // ── Vista de comprobante emitido ─────────────────────────
  if (comprobante) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 text-ok px-4 py-3 text-sm font-semibold text-center">
          {comprobante.tipo} {comprobante.serie}-{comprobante.numero} emitida y registrada.
          Stock actualizado.
        </div>
        <Ticket venta={comprobante} />
        <div className="flex gap-2 justify-center print:hidden">
          <button className="btn-ink" onClick={() => window.print()}>Imprimir</button>
          <button className="btn-volt" onClick={() => setComprobante(null)}>
            Nueva venta
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* ── Carrito ─────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase">Punto de venta</h1>
          <p className="text-sm text-neutral-500">
            Escanea productos con la pistola: cada lectura los agrega al ticket.
            Escanear el mismo código suma una unidad.
          </p>
        </div>

        <div className="card p-4">
          <CampoEscaneo onCodigo={agregarPorCodigo} grande
            placeholder="Escanea aquí para agregar al ticket…" />
          {buscando && <p className="text-xs text-neutral-400 mt-2">Buscando producto…</p>}
        </div>

        {msj && (
          <div role="alert" className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-alerta border border-red-200">
            {msj.texto}
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-fondo text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5">Producto</th>
                <th className="px-4 py-2.5 text-center">Cantidad</th>
                <th className="px-4 py-2.5 text-right">P. Unit</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {!carrito.length && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-400">
                  El ticket está vacío. Escanea el primer producto para empezar.
                </td></tr>
              )}
              {carrito.map((it, i) => (
                <tr key={it.codigo} className="border-t border-linea">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{it.nombre}</div>
                    <span className="codigo">{it.codigo}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button className="btn-ghost !px-2.5 !py-1" aria-label="Restar unidad"
                        onClick={() => cambiarCantidad(i, it.cantidad - 1)}>−</button>
                      <input
                        type="number" min="1" max={it.stock}
                        className="input !w-16 text-center font-mono !py-1"
                        value={it.cantidad}
                        onChange={(e) => cambiarCantidad(i, e.target.value)}
                        aria-label={`Cantidad de ${it.nombre}`}
                      />
                      <button className="btn-ghost !px-2.5 !py-1" aria-label="Sumar unidad"
                        onClick={() => cambiarCantidad(i, it.cantidad + 1)}>+</button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">S/ {it.precio.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">
                    S/ {(it.precio * it.cantidad).toFixed(2)}
                  </td>
                  <td className="px-2 py-2.5">
                    <button className="text-alerta hover:underline text-xs font-semibold cursor-pointer"
                      onClick={() => quitar(i)}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Panel de cobro ─────────────────────────────────── */}
      <div className="space-y-4">
        <div className="card p-4 space-y-4">
          <h2 className="font-display text-xl font-bold uppercase">Comprobante</h2>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de comprobante">
            {["BOLETA", "FACTURA"].map((t) => (
              <button key={t} type="button"
                onClick={() => setTipo(t)}
                className={`btn ${tipo === t ? "bg-ink text-white" : "border border-linea hover:bg-fondo"}`}>
                {t === "BOLETA" ? "Boleta" : "Factura"}
              </button>
            ))}
          </div>

          <div>
            <label className="label" htmlFor="c-doc">
              {tipo === "FACTURA" ? "RUC del cliente *" : "DNI (opcional)"}
            </label>
            <div className="flex gap-2">
              <input id="c-doc" className="input font-mono" inputMode="numeric"
                maxLength={11} value={cliente.doc}
                onChange={(e) => {
                  setCliente((c) => ({ ...c, doc: e.target.value.replace(/\D/g, "") }));
                  setClienteEncontrado(null);
                  setMsjCliente(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarCliente())}
              />
              <button type="button" className="btn-ghost shrink-0" onClick={buscarCliente}
                disabled={buscandoCliente || !cliente.doc}>
                {buscandoCliente ? "..." : "Buscar"}
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              Busca primero en tus clientes guardados y, si no lo encuentra, consulta SUNAT (RUC) o RENIEC (DNI).
            </p>
          </div>

          {msjCliente && (
            <div className={`rounded-md px-3 py-2 text-xs font-medium ${
              msjCliente.tipo === "error"
                ? "bg-red-50 text-alerta border border-red-200"
                : "bg-green-50 text-ok border border-green-200"
            }`}>
              {msjCliente.texto}
            </div>
          )}

          <div>
            <label className="label" htmlFor="c-nombre">
              {tipo === "FACTURA" ? "Razón social *" : "Nombre del cliente"}
            </label>
            <input id="c-nombre" className="input" value={cliente.nombre}
              onChange={(e) => { setCliente((c) => ({ ...c, nombre: e.target.value })); setClienteEncontrado(null); }} />
          </div>
          {tipo === "FACTURA" && (
            <div>
              <label className="label" htmlFor="c-dir">Dirección fiscal</label>
              <input id="c-dir" className="input" value={cliente.direccion}
                onChange={(e) => { setCliente((c) => ({ ...c, direccion: e.target.value })); setClienteEncontrado(null); }} />
            </div>
          )}
          {cliente.doc && cliente.nombre && clienteEncontrado !== "local" && (
            <button type="button" className="btn-ghost w-full !py-2 text-xs" onClick={guardarCliente}
              disabled={buscandoCliente}>
              + Guardar como cliente frecuente
            </button>
          )}
          <div>
            <label className="label" htmlFor="c-pago">Método de pago</label>
            <select id="c-pago" className="input" value={metodoPago}
              onChange={(e) => setMetodoPago(e.target.value)}>
              {["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card p-4 space-y-2">
          <div className="flex justify-between text-sm text-neutral-600">
            <span>Op. gravada</span><span className="font-mono">S/ {subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-neutral-600">
            <span>IGV (18%)</span><span className="font-mono">S/ {igv.toFixed(2)}</span>
          </div>
          <div className="border-t border-linea pt-2 flex justify-between items-center">
            <span className="font-display text-lg font-bold uppercase">Total</span>
            <span className="font-mono text-2xl font-semibold">S/ {total.toFixed(2)}</span>
          </div>
          <button
            className="btn-volt w-full !py-3.5 text-base"
            disabled={!carrito.length || procesando}
            onClick={emitir}
          >
            {procesando ? "Emitiendo…" : `Emitir ${tipo.toLowerCase()}`}
          </button>
          <p className="text-[11px] text-neutral-400 text-center">
            Al emitir se registra la venta y se descuenta el stock automáticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
