"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const twilio = require("twilio");

const configBase = require("./lib/config");
const { crearServicioVoces } = require("./elevenlabs");
const { Almacen } = require("./lib/almacen");
const { Eventos } = require("./lib/eventos");
const { Gestor } = require("./lib/gestor");
const { Datos } = require("./lib/twilio-datos");
const motor = require("./lib/motor");
const { manejarError } = require("./lib/http");
const rutasCampanas = require("./lib/rutas-campanas");
const rutasSistema = require("./lib/rutas-sistema");

function crearClienteTwilio(tw) {
  if (!/^AC[0-9A-Za-z]{30,40}$/.test(String(tw.accountSid || "")) || !tw.authToken) return null;
  try {
    return twilio(tw.accountSid, tw.authToken, { timeout: 20000 });
  } catch (err) {
    console.error(`No se pudo crear el cliente de Twilio: ${err.message}`);
    return null;
  }
}

function cabecerasSeguridad(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  });
  next();
}

function crearAutenticacion(cfg) {
  if (!cfg.seguridad.activa) return (req, res, next) => next();
  const esperado = Buffer.from(`${cfg.seguridad.usuario}:${cfg.seguridad.clave}`);
  const intentos = new Map();
  return (req, res, next) => {
    const ruta = req.path;
    if (ruta === "/api/salud" || ruta.startsWith("/api/webhooks/") || ruta.startsWith("/audio/")) return next();
    const ip = req.ip || "";
    const registro = intentos.get(ip);
    if (registro && registro.cuenta >= 10 && Date.now() - registro.ultimo < 5 * 60 * 1000) {
      res.status(429).send("Demasiados intentos. Espera unos minutos.");
      return undefined;
    }
    const encabezado = req.headers.authorization || "";
    const m = /^Basic (.+)$/i.exec(encabezado);
    if (m) {
      const dado = Buffer.from(m[1], "base64");
      if (dado.length === esperado.length && crypto.timingSafeEqual(dado, esperado)) {
        intentos.delete(ip);
        return next();
      }
      intentos.set(ip, { cuenta: (registro ? registro.cuenta : 0) + 1, ultimo: Date.now() });
    }
    res.set("WWW-Authenticate", 'Basic realm="Llamadas Simultaneas", charset="UTF-8"').status(401).send("Acceso restringido");
    return undefined;
  };
}

function limpiar(g, cfg) {
  try {
    const inactivas = [...g.campanas.values()].filter((c) => !g.estaActiva(c)).sort((a, b) => String(a.creada).localeCompare(String(b.creada)));
    const exceso = g.campanas.size - cfg.limites.maxCampanasGuardadas;
    if (exceso > 0) {
      inactivas.slice(0, exceso).forEach((c) => {
        g.campanas.delete(c.id);
        g.rt.delete(c.id);
        c.resultados.forEach((r) => { if (r.sid) g.sidIndex.delete(r.sid); });
        g.almacen.eliminar(c.id);
        console.log(`Campaña antigua eliminada: ${c.id}`);
      });
    }
    const protegidos = new Set();
    for (const c of g.campanas.values()) {
      Object.keys(c.audios || {}).forEach((clave) => protegidos.add(`${clave}.mp3`));
      c.resultados.forEach((r) => { if (r.audioClave) protegidos.add(`${r.audioClave}.mp3`); });
    }
    const limite = Date.now() - cfg.limites.retencionAudiosDias * 86400000;
    let borrados = 0;
    fs.readdirSync(cfg.dirAudioGenerado).forEach((archivo) => {
      if (!archivo.endsWith(".mp3") || protegidos.has(archivo)) return;
      const ruta = path.join(cfg.dirAudioGenerado, archivo);
      try {
        if (fs.statSync(ruta).mtimeMs < limite) { fs.unlinkSync(ruta); borrados += 1; }
      } catch (err) { }
    });
    if (borrados) console.log(`Audios antiguos eliminados: ${borrados}`);
  } catch (err) {
    console.error(`Limpieza periódica: ${err.message}`);
  }
}

function crearApp({ g, cfg, eventos, inicio }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cabecerasSeguridad);

  app.use("/audio", express.static(cfg.dirAudio, {
    index: false,
    setHeaders(res, ruta) {
      const generado = ruta.includes(`${path.sep}generado${path.sep}`);
      res.set("Cache-Control", generado ? "public, max-age=31536000, immutable" : "public, max-age=3600");
      res.set("Access-Control-Allow-Origin", "*");
    },
  }));

  app.use(crearAutenticacion(cfg));
  app.use(express.json({ limit: cfg.limites.maxBytesJson }));

  const router = express.Router();
  rutasCampanas.registrar(router, { g, config: cfg, eventos });
  rutasSistema.registrar(router, { g, config: cfg, inicio });
  app.use("/api", router);
  app.use("/api", (req, res) => res.status(404).json({ error: `La ruta ${req.method} ${req.originalUrl} no existe.` }));

  app.use(express.static(cfg.dirPublic, {
    index: "index.html",
    setHeaders(res) { res.set("Cache-Control", "no-cache"); },
  }));
  app.use(manejarError);
  return app;
}

function iniciar(opciones = {}) {
  const inicio = Date.now();
  const cfg = opciones.config || configBase;
  fs.mkdirSync(cfg.dirAudioGenerado, { recursive: true });

  const almacen = new Almacen(cfg.dirDatos, opciones.almacen || {});
  almacen.iniciar();
  const eventos = new Eventos();
  const client = opciones.client !== undefined ? opciones.client : crearClienteTwilio(cfg.twilio);
  const voces = opciones.voces || crearServicioVoces({
    apiKey: cfg.elevenlabs.apiKey, baseUrl: cfg.elevenlabs.baseUrl, modelId: cfg.elevenlabs.modelId, formato: cfg.elevenlabs.formato,
    ajustesVoz: cfg.elevenlabs.ajustesVoz, directorio: cfg.dirAudioGenerado, publicBaseUrl: cfg.publicBaseUrl, concurrencia: cfg.elevenlabs.concurrencia,
  });

  const g = new Gestor({ config: cfg, client, voces, almacen, eventos });
  g.motor = motor;
  g.datos = new Datos();
  const guardadas = almacen.cargarTodas();
  guardadas.forEach((c) => g.registrar(c));

  const app = crearApp({ g, cfg, eventos, inicio });
  const servidor = app.listen(cfg.PORT, opciones.host || "0.0.0.0", () => {
    const puerto = servidor.address().port;
    console.log(`Llamadas Simultáneas v${cfg.version} escuchando en el puerto ${puerto}`);
    console.log(`  Twilio: ${client ? "configurado" : "SIN CREDENCIALES VÁLIDAS"} · número: ${cfg.twilio.fromNumber || "(falta TWILIO_PHONE_NUMBER)"}`);
    console.log(`  ElevenLabs: ${voces.disponible() ? "configurado" : "sin API key"} · dirección pública: ${cfg.publicBaseUrl}`);
    console.log(`  Panel ${cfg.seguridad.activa ? "protegido con usuario y contraseña" : "SIN contraseña (define PANEL_USUARIO y PANEL_CLAVE)"} · ${guardadas.length} campañas guardadas`);
    if (cfg.usaLocalhost) console.warn("  AVISO: PUBLIC_BASE_URL apunta a localhost; Twilio no podrá descargar audios ni enviar avisos.");
  });
  servidor.keepAliveTimeout = 65000;
  servidor.headersTimeout = 66000;

  g.iniciarTareas();
  const tareas = [];
  const cada = (ms, fn) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); tareas.push(t); };
  cada(60 * 60 * 1000, () => limpiar(g, cfg));
  const arranque = setTimeout(() => limpiar(g, cfg), 30000);
  if (arranque.unref) arranque.unref();
  motor.recuperar(g).catch((err) => console.error(`Recuperación tras reinicio: ${err.stack || err.message}`));

  let cerrando = false;
  function cerrar(codigoSalida) {
    if (cerrando) return Promise.resolve();
    cerrando = true;
    tareas.forEach((t) => clearInterval(t));
    clearTimeout(arranque);
    g.datos.cancelarTemporizadores();
    g.apagar();
    eventos.cerrarTodos();
    return new Promise((resolver) => {
      const salir = () => { resolver(); if (codigoSalida !== undefined) process.exit(codigoSalida); };
      servidor.close(salir);
      if (servidor.closeAllConnections) servidor.closeAllConnections();
      const t = setTimeout(salir, 3000);
      if (t.unref) t.unref();
    });
  }
  return { app, servidor, g, eventos, cerrar };
}

if (require.main === module) {
  const sistema = iniciar();
  ["SIGTERM", "SIGINT"].forEach((senal) => process.on(senal, () => {
    console.log(`${senal} recibido: guardando campañas y cerrando...`);
    sistema.cerrar(0);
  }));
  process.on("uncaughtException", (err) => {
    console.error(`Error no controlado: ${err.stack || err}`);
    try { sistema.g.almacen.vaciarSync(); } catch (e) { }
  });
  process.on("unhandledRejection", (motivo) => {
    console.error(`Promesa rechazada sin manejar: ${motivo && motivo.stack ? motivo.stack : motivo}`);
  });
}

module.exports = { iniciar, crearApp, crearClienteTwilio, limpiar };
