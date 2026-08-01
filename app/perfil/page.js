"use client";
import { useState } from "react";

export default function Perfil() {
  const [f, setF] = useState({ actual: "", nueva: "", confirmar: "" });
  const [msj, setMsj] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function cambiar(e) {
    e.preventDefault();
    if (f.nueva !== f.confirmar) {
      setMsj({ tipo: "error", texto: "Las contraseñas nuevas no coinciden" });
      return;
    }
    setEnviando(true);
    setMsj(null);
    const r = await fetch("/api/auth/cambiar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual: f.actual, nueva: f.nueva }),
    });
    const data = await r.json();
    setEnviando(false);
    if (!r.ok) {
      setMsj({ tipo: "error", texto: data.error });
      return;
    }
    setMsj({ tipo: "ok", texto: "Contraseña actualizada correctamente" });
    setF({ actual: "", nueva: "", confirmar: "" });
  }

  return (
    <div className="max-w-sm mx-auto space-y-4">
      <h1 className="font-display text-3xl font-bold uppercase">Mi cuenta</h1>
      <form onSubmit={cambiar} className="card p-5 space-y-3">
        <h2 className="font-display text-lg font-bold uppercase">Cambiar contraseña</h2>
        {msj && (
          <div
            role="status"
            className={`rounded-md px-3 py-2.5 text-sm font-medium ${
              msj.tipo === "error"
                ? "bg-red-50 text-alerta border border-red-200"
                : "bg-green-50 text-ok border border-green-200"
            }`}
          >
            {msj.texto}
          </div>
        )}
        <div>
          <label className="label" htmlFor="p-actual">Contraseña actual</label>
          <input id="p-actual" type="password" className="input" required
            autoComplete="current-password" value={f.actual}
            onChange={(e) => setF((x) => ({ ...x, actual: e.target.value }))} />
        </div>
        <div>
          <label className="label" htmlFor="p-nueva">Nueva contraseña (mínimo 6)</label>
          <input id="p-nueva" type="password" className="input" required minLength={6}
            autoComplete="new-password" value={f.nueva}
            onChange={(e) => setF((x) => ({ ...x, nueva: e.target.value }))} />
        </div>
        <div>
          <label className="label" htmlFor="p-conf">Confirmar nueva contraseña</label>
          <input id="p-conf" type="password" className="input" required minLength={6}
            autoComplete="new-password" value={f.confirmar}
            onChange={(e) => setF((x) => ({ ...x, confirmar: e.target.value }))} />
        </div>
        <button className="btn-volt w-full" disabled={enviando}>
          {enviando ? "Guardando…" : "Actualizar contraseña"}
        </button>
      </form>
    </div>
  );
}
