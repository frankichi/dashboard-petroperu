"use client";
import { useEffect, useState } from "react";

export default function Login() {
  const [modo, setModo] = useState("login"); // login | inicial | recuperar
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [f, setF] = useState({ usuario: "", nombre: "", password: "", codigo: "", nueva: "" });
  const [msj, setMsj] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [recuperarPaso, setRecuperarPaso] = useState(1);

  useEffect(() => {
    fetch("/api/auth/estado")
      .then((r) => r.json())
      .then((d) => {
        if (d.inicializado === false) setModo("inicial");
        setCargandoEstado(false);
      })
      .catch(() => setCargandoEstado(false));
  }, []);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function post(accion, body) {
    setEnviando(true);
    setMsj(null);
    const r = await fetch(`/api/auth/${accion}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    setEnviando(false);
    if (!r.ok) {
      setMsj({ tipo: "error", texto: data.error });
      return null;
    }
    return data;
  }

  async function entrar(e) {
    e.preventDefault();
    const d = await post("login", { usuario: f.usuario, password: f.password });
    if (d) window.location.href = d.rol === "admin" ? "/" : "/ventas";
  }

  async function crearAdmin(e) {
    e.preventDefault();
    const d = await post("inicial", { usuario: f.usuario, nombre: f.nombre, password: f.password });
    if (d) window.location.href = "/";
  }

  async function solicitarCodigo(e) {
    e.preventDefault();
    const d = await post("recuperar", { usuario: f.usuario });
    if (d) {
      setMsj({ tipo: "info", texto: d.mensaje });
      setRecuperarPaso(2);
    }
  }

  async function restablecer(e) {
    e.preventDefault();
    const d = await post("restablecer", { usuario: f.usuario, codigo: f.codigo, password: f.nueva });
    if (d) {
      setMsj({ tipo: "ok", texto: "Contraseña actualizada. Ya puedes iniciar sesión." });
      setModo("login");
      setRecuperarPaso(1);
      setF((x) => ({ ...x, password: "", codigo: "", nueva: "" }));
    }
  }

  if (cargandoEstado) {
    return <div className="min-h-[60vh] flex items-center justify-center text-neutral-400">Cargando…</div>;
  }

  return (
    <div className="min-h-[75vh] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Electro Industria A&Z"
            className="h-28 w-28 object-contain mx-auto" />
          <p className="text-xs text-neutral-500 mt-1 uppercase tracking-wide">
            Servicios eléctricos · Materiales y equipos industriales
          </p>
        </div>

        <div className="card p-6 space-y-4">
          {msj && (
            <div
              role="status"
              className={`rounded-md px-3 py-2.5 text-sm font-medium ${
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

          {/* ── Primer arranque: crear administrador ── */}
          {modo === "inicial" && (
            <form onSubmit={crearAdmin} className="space-y-3">
              <h1 className="font-display text-xl font-bold uppercase">Bienvenido</h1>
              <p className="text-sm text-neutral-500">
                Aún no hay usuarios. Crea la cuenta del <b>administrador</b> para empezar.
              </p>
              <div>
                <label className="label" htmlFor="l-user">Usuario</label>
                <input id="l-user" className="input" required autoComplete="username"
                  value={f.usuario} onChange={(e) => set("usuario", e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="l-nombre">Nombre completo</label>
                <input id="l-nombre" className="input" value={f.nombre}
                  onChange={(e) => set("nombre", e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="l-pass">Contraseña (mínimo 6)</label>
                <input id="l-pass" type="password" className="input" required minLength={6}
                  autoComplete="new-password"
                  value={f.password} onChange={(e) => set("password", e.target.value)} />
              </div>
              <button className="btn-volt w-full !py-3" disabled={enviando}>
                {enviando ? "Creando…" : "Crear administrador y entrar"}
              </button>
            </form>
          )}

          {/* ── Inicio de sesión ── */}
          {modo === "login" && (
            <form onSubmit={entrar} className="space-y-3">
              <h1 className="font-display text-xl font-bold uppercase">Iniciar sesión</h1>
              <div>
                <label className="label" htmlFor="l-user">Usuario</label>
                <input id="l-user" className="input" required autoComplete="username"
                  value={f.usuario} onChange={(e) => set("usuario", e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="l-pass">Contraseña</label>
                <input id="l-pass" type="password" className="input" required
                  autoComplete="current-password"
                  value={f.password} onChange={(e) => set("password", e.target.value)} />
              </div>
              <button className="btn-volt w-full !py-3" disabled={enviando}>
                {enviando ? "Verificando…" : "Entrar"}
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-electrico hover:underline cursor-pointer"
                onClick={() => { setModo("recuperar"); setMsj(null); setRecuperarPaso(1); }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </form>
          )}

          {/* ── Recuperación de contraseña ── */}
          {modo === "recuperar" && (
            <div className="space-y-3">
              <h1 className="font-display text-xl font-bold uppercase">Recuperar contraseña</h1>
              {recuperarPaso === 1 && (
                <form onSubmit={solicitarCodigo} className="space-y-3">
                  <p className="text-sm text-neutral-500">
                    Ingresa tu usuario. Se generará un <b>código de 6 dígitos</b> que tu
                    administrador verá en su panel y te lo entregará.
                  </p>
                  <div>
                    <label className="label" htmlFor="r-user">Usuario</label>
                    <input id="r-user" className="input" required value={f.usuario}
                      onChange={(e) => set("usuario", e.target.value)} />
                  </div>
                  <button className="btn-ink w-full" disabled={enviando}>
                    {enviando ? "Generando…" : "Solicitar código"}
                  </button>
                </form>
              )}
              {recuperarPaso === 2 && (
                <form onSubmit={restablecer} className="space-y-3">
                  <div>
                    <label className="label" htmlFor="r-cod">Código de 6 dígitos</label>
                    <input id="r-cod" className="input font-mono text-center tracking-[0.4em]"
                      required maxLength={6} inputMode="numeric" value={f.codigo}
                      onChange={(e) => set("codigo", e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div>
                    <label className="label" htmlFor="r-nueva">Nueva contraseña (mínimo 6)</label>
                    <input id="r-nueva" type="password" className="input" required minLength={6}
                      autoComplete="new-password" value={f.nueva}
                      onChange={(e) => set("nueva", e.target.value)} />
                  </div>
                  <button className="btn-volt w-full" disabled={enviando}>
                    {enviando ? "Guardando…" : "Restablecer contraseña"}
                  </button>
                </form>
              )}
              <button
                type="button"
                className="w-full text-center text-sm text-neutral-500 hover:underline cursor-pointer"
                onClick={() => { setModo("login"); setMsj(null); }}
              >
                ← Volver al inicio de sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
