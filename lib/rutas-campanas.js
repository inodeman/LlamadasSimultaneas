"use strict";
const express = require("express");
const twilio = require("twilio");
const motor = require("./motor");
const exportar = require("./exportar");
const validar = require("./validar");
const { FILTROS, construirTabla } = require("./tablas");
const { filaPublica } = require("./gestor");
const { prepararEntradas, medir, transmitir } = require("./zip");
const { construirCsv } = require("./util");
const { asincrono, enviarJson, limitador, cabecerasDescarga } = require("./http");

function registrar(router, { g, config, eventos }) {
  const noEncontrada = () => g.errorHttp(404, "No encontré esa campaña. Puede que ya se haya borrado.");
  const buscar = (id) => {
    const c = g.obtener(String(id || ""));
    if (!c) throw noEncontrada();
    return c;
  };
  const resumenDe = (c) => {
    if (!c.res || g.estaActiva(c)) c.res = g.resumenDe(c);
    return c.res;
  };
  const itemLista = (c) => {
    const r = resumenDe(c);
    return {
      id: c.id, tipo: c.tipo, nombre: c.nombre || "", estado: c.estado, creada: c.creada, inicio: c.inicio, fin: c.fin,
      total: r.total, progreso: r.progreso, contestaron: r.cuenta.contesto,
      noContestaron: r.cuenta.no_contesto + r.cuenta.ocupado + r.cuenta.buzon, fallaron: r.cuenta.fallida + r.cuenta.error,
      sinMarcar: r.cuenta.pendiente + r.cuenta.omitido, mensaje: String((c.config && c.config.mensaje) || "").slice(0, 90),
      reanudable: Boolean(c.reanudable), activa: g.estaActiva(c), costo: r.costo, aviso: c.aviso ? c.aviso.nivel : null,
    };
  };

  router.get("/campanas", (req, res) => {
    const lista = [...g.campanas.values()].sort((a, b) => String(b.creada).localeCompare(String(a.creada))).map(itemLista);
    const activa = (tipo) => { const c = g.campanaActiva(tipo); return c ? c.id : null; };
    enviarJson(req, res, { campanas: lista, activas: { llamadas: activa("llamadas"), whatsapp: activa("whatsapp") } });
  });

  router.get("/eventos", (req, res) => {
    const cliente = eventos.agregar(req, res, null);
    const lista = [...g.campanas.values()].map(itemLista);
    eventos.enviar(cliente, "lista-completa", { campanas: lista });
  });

  router.get("/campanas/:id/eventos", (req, res) => {
    const c = buscar(req.params.id);
    const cliente = eventos.agregar(req, res, c.id);
    eventos.enviar(cliente, "instantanea", { id: c.id, total: c.resultados.length });
    eventos.enviar(cliente, "resumen", g.resumenDe(c));
    const filas = c.resultados.map(filaPublica);
    for (let desde = 0; desde < filas.length; desde += 400) {
      eventos.enviar(cliente, "filas", { id: c.id, filas: filas.slice(desde, desde + 400) });
    }
    eventos.enviar(cliente, "listo", { id: c.id });
  });

  router.get("/campanas/:id", (req, res) => {
    const c = buscar(req.params.id);
    const cuerpo = {
      resumen: g.resumenDe(c),
      config: c.config,
      invalidos: (c.invalidos || []).slice(0, 200),
      audios: Object.keys(c.audios || {}).length,
      origen: c.origen || null,
    };
    if (req.query.filas !== "0") cuerpo.filas = c.resultados.map(filaPublica);
    enviarJson(req, res, cuerpo);
  });

  router.get("/campanas/:id/filas/:i", asincrono(async (req, res) => {
    const c = buscar(req.params.id);
    const fila = c.resultados[parseInt(req.params.i, 10)];
    if (!fila) throw g.errorHttp(404, "No encontré ese contacto.");
    const cuerpo = { fila: { ...filaPublica(fila), incidencia: fila.incidencia, intentos: fila.intentos, answeredBy: fila.answeredBy || "", audioClave: fila.audioClave || "", error: fila.error || "" } };
    if (fila.sid && g.client && c.tipo === "llamadas") {
      try {
        cuerpo.twilio = await Promise.race([
          g.datos.detalleLlamada(g, fila.sid),
          new Promise((_, rechazo) => setTimeout(() => rechazo(new Error("Twilio tardó demasiado en responder")), 9000)),
        ]);
      } catch (err) {
        cuerpo.twilioError = err.message;
      }
    }
    res.json(cuerpo);
  }));

  router.post("/contactos/previsualizar", limitador(40, 60000), asincrono(async (req, res) => {
    const cuerpo = req.body || {};
    const prev = validar.previsualizar(cuerpo, g);
    if (cuerpo.modoAudio === "voces" && cuerpo.mensaje && g.voces.disponible() && prev.validos) {
      const lec = validar.leerContactos(cuerpo, g.cfg);
      const voces = validar.resolverVoces(cuerpo, g);
      prev.audios = validar.estimarAudios(lec.contactos, String(cuerpo.mensaje), voces, g.voces);
      prev.audios.voces = voces.length;
      try { prev.suscripcion = await g.voces.suscripcion(); } catch (err) { prev.suscripcionError = err.message; }
    }
    res.json(prev);
  }));

  function crear(tipo, validarFn) {
    return (req, res) => {
      const activa = g.campanaActiva(tipo);
      if (activa) {
        const err = g.errorHttp(409, `Ya hay una campaña de ${tipo === "llamadas" ? "llamadas" : "WhatsApp"} en curso. Espera a que termine o deténla antes de iniciar otra.`);
        err.campanaId = activa.id;
        throw err;
      }
      const datos = validarFn(req.body || {}, g);
      const c = motor.crearCampana(g, tipo, datos);
      motor.iniciarCampana(g, c);
      console.log(`Campaña ${c.id} creada: ${c.resultados.length} contactos (${tipo})`);
      res.status(201).json({ id: c.id, estado: c.estado, total: c.resultados.length, invalidos: c.invalidosTotal });
    };
  }
  router.post("/campanas/llamadas", asincrono(crear("llamadas", validar.validarLlamadas)));
  router.post("/campanas/whatsapp", asincrono(crear("whatsapp", validar.validarWhatsapp)));

  const control = (nombre, fn) => router.post(`/campanas/:id/${nombre}`, asincrono(async (req, res) => {
    buscar(req.params.id);
    const c = await fn(req);
    res.json({ ok: true, estado: c.estado });
  }));
  control("pausar", (req) => g.pausar(req.params.id));
  control("reanudar", (req) => motor.reanudar(g, req.params.id));
  control("detener", (req) => motor.detener(g, req.params.id));
  control("ajustar", async (req) => motor.ajustar(g, req.params.id, { concurrencia: (req.body || {}).concurrencia, cps: (req.body || {}).cps }));

  router.post("/campanas/:id/actualizar-twilio", asincrono(async (req, res) => {
    const c = buscar(req.params.id);
    if (!g.client) throw g.errorHttp(400, "Twilio no está configurado.");
    if (c.tipo !== "llamadas") throw g.errorHttp(400, "Solo las campañas de llamadas tienen datos adicionales en Twilio.");
    g.datos.enriquecer(g, c, true).catch((err) => console.error(`Actualización de datos ${c.id}: ${err.message}`));
    res.status(202).json({ ok: true });
  }));

  router.delete("/campanas/:id", asincrono(async (req, res) => {
    const c = buscar(req.params.id);
    if (g.estaActiva(c)) throw g.errorHttp(409, "No se puede borrar una campaña activa. Deténla primero.");
    g.campanas.delete(c.id);
    g.rt.delete(c.id);
    c.resultados.forEach((r) => { if (r.sid) g.sidIndex.delete(r.sid); });
    await g.almacen.eliminar(c.id);
    eventos.emitir("lista", { id: c.id, eliminada: true }, null);
    res.json({ ok: true });
  }));

  router.get("/campanas/:id/plantilla", (req, res) => {
    const c = buscar(req.params.id);
    const lista = String(req.query.lista || "reintentar");
    if (!FILTROS[lista] || lista === "twilio" || lista === "todo") throw g.errorHttp(400, "Lista no válida.");
    const filas = c.resultados.filter((r) => FILTROS[lista](r, c));
    const csvTexto = construirCsv(["numero", "nombre"], filas.map((r) => [r.numero, r.nombre || ""])).replace(/^﻿/, "");
    res.json({
      cantidad: filas.length, csvTexto, lista,
      config: {
        tipo: c.tipo, modoAudio: c.config.modoAudio, mensaje: c.config.mensaje, audioUrl: c.config.audioUrl, voces: c.config.voces,
        concurrencia: c.config.concurrencia, cps: c.config.cps, timbradoSeg: c.config.timbradoSeg, detectarBuzon: c.config.detectarBuzon, autoPausa: c.config.autoPausa,
        nombre: `${c.nombre || "Campaña"} (reintento)`.slice(0, 80),
      },
    });
  });

  router.get("/campanas/:id/descargas", (req, res) => {
    const c = buscar(req.params.id);
    res.json({ descargas: exportar.catalogo(c, exportar.ctxDe(g, req.query.tz)) });
  });

  router.get("/campanas/:id/descargas/:clave", asincrono(async (req, res) => {
    const c = buscar(req.params.id);
    const d = exportar.descarga(g, c, String(req.params.clave), req.query.tz);
    if (!d) throw g.errorHttp(404, "Esa descarga no existe o no tiene datos en esta campaña.");
    if (d.buffer) {
      cabecerasDescarga(res, d.nombre, d.tipo, d.buffer.length);
      res.end(d.buffer);
      return;
    }
    const entradas = await prepararEntradas(d.defs);
    const tamano = medir(entradas);
    cabecerasDescarga(res, d.nombre, d.tipo, tamano);
    try {
      await transmitir(entradas, res);
      res.end();
    } catch (err) {
      console.warn(`Descarga ${d.nombre} interrumpida: ${err.message}`);
      res.destroy();
    }
  }));

  router.get("/campanas/:id/audios/:clave", (req, res) => {
    const c = buscar(req.params.id);
    const audio = (c.audios || {})[String(req.params.clave)];
    if (!audio) throw g.errorHttp(404, "Ese audio no pertenece a esta campaña.");
    res.download(g.voces.rutaAudio(audio.clave), exportar.nombreAudio(audio).split("/").pop(), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "El archivo de audio ya no está en el servidor." });
    });
  });

  const formulario = express.urlencoded({ extended: false, limit: "100kb" });
  function validarFirma(req, res, next) {
    if (!config.twilio.validarFirma) return next();
    const firma = req.get("X-Twilio-Signature") || "";
    const url = `${config.publicBaseUrl}${req.originalUrl}`;
    if (config.twilio.authToken && twilio.validateRequest(config.twilio.authToken, firma, url, req.body || {})) return next();
    console.warn(`Aviso rechazado por firma inválida: ${req.originalUrl}`);
    res.status(403).end();
    return undefined;
  }
  const aviso = (aplicar) => (req, res) => {
    try {
      aplicar(req.body || {});
    } catch (err) {
      console.error(`Error procesando aviso de Twilio: ${err.stack || err.message}`);
    }
    res.status(204).end();
  };
  router.post("/webhooks/call-status", formulario, validarFirma, aviso((p) => g.aplicarLlamada(p)));
  router.post("/webhooks/message-status", formulario, validarFirma, aviso((p) => g.aplicarMensaje(p)));
  router.post("/webhooks/amd", formulario, validarFirma, aviso((p) => g.aplicarAmd(p)));
}

module.exports = { registrar };
