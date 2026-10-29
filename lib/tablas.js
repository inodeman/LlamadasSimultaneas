"use strict";
const { textoRespuesta, etiquetaCat } = require("./estados");
const { formatoFecha, construirCsv } = require("./util");
const { E, celda, serialLocal } = require("./xlsx");

const ESTILO_TIPO = {
  texto: E.texto, largo: E.ajustar, fecha: E.fecha, moneda: E.moneda, entero: E.entero,
  decimal: E.decimal, miles: E.miles, porcentaje: E.porcentaje,
};

const PERMANENTES_SIP = new Set(["404", "410", "484", "604"]);
const PERMANENTES_CODIGO = new Set(["21211", "21214", "21217", "21401", "13223", "13224", "sip-404", "sip-410", "sip-484", "sip-604"]);

function esFalloPermanente(r) {
  if (PERMANENTES_SIP.has(String(r.sip || ""))) return true;
  return Boolean(r.incidencia && PERMANENTES_CODIGO.has(String(r.incidencia.codigo)));
}

function terminada(r) {
  return Boolean(r.sid) && (r.rangoLlamada || 0) >= 4;
}

function escuchoCompleto(r) {
  if (r.cat !== "contesto" || !r.audioSeg) return "";
  return (r.duracion || 0) >= r.audioSeg * 0.9 ? "Sí" : "No";
}

function contestadoPor(r) {
  const a = String(r.answeredBy || "");
  if (!a) return r.buzon ? "Contestadora o buzón" : "";
  if (a === "human") return "Persona";
  if (/^machine|^fax/.test(a)) return "Contestadora o buzón";
  return "No determinado";
}

function motivoReintento(r, tipo) {
  switch (r.cat) {
    case "no_contesto": return "No contestó";
    case "ocupado": return "Línea ocupada";
    case "buzon": return "Contestó una contestadora";
    case "cancelada": return "Llamada cancelada";
    case "pendiente":
    case "omitido": return "Sin marcar";
    case "fallida":
    case "error": return `${tipo === "whatsapp" ? "No entregado" : "Falló"}${r.incidencia ? `: ${r.incidencia.titulo}` : ""}`;
    default: return "";
  }
}

const CATALOGO = {
  n: { titulo: "#", ancho: 6, tipo: "entero", valor: (r) => r.i + 1 },
  numero: { titulo: "Número", ancho: 17, tipo: "texto", valor: (r) => r.numero },
  nombre: { titulo: "Nombre", ancho: 26, tipo: "texto", valor: (r) => r.nombre || "" },
  respondio: { titulo: "¿Respondió?", tituloWa: "¿Entregado?", ancho: 13, tipo: "texto", semaforo: true, valor: (r) => textoRespuesta(r) },
  resultado: { titulo: "Resultado", ancho: 27, tipo: "texto", semaforo: true, valor: (r, c) => etiquetaCat(r.cat, c.tipo) },
  estadoTw: { titulo: "Estado en Twilio", ancho: 16, tipo: "texto", valor: (r) => r.estadoLlamada || "" },
  duracion: { titulo: "Duración (seg)", ancho: 14, tipo: "entero", valor: (r) => (terminada(r) ? (r.duracion || 0) : null) },
  audioSeg: { titulo: "Duración del audio (seg)", ancho: 16, tipo: "decimal", valor: (r) => r.audioSeg || null },
  completo: { titulo: "¿Escuchó el mensaje completo?", ancho: 19, tipo: "texto", valor: (r) => escuchoCompleto(r) },
  contestadoPor: { titulo: "Contestó", ancho: 21, tipo: "texto", valor: (r) => contestadoPor(r) },
  voz: { titulo: "Voz", ancho: 18, tipo: "texto", valor: (r) => r.voz || "" },
  hora: { titulo: "Hora de la llamada", tituloWa: "Hora del envío", ancho: 20, tipo: "fecha", valor: (r) => r.tCrea || null },
  horaTimbre: { titulo: "Empezó a timbrar", ancho: 20, tipo: "fecha", valor: (r) => r.tTimbra || null },
  horaContesto: { titulo: "Hora en que contestó", ancho: 20, tipo: "fecha", valor: (r) => r.tContesta || null },
  horaFin: { titulo: "Hora de término", ancho: 20, tipo: "fecha", valor: (r) => (terminada(r) ? (r.tFin || null) : null) },
  costo: { titulo: "Costo (USD)", ancho: 12, tipo: "moneda", valor: (r) => (r.precio !== null && r.precio !== undefined ? Math.abs(r.precio) : null) },
  sip: { titulo: "Código SIP", ancho: 11, tipo: "texto", valor: (r) => r.sip || "" },
  codigo: { titulo: "Código de error", ancho: 16, tipo: "texto", valor: (r) => (r.incidencia ? String(r.incidencia.codigo) : "") },
  motivo: { titulo: "Qué pasó", ancho: 34, tipo: "largo", valor: (r) => (r.incidencia ? r.incidencia.titulo : "") },
  detalle: { titulo: "Detalle del error", ancho: 52, tipo: "largo", valor: (r) => (r.incidencia ? (r.incidencia.detalle || "") : (r.error || "")) },
  accion: { titulo: "Qué hacer", ancho: 48, tipo: "largo", valor: (r) => (r.incidencia ? (r.incidencia.accion || "") : "") },
  intentos: { titulo: "Intentos", ancho: 10, tipo: "entero", valor: (r) => r.intentos || null },
  sid: { titulo: "SID de Twilio", ancho: 38, tipo: "texto", valor: (r) => r.sid || "" },
  audio: { titulo: "Archivo de audio", ancho: 44, tipo: "texto", valor: (r) => (r.audioClave ? `${r.audioClave}.mp3` : "") },
  de: { titulo: "Desde (From)", ancho: 17, tipo: "texto", valor: (r, c, ctx) => ctx.de || "" },
  moneda: { titulo: "Moneda", ancho: 9, tipo: "texto", valor: (r) => (r.precio !== null && r.precio !== undefined ? "USD" : "") },
  answeredBy: { titulo: "AnsweredBy (Twilio)", ancho: 20, tipo: "texto", valor: (r) => r.answeredBy || "" },
  motivoReintento: { titulo: "Por qué se reintenta", ancho: 44, tipo: "texto", valor: (r, c) => motivoReintento(r, c.tipo) },
};

const CONJUNTOS = {
  todo: ["n", "numero", "nombre", "respondio", "resultado", "estadoTw", "duracion", "completo", "contestadoPor", "voz", "hora", "horaContesto", "horaFin", "costo", "sip", "codigo", "motivo", "detalle", "accion", "intentos", "sid", "audio"],
  respondieron: ["n", "numero", "nombre", "voz", "duracion", "completo", "contestadoPor", "hora", "horaFin", "costo", "sid"],
  noRespondieron: ["n", "numero", "nombre", "resultado", "estadoTw", "duracion", "contestadoPor", "voz", "hora", "sid"],
  fallidas: ["n", "numero", "nombre", "resultado", "codigo", "motivo", "detalle", "accion", "sip", "estadoTw", "hora", "sid", "intentos"],
  sinMarcar: ["n", "numero", "nombre", "resultado", "voz"],
  reintentar: ["numero", "nombre", "motivoReintento"],
  twilio: ["sid", "numero", "de", "estadoTw", "duracion", "costo", "moneda", "answeredBy", "sip", "codigo", "motivo", "hora", "horaTimbre", "horaContesto", "horaFin"],
};

const CONJUNTOS_WA = {
  ...CONJUNTOS,
  todo: ["n", "numero", "nombre", "respondio", "resultado", "estadoTw", "hora", "codigo", "motivo", "detalle", "accion", "sid"],
  respondieron: ["n", "numero", "nombre", "resultado", "hora", "sid"],
  noRespondieron: ["n", "numero", "nombre", "resultado", "estadoTw", "hora", "sid"],
  fallidas: ["n", "numero", "nombre", "resultado", "codigo", "motivo", "detalle", "accion", "hora", "sid"],
};

const FILTROS = {
  todo: () => true,
  respondieron: (r) => r.cat === "contesto",
  noRespondieron: (r, c) => ["no_contesto", "ocupado", "buzon"].includes(r.cat) || (c.tipo === "whatsapp" && r.cat === "en_curso" && Boolean(r.sid)),
  fallidas: (r) => r.cat === "fallida" || r.cat === "error",
  sinMarcar: (r) => ["pendiente", "omitido", "cancelada"].includes(r.cat),
  reintentar: (r) => r.cat !== "contesto" && r.cat !== "en_curso" && !((r.cat === "fallida" || r.cat === "error") && esFalloPermanente(r)),
  twilio: (r) => Boolean(r.sid),
};

function construirTabla(c, lista, ctx = {}) {
  const conjuntos = c.tipo === "whatsapp" ? CONJUNTOS_WA : CONJUNTOS;
  const claves = conjuntos[lista];
  const filtro = FILTROS[lista];
  if (!claves || !filtro) throw new Error(`Lista desconocida: ${lista}`);
  const columnas = claves.map((k) => {
    const def = CATALOGO[k];
    return { clave: k, titulo: c.tipo === "whatsapp" && def.tituloWa ? def.tituloWa : def.titulo, ancho: def.ancho, tipo: def.tipo, semaforo: Boolean(def.semaforo) };
  });
  const datos = [];
  const filas = c.resultados || [];
  for (let k = 0; k < filas.length; k += 1) {
    const r = filas[k];
    if (!filtro(r, c)) continue;
    datos.push(claves.map((clave) => CATALOGO[clave].valor(r, c, ctx)));
  }
  return { lista, columnas, datos };
}

function textoCsv(columna, valor, zona) {
  if (valor === null || valor === undefined) return "";
  if (columna.tipo === "fecha") return formatoFecha(valor, zona);
  if (columna.tipo === "moneda") return Number(valor).toFixed(4);
  if (columna.tipo === "decimal") return Number(valor).toFixed(1);
  return valor;
}

function tablaACsv(tabla, zona) {
  return construirCsv(
    tabla.columnas.map((c) => c.titulo),
    tabla.datos.map((fila) => fila.map((v, j) => textoCsv(tabla.columnas[j], v, zona)))
  );
}

function estiloSemaforo(valor) {
  const v = String(valor || "");
  if (!v) return E.gris;
  if (/^(Sí|Contestó|Entregado|Leído)$/.test(v)) return E.verde;
  if (/^(No|No contestó|Ocupado|Línea ocupada|Buzón|Contestadora)/.test(v)) return E.ambar;
  if (/^(Error|Falló|No entregado|Error antes)/.test(v)) return E.rojo;
  if (/^(En curso|Enviado)/.test(v)) return E.azul;
  return E.gris;
}

function tablaAHoja(tabla, nombre, zona, extras = {}) {
  const columnas = tabla.columnas.map((c) => ({ titulo: c.titulo, ancho: c.ancho, estilo: ESTILO_TIPO[c.tipo] }));
  const filas = tabla.datos.map((fila) => fila.map((v, j) => {
    const col = tabla.columnas[j];
    if (col.tipo === "fecha") return v ? serialLocal(v, zona) : null;
    if (col.semaforo) return celda(v, estiloSemaforo(v));
    return v;
  }));
  return { nombre, columnas, filas, congelar: { filas: 1, columnas: extras.congelarColumnas === undefined ? 0 : extras.congelarColumnas }, autofiltro: true, color: extras.color };
}

module.exports = { CATALOGO, CONJUNTOS, CONJUNTOS_WA, FILTROS, construirTabla, tablaACsv, tablaAHoja, estiloSemaforo, esFalloPermanente, ESTILO_TIPO, escuchoCompleto, contestadoPor };
