"use client";
import { useEffect, useState } from "react";

const VACIO = { usuario: "", nombre: "", rol: "empleado", password: "" };

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState(null);
  const [msj, setMsj] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function cargar() {
    setCargando(true);
    const r = await fetch("/api/usuarios").then((x) => x.json());
    setUsuarios(r.usuarios || []);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  async function llamar(metodo, body, exito) {
    setEnviando(true);
    setMsj(null);
    const r = await fetch("/api/usuarios", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    setEnviando(false);
    if (!r.ok) {
      setMsj({ tipo: "error", texto: data.error });
      return false;
    }
    setMsj({ tipo: "ok", texto: exito });
    cargar();
    return true;
  }

  async function crear(e) {
    e.preventDefault();
    const ok = await llamar("POST", form, `Cuenta "${form.usuario}" creada`);
    if (ok) setForm(null);
  }

  function resetearPassword(u) {
    const nueva = prompt(
      `Nueva contraseña para "${u.usuario}" (mínimo 6 caracteres):`
    );
    if (!nueva) return;
    llamar("PUT", { usuario: u.usuario, password: nueva },
      `Contraseña de "${u.usuario}" restablecida. Entrégasela al usuario.`);
  }

  const solicitudes = usuarios.filter((u) => u.recuperacion);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase">Usuarios</h1>
          <p className="text-sm text-neutral-500">
            Crea cuentas para tu personal. El <b>administrador</b> tiene control total;
            el <b>empleado</b> puede vender, registrar productos y consultar, pero no editar ni borrar.
          </p>
        </div>
        <button className="btn-volt" onClick={() => { setForm({ ...VACIO }); setMsj(null); }}>
          + Nueva cuenta
        </button>
      </div>

      {msj && (
        <div
          role="status"
          className={`rounded-md px-4 py-3 text-sm font-medium ${
            msj.tipo === "error"
              ? "bg-red-50 text-alerta border border-red-200"
              : "bg-green-50 text-ok border border-green-200"
          }`}
        >
          {msj.texto}
        </div>
      )}

      {/* Solicitudes de recuperación pendientes */}
      {solicitudes.length > 0 && (
        <div className="card p-4 border-l-4 border-l-volt">
          <h2 className="font-display text-lg font-bold uppercase mb-2">
            Solicitudes de recuperación de contraseña
          </h2>
          <p className="text-sm text-neutral-500 mb-3">
            Estos usuarios pidieron recuperar su contraseña. Entrégales su código
            (vigente 30 minutos) para que la restablezcan desde la pantalla de login.
          </p>
          <div className="flex flex-wrap gap-3">
            {solicitudes.map((u) => (
              <div key={u.usuario} className="bg-fondo rounded-md px-4 py-2 border border-linea">
                <div className="text-sm font-semibold">{u.nombre} ({u.usuario})</div>
                <div className="font-mono text-2xl font-bold tracking-[0.3em] text-cobre">
                  {u.recuperacion}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulario de nueva cuenta */}
      {form && (
        <form onSubmit={crear} className="card p-5 space-y-4">
          <h2 className="font-display text-xl font-bold uppercase">Nueva cuenta</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="u-usuario">Usuario *</label>
              <input id="u-usuario" className="input" required value={form.usuario}
                placeholder="jperez"
                onChange={(e) => setForm((f) => ({ ...f, usuario: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="u-nombre">Nombre completo</label>
              <input id="u-nombre" className="input" value={form.nombre}
                placeholder="Juan Pérez"
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="u-rol">Rol</label>
              <select id="u-rol" className="input" value={form.rol}
                onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value }))}>
                <option value="empleado">Empleado (vender y registrar)</option>
                <option value="admin">Administrador (control total)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="u-pass">Contraseña inicial * (mínimo 6)</label>
              <input id="u-pass" type="text" className="input font-mono" required minLength={6}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn-volt" disabled={enviando}>
              {enviando ? "Creando…" : "Crear cuenta"}
            </button>
          </div>
        </form>
      )}

      {/* Tabla de usuarios */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-fondo text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5">Usuario</th>
                <th className="px-4 py-2.5">Rol</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5">Creado</th>
                <th className="px-4 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">Cargando…</td></tr>
              )}
              {usuarios.map((u) => (
                <tr key={u.usuario} className="border-t border-linea hover:bg-fondo/60">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{u.nombre}</div>
                    <div className="font-mono text-xs text-neutral-500">{u.usuario}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`tag ${u.rol === "admin" ? "bg-ink text-volt" : "bg-electrico-pale text-electrico"}`}>
                      {u.rol === "admin" ? "Administrador" : "Empleado"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`tag ${u.estado === "ACTIVO" ? "bg-green-100 text-ok" : "bg-neutral-200 text-neutral-500"}`}>
                      {u.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">
                    {u.fecha_creacion}<br />por {u.creado_por}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      <button className="btn-ghost !py-1 !px-2.5 text-xs"
                        onClick={() => llamar("PUT",
                          { usuario: u.usuario, rol: u.rol === "admin" ? "empleado" : "admin" },
                          `Rol de "${u.usuario}" actualizado`)}>
                        Hacer {u.rol === "admin" ? "empleado" : "admin"}
                      </button>
                      <button className="btn-ghost !py-1 !px-2.5 text-xs"
                        onClick={() => resetearPassword(u)}>
                        Restablecer clave
                      </button>
                      <button
                        className={`!py-1 !px-2.5 text-xs ${u.estado === "ACTIVO" ? "btn-rojo" : "btn-ink"}`}
                        onClick={() => llamar("PUT",
                          { usuario: u.usuario, estado: u.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO" },
                          `Cuenta "${u.usuario}" ${u.estado === "ACTIVO" ? "desactivada" : "reactivada"}`)}>
                        {u.estado === "ACTIVO" ? "Desactivar" : "Reactivar"}
                      </button>
                    </div>
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
