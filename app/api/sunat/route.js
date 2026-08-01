import { NextResponse } from "next/server";
import { requerir } from "@/lib/auth";

export const dynamic = "force-dynamic";
const err = (t, s = 400) => NextResponse.json({ error: t }, { status: s });

/**
 * Consulta pública de RUC/DNI mediante un proveedor externo.
 * SUNAT no ofrece una API pública oficial para consultas puntuales; el
 * estándar de la industria en Perú es usar un proveedor intermedio que
 * sí la ofrece de forma gratuita/económica. Aquí se usa decolecta.com
 * (mismo servicio detrás de apis.net.pe). Ver README para obtener un
 * token gratuito.
 */
async function consultarProveedor(tipo, numero, token) {
  const ruta = tipo === "ruc" ? "sunat/ruc" : "reniec/dni";
  const url = `https://api.decolecta.com/v1/${ruta}?numero=${encodeURIComponent(numero)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`El proveedor de consulta respondió con error (${res.status}).`);
  }
  return res.json();
}

function normalizar(tipo, data, numero) {
  if (!data) return null;
  if (tipo === "ruc") {
    return {
      doc: numero,
      tipo_doc: "RUC",
      nombre: data.razon_social || data.razonSocial || data.nombre || "",
      direccion: data.direccion || "",
      estado_sunat: data.estado || "",
      condicion_sunat: data.condicion || "",
    };
  }
  return {
    doc: numero,
    tipo_doc: "DNI",
    nombre:
      data.nombre_completo || data.nombreCompleto ||
      [data.nombres, data.apellido_paterno, data.apellido_materno].filter(Boolean).join(" ") ||
      data.nombre || "",
    direccion: data.direccion || "",
    estado_sunat: "",
    condicion_sunat: "",
  };
}

// GET /api/sunat?tipo=ruc&numero=20606112298
export async function GET(req) {
  const g = requerir();
  if (g.error) return err(g.error, g.status);

  const token = process.env.RUC_API_TOKEN;
  if (!token) {
    return err(
      "La consulta a SUNAT no está configurada todavía. Agrega la variable RUC_API_TOKEN " +
      "(ver README, sección 'Conectar con SUNAT') o ingresa los datos del cliente manualmente.",
      501
    );
  }

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo") === "dni" ? "dni" : "ruc";
  const numero = (searchParams.get("numero") || "").trim();

  if (tipo === "ruc" && !/^\d{11}$/.test(numero)) return err("El RUC debe tener 11 dígitos");
  if (tipo === "dni" && !/^\d{8}$/.test(numero)) return err("El DNI debe tener 8 dígitos");

  try {
    const data = await consultarProveedor(tipo, numero, token);
    if (!data) return err(`No se encontró ningún ${tipo.toUpperCase()} con ese número`, 404);
    return NextResponse.json({ resultado: normalizar(tipo, data, numero) });
  } catch (e) {
    return err(e.message, 502);
  }
}
