"use client";

/** Comprobante en formato ticket 80mm. El id="ticket" activa los estilos @media print. */
export default function Ticket({ venta }) {
  if (!venta) return null;
  const emp = {
    nombre: process.env.NEXT_PUBLIC_EMPRESA_NOMBRE || "ELECTRO INDUSTRIA A&Z",
    ruc: process.env.NEXT_PUBLIC_EMPRESA_RUC || "-",
    direccion: process.env.NEXT_PUBLIC_EMPRESA_DIRECCION || "",
    telefono: process.env.NEXT_PUBLIC_EMPRESA_TELEFONO || "",
    lema: process.env.NEXT_PUBLIC_EMPRESA_LEMA || "",
  };
  const linea = "─".repeat(38);

  return (
    <div
      id="ticket"
      className="bg-white border border-linea rounded p-4 font-mono text-[12px] leading-snug max-w-xs mx-auto"
    >
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-16 w-16 object-contain mx-auto mb-1" />
        <div className="font-bold">{emp.nombre}</div>
        {emp.lema && <div className="text-[10px]">{emp.lema}</div>}
        <div>RUC: {emp.ruc}</div>
        <div>{emp.direccion}</div>
        {emp.telefono && <div>Tel: {emp.telefono}</div>}
      </div>
      <div className="my-1">{linea}</div>
      <div className="text-center font-bold">
        {venta.tipo === "FACTURA" ? "FACTURA ELECTRÓNICA" : "BOLETA DE VENTA"}
        <br />
        {venta.serie}-{venta.numero}
      </div>
      <div className="my-1">{linea}</div>
      <div>Fecha: {venta.fecha}</div>
      {venta.cliente_nombre && <div>Cliente: {venta.cliente_nombre}</div>}
      {venta.cliente_doc && (
        <div>{venta.tipo === "FACTURA" ? "RUC" : "DNI"}: {venta.cliente_doc}</div>
      )}
      {venta.cliente_direccion && <div>Dir: {venta.cliente_direccion}</div>}
      <div className="my-1">{linea}</div>
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th className="font-normal">CANT</th>
            <th className="font-normal">DESCRIPCIÓN</th>
            <th className="font-normal text-right">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {(venta.items || []).map((it, i) => (
            <tr key={i} className="align-top">
              <td className="pr-1">{it.cantidad}</td>
              <td className="pr-1">
                {it.nombre}
                <br />
                <span className="text-[10px]">@ S/ {Number(it.precio_unit).toFixed(2)}</span>
              </td>
              <td className="text-right">{Number(it.total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-1">{linea}</div>
      <div className="flex justify-between"><span>OP. GRAVADA:</span><span>S/ {Number(venta.subtotal).toFixed(2)}</span></div>
      <div className="flex justify-between"><span>IGV (18%):</span><span>S/ {Number(venta.igv).toFixed(2)}</span></div>
      <div className="flex justify-between font-bold text-[14px]"><span>TOTAL:</span><span>S/ {Number(venta.total).toFixed(2)}</span></div>
      <div>Pago: {venta.metodo_pago}</div>
      <div className="my-1">{linea}</div>
      <div className="text-center">¡Gracias por su compra!</div>
    </div>
  );
}
