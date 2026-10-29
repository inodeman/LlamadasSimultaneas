"use strict";
const fs = require("fs");
const path = require("path");
const exportar = require("./exportar");
const { diagnosticar } = require("./diagnostico");
const { VOCES_ESTANDAR } = require("./voces-estandar");
const { ErrorElevenLabs } = require("../elevenlabs");
const { formatoFecha, zonaValida } = require("./util");
const { asincrono, enviarJson, limitador, cabecerasDescarga } = require("./http");

const TEXTO_MUESTRA = "Hola, le saludamos para compartirle un mensaje importante. Gracias por su atención.";

function listarAudiosLocales(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.(mp3|wav)$/i.test(f))
      .map((f) => ({ archivo: f, bytes: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => a.archivo.localeCompare(b.archivo));
  } catch (err) {
    return [];
  }
}

function avisoEleven(err) {
  return { titulo: err.titulo || "Error de ElevenLabs", detalle: err.message, accion: err.accion || "", codigo: err.codigo || "" };
}

function registrar(router, { g, config, inicio }) {
  let cacheDiagnostico = null;

  router.get("/salud", (req, res) => {
    res.json({
      ok: true, version: config.version, activoDesde: new Date(inicio).toISOString(), segundosActivo: Math.round(process.uptime()),
      campanasActivas: [...g.campanas.values()].filter((c) => g.estaActiva(c)).length,
      twilio: Boolean(g.client), elevenlabs: g.voces.disponible(),
    });
  });

  router.get("/config", (req, res) => {
    res.json({
      version: config.version,
      twilioConfigurado: Boolean(g.client),
      numeroOrigen: config.twilio.fromNumber || "",
      whatsappDesde: config.twilio.whatsappFrom || "",
      elevenlabs: g.voces.disponible(),
      vozPredeterminada: config.elevenlabs.vozPredeterminada,
      modeloVoz: g.voces.modelId,
      publicBaseUrl: config.publicBaseUrl,
      usaLocalhost: config.usaLocalhost,
      zonaHoraria: config.zonaHoraria,
      panelProtegido: config.seguridad.activa,
      codigoPais: config.defaultCountryCode,
      limites: { contactos: config.limites.maxContactos, concurrencia: config.limites.maxConcurrencia, voces: config.limites.maxVoces, textoVoz: config.limites.maxTextoVoz },
      valores: {
        concurrencia: 5, cps: config.llamadas.porSegundo, timbradoSeg: config.llamadas.timbradoSegundos, detectarBuzon: config.llamadas.detectarBuzon,
        autoPausa: config.autoPausa.activa, umbralAutoPausa: config.autoPausa.umbralPct, liberarSinContestarSeg: Math.round(config.llamadas.liberarSinContestarMs / 1000),
      },
      audiosLocales: listarAudiosLocales(config.dirAudio),
    });
  });

  router.get("/diagnostico", asincrono(async (req, res) => {
    const profundo = req.query.profundo === "1";
    if (!profundo && cacheDiagnostico && Date.now() - cacheDiagnostico.ts < 45000) {
      res.json(cacheDiagnostico);
      return;
    }
    const resultado = await diagnosticar(g, profundo);
    if (!profundo) cacheDiagnostico = resultado;
    res.json(resultado);
  }));

  router.get("/voces", asincrono(async (req, res) => {
    const predeterminada = config.elevenlabs.vozPredeterminada;
    if (!g.voces.disponible()) {
      res.json({
        disponible: false, predeterminada, voces: [],
        aviso: { titulo: "Falta la API key de ElevenLabs", detalle: "No hay ELEVENLABS_API_KEY en el archivo .env.", accion: "Agrégala y reinicia el servidor para usar voces de ElevenLabs.", codigo: "sin_clave" },
      });
      return;
    }
    let voces = [];
    let aviso = null;
    try {
      voces = await g.voces.listarVoces(req.query.forzar === "1");
    } catch (err) {
      if (!(err instanceof ErrorElevenLabs)) throw err;
      aviso = avisoEleven(err);
    }
    if (!voces.length) {
      voces = VOCES_ESTANDAR.slice();
      if (!aviso) aviso = { titulo: "La cuenta no devolvió voces", detalle: "Se muestran las voces predeterminadas de ElevenLabs.", accion: "", codigo: "sin_voces" };
      else aviso.detalle += " Mientras tanto se muestran las voces predeterminadas de ElevenLabs.";
    }
    if (!voces.some((v) => v.id === predeterminada)) {
      voces = [{ id: predeterminada, nombre: "Voz predeterminada del servidor", categoria: "", genero: "", acento: "", edad: "", estilo: "configurada en .env", descripcion: "", idiomas: [], previewUrl: "", origen: "predeterminada" }, ...voces];
    }
    res.json({ disponible: true, predeterminada, voces, aviso });
  }));

  router.get("/voces/recomendadas", asincrono(async (req, res) => {
    if (!g.voces.disponible()) {
      res.json({ voces: [], aviso: { titulo: "Falta la API key de ElevenLabs", detalle: "No hay ELEVENLABS_API_KEY en el archivo .env.", accion: "", codigo: "sin_clave" } });
      return;
    }
    const cantidad = Math.min(30, Math.max(1, parseInt(req.query.n, 10) || 15));
    try {
      const voces = await g.voces.recomendadas(cantidad, req.query.forzar === "1");
      res.json({ voces, aviso: voces.length < cantidad ? { titulo: "Pocas voces en la biblioteca", detalle: `ElevenLabs devolvió ${voces.length} voces recomendadas.`, accion: "", codigo: "pocas" } : null });
    } catch (err) {
      if (!(err instanceof ErrorElevenLabs)) throw err;
      res.json({ voces: [], aviso: avisoEleven(err) });
    }
  }));

  router.post("/voces/agregar", limitador(20, 60000), asincrono(async (req, res) => {
    const { publicOwnerId, vozId, nombre } = req.body || {};
    const id = await g.voces.agregarVozCompartida(publicOwnerId, vozId, nombre);
    res.json({ ok: true, vozId: id });
  }));

  router.post("/voces/muestra", limitador(15, 60000), asincrono(async (req, res) => {
    const { vozId } = req.body || {};
    let texto = String((req.body || {}).texto || TEXTO_MUESTRA).trim().slice(0, 300);
    if (!texto) texto = TEXTO_MUESTRA;
    if (!/^[A-Za-z0-9]{10,40}$/.test(String(vozId || ""))) throw g.errorHttp(400, "Elige una voz válida.");
    const audio = await g.voces.generarAudio(vozId, texto);
    res.json({ ok: true, url: `/audio/generado/${audio.clave}.mp3`, segundos: audio.segundos, caracteres: audio.caracteres, nuevo: audio.nuevo });
  }));

  router.get("/elevenlabs/estado", asincrono(async (req, res) => {
    if (!g.voces.disponible()) {
      res.json({ disponible: false });
      return;
    }
    let suscripcion = null;
    let aviso = null;
    try { suscripcion = await g.voces.suscripcion(); } catch (err) { if (err instanceof ErrorElevenLabs) aviso = avisoEleven(err); else throw err; }
    res.json({ disponible: true, suscripcion, aviso, cola: g.voces.estado() });
  }));

  router.get("/twilio/registro", asincrono(async (req, res) => {
    if (!g.client) throw g.errorHttp(400, "Twilio no está configurado.");
    const zona = zonaValida(req.query.tz, config.zonaHoraria);
    const hoy = formatoFecha(Date.now(), zona).slice(0, 10);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || "")) ? req.query.desde : hoy;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hasta || "")) ? req.query.hasta : hoy;
    if (desde > hasta) throw g.errorHttp(400, "La fecha inicial no puede ser posterior a la final.");
    const dias = (new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000;
    if (dias > 31) throw g.errorHttp(400, "Elige un rango de máximo 31 días.");
    const inicioConsulta = new Date(new Date(`${desde}T00:00:00Z`).getTime() - 86400000);
    const finConsulta = new Date(new Date(`${hasta}T00:00:00Z`).getTime() + 2 * 86400000);
    const todos = await g.datos.registroLlamadas(g, { desde: inicioConsulta, hasta: finConsulta, limite: 20000 });
    const registros = todos.filter((x) => {
      const dia = formatoFecha(x.inicio || x.creada, zona).slice(0, 10);
      return dia >= desde && dia <= hasta;
    });
    const formato = ["csv", "xlsx", "json"].includes(req.query.formato) ? req.query.formato : "json";
    if (formato === "json") {
      const contados = {};
      registros.forEach((x) => { contados[x.estado] = (contados[x.estado] || 0) + 1; });
      const costo = registros.reduce((s, x) => s + (x.precio || 0), 0);
      enviarJson(req, res, { desde, hasta, total: registros.length, porEstado: contados, costo: Math.round(costo * 10000) / 10000 });
      return;
    }
    const archivo = exportar.registroTwilio(registros, { desde: new Date(`${desde}T12:00:00Z`), hasta: new Date(`${hasta}T12:00:00Z`), zona, formato });
    cabecerasDescarga(res, archivo.nombre, archivo.tipo, archivo.buffer.length);
    res.end(archivo.buffer);
  }));
}

module.exports = { registrar };
