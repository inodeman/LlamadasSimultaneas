"use strict";
const { construirMensaje } = require("./util");
const { ErrorElevenLabs } = require("../elevenlabs");

function marcarOmitidos(c, g) {
  let n = 0;
  c.resultados.forEach((r) => {
    if (r.estado === "pendiente" || r.estado === "marcando") {
      r.estado = "omitido";
      r.cat = "omitido";
      n += 1;
      g.cambio(c, r);
    }
  });
  c.omitidos = n;
  return n;
}

function detenerPorEleven(g, c, rt, err) {
  rt.detener = true;
  const inc = err && err.aIncidencia ? err.aIncidencia() : {
    fuente: "elevenlabs", codigo: "error", titulo: "Error de ElevenLabs", detalle: err && err.message ? err.message : "Error desconocido", accion: "", fatal: true,
  };
  g.incidencia(c, inc);
  marcarOmitidos(c, g);
  c.reanudable = true;
  c.fin = new Date().toISOString();
  g.aviso(c, "error", inc.titulo, `${inc.detalle}${inc.accion ? ` ${inc.accion}` : ""} No se hizo ninguna llamada con los contactos omitidos; cuando lo resuelvas puedes pulsar Reanudar.`, ["reanudar"]);
  g.cambiarEstado(c, "detenida");
  console.error(`Campaña ${c.id} detenida por ElevenLabs: ${inc.detalle}`);
  return false;
}

function registrarAudio(c, resultado, vozId, nombreVoz, texto) {
  const clave = resultado.claveArchivo;
  const existente = c.audios[clave];
  if (existente) {
    existente.usos += 1;
    return;
  }
  c.audios[clave] = {
    clave, archivo: `${clave}.mp3`, vozId, voz: nombreVoz, texto: texto.slice(0, 300),
    caracteres: resultado.caracteres || texto.length, bytes: resultado.bytes || 0, segundos: resultado.segundos || null, usos: 1,
  };
}

async function prepararAudios(g, c, rt) {
  const cfg = c.config;
  const servicio = g.voces;
  c.audios = c.audios || {};

  let nombres = {};
  try {
    nombres = await servicio.mapaDeNombres();
  } catch (err) {
    if (err.fatal) return detenerPorEleven(g, c, rt, err);
  }
  cfg.vocesNombres = cfg.voces.map((id) => nombres[id] || id);

  let filas = c.resultados.filter((r) => r.estado === "pendiente" && !r.audioUrl);
  filas.forEach((r) => {
    if (!r.vozId) r.vozId = cfg.voces[r.i % cfg.voces.length];
  });
  let vocesBuenas = cfg.voces.slice();
  c.audiosTotal = 0;
  c.audiosListos = 0;

  for (let pasada = 0; pasada < 3 && filas.length; pasada += 1) {
    const tareas = new Map();
    filas.forEach((r) => {
      r.voz = nombres[r.vozId] || r.vozId;
      const texto = construirMensaje(cfg.mensaje, r.nombre);
      r.claveAudio = `${r.vozId}|${texto}`;
      if (texto && !tareas.has(r.claveAudio)) tareas.set(r.claveAudio, { clave: r.claveAudio, vozId: r.vozId, texto });
    });

    const lista = [...tareas.values()];
    const nuevas = lista.filter((t) => !servicio.existeAudio(t.vozId, t.texto));
    const necesarios = nuevas.reduce((suma, t) => suma + t.texto.length, 0);
    if (necesarios > 0) {
      let sus = null;
      try {
        sus = await servicio.suscripcion();
      } catch (err) {
        if (err.fatal) return detenerPorEleven(g, c, rt, err);
      }
      if (sus && sus.limite !== null && sus.usados !== null && !sus.puedeExtender && necesarios > sus.limite - sus.usados) {
        return detenerPorEleven(g, c, rt, new ErrorElevenLabs(
          `Se necesitan unos ${necesarios.toLocaleString("es-MX")} caracteres para los audios nuevos y a la cuenta le quedan ${Math.max(0, sus.limite - sus.usados).toLocaleString("es-MX")}.`,
          { fatal: true, codigo: "creditos_insuficientes", titulo: "Créditos de ElevenLabs insuficientes", accion: "Recarga créditos en elevenlabs.io o usa un mensaje sin {nombre} para generar menos audios." }
        ));
      }
    }

    const base = c.audiosListos;
    c.audiosTotal += lista.length;
    c.estado = "generando_audios";
    g.cambio(c);
    const { resultados, errorFatal } = await servicio.generarVarios(lista, (listos) => {
      c.audiosListos = base + listos;
      g.cambio(c);
    }, () => rt.detener);
    if (errorFatal) return detenerPorEleven(g, c, rt, errorFatal);
    if (rt.detener) return false;

    const vocesFallidas = new Map();
    filas.forEach((r) => {
      const res = resultados.get(r.claveAudio);
      const texto = construirMensaje(cfg.mensaje, r.nombre);
      if (res && res.ok) {
        r.audioUrl = res.url;
        r.audioSeg = res.segundos || null;
        r.audioClave = res.claveArchivo;
        registrarAudio(c, res, r.vozId, r.voz, texto);
        return;
      }
      if (res && res.porVoz) {
        if (!vocesFallidas.has(r.vozId)) vocesFallidas.set(r.vozId, res);
        return;
      }
      const inc = { fuente: "elevenlabs", codigo: res ? String(res.codigo || "error") : "texto_vacio", titulo: res ? res.titulo : "Mensaje vacío", detalle: res ? res.error : "El mensaje de este contacto quedó vacío.", accion: res ? res.accion : "Revisa el mensaje y el nombre del contacto." };
      r.estado = "error";
      r.cat = "error";
      r.incidencia = inc;
      r.error = `${inc.titulo}: ${inc.detalle}`;
      g.incidencia(c, inc, r.numero);
      g.cambio(c, r);
    });

    if (!vocesFallidas.size) break;

    vocesFallidas.forEach((res, vozId) => {
      g.incidencia(c, { fuente: "elevenlabs", codigo: `${res.codigo || "voz"}:${vozId}`, titulo: `${res.titulo || "Voz no disponible"}: ${nombres[vozId] || vozId}`, detalle: res.error, accion: res.accion, nivel: "aviso" });
    });
    vocesBuenas = vocesBuenas.filter((v) => !vocesFallidas.has(v));
    if (!vocesBuenas.length) {
      const primera = vocesFallidas.values().next().value;
      return detenerPorEleven(g, c, rt, new ErrorElevenLabs(primera.error, { fatal: true, codigo: primera.codigo, titulo: primera.titulo, accion: primera.accion }));
    }
    filas = filas.filter((r) => vocesFallidas.has(r.vozId) && !r.audioUrl);
    filas.forEach((r, k) => { r.vozId = vocesBuenas[k % vocesBuenas.length]; });
    g.aviso(c, "aviso", "Una voz no se pudo usar", `Algunos contactos pasaron automáticamente a las otras voces seleccionadas (${[...vocesFallidas.keys()].map((v) => nombres[v] || v).join(", ")} no estaba disponible).`, []);
  }

  c.audiosListos = c.audiosTotal;
  g.cambio(c);
  return true;
}

module.exports = { prepararAudios, detenerPorEleven, marcarOmitidos };
