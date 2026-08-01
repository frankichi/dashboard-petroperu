"use client";
import { useRef, useState, useEffect } from "react";
import EscanerCamara from "./EscanerCamara";

function IconoScan() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
    </svg>
  );
}
function IconoCamara() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/**
 * Campo listo para el lector de pistola USB/Bluetooth:
 * el lector "escribe" el código y envía Enter → se dispara onCodigo.
 * También permite escribir a mano o abrir la cámara del dispositivo.
 */
export default function CampoEscaneo({
  onCodigo,
  placeholder = "Escanea el código o escríbelo y presiona Enter",
  autoFoco = true,
  grande = false,
}) {
  const inputRef = useRef(null);
  const [valor, setValor] = useState("");
  const [camara, setCamara] = useState(false);

  useEffect(() => {
    if (autoFoco) inputRef.current?.focus();
  }, [autoFoco]);

  function enviar(codigo) {
    const c = String(codigo || "").trim();
    if (!c) return;
    onCodigo(c);
    setValor("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none">
          <IconoScan />
        </span>
        <input
          ref={inputRef}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar(valor)}
          placeholder={placeholder}
          className={`input !pl-10 font-mono ${grande ? "!py-3.5 !text-base" : ""}`}
          autoComplete="off"
          aria-label="Código de producto"
        />
      </div>
      <button
        type="button"
        onClick={() => setCamara(true)}
        className="btn-ghost shrink-0"
        title="Escanear con la cámara"
        aria-label="Escanear con la cámara"
      >
        <IconoCamara />
        <span className="hidden sm:inline">Cámara</span>
      </button>
      {camara && (
        <EscanerCamara onCodigo={enviar} onCerrar={() => setCamara(false)} />
      )}
    </div>
  );
}
