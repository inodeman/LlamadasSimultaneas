"use strict";
const { construirCsv, formatoFecha, slug, zonaValida } = require("./util");
const { calcularResumen, porcentaje } = require("./resumen");
const { crearXlsx, celda, E, serialLocal, letraColumna } = require("./xlsx");
const { crearZipBuffer } = require("./zip");
const { construirTabla, tablaACsv, tablaAHoja, CONJUNTOS, CONJUNTOS_WA } = require("./tablas");
const { etiquetaCat } = require("./estados");

const TIPO_CSV = "text/csv; charset=utf-8";
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TIPO_ZIP = "application/zip";

function baseNombre(c, zona) {
  const nombre = slug(c.nombre || (c.tipo === "whatsapp" ? "whatsapp" : "llamadas"), 30) || "campana";
  const fecha = formatoFecha(new Date(c.creada).getTime(), zona).replace(/[-: ]/g, "").slice(0, 13);
  return `${nombre}_${fecha.slice(0, 8)}_${fecha.slice(8, 12)}`;
}

function csvErrores(c, zona) {
  const lista = c.incidencias || [];
  return construirCsv(
    ["Origen", "Código", "Qué pasó", "Detalle", "Qué hacer", "Veces", "Gravedad", "Primera vez", "Última vez", "Ejemplos (números)", "Más información"],
    lista.map((x) => [
      x.fuente === "elevenlabs" ? "ElevenLabs" : x.fuente === "twilio" ? "Twilio" : "Sistema", x.codigo, x.titulo, x.detalle, x.accion,
      x.cantidad, x.nivel === "error" ? "Error" : "Aviso", formatoFecha(x.primera, zona), formatoFecha(x.ultima, zona), (x.ejemplos || []).join(" "), x.enlace || "",
    ])
  );
}

function csvInvalidos(c) {
  return construirCsv(["Fila del archivo", "Texto original", "Nombre", "Motivo"], (c.invalidos || []).map((x) => [x.fila, x.original, x.nombre, x.motivo]));
}

function listaAudios(c) {
  return Object.values(c.audios || {}).sort((a, b) => String(a.voz).localeCompare(String(b.voz)) || String(a.texto).localeCompare(String(b.texto)));
}

function nombreAudio(a) {
  const voz = slug(a.voz || "voz", 24) || "voz";
  const texto = slug(a.texto || "audio", 50) || "audio";
  return `audios/${voz}/${texto}_${String(a.clave).slice(0, 8)}.mp3`;
}

function csvAudios(c) {
  return construirCsv(
    ["Archivo en el ZIP", "Voz", "Texto leído", "Caracteres", "Duración (seg)", "Contactos que lo usaron", "Tamaño (KB)"],
    listaAudios(c).map((a) => [nombreAudio(a), a.voz, a.texto, a.caracteres, a.segundos === null || a.segundos === undefined ? "" : a.segundos, a.usos, Math.round((a.bytes || 0) / 102.4) / 10])
  );
}

function hojaResumen(c, r, ctx) {
  const zona = ctx.zona;
  const wa = c.tipo === "whatsapp";
  const cols = wa ? CONJUNTOS_WA.todo : CONJUNTOS.todo;
  const L = (clave) => `Detalle!$${letraColumna(cols.indexOf(clave))}:$${letraColumna(cols.indexOf(clave))}`;
  const total = r.total;
  const cuenta = r.cuenta;
  const noResp = cuenta.no_contesto + cuenta.ocupado + cuenta.buzon;
  const errores = cuenta.fallida + cuenta.error;
  const sinMarcar = cuenta.pendiente + cuenta.omitido + cuenta.cancelada;
  const fila = [];
  const vacia = () => fila.push([]);
  const cabecera = (texto, a = "Cantidad", b = "% del total", d = "Notas") => fila.push([celda(texto, E.encabezado), celda(a, E.encabezado), celda(b, E.encabezado), celda(d, E.encabezado)]);
  let filaTotal = 0;
  const dato = (etiqueta, valor, formula, nota, conPct = true, sangria = false) => {
    const rowNum = fila.length + 1;
    if (!filaTotal) filaTotal = rowNum;
    fila.push([
      celda(sangria ? `     ${etiqueta}` : etiqueta, sangria ? E.texto : E.etiqueta),
      celda(valor, E.miles, formula),
      conPct ? celda(total ? valor / total : 0, E.porcentaje, `IF($B$${filaTotal}=0,0,B${rowNum}/$B$${filaTotal})`) : celda("", E.texto),
      celda(nota || "", E.ajustar),
    ]);
  };
  const medida = (etiqueta, valor, estilo, nota) => fila.push([celda(etiqueta, E.etiqueta), celda(valor, estilo), celda("", E.texto), celda(nota || "", E.ajustar)]);

  fila.push([celda(wa ? "Reporte de campaña de WhatsApp" : "Reporte de campaña de llamadas", E.titulo)]);
  fila.push([celda(`${c.nombre || c.id}  ·  generado el ${formatoFecha(Date.now(), zona)}  ·  estado: ${r.estado}`, E.subtitulo)]);
  vacia();
  cabecera("Resultado de la campaña");
  dato("Contactos en la campaña", total, `COUNTA(${L("numero")})-1`, c.invalidosTotal ? `Además se descartaron ${c.invalidosTotal} números inválidos al cargar (ver hoja Inválidos).` : "", false);
  dato(wa ? "Mensajes enviados" : "Llamadas hechas", r.marcadas, `COUNTIF(${L("sid")},"?*")`, "Contactos para los que Twilio creó una llamada o mensaje.");
  dato(wa ? "Entregados (Sí)" : "Respondieron (Sí)", cuenta.contesto, `COUNTIF(${L("respondio")},"Sí")`, wa ? "Mensajes entregados o leídos." : "Llamadas que fueron contestadas por una persona.");
  dato(wa ? "Sin entrega confirmada (No)" : "No respondieron (No)", noResp + (wa ? cuenta.en_curso : 0), `COUNTIF(${L("respondio")},"No")`, wa ? "Enviados que aún no muestran entrega." : "Suma de no contestó, ocupado y contestadora.");
  if (!wa) {
    dato("No contestaron", cuenta.no_contesto, `COUNTIF(${L("resultado")},"No contestó")`, "Timbró el tiempo configurado sin respuesta.", true, true);
    dato("Línea ocupada", cuenta.ocupado, `COUNTIF(${L("resultado")},"Ocupado")`, "", true, true);
    dato("Contestadora o buzón", cuenta.buzon, `COUNTIF(${L("resultado")},"Buzón o contestadora")`, "Solo se detecta si activaste la detección de buzón.", true, true);
  }
  dato(wa ? "No entregados (Error)" : "Fallaron o con error (Error)", errores, `COUNTIF(${L("respondio")},"Error")`, "Ver la hoja Errores para el motivo exacto.");
  dato(wa ? "En proceso" : "En curso", cuenta.en_curso, `COUNTIF(${L("respondio")},"En curso")`, "");
  dato(wa ? "Sin enviar" : "Sin marcar o canceladas", sinMarcar, `COUNTIF(${L("resultado")},"Pendiente")+COUNTIF(${L("resultado")},"Sin marcar*")+COUNTIF(${L("resultado")},"Cancelada")`, "Quedaron pendientes; descarga la lista 'Reintentar' para volver a marcarlos.");
  vacia();

  if (!wa) {
    cabecera("Calidad de la respuesta", "Valor", "", "Cómo se calcula");
    medida("Tasa de respuesta", r.tasaRespuesta / 100, E.porcentaje, "Respondieron entre las llamadas terminadas (sin contar canceladas).");
    medida("Tasa de respuesta entre números alcanzables", r.tasaContactables / 100, E.porcentaje, "Respondieron entre quienes no tuvieron falla técnica.");
    medida("Tasa de fallos", r.tasaFallos / 100, E.porcentaje, "Llamadas que fallaron entre las terminadas.");
    medida("Duración promedio de quienes respondieron (seg)", r.duracionPromedio, E.decimal, "");
    medida("Duración máxima (seg)", r.duracionMax, E.entero, "");
    medida("Escucharon el mensaje completo", r.escucharonCompleto, E.miles, r.escucharonMedibles ? `De ${r.escucharonMedibles} respuestas con duración de audio conocida (≥ 90 % del audio).` : "Solo se mide con audios de ElevenLabs.");
    medida("Tiempo total en llamada (min)", Math.round((r.duracionTotal / 60) * 10) / 10, E.decimal, "");
    vacia();
    cabecera("Costo", "Valor", "", "Notas");
    medida("Costo total (USD)", r.costo, E.moneda, `Calculado con ${r.costoConDatos} llamadas que ya tienen precio en Twilio (el precio puede tardar unos minutos en aparecer).`);
    medida("Costo por llamada contestada (USD)", cuenta.contesto ? r.costo / cuenta.contesto : 0, E.moneda, "");
    vacia();
  }

  cabecera("Tiempos y ritmo", "Valor", "", "Notas");
  medida("Inicio", c.inicio ? serialLocal(new Date(c.inicio).getTime(), zona) : "", E.fecha, "");
  medida("Fin", c.fin ? serialLocal(new Date(c.fin).getTime(), zona) : "", E.fecha, "");
  const durMin = c.inicio && c.fin ? (new Date(c.fin) - new Date(c.inicio)) / 60000 : 0;
  medida("Duración de la campaña (min)", Math.round(durMin * 10) / 10, E.decimal, "");
  medida("Ritmo promedio (llamadas por minuto)", durMin > 0 ? Math.round((r.marcadas / durMin) * 10) / 10 : "", E.decimal, "");
  medida("Llamadas simultáneas configuradas", c.config ? c.config.concurrencia : "", E.entero, "");
  medida("Llamadas por segundo configuradas", c.config ? c.config.cps : "", E.decimal, "");
  vacia();

  cabecera("Configuración", "", "", "");
  fila.push([celda("Mensaje", E.etiqueta), celda(c.config ? c.config.mensaje || c.config.audioUrl || "" : "", E.ajustar), celda("", E.texto), celda("", E.texto)]);
  fila.push([celda("Voces", E.etiqueta), celda((r.voces || []).join(", "), E.ajustar), celda("", E.texto), celda("", E.texto)]);
  fila.push([celda("Tipo de audio", E.etiqueta), celda(c.config ? ({ voces: "Voces de ElevenLabs", mp3: "Archivo MP3 fijo", tts: "Voz de Twilio", texto: "Texto de WhatsApp" }[c.config.modoAudio] || c.config.modoAudio) : "", E.ajustar), celda("", E.texto), celda("", E.texto)]);
  vacia();

  if ((r.motivosFallo || []).length) {
    cabecera("Principales causas de falla", "Cantidad", "Código", "Qué hacer");
    r.motivosFallo.slice(0, 10).forEach((m) => fila.push([celda(m.titulo, E.etiqueta), celda(m.cantidad, E.miles), celda(String(m.codigo), E.texto), celda(`${m.detalle ? `${m.detalle} ` : ""}${m.accion || ""}`.trim(), E.ajustar)]));
  }
  return {
    nombre: "Resumen", columnas: [{ ancho: 46 }, { ancho: 18 }, { ancho: 14 }, { ancho: 78 }], filas: fila.map((f) => f), sinCuadricula: true, color: "FF1B6EF3", horizontal: false,
  };
}

function hojasAnalisis(c, r, ctx) {
  const zona = ctx.zona;
  const hojas = [];
  if (c.tipo !== "whatsapp" && r.porVoz.length) {
    hojas.push({
      nombre: "Por voz", color: "FF7C4DFF",
      columnas: [
        { titulo: "Voz", ancho: 22 }, { titulo: "Llamadas", ancho: 12, estilo: E.miles }, { titulo: "Respondieron", ancho: 14, estilo: E.miles },
        { titulo: "% que respondió", ancho: 16, estilo: E.porcentaje }, { titulo: "Duración promedio (seg)", ancho: 20, estilo: E.decimal }, { titulo: "Escucharon completo", ancho: 20, estilo: E.miles },
      ],
      filas: r.porVoz.map((v) => [v.voz, v.marcadas, v.contestaron, v.tasa / 100, v.duracionPromedio, v.completos]),
      congelar: { filas: 1 }, autofiltro: true,
    });
  }
  if (r.porHora.length) {
    hojas.push({
      nombre: "Por hora", color: "FF00A98F",
      columnas: [{ titulo: "Hora del día", ancho: 14 }, { titulo: c.tipo === "whatsapp" ? "Mensajes" : "Llamadas", ancho: 12, estilo: E.miles }, { titulo: c.tipo === "whatsapp" ? "Entregados" : "Respondieron", ancho: 14, estilo: E.miles }, { titulo: "% que respondió", ancho: 16, estilo: E.porcentaje }],
      filas: r.porHora.map((h) => [`${String(h.hora).padStart(2, "0")}:00 a ${String(h.hora).padStart(2, "0")}:59`, h.marcadas, h.contestaron, h.tasa / 100]),
      congelar: { filas: 1 },
    });
  }
  if ((c.incidencias || []).length) {
    hojas.push({
      nombre: "Errores", color: "FFD93025",
      columnas: [
        { titulo: "Origen", ancho: 13 }, { titulo: "Código", ancho: 14 }, { titulo: "Qué pasó", ancho: 36, estilo: E.ajustar }, { titulo: "Detalle", ancho: 56, estilo: E.ajustar },
        { titulo: "Qué hacer", ancho: 56, estilo: E.ajustar }, { titulo: "Veces", ancho: 9, estilo: E.miles }, { titulo: "Gravedad", ancho: 11 },
        { titulo: "Primera vez", ancho: 20, estilo: E.fecha }, { titulo: "Última vez", ancho: 20, estilo: E.fecha }, { titulo: "Ejemplos", ancho: 40, estilo: E.ajustar }, { titulo: "Más información", ancho: 44 },
      ],
      filas: c.incidencias.map((x) => [
        x.fuente === "elevenlabs" ? "ElevenLabs" : x.fuente === "twilio" ? "Twilio" : "Sistema", String(x.codigo), x.titulo, x.detalle, x.accion, x.cantidad,
        celda(x.nivel === "error" ? "Error" : "Aviso", x.nivel === "error" ? E.rojo : E.ambar), serialLocal(x.primera, zona), serialLocal(x.ultima, zona), (x.ejemplos || []).join("  "), x.enlace || "",
      ]),
      congelar: { filas: 1 }, autofiltro: true,
    });
  }
  if ((c.invalidos || []).length) {
    hojas.push({
      nombre: "Inválidos", color: "FF9AA0A6",
      columnas: [{ titulo: "Fila del archivo", ancho: 16, estilo: E.entero }, { titulo: "Texto original", ancho: 26 }, { titulo: "Nombre", ancho: 26 }, { titulo: "Motivo", ancho: 56, estilo: E.ajustar }],
      filas: c.invalidos.map((x) => [x.fila, x.original, x.nombre, x.motivo]),
      congelar: { filas: 1 }, autofiltro: true,
    });
  }
  const audios = listaAudios(c);
  if (audios.length) {
    hojas.push({
      nombre: "Audios", color: "FFE8710A",
      columnas: [
        { titulo: "Archivo en el ZIP", ancho: 56 }, { titulo: "Voz", ancho: 20 }, { titulo: "Texto leído", ancho: 70, estilo: E.ajustar },
        { titulo: "Caracteres", ancho: 12, estilo: E.miles }, { titulo: "Duración (seg)", ancho: 14, estilo: E.decimal }, { titulo: "Contactos que lo usaron", ancho: 18, estilo: E.miles }, { titulo: "Tamaño (KB)", ancho: 13, estilo: E.decimal },
      ],
      filas: audios.map((a) => [nombreAudio(a), a.voz, a.texto, a.caracteres, a.segundos === undefined ? null : a.segundos, a.usos, Math.round((a.bytes || 0) / 102.4) / 10]),
      congelar: { filas: 1 }, autofiltro: true,
    });
  }
  return hojas;
}

function xlsxCampana(c, ctx) {
  const r = calcularResumen(c, { zona: ctx.zona });
  const wa = c.tipo === "whatsapp";
  const listas = [
    ["Detalle", "todo", "FF1B6EF3", 2],
    [wa ? "Entregados" : "Respondieron", "respondieron", "FF188038", 3],
    [wa ? "Sin entrega" : "No respondieron", "noRespondieron", "FFF9AB00", 3],
    [wa ? "No entregados" : "Fallidas", "fallidas", "FFD93025", 3],
    [wa ? "Sin enviar" : "Sin marcar", "sinMarcar", "FF9AA0A6", 3],
  ];
  const hojas = [hojaResumen(c, r, ctx)];
  listas.forEach(([nombre, lista, color, congelarColumnas]) => {
    hojas.push(tablaAHoja(construirTabla(c, lista, ctx), nombre, ctx.zona, { color, congelarColumnas: Math.min(congelarColumnas, 3) }));
  });
  hojasAnalisis(c, r, ctx).forEach((h) => hojas.push(h));
  return crearXlsx({ titulo: `${c.nombre || c.id} - resultados`, hojas });
}

const DEFINICIONES = [
  { id: "excel", titulo: "Reporte completo en Excel", descripcion: "Resumen, detalle de cada contacto, quién respondió y quién no, fallas con su causa, voces, horas y audios.", formato: "XLSX", recomendado: true },
  { id: "todo", titulo: "Todos los contactos", descripcion: "Resultado de cada número con duración, costo, voz y SID de Twilio.", formato: "CSV" },
  { id: "respondieron", titulo: "Quienes respondieron", descripcion: "Personas que contestaron, cuánto duró la llamada y si escucharon el mensaje completo.", formato: "CSV" },
  { id: "no_respondieron", titulo: "Quienes no respondieron", descripcion: "No contestaron, línea ocupada o contestadora.", formato: "CSV" },
  { id: "fallidas", titulo: "Llamadas fallidas con su causa", descripcion: "Código de error de Twilio o SIP, qué significa y qué hacer.", formato: "CSV" },
  { id: "sin_marcar", titulo: "Sin marcar o canceladas", descripcion: "Contactos que quedaron pendientes.", formato: "CSV" },
  { id: "reintentar", titulo: "Lista para reintentar", descripcion: "Todo lo que vale la pena volver a marcar (excluye números que no existen). Se puede subir de nuevo tal cual.", formato: "CSV" },
  { id: "twilio", titulo: "Resumen de datos de Twilio", descripcion: "SID, estado, duración, precio, quién contestó y códigos de cada llamada.", formato: "CSV" },
  { id: "errores", titulo: "Errores de Twilio y ElevenLabs", descripcion: "Cada error agrupado con su explicación y la acción recomendada.", formato: "CSV" },
  { id: "invalidos", titulo: "Números inválidos descartados", descripcion: "Filas del archivo que no eran teléfonos válidos y por qué.", formato: "CSV" },
  { id: "audios", titulo: "Audios de ElevenLabs", descripcion: "Todos los mp3 generados, ordenados por voz, con un índice.", formato: "ZIP" },
  { id: "respaldo", titulo: "Respaldo completo", descripcion: "Excel, todos los CSV, los audios y los datos crudos de la campaña.", formato: "ZIP" },
];

function catalogo(c, ctx) {
  const r = calcularResumen(c, { zona: ctx.zona });
  const wa = c.tipo === "whatsapp";
  const cuantos = (lista) => construirTabla(c, lista, ctx).datos.length;
  const audios = listaAudios(c);
  const conteos = {
    excel: r.total, todo: r.total, respondieron: cuantos("respondieron"), no_respondieron: cuantos("noRespondieron"), fallidas: cuantos("fallidas"),
    sin_marcar: cuantos("sinMarcar"), reintentar: cuantos("reintentar"), twilio: cuantos("twilio"), errores: (c.incidencias || []).length,
    invalidos: (c.invalidos || []).length, audios: audios.length, respaldo: null,
  };
  return DEFINICIONES.filter((d) => {
    if (wa && (d.id === "audios")) return false;
    if (d.id === "audios") return audios.length > 0;
    if (d.id === "invalidos") return conteos.invalidos > 0;
    if (d.id === "errores") return conteos.errores > 0;
    return true;
  }).map((d) => ({
    ...d,
    cantidad: conteos[d.id],
    vacio: conteos[d.id] === 0 && d.id !== "respaldo",
    href: `/api/campanas/${encodeURIComponent(c.id)}/descargas/${d.id}`,
  }));
}

const MAPA_LISTAS = { todo: "todo", respondieron: "respondieron", no_respondieron: "noRespondieron", fallidas: "fallidas", sin_marcar: "sinMarcar", reintentar: "reintentar", twilio: "twilio" };

function defsAudios(c, rutaAudio) {
  const defs = listaAudios(c).map((a) => ({ nombre: nombreAudio(a), ruta: rutaAudio(a.clave) }));
  defs.push({ nombre: "indice_audios.csv", texto: csvAudios(c) });
  defs.push({ nombre: "LEEME.txt", texto: `Audios generados con ElevenLabs para la campaña "${c.nombre || c.id}".\r\nCada carpeta es una voz. El archivo indice_audios.csv indica qué texto dice cada audio y cuántos contactos lo recibieron.\r\n` });
  return defs;
}

function ctxDe(g, zonaPedida) {
  return { zona: zonaValida(zonaPedida, g.cfg.zonaHoraria), de: g.cfg.twilio.fromNumber };
}

function descarga(g, c, id, zonaPedida) {
  const ctx = ctxDe(g, zonaPedida);
  const base = baseNombre(c, ctx.zona);
  if (id === "excel") return { nombre: `${base}_reporte.xlsx`, tipo: TIPO_XLSX, buffer: xlsxCampana(c, ctx) };
  if (MAPA_LISTAS[id]) {
    const tabla = construirTabla(c, MAPA_LISTAS[id], ctx);
    return { nombre: `${base}_${id}.csv`, tipo: TIPO_CSV, buffer: Buffer.from(tablaACsv(tabla, ctx.zona), "utf8") };
  }
  if (id === "errores") return { nombre: `${base}_errores.csv`, tipo: TIPO_CSV, buffer: Buffer.from(csvErrores(c, ctx.zona), "utf8") };
  if (id === "invalidos") return { nombre: `${base}_invalidos.csv`, tipo: TIPO_CSV, buffer: Buffer.from(csvInvalidos(c), "utf8") };
  if (id === "audios") {
    if (!listaAudios(c).length) return null;
    return { nombre: `${base}_audios.zip`, tipo: TIPO_ZIP, defs: defsAudios(c, (clave) => g.voces.rutaAudio(clave)) };
  }
  if (id === "respaldo") {
    const defs = [{ nombre: "reporte.xlsx", buffer: xlsxCampana(c, ctx) }];
    Object.entries(MAPA_LISTAS).forEach(([nombre, lista]) => defs.push({ nombre: `csv/${nombre}.csv`, texto: tablaACsv(construirTabla(c, lista, ctx), ctx.zona) }));
    defs.push({ nombre: "csv/errores.csv", texto: csvErrores(c, ctx.zona) });
    if ((c.invalidos || []).length) defs.push({ nombre: "csv/invalidos.csv", texto: csvInvalidos(c) });
    defs.push({ nombre: "datos/campana.json", texto: JSON.stringify(c, null, 1) });
    if (listaAudios(c).length) defsAudios(c, (clave) => g.voces.rutaAudio(clave)).forEach((d) => defs.push(d));
    return { nombre: `${base}_respaldo.zip`, tipo: TIPO_ZIP, defs };
  }
  return null;
}

function resumenPorDia(registros, zona) {
  const dias = new Map();
  registros.forEach((x) => {
    const dia = formatoFecha(x.inicio || x.creada, zona).slice(0, 10) || "sin fecha";
    const d = dias.get(dia) || { dia, total: 0, completed: 0, contestadas: 0, "no-answer": 0, busy: 0, failed: 0, canceled: 0, otras: 0, segundos: 0, costo: 0 };
    d.total += 1;
    if (Object.prototype.hasOwnProperty.call(d, x.estado)) d[x.estado] += 1;
    else d.otras += 1;
    if (x.estado === "completed" && (x.duracion || 0) > 0) d.contestadas += 1;
    d.segundos += x.duracion || 0;
    d.costo += x.precio || 0;
    dias.set(dia, d);
  });
  return [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

function registroTwilio(registros, { desde, hasta, zona, formato }) {
  const dias = resumenPorDia(registros, zona);
  const rango = `${formatoFecha(desde.getTime(), zona).slice(0, 10)}_a_${formatoFecha(hasta.getTime(), zona).slice(0, 10)}`;
  const encabezados = ["SID", "A (To)", "De (From)", "Dirección", "Estado", "Duración (seg)", "Precio (USD)", "Contestó", "Creada", "Inicio", "Fin"];
  if (formato === "csv") {
    const csv = construirCsv(encabezados, registros.map((x) => [
      x.sid, x.para, x.de, x.direccion, x.estado, x.duracion === null ? "" : x.duracion, x.precio === null ? "" : x.precio.toFixed(4), x.contestadoPor,
      formatoFecha(x.creada, zona), formatoFecha(x.inicio, zona), formatoFecha(x.fin, zona),
    ]));
    return { nombre: `twilio_llamadas_${rango}.csv`, tipo: TIPO_CSV, buffer: Buffer.from(csv, "utf8") };
  }
  const hojaDias = {
    nombre: "Resumen por día", color: "FF1B6EF3",
    columnas: [
      { titulo: "Día", ancho: 14 }, { titulo: "Llamadas", ancho: 11, estilo: E.miles }, { titulo: "Contestadas (con duración)", ancho: 22, estilo: E.miles }, { titulo: "% contestadas", ancho: 14, estilo: E.porcentaje },
      { titulo: "No contestó", ancho: 12, estilo: E.miles }, { titulo: "Ocupado", ancho: 10, estilo: E.miles }, { titulo: "Fallidas", ancho: 10, estilo: E.miles }, { titulo: "Canceladas", ancho: 12, estilo: E.miles },
      { titulo: "Minutos facturables aprox.", ancho: 22, estilo: E.decimal }, { titulo: "Costo (USD)", ancho: 13, estilo: E.moneda },
    ],
    filas: dias.map((d) => [d.dia, d.total, d.contestadas, d.total ? porcentaje(d.contestadas, d.total) / 100 : 0, d["no-answer"], d.busy, d.failed, d.canceled, Math.round((d.segundos / 60) * 10) / 10, d.costo]),
    congelar: { filas: 1 },
  };
  const hojaLlamadas = {
    nombre: "Llamadas", color: "FF188038",
    columnas: [
      { titulo: "SID", ancho: 38 }, { titulo: "A (To)", ancho: 17 }, { titulo: "De (From)", ancho: 17 }, { titulo: "Dirección", ancho: 14 }, { titulo: "Estado", ancho: 12 },
      { titulo: "Duración (seg)", ancho: 14, estilo: E.entero }, { titulo: "Precio (USD)", ancho: 13, estilo: E.moneda }, { titulo: "Contestó", ancho: 18 },
      { titulo: "Creada", ancho: 20, estilo: E.fecha }, { titulo: "Inicio", ancho: 20, estilo: E.fecha }, { titulo: "Fin", ancho: 20, estilo: E.fecha },
    ],
    filas: registros.map((x) => [x.sid, x.para, x.de, x.direccion, x.estado, x.duracion, x.precio, x.contestadoPor, x.creada ? serialLocal(x.creada, zona) : null, x.inicio ? serialLocal(x.inicio, zona) : null, x.fin ? serialLocal(x.fin, zona) : null]),
    congelar: { filas: 1 }, autofiltro: true,
  };
  return { nombre: `twilio_llamadas_${rango}.xlsx`, tipo: TIPO_XLSX, buffer: crearXlsx({ titulo: "Registro de llamadas de Twilio", hojas: [hojaDias, hojaLlamadas] }) };
}

module.exports = { catalogo, descarga, registroTwilio, xlsxCampana, listaAudios, nombreAudio, csvErrores, csvInvalidos, baseNombre, ctxDe, TIPO_CSV, TIPO_XLSX, TIPO_ZIP, etiquetaCat, crearZipBuffer };
