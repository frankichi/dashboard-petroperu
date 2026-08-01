"use client";
import { useEffect, useRef } from "react";

/**
 * Escáner con la cámara del dispositivo (celular o webcam).
 * Lee códigos QR, EAN-13, EAN-8, Code 128 y Code 39.
 * El lector USB tipo pistola NO necesita este componente:
 * escribe directo en cualquier campo de texto.
 */
export default function EscanerCamara({ onCodigo, onCerrar }) {
  const ref = useRef(null);

  useEffect(() => {
    let scanner;
    let activo = true;
    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      if (!activo) return;
      scanner = new Html5Qrcode("lector-camara", {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
        ],
      });
      ref.current = scanner;
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          (texto) => {
            onCodigo(texto.trim());
            cerrar();
          },
          () => {}
        );
      } catch (e) {
        alert("No se pudo abrir la cámara: " + e);
        onCerrar();
      }
    })();

    function cerrar() {
      activo = false;
      if (ref.current?.isScanning) {
        ref.current.stop().then(() => ref.current.clear()).catch(() => {});
      }
      onCerrar();
    }

    return () => {
      activo = false;
      if (ref.current?.isScanning) {
        ref.current.stop().then(() => ref.current.clear()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-ink/80 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-bold uppercase">
            Escanear con cámara
          </h3>
          <button onClick={onCerrar} className="btn-ghost !py-1 !px-3" aria-label="Cerrar escáner">
            ✕
          </button>
        </div>
        <div id="lector-camara" className="rounded overflow-hidden bg-black min-h-[260px]" />
        <p className="text-xs text-neutral-500 mt-3">
          Apunta la cámara al código de barras o QR del producto. Se detecta automáticamente.
        </p>
      </div>
    </div>
  );
}
