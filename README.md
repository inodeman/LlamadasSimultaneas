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

## Audio MP3

Coloca los archivos MP3 en `public/audio/` y la URL pública será:
`https://tu-ngrok.ngrok-free.app/audio/mensaje.mp3`
