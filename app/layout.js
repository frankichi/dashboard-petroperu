import "./globals.css";
import Nav from "@/components/Nav";

export const metadata = {
  title: "Electro Industria A&Z · Inventario y ventas",
  description: "Sistema de inventario, punto de venta y facturación de Electro Industria A&Z — servicios eléctricos y venta de materiales, equipos y accesorios eléctricos e industriales.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <div className="franja" />
        <Nav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
