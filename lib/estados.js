"use strict";

const RANGO_LLAMADA = {
  queued: 1, initiated: 1, ringing: 2, answered: 3, "in-progress": 3,
  completed: 4, busy: 4, "no-answer": 4, canceled: 4, failed: 4,
};

const RANGO_MENSAJE = {
  accepted: 1, queued: 1, scheduled: 1, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, undelivered: 5,
};

const TEXTO_LLAMADA = {
  queued: "en cola", initiated: "en cola", ringing: "timbrando", answered: "contestada", "in-progress": "contestada",
  busy: "ocupado", "no-answer": "no contestó", canceled: "cancelada", failed: "fallida",
};

const TEXTO_MENSAJE = {
  accepted: "en cola", queued: "en cola", scheduled: "en cola", sending: "enviando", sent: "enviado",
  delivered: "entregado", read: "leído", failed: "fallido", undelivered: "no entregado",
};

function esTerminalLlamada(r) {
  return (r.rangoLlamada || 0) >= 4;
}

function esTerminalMensaje(r) {
  return (r.rangoLlamada || 0) >= 4;
}

function numeroOCero(valor) {
  const n = parseFloat(valor);
  return Number.isFinite(n) ? n : null;
}

function aplicarEstadoLlamada(r, estadoTwilio, extras = {}) {
  const rango = RANGO_LLAMADA[estadoTwilio];
  if (!rango) return false;
  const rangoActual = r.rangoLlamada || 0;
  if (rango < rangoActual) return false;

  const ahora = extras.ahora || Date.now();
  const duracionNueva = extras.duracion !== undefined && extras.duracion !== null && extras.duracion !== ""
    ? (parseInt(extras.duracion, 10) || 0)
    : null;
  let cambio = rango !== rangoActual || estadoTwilio !== r.estadoLlamada;

  r.rangoLlamada = rango;
  r.estadoLlamada = estadoTwilio;
  r.ultimoUpdate = ahora;

  if (duracionNueva !== null && duracionNueva > (r.duracion || 0)) {
    r.duracion = duracionNueva;
    cambio = true;
  }
  if ((rango === 2 || rango === 3) && !r.tTimbra) r.tTimbra = ahora;
  if (rango === 3 && !r.tContesta) r.tContesta = ahora;
  if (rango >= 4 && !r.tFin) r.tFin = ahora;
  if (estadoTwilio === "completed" && (r.duracion || 0) > 0 && !r.tContesta) {
    r.tContesta = Math.max(r.tCrea || 0, (r.tFin || ahora) - r.duracion * 1000);
    if (!r.tTimbra) r.tTimbra = r.tContesta;
  }

  if (extras.sip && String(extras.sip) !== String(r.sip || "")) {
    r.sip = String(extras.sip);
    cambio = true;
  }
  if (extras.answeredBy && extras.answeredBy !== r.answeredBy) {
    r.answeredBy = extras.answeredBy;
    cambio = true;
  }
  const precio = numeroOCero(extras.precio);
  if (precio !== null && precio !== r.precio) {
    r.precio = precio;
    cambio = true;
  }

  const duracion = r.duracion || 0;
  const maquina = /^(machine|fax)/i.test(r.answeredBy || "");
  r.buzon = maquina;

  if (maquina) {
    r.respondio = false;
  } else if (estadoTwilio === "in-progress" || estadoTwilio === "answered" || (estadoTwilio === "completed" && duracion > 0)) {
    r.respondio = true;
  } else if (rango === 4 && r.respondio !== true) {
    r.respondio = false;
  }

  if (estadoTwilio === "completed") {
    r.estado = maquina ? "buzón" : (duracion > 0 || r.respondio ? "completada" : "no contestada");
  } else {
    r.estado = TEXTO_LLAMADA[estadoTwilio] || estadoTwilio;
  }
  r.cat = categoriaDe(r);
  return cambio;
}

function aplicarEstadoMensaje(r, estadoTwilio, extras = {}) {
  const rango = RANGO_MENSAJE[estadoTwilio];
  if (!rango) return false;
  const rangoActual = r.rangoMensaje || 0;
  if (rango < rangoActual) return false;
  const cambio = rango !== rangoActual || estadoTwilio !== r.estadoLlamada;
  r.rangoMensaje = rango;
  r.estadoLlamada = estadoTwilio;
  r.rangoLlamada = rango >= 3 ? 4 : rango;
  r.ultimoUpdate = extras.ahora || Date.now();
  if (rango >= 3 && !r.tFin) r.tFin = r.ultimoUpdate;
  r.estado = TEXTO_MENSAJE[estadoTwilio] || estadoTwilio;
  if (estadoTwilio === "delivered" || estadoTwilio === "read") r.respondio = true;
  if (rango === 5) r.respondio = false;
  r.cat = categoriaDe(r, "whatsapp");
  return cambio;
}

function categoriaDe(r, tipo) {
  if (r.estado === "omitido") return "omitido";
  if (r.estado === "error") return "error";
  if (!r.sid) return "pendiente";
  if (tipo === "whatsapp" || r.tipo === "whatsapp") {
    if (r.estadoLlamada === "failed" || r.estadoLlamada === "undelivered") return "fallida";
    if (r.estadoLlamada === "delivered" || r.estadoLlamada === "read") return "contesto";
    return "en_curso";
  }
  const rango = r.rangoLlamada || 0;
  if (rango < 4) return "en_curso";
  if (r.buzon) return "buzon";
  if (r.respondio === true) return "contesto";
  switch (r.estadoLlamada) {
    case "busy": return "ocupado";
    case "no-answer": return "no_contesto";
    case "canceled": return "cancelada";
    case "failed": return "fallida";
    default: return "no_contesto";
  }
}

function grupoDe(cat) {
  switch (cat) {
    case "contesto": return "si";
    case "no_contesto":
    case "ocupado":
    case "buzon": return "no";
    case "fallida":
    case "error": return "error";
    case "en_curso": return "curso";
    default: return "pendiente";
  }
}

const ETIQUETA_CAT = {
  pendiente: "Pendiente", en_curso: "En curso", contesto: "Contestó", buzon: "Buzón o contestadora",
  no_contesto: "No contestó", ocupado: "Ocupado", fallida: "Falló", cancelada: "Cancelada",
  error: "Error antes de marcar", omitido: "Sin marcar (campaña detenida)",
};

const ETIQUETA_CAT_WA = {
  pendiente: "Pendiente", en_curso: "Enviado", contesto: "Entregado", fallida: "No entregado",
  error: "Error al enviar", omitido: "Sin enviar",
};

function etiquetaCat(cat, tipo) {
  const mapa = tipo === "whatsapp" ? ETIQUETA_CAT_WA : ETIQUETA_CAT;
  return mapa[cat] || cat;
}

function textoRespuesta(r) {
  const grupo = grupoDe(r.cat || categoriaDe(r));
  if (grupo === "si") return "Sí";
  if (grupo === "no") return "No";
  if (grupo === "error") return "Error";
  if (grupo === "curso") return "En curso";
  return "";
}

function filaNueva(indice, contacto, extra = {}) {
  return {
    i: indice,
    numero: contacto.numero,
    nombre: contacto.nombre || "",
    voz: contacto.voz || "",
    vozId: contacto.vozId || "",
    claveAudio: contacto.claveAudio || "",
    sid: null,
    estado: "pendiente",
    estadoLlamada: null,
    rangoLlamada: 0,
    respondio: undefined,
    buzon: false,
    duracion: 0,
    sip: "",
    precio: null,
    cat: "pendiente",
    error: "",
    incidencia: null,
    intentos: 0,
    tCrea: 0,
    tTimbra: 0,
    tContesta: 0,
    tFin: 0,
    ultimoUpdate: 0,
    ...extra,
  };
}

module.exports = {
  RANGO_LLAMADA, RANGO_MENSAJE, aplicarEstadoLlamada, aplicarEstadoMensaje, categoriaDe, grupoDe,
  etiquetaCat, textoRespuesta, filaNueva, esTerminalLlamada, esTerminalMensaje,
};
