# BroadcastDemo v2

Demo de campañas masivas de llamadas y WhatsApp con Twilio.

## Instalación

```powershell
cd C:\Users\vicro\OneDrive\Documents\INODE\BroadcastDemo
```

```powershell
npm install
```

## Configuración

1. Renombra `.env.example` a `.env`
2. Llena las credenciales de Twilio:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxx...
TWILIO_AUTH_TOKEN=xxxxxxxx...
TWILIO_PHONE_NUMBER=+526567380528
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
PUBLIC_BASE_URL=https://tu-ngrok.ngrok-free.app
PORT=3000
```

## Uso

```powershell
cd C:\Users\vicro\OneDrive\Documents\INODE\BroadcastDemo
```

```powershell
npm run dev
```

Abrir: http://localhost:3000

## CSV de contactos

| numero     | nombre        |
|------------|---------------|
| 6141234567 | Juan Pérez    |
| 6149876543 | María López   |

- La columna `nombre` es opcional.
- Sin código de país: se agrega +52 automáticamente.
- Usa `{nombre}` en el mensaje para personalizar por contacto.

## Verificar la cuenta de Twilio

Con el `.env` configurado, desde la carpeta del proyecto:

```powershell
node verificar_twilio.js
```

Revisa el formato de las variables, el estado y el saldo de la cuenta, que el número emisor pertenezca a la cuenta y los permisos de llamadas a México.

Para probar una llamada real a un número propio:

```powershell
node verificar_twilio.js --llamar +52XXXXXXXXXX
```

La aplicación también consulta el estado de la cuenta al iniciar y muestra un aviso rojo en pantalla si Twilio la rechaza. El estado se puede consultar en `/api/twilio/status`.

Si Twilio rechaza la autenticación durante una campaña, la campaña se detiene en el primer lote y muestra el motivo en pantalla.

## Voces de ElevenLabs

En la campaña de llamadas, el tipo de audio "Voces de ElevenLabs (una o varias)" permite elegir las voces de la cuenta de ElevenLabs.

Variables del `.env` (en DigitalOcean App Platform van en Settings > Environment Variables):

```
ELEVENLABS_API_KEY=xxxxxxxx...
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_CONCURRENCY=3
```

- `ELEVENLABS_API_KEY` es obligatoria. `ELEVENLABS_MODEL_ID` y `ELEVENLABS_CONCURRENCY` son opcionales.
- `PUBLIC_BASE_URL` debe ser la URL pública del servidor, porque Twilio descarga los audios desde ahí.
- La lista de voces se carga desde la cuenta de ElevenLabs. El botón Escuchar genera una muestra con el mensaje escrito.
- Con una sola voz marcada, todas las llamadas usan esa voz. Con varias, se alternan entre los contactos en orden.
- Se genera un audio por cada mensaje distinto y por cada voz. Sin `{nombre}` en el mensaje, es un solo audio por voz. Con `{nombre}`, uno por cada nombre distinto, y cada audio consume créditos.
- Los audios generados se guardan en `public/audio/generado/` y se reutilizan si el mensaje y la voz se repiten.
- Si ElevenLabs rechaza la API key o la cuenta no tiene créditos, la campaña se detiene antes de hacer llamadas y muestra el motivo.

## Audio MP3

Coloca los archivos MP3 en `public/audio/` y la URL pública será:
`https://tu-ngrok.ngrok-free.app/audio/mensaje.mp3`
