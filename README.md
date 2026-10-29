# Llamadas Simultáneas v3.0.0

Campañas masivas de llamadas con Twilio (con audio generado por ElevenLabs, voz de Twilio o un MP3) y de WhatsApp, con seguimiento en tiempo real de quién contesta, quién no y por qué falla cada llamada.

## Qué hace

- Carga contactos desde un CSV o pegando números. Detecta duplicados e inválidos antes de iniciar y avisa cuántos se marcarán.
- Tres tipos de audio para las llamadas: voces de ElevenLabs (una o varias, con el nombre de cada persona dentro del mensaje), voz de Twilio y un MP3 fijo.
- Muestra todo en vivo: un tablero con una lámpara por contacto, marcador de resultados, líneas abiertas, últimos eventos, gráficos y una tabla filtrable. Cada contacto abre un detalle con su cronología, su código de error y el audio que escuchó.
- Muestra los errores de Twilio y de ElevenLabs con su código, cuántos contactos afectó y qué hacer.
- Se pausa sola si casi todas las llamadas fallan, para no gastar el saldo de los contactos restantes.
- Todo se puede descargar: reporte en Excel, listas en CSV, audios de ElevenLabs, resumen de datos de Twilio y un respaldo completo.
- Guarda cada campaña en disco. Si el servidor se reinicia, la campaña queda como interrumpida y se puede reanudar.

## Requisitos

- Node 18 o superior.
- Cuenta de Twilio con un número que pueda llamar a México y permisos de llamadas al país activos.
- API key de ElevenLabs (opcional si solo se usa la voz de Twilio o un MP3).
- Una dirección pública (`PUBLIC_BASE_URL`) que Twilio pueda alcanzar para descargar los audios y avisar el estado de cada llamada.

## Instalación local

```powershell
cd C:\Users\vicro\OneDrive\Documents\Inode\LlamadasSimultaneas
```

```powershell
npm install
```

```powershell
Copy-Item .env.example .env
```

Llena `.env` con las credenciales y arranca:

```powershell
npm start
```

Abre http://localhost:3000. Para recibir los avisos de Twilio en tu computadora necesitas un túnel público (por ejemplo ngrok) y poner su dirección en `PUBLIC_BASE_URL`.

## Variables de entorno

Obligatorias para llamar:

| Variable | Para qué sirve |
|---|---|
| `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN` | Credenciales de la cuenta de Twilio |
| `TWILIO_PHONE_NUMBER` | Número desde el que se llama, con `+` y código de país |
| `PUBLIC_BASE_URL` | Dirección pública del servidor, sin diagonal final |

Opcionales:

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `ELEVENLABS_API_KEY` | vacío | Activa las voces de ElevenLabs |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | Modelo de voz |
| `ELEVENLABS_CONCURRENCY` | `3` | Audios que se generan al mismo tiempo |
| `PORT` | `3000` | Puerto del servidor |
| `DEFAULT_COUNTRY_CODE` | `52` | Código de país para números sin él |
| `TWILIO_WHATSAPP_NUMBER` | `whatsapp:+14155238886` | Remitente de WhatsApp |
| `PANEL_USUARIO` y `PANEL_CLAVE` | vacío | Protegen todo el panel con usuario y contraseña |
| `LLAMADAS_POR_SEGUNDO` | `1` | Ritmo máximo de marcado. Twilio abre cerca de 1 llamada por segundo por cuenta |
| `TIMBRADO_SEGUNDOS` | `40` | Segundos que timbra una llamada antes de rendirse |
| `DURACION_MAXIMA_SEGUNDOS` | `0` | Límite de duración por llamada. 0 es sin límite |
| `ESPERA_FIN_LLAMADA_MS` | `45000` | Tiempo que se espera una llamada sin contestar antes de liberar su lugar |
| `DETECTAR_BUZON` | `false` | Detección de contestadora de Twilio (tiene costo extra) |
| `AUTO_PAUSA_FALLOS` | `true` | Pausa automática cuando fallan casi todas las llamadas |
| `UMBRAL_FALLOS_PCT` | `60` | Porcentaje de fallas que dispara la pausa |
| `VENTANA_FALLOS` | `30` | Cuántas llamadas recientes se miran para ese porcentaje |
| `ERRORES_SEGUIDOS_PAUSA` | `10` | Rechazos seguidos de Twilio que pausan la campaña |
| `MAX_CONTACTOS` | `5000` | Contactos máximos por campaña |
| `MAX_CONCURRENCIA` | `50` | Líneas simultáneas máximas |
| `MAX_CAMPANAS` | `40` | Campañas que se conservan en disco |
| `RETENCION_AUDIOS_DIAS` | `60` | Días que se conservan los audios generados que ya no usa ninguna campaña |
| `WHATSAPP_POR_SEGUNDO` | `5` | Ritmo de envío de WhatsApp |
| `TZ_REPORTES` | `America/Mexico_City` | Zona horaria de los reportes |
| `VALIDAR_FIRMA_TWILIO` | `false` | Rechaza avisos que no vengan firmados por Twilio. Actívalo solo cuando `PUBLIC_BASE_URL` sea exactamente la dirección que usa Twilio |
| `DATA_DIR` | `./data` | Carpeta donde se guardan las campañas |

## Formato del CSV

| numero | nombre |
|---|---|
| 6561234567 | Juan Pérez |
| +52 656 765 4321 | María López |

- La columna `nombre` es opcional. Escribe `{nombre}` en el mensaje para saludar a cada persona.
- Sin código de país se agrega el de `DEFAULT_COUNTRY_CODE`.
- En la pantalla de llamadas hay un botón para descargar un archivo de ejemplo.

## Cómo se usa

1. En Llamadas, sube el CSV o pega los números.
2. Elige el tipo de audio. Con ElevenLabs marca una o varias voces; si marcas varias se alternan entre los contactos. El botón de escuchar genera una muestra con tu mensaje.
3. Ajusta las líneas simultáneas y el ritmo, y confirma. Solo puede haber una campaña de llamadas y una de WhatsApp activas a la vez.
4. En En vivo puedes pausar, reanudar, cambiar el ritmo o detener. Los resultados y los errores aparecen mientras ocurren.
5. Al terminar, en Descargas están todos los archivos. Con Reintentar se prepara una campaña nueva con los mismos ajustes y solo los contactos que elijas (quienes no respondieron, quienes fallaron o ambos sin los números que no existen), y se revisa antes de iniciar.

## Qué significa cada resultado

| Resultado | Significado |
|---|---|
| Respondieron | Una persona contestó la llamada |
| No respondieron | Nadie contestó, la línea estaba ocupada, se agotó el timbrado o contestó un buzón o contestadora |
| Fallaron | Twilio no pudo completar la llamada. El detalle trae el código de Twilio, el código SIP y la acción recomendada |
| En curso | Timbrando o hablando en este momento |
| Pendientes | Aún no se marcan |
| Sin marcar | Quedaron sin marcar porque la campaña se detuvo o se canceló |

Cada resultado tiene un color y una forma distintos para que se distinga sin depender solo del color.

## Descargas

De cada campaña:

- Reporte completo en Excel, con las hojas Resumen, Detalle, Respondieron, No respondieron, Fallidas, Sin marcar, Por voz, Por hora, Errores y Audios.
- Todos los contactos, Quienes respondieron, Quienes no respondieron, Llamadas fallidas con su causa, Sin marcar o canceladas y Lista para reintentar, todos en CSV.
- Resumen de datos de Twilio en CSV: SID, estado, duración, costo, código SIP, código de error y horas de cada llamada.
- Errores de Twilio y ElevenLabs en CSV.
- Audios de ElevenLabs en un ZIP ordenado por voz, con un índice de qué audio recibió cada contacto.
- Respaldo completo en un ZIP con todo lo anterior.

De la cuenta de Twilio, en Descargas, el registro de llamadas por rango de fechas en Excel, CSV o JSON, incluso de llamadas que no se hicieron desde esta aplicación.

## Errores de Twilio y ElevenLabs

- Cada problema distinto aparece una sola vez en el panel de errores, con su código, el número de contactos afectados, los primeros números y qué hacer.
- Los errores de ElevenLabs que impiden continuar (pago pendiente, créditos agotados, API key inválida) detienen la campaña antes de marcar y se puede reanudar al resolverlos. Los que afectan a una sola voz pasan sus contactos a las otras voces elegidas; si ninguna voz funciona, la campaña se detiene antes de marcar.
- La luz de estado de la barra superior resume la salud del sistema. Al abrirla, Revisar a fondo comprueba las credenciales, el estado y el saldo de la cuenta de Twilio, el número de origen, el permiso para llamar a México, la API key, los créditos y las voces de ElevenLabs, que la dirección pública responda, la seguridad del panel, la memoria, el disco y la carpeta de datos.

Para revisar la cuenta de Twilio desde la terminal:

```powershell
cd C:\Users\vicro\OneDrive\Documents\Inode\LlamadasSimultaneas
```

```powershell
node verificar_twilio.js
```

## Voces de ElevenLabs

El selector muestra las voces de la cuenta y, si la API key no puede leerlas, las 17 voces predeterminadas de ElevenLabs para que nunca quede vacío. Además ofrece 15 voces recomendadas de la biblioteca para agregar a la cuenta con un clic. Con un plan gratuito, ElevenLabs no permite usar voces de la biblioteca por API; el panel lo avisa y los contactos de esa voz pasan a las otras voces elegidas.

## Seguridad

- Define `PANEL_USUARIO` y `PANEL_CLAVE`. Sin contraseña, cualquiera que conozca la dirección puede lanzar llamadas con tu saldo.
- Mientras el servidor use `http://`, la contraseña viaja sin cifrar. Lo recomendable es poner un dominio con HTTPS en Nginx y cambiar `PUBLIC_BASE_URL`.
- Los audios y los avisos de Twilio quedan abiertos porque Twilio los consulta sin contraseña.
- Las respuestas llevan cabeceras de seguridad y la interfaz no usa scripts externos.

## Datos que se guardan

- `data/campanas/` con una campaña por archivo.
- `public/audio/generado/` con los audios de ElevenLabs, que se reutilizan cuando el mensaje y la voz se repiten.

Haz respaldo de la carpeta `data` si necesitas conservar el historial.

## Pruebas

```powershell
cd C:\Users\vicro\OneDrive\Documents\Inode\LlamadasSimultaneas
```

```powershell
npm test
```

Las pruebas usan simuladores de Twilio y ElevenLabs: no hacen llamadas ni gastan créditos.

## Estructura

- `server.js` arranca la aplicación.
- `elevenlabs.js` habla con ElevenLabs y traduce sus errores.
- `lib/` contiene la lógica: campañas, marcado, estados, resumen, descargas, Excel y ZIP sin dependencias, datos de Twilio y diagnóstico.
- `public/` contiene la interfaz (módulos ES, sin compilación).
- `tests/` contiene las pruebas.
- `verificar_twilio.js` y `generar_audio.js` son utilidades de terminal.

Las licencias de las piezas de terceros están en `LICENCIAS.md`.
