# Reloj Checador NFC — Ámbar Rojo Studios

App de asistencia por PIN + etiqueta NFC. Multi-empresa, multi-sucursal, sin login del empleado.

## Cómo funciona (flujo real)

1. **Cada sucursal tiene una etiqueta NFC** grabada con una URL fija: `/<empresa>/<sucursal>`. No hay pool de tags ni registro dinámico — la URL es la identidad de la sucursal (modelo "por-slug", igual que un menú o reseña con QR).
2. El empleado acerca su celular a la etiqueta → se abre esa URL → ve un formulario con un solo campo: **PIN (4-8 dígitos)**.
3. Al enviar, el navegador intenta obtener el GPS (`enableHighAccuracy`) y manda `{pin, lat, lon, precision}` a `POST /<empresa>/<sucursal>/checar`.
4. El servidor:
   - busca al empleado por PIN dentro de esa empresa,
   - decide **entrada o salida automáticamente** alternando respecto a su última checada (si la entrada anterior lleva más de 16h abierta, se asume que olvidó marcar salida y se reinicia a "entrada" — evita que un olvido invierta todos los días siguientes),
   - evalúa si el GPS cae dentro de la geocerca de la sucursal: el margen de error del GPS expande el radio configurado, con **tope absoluto de 300 m** (`radio efectivo = min(radio + precisión, max(radio, 300))`),
   - si la sucursal tiene geocerca pero el GPS no sirve para verificarla (permiso denegado, timeout, o precisión peor a 500 m), la checada **se rechaza hasta que el empleado mande una selfie de evidencia** (`<input capture="user">`, comprimida en el cliente a ~60 KB y guardada en base64 en la BD). Con GPS bueno nunca se guarda foto,
   - guarda la checada con la hora del **servidor en UTC** (no la del celular). Cada sucursal tiene su columna `timezone` (IANA, default `America/Mexico_City`) y toda hora visible — respuesta al empleado, panel y CSV de nómina — se convierte a la zona de la sucursal.
5. No hay límite de intentos en PINs correctos; solo los intentos fallidos cuentan para un rate-limit (20 cada 15 min por IP+sucursal) — así un pico de gente checando a la misma hora no se autobloquea.

## Roles y paneles

- **Empleado**: sin login, solo el PIN. Página pública en `/<empresa>/<sucursal>`.
- **Panel de empresa** (`/<empresa>/panel`, Basic Auth con `slug` + `admin_pass` propios): altas/bajas de empleados, tabla de asistencia filtrable por días (las checadas sin GPS muestran "📷 ver foto" con la selfie de evidencia), y descarga de CSV para nómina en hora local de la sucursal (con protección contra fórmulas maliciosas en Excel).
  - **Corrección de checadas**: el patrón puede capturar a mano una checada olvidada (se teclea la hora real, en la zona de la sucursal, y queda marcada como `origen='manual'`) y **anular** una equivocada. Anular no borra: la fila se conserva y solo deja de contar para nómina y estadísticas — el histórico completo es lo que le da valor probatorio al registro (art. 804 LFT).
- **Superadmin** (`/superadmin`, Basic Auth global de Ámbar Rojo): da de alta empresas y sus sucursales (con lat/lon/radio), y genera la URL exacta que hay que grabar en cada etiqueta NFC.

## Stack

- Node.js + Express, SQLite nativo (`node:sqlite`, sin ORM).
- HTML servido como strings (`ui.js` + `esc()` para escapar) — sin motor de plantillas ni build step.
- Un solo proceso: rate-limit y SQLite viven en memoria/disco local (`data/checador.db`), en modo WAL y con `busy_timeout`. No pensado para múltiples réplicas tal cual está.
- `mantenimiento.js` corre en el mismo proceso, al arrancar y cada 24 h: respaldo con `VACUUM INTO` en `/data/backups`, borrado de respaldos de más de 14 días y purga de las selfies de más de 90 días (la checada se queda, la foto no).
- Despliegue vía Docker (`Dockerfile` + `docker-compose.yml`), pensado para EasyPanel.

## Seguridad notable

- La contraseña de superadmin se valida contra una lista de valores inseguros por defecto; si coincide, el servidor **no arranca**.
- Autenticación Basic tanto para superadmin como para cada empresa (usuario = slug de empresa).
- Baja de empleados es lógica (`activo=0`), nunca se borra — para no perder histórico de checadas.
- La exigencia de selfie sin GPS válido se valida en el **backend** (formato `data:image/...` y tamaño máximo), no solo en el frontend. La foto de evidencia solo la ve el panel de la empresa, con auth.
- Body JSON limitado a 32 KB en todas las rutas salvo `/checar` (3 MB, para la selfie base64).

## Despliegue en EasyPanel

1. Crear el servicio desde este repo (EasyPanel detecta el `Dockerfile`) o pegar el `docker-compose.yml`.
2. **Variables de entorno obligatorias**: `SUPERADMIN_PASS` (una fuerte; con la default el servidor no arranca). Opcionales: `SUPERADMIN_USER` (default `admin`), `PORT` (default 3050).
3. **Volumen**: montar un volumen en `/data` (el compose ya trae `checador_data:/data`). Ahí vive `checador.db` con todo: checadas y fotos. Sin este volumen se pierde todo en cada deploy.
4. **Respaldo**: los automáticos viven en `/data/backups`, o sea **en el mismo volumen que la BD**. Sirven contra un borrado o una corrupción, no contra perder el volumen. Para un respaldo de verdad hay que sacar la copia del VPS: botón *Descargar respaldo* en `/superadmin`, o `curl -u admin:PASS https://checador.../superadmin/api/respaldo -o copia.db` desde otra máquina. **Restaurar** = detener el servicio, dejar ese archivo como `/data/checador.db` y levantar.
5. Apuntar el dominio (`checador.ambarrojostudios.cloud`) al puerto **3050**.
6. Probar: `GET /salud` debe responder `{"ok":true,...}`, y `/superadmin` pedir credenciales.

Para correr las pruebas localmente: `node test.js` (usa una BD temporal, no toca la real).
