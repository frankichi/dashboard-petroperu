@import url("https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");

@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-fondo text-ink font-body antialiased;
}

/* Franja de seguridad industrial: firma visual del sistema */
.franja {
  height: 6px;
  background: repeating-linear-gradient(
    -45deg,
    #f5b301 0 14px,
    #1a1d21 14px 28px
  );
}

.card {
  @apply bg-panel border border-linea rounded-lg shadow-card;
}

.btn {
  @apply inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-semibold text-sm transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-electrico;
}
.btn-volt { @apply btn bg-volt text-ink hover:bg-volt-dark; }
.btn-ink { @apply btn bg-ink text-white hover:bg-black; }
.btn-ghost { @apply btn bg-transparent border border-linea hover:bg-fondo; }
.btn-rojo { @apply btn bg-alerta text-white hover:bg-red-700; }

.input {
  @apply w-full rounded-md border border-linea bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-electrico/40 focus:border-electrico placeholder:text-neutral-400;
}
.label { @apply block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1; }

.codigo {
  @apply font-mono text-[13px] font-medium bg-ink text-volt px-1.5 py-0.5 rounded;
}

.tag { @apply inline-block text-xs font-semibold px-2 py-0.5 rounded-full; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}

/* ── Impresión de comprobantes (ticket 80mm) ───────────────── */
@media print {
  body * { visibility: hidden; }
  #ticket, #ticket * { visibility: visible; }
  #ticket {
    position: absolute; left: 0; top: 0;
    width: 76mm; padding: 2mm;
    font-family: "IBM Plex Mono", monospace;
    font-size: 11px; color: #000; background: #fff;
    box-shadow: none; border: none;
  }
  @page { size: 80mm auto; margin: 0; }
}
