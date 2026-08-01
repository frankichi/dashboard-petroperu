"use client";
import { useEffect, useState } from "react";
import CampoEscaneo from "@/components/CampoEscaneo";

const VACIO = {
  codigo: "", nombre: "", descripcion: "", categoria: "", marca: "",
  unidad: "UND", voltaje: "", amperaje: "", peso: "", medidas: "",
  stock: "", stock_minimo: "", costo: "", precio: "", ubicacion: "",
};

const CATEGORIAS = [
  "Cables y conductores", "Iluminación", "Tableros y llaves",
  "Tomacorrientes e interruptores", "Herramientas", "Motores y bombas",
  "Canalización (tubos/canaletas)", "Ferretería general", "EPP / Seguridad", "Otros",
];

export default function Inventario() {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [form, setForm] = useState(null); // null = cerrado
  const [esEdicion, setEsEdicion] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msj, setMsj] = useState(null);
  const [sesion, setSesion] = useState(null);
  const esAdmin = sesion?.rol === "admin";

  async function cargar() {
    setCargando(true);
    const r = await fetch("/api/productos").then((x) => x.json());
    setProductos(r.productos || []);
    setCargando(false);
  }
  useEffect(() => {
    cargar();
    fetch("/api/auth/yo").then((r) => r.json()).then((d) => setSesion(d.sesion));
  }, []);

  function alEscanear(codigo) {
    const existente = productos.find((p) => String(p.codigo).trim() === codigo);
    if (existente) {
      if (esAdmin) {
        setForm({ ...VACIO, ...existente });
        setEsEdicion(true);
        setMsj({ tipo: "info", texto: `Producto encontrado: ${existente.nombre}. Puedes editarlo.` });
      } else {
        setBusqueda(String(existente.codigo));
        setMsj({
          tipo: "info",
          texto: `${existente.nombre} — Stock: ${existente.stock} ${existente.unidad} — Precio: S/ ${Number(existente.precio || 0).toFixed(2)}. (Solo el administrador puede editar productos.)`,
        });
      }
    } else {
      setForm({ ...VACIO, codigo });
      setEsEdicion(false);
      setMsj({ tipo: "info", texto: "Código nuevo. Completa las características para registrarlo." });
    }
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setMsj(null);
    const r = await fetch("/api/productos", {
      method: esEdicion ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await r.json();
    setGuardando(false);
    if (!r.ok) {
      setMsj({ tipo: "error", texto: data.error || "No se pudo guardar" });
      return;
    }
    setMsj({ tipo: "ok", texto: esEdicion ? "Producto actualizado" : "Producto registrado" });
    setForm(null);
    cargar();
  }

  async function eliminar(p) {
    if (!confirm(`¿Eliminar definitivamente "${p.nombre}" (${p.codigo})? Esta acción no se puede deshacer.`)) return;
    const r = await fetch(`/api/productos?codigo=${encodeURIComponent(p.codigo)}`, { method: "DELETE" });
    const data = await r.json();
    if (!r.ok) {
      setMsj({ tipo: "error", texto: data.error || "No se pudo eliminar" });
      return;
    }
    setMsj({ tipo: "ok", texto: `Producto "${p.nombre}" eliminado` });
    cargar();
  }

  const filtrados = productos.filter((p) => {
    const q = busqueda.toLowerCase();
    return (
      !q ||
      String(p.codigo).toLowerCase().includes(q) ||
      String(p.nombre).toLowerCase().includes(q) ||
      String(p.categoria).toLowerCase().includes(q) ||
      String(p.marca).toLowerCase().includes(q)
    );
  });

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase">Inventario</h1>
          <p className="text-sm text-neutral-500">
            {esAdmin ? "Escanea un código: si existe lo abres para editar, si es nuevo lo registras." : "Escanea un código: si es nuevo lo registras; si existe, verás su stock y precio."}
          </p>
        </div>
        <button
          className="btn-volt"
          onClick={() => { setForm({ ...VACIO }); setEsEdicion(false); setMsj(null); }}
        >
          + Registrar sin escanear
        </button>
      </div>

      <div className="card p-4">
        <CampoEscaneo onCodigo={alEscanear} grande />
      </div>

      {msj && (
        <div
          role="status"
          className={`rounded-md px-4 py-3 text-sm font-medium ${
            msj.tipo === "error"
              ? "bg-red-50 text-alerta border border-red-200"
              : msj.tipo === "ok"
              ? "bg-green-50 text-ok border border-green-200"
              : "bg-electrico-pale text-electrico border border-blue-200"
          }`}
        >
          {msj.texto}
        </div>
      )}

      {/* ── Formulario de producto ─────────────────────────── */}
      {form && (
        <form onSubmit={guardar} className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold uppercase">
              {esEdicion ? "Editar producto" : "Nuevo producto"}
            </h2>
            {form.codigo && <span className="codigo">{form.codigo}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="f-codigo">Código (barras/QR) *</label>
              <input id="f-codigo" className="input font-mono" required value={form.codigo}
                onChange={(e) => set("codigo", e.target.value)} disabled={esEdicion} />
            </div>
            <div className="lg:col-span-2">
              <label className="label" htmlFor="f-nombre">Nombre del producto *</label>
              <input id="f-nombre" className="input" required value={form.nombre}
                placeholder="Ej: Cable THW 12 AWG rollo 100m"
                onChange={(e) => set("nombre", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-categoria">Categoría</label>
              <select id="f-categoria" className="input" value={form.categoria}
                onChange={(e) => set("categoria", e.target.value)}>
                <option value="">— Seleccionar —</option>
                {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-marca">Marca</label>
              <input id="f-marca" className="input" value={form.marca}
                placeholder="Indeco, Philips, Stanley…"
                onChange={(e) => set("marca", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-unidad">Unidad</label>
              <select id="f-unidad" className="input" value={form.unidad}
                onChange={(e) => set("unidad", e.target.value)}>
                {["UND", "MTS", "ROLLO", "CAJA", "KG", "PAR", "JGO", "GLN"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-voltaje">Voltaje</label>
              <input id="f-voltaje" className="input" value={form.voltaje}
                placeholder="220V, 380V, 12V…" onChange={(e) => set("voltaje", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-amperaje">Amperaje / Potencia</label>
              <input id="f-amperaje" className="input" value={form.amperaje}
                placeholder="16A, 2A, 1500W…" onChange={(e) => set("amperaje", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-peso">Peso</label>
              <input id="f-peso" className="input" value={form.peso}
                placeholder="2.5 kg" onChange={(e) => set("peso", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-medidas">Medidas</label>
              <input id="f-medidas" className="input" value={form.medidas}
                placeholder='20x15x10 cm, 1/2", 3m…' onChange={(e) => set("medidas", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-ubicacion">Ubicación en tienda</label>
              <input id="f-ubicacion" className="input" value={form.ubicacion}
                placeholder="Estante A-3" onChange={(e) => set("ubicacion", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-stock">Stock actual</label>
              <input id="f-stock" type="number" min="0" step="any" className="input font-mono"
                value={form.stock} onChange={(e) => set("stock", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-min">Stock mínimo (alerta)</label>
              <input id="f-min" type="number" min="0" step="any" className="input font-mono"
                value={form.stock_minimo} onChange={(e) => set("stock_minimo", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-costo">Costo (S/)</label>
              <input id="f-costo" type="number" min="0" step="0.01" className="input font-mono"
                value={form.costo} onChange={(e) => set("costo", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-precio">Precio de venta (S/) *</label>
              <input id="f-precio" type="number" min="0" step="0.01" required className="input font-mono"
                value={form.precio} onChange={(e) => set("precio", e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label" htmlFor="f-desc">Descripción</label>
              <textarea id="f-desc" className="input" rows={2} value={form.descripcion}
                onChange={(e) => set("descripcion", e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-volt" disabled={guardando}>
              {guardando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Registrar producto"}
            </button>
          </div>
        </form>
      )}

      {/* ── Tabla de productos ─────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-linea flex flex-wrap items-center gap-3 justify-between">
          <h2 className="font-display text-xl font-bold uppercase">
            Productos <span className="text-neutral-400">({filtrados.length})</span>
          </h2>
          <input
            className="input !w-64"
            placeholder="Buscar por nombre, código, marca…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar producto"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-fondo text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5">Código</th>
                <th className="px-4 py-2.5">Producto</th>
                <th className="px-4 py-2.5">Categoría</th>
                <th className="px-4 py-2.5">Especificaciones</th>
                <th className="px-4 py-2.5 text-right">Stock</th>
                {esAdmin && <th className="px-4 py-2.5 text-right">Costo</th>}
                <th className="px-4 py-2.5 text-right">Precio</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={esAdmin ? 8 : 7} className="px-4 py-8 text-center text-neutral-400">
                  Cargando inventario…
                </td></tr>
              )}
              {!cargando && !filtrados.length && (
                <tr><td colSpan={esAdmin ? 8 : 7} className="px-4 py-8 text-center text-neutral-400">
                  Aún no hay productos. Escanea un código arriba para registrar el primero.
                </td></tr>
              )}
              {filtrados.map((p) => {
                const bajo = Number(p.stock) <= (Number(p.stock_minimo) || 0);
                return (
                  <tr key={p.codigo} className="border-t border-linea hover:bg-fondo/60">
                    <td className="px-4 py-2.5"><span className="codigo">{p.codigo}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">{p.nombre}</div>
                      <div className="text-xs text-neutral-500">{p.marca}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">{p.categoria}</td>
                    <td className="px-4 py-2.5 text-xs text-neutral-600">
                      {[p.voltaje, p.amperaje, p.medidas, p.peso].filter(Boolean).join(" · ")}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      <span className={`tag ${bajo ? "bg-red-100 text-alerta" : "bg-green-100 text-ok"}`}>
                        {p.stock} {p.unidad}
                      </span>
                    </td>
                    {esAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-500">
                        S/ {Number(p.costo || 0).toFixed(2)}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">
                      S/ {Number(p.precio || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {esAdmin && (
                        <div className="flex gap-1.5 justify-end">
                          <button
                            className="btn-ghost !py-1 !px-3 text-xs"
                            onClick={() => { setForm({ ...VACIO, ...p }); setEsEdicion(true); setMsj(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                          >
                            Editar
                          </button>
                          <button
                            className="btn-rojo !py-1 !px-3 text-xs"
                            onClick={() => eliminar(p)}
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
