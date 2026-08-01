# ⚡ Electro Industria A&Z — Sistema de inventario y ventas

> Empresa de servicios eléctricos. Venta de materiales, equipos y accesorios eléctricos e industriales. Ejecución de obras y asesoramiento.

Sistema web completo: inventario con lector de código de barras/QR, punto de venta con boletas y facturas (IGV 18%), historial de comprobantes y dashboard. **Base de datos: Google Sheets. Despliegue: Vercel.**

> **Base de datos**: Google Sheets, sin cuenta de servicio. Se usa Google Apps Script como puente (útil si tu organización de Google Workspace bloquea la creación de claves de cuenta de servicio, error `iam.disableServiceAccountKeyCreation`).

## Qué lector comprar

Compra un **lector 2D tipo pistola con cable USB** (o inalámbrico 2.4G). Debe decir **"2D"** o **"QR"** en la descripción: eso garantiza que lee tanto códigos de barras (EAN-13, Code 128) como códigos QR. Funciona como un teclado: lo conectas y ya está, sin drivers ni configuración. Marcas comunes: Netum, Eyoyo, Tera, Honeywell. En Perú se consiguen desde ~S/ 90.

El sistema también permite escanear con la **cámara del celular** (botón "Cámara" junto al campo de escaneo), útil como respaldo o para trabajar desde el teléfono.

---

## Instalación paso a paso

### 1. Tu hoja de Google Sheets

Ya tienes creada `ElectroIndustriaAZ BD`. No necesitas crear pestañas ni columnas a mano: **el sistema las crea automáticamente** (`Productos`, `Ventas`, `VentaItems`, `Movimientos`, `Usuarios`) la primera vez que se conecta.

### 2. Instalar el Apps Script dentro de tu hoja (reemplaza a la cuenta de servicio)

Este es el paso que evita por completo el error *"La creación de claves de la cuenta de servicio está inhabilitada"*: en lugar de una clave de Google Cloud, el "backend" vive dentro de tu propia hoja.

1. Abre tu hoja `ElectroIndustriaAZ BD`.
2. Menú **Extensiones → Apps Script**. Se abre un editor en una pestaña nueva.
3. Verás un archivo `Código.gs` con contenido de ejemplo. Bórralo todo y pega el contenido completo del archivo **`google-apps-script/Code.gs`** que viene en este mismo proyecto.
4. Dentro del código pegado, busca esta línea cerca del inicio:
   ```js
   const TOKEN = "CAMBIA-ESTA-CLAVE-POR-UNA-PROPIA-Y-LARGA-123456";
   ```
   Reemplaza el texto entre comillas por una clave secreta inventada por ti (letras, números, larga). **Anótala**, la necesitarás en el paso 4.
5. Guarda (ícono de disquete o Ctrl/Cmd+S). Ponle un nombre al proyecto si te lo pide, ej. `FerreSys Backend`.
6. Arriba a la derecha, botón azul **Implementar → Nueva implementación**.
   - Haz clic en el ícono de engranaje junto a "Seleccionar tipo" → **Aplicación web**.
   - "Ejecutar como": **Yo (tu correo)**.
   - "Quién tiene acceso": **Cualquier usuario**.
   - Botón **Implementar**.
7. Google te pedirá autorizar permisos (es tu propio script accediendo a tu propia hoja): **Autorizar acceso** → elige tu cuenta → si aparece "Google no verificó esta app", haz clic en **Avanzado** → **Ir a [nombre del proyecto] (no seguro)** → **Permitir**. Esto es normal y seguro: el script nunca sale de tu cuenta.
8. Copia la **URL de la aplicación web** que te muestra (empieza con `https://script.google.com/macros/s/.../exec`). Esa es tu `APPS_SCRIPT_URL`.

> Si en el futuro modificas el código del script, debes volver a **Implementar → Gestionar implementaciones → ✏️ → Nueva versión → Implementar** para que los cambios se publiquen.

### 3. Probar en tu computadora (opcional pero recomendado)

Necesitas [Node.js](https://nodejs.org) instalado (versión 18 o superior).

```bash
npm install
copy .env.example .env.local   # en Windows (en Mac/Linux: cp .env.example .env.local)
```

Abre `.env.local` y completa:

| Variable | Valor |
|---|---|
| `APPS_SCRIPT_URL` | La URL de la aplicación web que copiaste en el paso 2.8 |
| `APPS_SCRIPT_TOKEN` | La misma clave secreta que escribiste en `TOKEN` dentro de `Code.gs` |
| `AUTH_SECRET` | Un texto largo y aleatorio inventado por ti (30+ caracteres). Firma las sesiones de login |
| `NEXT_PUBLIC_EMPRESA_*` | Los datos reales de Electro Industria A&Z: RUC, dirección y teléfono (salen impresos en boletas y facturas) |

Luego:

```bash
npm run dev
```

Abre `http://localhost:3000`. Si el dashboard carga sin error rojo, la conexión con Sheets funciona.

### 4. Subir a GitHub

1. Crea un repositorio nuevo en [github.com/new](https://github.com/new) (puede ser privado).
2. En la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Sistema Electro Industria A&Z v1"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/electro-industria-az.git
git push -u origin main
```

> El archivo `.gitignore` ya evita que se suban tus claves (`.env.local`).

### 5. Desplegar en Vercel

1. Entra a [vercel.com](https://vercel.com) e inicia sesión con tu cuenta de GitHub.
2. **Add New → Project** → importa el repositorio `electro-industria-az`.
3. Antes de darle Deploy, abre **Environment Variables** y agrega **las mismas variables** de tu `.env.local` (`APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN`, `AUTH_SECRET` y las `NEXT_PUBLIC_EMPRESA_*`).
4. **Deploy**. En un minuto tendrás tu URL, ej. `https://electro-industria-az.vercel.app`, lista para usar desde cualquier computadora o celular de la tienda.

---

## Usuarios y roles

La **primera vez** que abras el sistema te pedirá crear la cuenta del **administrador** (no hay usuarios por defecto ni contraseñas de fábrica). A partir de ahí, todo requiere iniciar sesión.

| Permiso | Administrador | Empleado |
|---|:---:|:---:|
| Vender (punto de venta, boletas/facturas) | ✅ | ✅ |
| Registrar productos nuevos | ✅ | ✅ |
| Ver inventario y comprobantes | ✅ | ✅ |
| Editar y **eliminar** productos | ✅ | ❌ |
| Ver costos y dashboard (utilidades, valor del negocio) | ✅ | ❌ |
| Crear cuentas, cambiar roles, desactivar usuarios | ✅ | ❌ |
| Cambiar su propia contraseña | ✅ | ✅ |

**Crear cuentas**: menú **Usuarios** (solo admin) → "Nueva cuenta" → eliges rol y contraseña inicial.

**Recuperar contraseña**: en el login, el usuario pulsa "¿Olvidaste tu contraseña?" e ingresa su usuario. El sistema genera un **código de 6 dígitos (válido 30 min)** que aparece en el panel Usuarios del administrador; el admin se lo entrega y el usuario define su nueva contraseña. Alternativamente, el admin puede restablecerla directamente con el botón "Restablecer clave". *(Se eligió este flujo con código en lugar de correos porque no requiere configurar un servidor de email; si luego quieres envío por correo, se puede integrar.)*

**Seguridad**: las contraseñas se guardan encriptadas (scrypt + salt) en la pestaña `Usuarios` de tu hoja; nadie puede leerlas, ni siquiera abriendo el Sheets. Las sesiones duran 12 horas y van firmadas en una cookie httpOnly.

## Conectar con SUNAT (consulta de clientes por RUC/DNI)

SUNAT no ofrece una API pública gratuita para consultas individuales de RUC, así que el sistema usa un proveedor intermedio gratuito (el más usado en Perú para esto):

1. Entra a [apis.net.pe](https://apis.net.pe) y regístrate gratis.
2. Genera tu token (aparece como `apis-token-1.xxxxxxxxxx...`).
3. En Vercel, agrega la variable `RUC_API_TOKEN` con ese valor.
4. Redeploy. Listo: en el Punto de venta, al escribir un RUC (11 dígitos) o DNI (8 dígitos) y presionar "Buscar", el sistema:
   - Primero busca en tus **clientes ya guardados** (pestaña `Clientes` de tu hoja).
   - Si no lo encuentra, consulta **SUNAT** (para RUC) o **RENIEC** (para DNI) y autocompleta razón social/nombre y dirección.
   - Puedes guardar ese cliente con un clic para que la próxima venta sea instantánea, sin volver a consultar.

Sin este token configurado, el sistema sigue funcionando normalmente: solo no autocompleta, y sigues escribiendo los datos del cliente a mano como antes.

## Corrección de códigos con ceros a la izquierda

Si registraste productos antes de esta versión y notas que un código como `038753319544` se guardó sin el cero inicial (`38753319544`), fue porque Google Sheets convertía automáticamente los códigos numéricos en números. Esto ya está corregido de raíz (las columnas se fuerzan a formato de texto), pero:

1. **Actualiza tu Apps Script** con la versión más reciente de `google-apps-script/Code.gs` (ver instrucciones de esa carpeta: Extensiones → Apps Script → reemplazar código → Implementar → Gestionar implementaciones → Nueva versión).
2. Los productos que **ya** perdieron su cero deben corregirse una vez a mano: en **Inventario**, edítalos y vuelve a escribir el código completo con el cero — ya no se volverá a perder.

## Cómo se usa en el día a día

**Registrar productos** (Inventario): escanea el código del producto con la pistola. Si no existe, se abre el formulario con el código ya cargado: completas nombre, voltaje, amperaje, peso, medidas, stock, costo, precio, etc. Si ya existe, se abre para editar.

**Vender** (Punto de venta): escanea los productos uno por uno; cada lectura los agrega al ticket (escanear dos veces = 2 unidades). Eliges **Boleta** o **Factura** (la factura pide RUC), método de pago, y presionas **Emitir**. El sistema:
1. Genera el comprobante con numeración correlativa (B001-000001, F001-000001…),
2. Lo registra en Google Sheets (pestañas `Ventas` y `VentaItems`),
3. Descuenta el stock automáticamente y anota el movimiento en el kardex (`Movimientos`),
4. Muestra el ticket en formato 80 mm listo para imprimir.

**Comprobantes**: historial de todo lo emitido, con buscador y reimpresión.

**Dashboard**: ventas de hoy y del mes, valor del inventario, gráfica de ventas de los últimos 14 días, top de productos vendidos, stock por categoría y lista de productos por reponer.

---

## Nota sobre facturación electrónica (SUNAT)

Este sistema genera boletas y facturas **internas** con IGV, numeración y formato de ticket. Para que tengan validez tributaria ante SUNAT deben emitirse electrónicamente mediante el portal SOL, el facturador SUNAT o un OSE/PSE autorizado (Nubefact, Efact, etc.). Un siguiente paso natural del proyecto es conectar la emisión a la API de uno de esos proveedores; la estructura de datos ya está lista para ello.
