# Historial de cambios

## 3.0.0

Reescritura completa pensada para producción. El `.env` anterior sigue funcionando: las variables nuevas son opcionales.

### Corregido respecto a la versión anterior

- Las campañas vivían solo en memoria y se perdían al reiniciar el servidor. Ahora cada campaña se guarda en disco; tras un reinicio queda como interrumpida y se puede reanudar.
- La duración de la llamada se leía del campo `Duration` de Twilio, que viene en minutos, como si fueran segundos. Ahora se usa `CallDuration`.

### Novedades

- Seguimiento en tiempo real con transmisión por eventos (con respaldo por consulta periódica): tablero con una lámpara por contacto, marcador, líneas abiertas, últimos eventos, gráficos, tabla filtrable y detalle por contacto con su cronología.
- Respondieron, no respondieron, fallaron, en curso y pendientes, con duración promedio, llamada más larga, porcentaje que escuchó el mensaje completo, resultados por hora y por voz y costo cuando Twilio lo reporta.
- Errores de Twilio y de ElevenLabs con su código de Twilio, su código SIP, la causa en español y la acción recomendada, por contacto y agrupados en un panel que dice cuántos contactos afectó cada problema, cuáles números y qué hacer.
- Pausa automática cuando fallan casi todas las llamadas o Twilio rechaza varias seguidas, para no gastar el saldo de los contactos restantes.
- Descargas: reporte en Excel de 10 hojas, CSV de todos, de quienes respondieron, de quienes no, de fallidas con causa, de sin marcar, lista para reintentar, resumen de datos de Twilio y errores, ZIP con los audios de ElevenLabs y un respaldo completo. Registro de llamadas de la cuenta de Twilio por fechas en Excel, CSV o JSON.
- Reintentar una campaña con quienes no respondieron, quienes fallaron o ambos.
- Voces de ElevenLabs: se conservan las de la cuenta y las predeterminadas, y se suman 15 recomendadas de la biblioteca que se agregan a la cuenta con un clic. Si una voz no se puede usar, sus contactos pasan a las demás voces elegidas.
- Si ElevenLabs reporta pago pendiente, créditos agotados o API key inválida, la campaña se detiene antes de marcar y se puede reanudar al resolverlo.
- Estado del sistema con revisión a fondo de Twilio, ElevenLabs, dirección pública, seguridad, memoria y disco.
- Interfaz nueva con animaciones, tema claro y oscuro, diseño para celular con navegación inferior y respeto a la preferencia de movimiento reducido. Cada resultado se distingue por forma y por color.
- Usuario y contraseña opcionales para el panel, cabeceras de seguridad, límites de peticiones en las rutas de voces, validación opcional de la firma de Twilio, cierre ordenado del servidor y limpieza automática de campañas y audios viejos.
- 14 pruebas automáticas con simuladores de Twilio y ElevenLabs.

### Cambios que conviene saber

- Los datos se guardan en `data/` (configurable con `DATA_DIR`). Respalda esa carpeta si quieres conservar el historial.
- Se requiere Node 18 o superior.
- El CSV se lee en el navegador y se envía como texto, así que ya no se necesita `multer`. Se retiró la carpeta `src/`, que no se usaba.
- Las rutas de la API de campañas cambiaron (ahora empiezan con `/api/campanas`). Los avisos de Twilio siguen llegando a `/api/webhooks/call-status` y `/api/webhooks/message-status`, y se suma `/api/webhooks/amd` para la detección de contestadora. La aplicación los configura sola en cada llamada.
