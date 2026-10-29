"use strict";
const { horaLocal } = require("./util");

const BUCKET_MS = 10000;
const BUCKETS = 30;

function nuevoGrupo() {
  return { marcadas: 0, contestaron: 0, duracion: 0, completos: 0 };
}

function porcentaje(parte, total) {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

function calcularResumen(c, opciones = {}) {
  const ahora = opciones.ahora || Date.now();
  const zona = opciones.zona || "America/Mexico_City";
  const filas = c.resultados || [];
  const esLlamada = c.tipo !== "whatsapp";

  const cuenta = {
    pendiente: 0, omitido: 0, en_curso: 0, contesto: 0, buzon: 0,
    no_contesto: 0, ocupado: 0, fallida: 0, cancelada: 0, error: 0,
  };
  const estadosTwilio = {};
  const fallos = new Map();
  const voces = new Map();
  const horas = new Map();
  const sparkline = new Array(BUCKETS).fill(0);
  let enCola = 0;
  let timbrando = 0;
  let enLlamada = 0;
  let marcadas = 0;
  let duracionTotal = 0;
  let duracionMax = 0;
  let completos = 0;
  let conAudioConocido = 0;
  let costo = 0;
  let conPrecio = 0;
  let terminalesUltimos2min = 0;
  let primeraMarca = 0;
  let ultimaMarca = 0;

  const sumarFallo = (r) => {
    const inc = r.incidencia || null;
    const clave = inc ? `${inc.fuente}:${inc.codigo}` : (r.sip ? `sip:${r.sip}` : "twilio:sin-dato");
    const registro = fallos.get(clave) || {
      clave, codigo: inc ? inc.codigo : (r.sip ? `sip-${r.sip}` : "sin-dato"),
      titulo: inc ? inc.titulo : (r.sip ? `Código SIP ${r.sip}` : "Sin detalle de Twilio todavía"),
      detalle: inc ? inc.detalle : "", accion: inc ? inc.accion : "", fuente: inc ? inc.fuente : "twilio", cantidad: 0,
    };
    registro.cantidad += 1;
    fallos.set(clave, registro);
  };

  for (let k = 0; k < filas.length; k += 1) {
    const r = filas[k];
    const cat = r.cat || "pendiente";
    cuenta[cat] = (cuenta[cat] || 0) + 1;
    if (!r.sid) {
      if (cat === "error") sumarFallo(r);
      continue;
    }
    marcadas += 1;
    if (r.tCrea) {
      if (!primeraMarca || r.tCrea < primeraMarca) primeraMarca = r.tCrea;
      if (r.tCrea > ultimaMarca) ultimaMarca = r.tCrea;
    }
    const estadoTw = r.estadoLlamada || "queued";
    estadosTwilio[estadoTw] = (estadosTwilio[estadoTw] || 0) + 1;

    if (cat === "en_curso") {
      const rango = r.rangoLlamada || 1;
      if (rango >= 3) enLlamada += 1;
      else if (rango === 2) timbrando += 1;
      else enCola += 1;
      continue;
    }

    if (r.precio) { costo += Math.abs(r.precio); conPrecio += 1; }
    if (r.tFin) {
      if (ahora - r.tFin <= 120000) terminalesUltimos2min += 1;
      const antiguedad = Math.floor((ahora - r.tFin) / BUCKET_MS);
      if (antiguedad >= 0 && antiguedad < BUCKETS) sparkline[BUCKETS - 1 - antiguedad] += 1;
    }

    const nombreVoz = r.voz || "";
    const grupo = voces.get(nombreVoz) || nuevoGrupo();
    grupo.marcadas += 1;
    voces.set(nombreVoz, grupo);

    const hora = horaLocal(r.tCrea, zona);
    if (hora !== null) {
      const g = horas.get(hora) || nuevoGrupo();
      g.marcadas += 1;
      if (cat === "contesto") g.contestaron += 1;
      horas.set(hora, g);
    }

    if (cat === "contesto") {
      grupo.contestaron += 1;
      grupo.duracion += r.duracion || 0;
      duracionTotal += r.duracion || 0;
      if ((r.duracion || 0) > duracionMax) duracionMax = r.duracion || 0;
      if (r.audioSeg) {
        conAudioConocido += 1;
        if ((r.duracion || 0) >= r.audioSeg * 0.9) { completos += 1; grupo.completos += 1; }
      }
    } else if (cat === "fallida" || cat === "error") {
      sumarFallo(r);
    }
  }

  const terminadas = cuenta.contesto + cuenta.buzon + cuenta.no_contesto + cuenta.ocupado + cuenta.fallida + cuenta.cancelada;
  const procesadas = terminadas + cuenta.error;
  const total = filas.length;
  const contactables = cuenta.contesto + cuenta.buzon + cuenta.no_contesto + cuenta.ocupado;
  const porDespachar = cuenta.pendiente;
  const ritmoPorMin = Math.round((terminalesUltimos2min / 2) * 10) / 10;
  const activa = c.estado === "en_curso" || c.estado === "generando_audios" || c.estado === "preparando";
  let etaSeg = null;
  if (activa && ritmoPorMin > 0 && (porDespachar + cuenta.en_curso) > 0) {
    etaSeg = Math.min(7 * 86400, Math.round(((porDespachar + cuenta.en_curso) / ritmoPorMin) * 60));
  }

  const resumen = {
    id: c.id,
    tipo: c.tipo,
    estado: c.estado,
    nombre: c.nombre || "",
    total,
    marcadas,
    procesadas,
    terminadas,
    progreso: total ? Math.min(100, Math.round((procesadas / total) * 100)) : 0,
    cuenta,
    estadosTwilio,
    enCola, timbrando, enLlamada,
    pendientes: porDespachar,
    omitidos: cuenta.omitido,
    invalidos: (c.invalidos || []).length,
    duplicados: c.duplicados || 0,
    tasaRespuesta: porcentaje(cuenta.contesto, terminadas - cuenta.cancelada),
    tasaContactables: porcentaje(cuenta.contesto, contactables),
    tasaFallos: porcentaje(cuenta.fallida, terminadas - cuenta.cancelada),
    duracionTotal,
    duracionPromedio: cuenta.contesto ? Math.round((duracionTotal / cuenta.contesto) * 10) / 10 : 0,
    duracionMax,
    escucharonCompleto: completos,
    escucharonMedibles: conAudioConocido,
    costo: Math.round(costo * 10000) / 10000,
    costoConDatos: conPrecio,
    ritmoPorMin,
    etaSeg,
    sparkline: activa ? sparkline : [],
    inicio: c.inicio || null,
    fin: c.fin || null,
    creada: c.creada || null,
    primeraMarca, ultimaMarca,
    audiosTotal: c.audiosTotal || 0,
    audiosListos: c.audiosListos || 0,
    concurrencia: c.config ? c.config.concurrencia : null,
    aviso: c.aviso || null,
    enriquecimiento: c.enriquecimiento || null,
    version: c.version || 0,
    reanudable: Boolean(c.reanudable),
    mensaje: c.config ? (c.config.mensaje || "") : "",
    modoAudio: c.config ? c.config.modoAudio : "",
    voces: c.config && c.config.vocesNombres ? c.config.vocesNombres : [],
    incidencias: (c.incidencias || []).slice(0, 25),
    motivosFallo: [...fallos.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 15),
    porVoz: [...voces.entries()].map(([nombre, g]) => ({
      voz: nombre || "(sin voz)", marcadas: g.marcadas, contestaron: g.contestaron,
      tasa: porcentaje(g.contestaron, g.marcadas),
      duracionPromedio: g.contestaron ? Math.round((g.duracion / g.contestaron) * 10) / 10 : 0,
      completos: g.completos,
    })).sort((a, b) => b.marcadas - a.marcadas),
    porHora: [...horas.entries()].map(([hora, g]) => ({
      hora, marcadas: g.marcadas, contestaron: g.contestaron, tasa: porcentaje(g.contestaron, g.marcadas),
    })).sort((a, b) => a.hora - b.hora),
  };

  if (!esLlamada) {
    const e = estadosTwilio;
    resumen.mensajes = {
      enviados: marcadas,
      enCola: (e.queued || 0) + (e.accepted || 0) + (e.sending || 0) + (e.scheduled || 0),
      enviadosSinEntrega: e.sent || 0,
      entregados: (e.delivered || 0) + (e.read || 0),
      leidos: e.read || 0,
      fallidos: (e.failed || 0) + (e.undelivered || 0),
    };
  }
  return resumen;
}

module.exports = { calcularResumen, porcentaje };
