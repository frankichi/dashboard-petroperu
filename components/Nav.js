"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const RUTAS = [
  { href: "/", label: "Dashboard", solo: "admin" },
  { href: "/ventas", label: "Punto de venta" },
  { href: "/inventario", label: "Inventario" },
  { href: "/comprobantes", label: "Comprobantes" },
  { href: "/usuarios", label: "Usuarios", solo: "admin" },
];

export default function Nav() {
  const path = usePathname();
  const [sesion, setSesion] = useState(null);

  useEffect(() => {
    if (path === "/login") return;
    fetch("/api/auth/yo")
      .then((r) => r.json())
      .then((d) => setSesion(d.sesion))
      .catch(() => {});
  }, [path]);

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (path === "/login") return null;

  const visibles = RUTAS.filter((r) => !r.solo || sesion?.rol === r.solo);

  return (
    <header className="bg-ink text-white sticky top-0 z-30 print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-1 sm:gap-3 h-14 overflow-x-auto">
        <Link href={sesion?.rol === "admin" ? "/" : "/ventas"} className="flex items-center gap-2 mr-2 shrink-0">
          <span className="bg-white rounded-md p-1 flex items-center justify-center h-9 w-9 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icono.png" alt="Electro Industria A&Z" className="h-full w-full object-contain" />
          </span>
          <span className="font-display font-bold text-xl tracking-wide uppercase leading-none">
            <span className="hidden md:inline">Electro Industria </span>A&amp;Z
          </span>
        </Link>
        <nav className="flex items-center gap-1 flex-1">
          {visibles.map((r) => {
            const activo = path === r.href;
            return (
              <Link
                key={r.href}
                href={r.href}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
                  activo
                    ? "bg-volt text-ink"
                    : "text-neutral-300 hover:text-white hover:bg-white/10"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>
        {sesion && (
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/perfil"
              className="text-right hover:bg-white/10 rounded-md px-2 py-1 transition-colors duration-200"
              title="Mi cuenta (cambiar contraseña)"
            >
              <div className="text-sm font-semibold leading-tight">{sesion.nombre}</div>
              <div className="text-[10px] uppercase tracking-wide text-volt leading-tight">
                {sesion.rol === "admin" ? "Administrador" : "Empleado"}
              </div>
            </Link>
            <button
              onClick={salir}
              className="text-neutral-300 hover:text-white hover:bg-white/10 rounded-md px-2.5 py-1.5 text-sm font-semibold cursor-pointer transition-colors duration-200"
              title="Cerrar sesión"
            >
              Salir
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
