# Despliegue de la v3.0.0 en el servidor

Esta guía actualiza el droplet de DigitalOcean (carpeta `/home/broadcast/llamadas-simultaneas`, administrada con PM2) sin tocar el `.env`, los datos ni los audios ya generados. Todo se ejecuta como root en la consola web del droplet. Cada bloque va por separado.

Antes de empezar, ten cerca el ZIP `LlamadasSimultaneas_v3.0.0.zip`.

## 1. Subir el ZIP al servidor

Desde tu computadora, en PowerShell (pide la contraseña o usa tu llave SSH):

```powershell
cd C:\Users\vicro\Downloads
```

```powershell
scp .\LlamadasSimultaneas_v3.0.0.zip root@147.182.177.22:/root/
```

Si prefieres pasar por GitHub, copia el contenido del ZIP a tu carpeta local del repositorio, súbelo con `git push` y clona en el servidor con un token nuevo de solo lectura. No pegues tokens en chats ni en correos.

## 2. Revisar la versión de Node

```bash
cd /root
```

```bash
node -v
```

Debe mostrar v18 o más. Si muestra una versión menor, actualiza Node antes de continuar:

```bash
cd /root
```

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
```

```bash
apt-get install -y nodejs
```

```bash
cd /root
```

```bash
npm install -g pm2 && pm2 update
```

## 3. Respaldo de la versión actual

```bash
cd /root
```

```bash
tar czf /root/respaldo_llamadas_$(date +%Y%m%d_%H%M).tgz -C /home/broadcast llamadas-simultaneas && ls -lh /root/respaldo_llamadas_*.tgz
```

## 4. Descomprimir el ZIP

```bash
cd /root
```

```bash
command -v unzip >/dev/null || apt-get install -y unzip
```

```bash
rm -rf /root/actualizacion_v3 && mkdir -p /root/actualizacion_v3 && unzip -q /root/LlamadasSimultaneas_v3.0.0.zip -d /root/actualizacion_v3 && ls /root/actualizacion_v3/LlamadasSimultaneas
```

## 5. Copiar los archivos nuevos

Se conservan `.env`, `data`, `node_modules` y toda la carpeta `public/audio`. Los archivos de la versión anterior que ya no existen (como `src/`) se eliminan.

```bash
cd /root
```

```bash
command -v rsync >/dev/null || apt-get install -y rsync
```

```bash
rsync -a --delete --exclude='.env' --exclude='.git/' --exclude='data/' --exclude='node_modules/' --exclude='public/audio/' /root/actualizacion_v3/LlamadasSimultaneas/ /home/broadcast/llamadas-simultaneas/
```

## 6. Instalar dependencias

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
npm install --omit=dev
```

## 7. Proteger el panel con usuario y contraseña

Sin esto, cualquiera que conozca la dirección del servidor puede lanzar llamadas con tu saldo. Este bloque agrega usuario y una contraseña aleatoria al `.env` solo si todavía no existen, y la muestra una vez para que la guardes.

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
grep -q '^PANEL_CLAVE=.' .env || { CLAVE=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20); printf '\nPANEL_USUARIO=inode\nPANEL_CLAVE=%s\n' "$CLAVE" >> .env; echo "Usuario: inode   Contraseña: $CLAVE"; }
```

Comprueba que la dirección pública siga bien (no muestra contraseñas):

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
grep -E '^(PUBLIC_BASE_URL|TWILIO_PHONE_NUMBER|PORT)=' .env
```

## 8. Validar y reiniciar

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
node --check server.js && echo "Sintaxis correcta"
```

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
pm2 restart all && pm2 save
```

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
pm2 logs llamadas-simultaneas --lines 15 --nostream
```

Debe aparecer `Llamadas Simultáneas v3.0.0 escuchando en el puerto 3000`, Twilio y ElevenLabs como configurados y el panel protegido.

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
curl -s http://127.0.0.1:3000/api/salud
```

Debe responder `"ok":true` y `"version":"3.0.0"`.

## 9. Comprobar en el navegador

1. Abre `http://147.182.177.22` e ingresa con el usuario y la contraseña del paso 7.
2. Pulsa la luz de estado de la barra superior y después Revisar a fondo. Todo debe salir en verde, salvo avisos esperados como la conexión sin HTTPS.
3. Si Twilio marca el permiso para llamar a México como no habilitado, actívalo en la consola de Twilio (Voice, Geo permissions): sin él las llamadas fallan.
4. Haz una campaña de prueba con 2 o 3 números propios antes de lanzar la real.

## Reversa

Si algo sale mal, vuelve a la versión anterior con el último respaldo:

```bash
cd /root
```

```bash
pm2 stop all
```

```bash
cd /home/broadcast
```

```bash
mv llamadas-simultaneas llamadas-simultaneas_v3_descartada
```

```bash
tar xzf "$(ls -1t /root/respaldo_llamadas_*.tgz | head -1)" -C /home/broadcast
```

```bash
cd /home/broadcast/llamadas-simultaneas
```

```bash
pm2 restart all && pm2 logs llamadas-simultaneas --lines 8 --nostream
```

Las campañas guardadas por la v3 quedan en `/home/broadcast/llamadas-simultaneas_v3_descartada/data` por si quieres recuperarlas.

## Notas

- Si las pantallas dejan de actualizarse después de un minuto, revisa que Nginx no tenga un `proxy_read_timeout` muy corto en el bloque del sitio. La aplicación envía un latido cada 15 segundos y pide a Nginx no retener la transmisión.
- Con un dominio y HTTPS, cambia `PUBLIC_BASE_URL` a la dirección con `https://` y reinicia. Después puedes activar `VALIDAR_FIRMA_TWILIO=true`.
- Para limpiar lo temporal después de comprobar que todo funciona: `rm -rf /root/actualizacion_v3 /root/LlamadasSimultaneas_v3.0.0.zip`.
