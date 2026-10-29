"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, hasta, leerZip, contactos } = require("./ayuda");

const VOCES = ["VozUnoAAAAAAAAAAAAAA", "MALAvozDDDDDDDDDDDDD"];

async function esperarFin(entorno, id, estados = ["completada"]) {
  return hasta(async () => {
    const r = await entorno.pedir("GET", `/api/campanas/${id}?filas=0`);
    return estados.includes(r.json.resumen.estado) ? r.json : null;
  }, { tiempo: 40000, mensaje: `campaña ${id} en estado ${estados.join("/")}` });
}

test("previsualiza contactos y detecta inválidos y duplicados", async () => {
  const e = await crearEntorno();
  try {
    const csv = `numero,nombre\n6561234567,Ana\n+526561234567,Ana repetida\n12345,Mal\n,Vacío\n(656) 777-8899,Luis\n`;
    const r = await e.pedir("POST", "/api/contactos/previsualizar", { csvTexto: csv });
    assert.equal(r.estado, 200);
    assert.equal(r.json.validos, 2);
    assert.equal(r.json.duplicados, 1);
    assert.ok(r.json.invalidos >= 2);
    assert.equal(r.json.muestra[0].numero, "+526561234567");
  } finally {
    await e.cerrarTodo();
  }
});

test("campaña completa con voces, avisos perdidos, errores y descargas", async () => {
  const e = await crearEntorno();
  try {
    const sinCuerpo = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: "numero\n", modoAudio: "voces", mensaje: "Hola" });
    assert.equal(sinCuerpo.estado, 400);

    const csv = contactos(20);
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { nombre: "Prueba", csvTexto: csv, modoAudio: "voces", mensaje: "Hola {nombre}, es un mensaje de prueba.", voces: VOCES, concurrencia: 5, cps: 30 });
    assert.equal(crear.estado, 201, JSON.stringify(crear.json));
    const id = crear.json.id;

    const otra = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: contactos(2), modoAudio: "tts", mensaje: "Hola" });
    assert.equal(otra.estado, 409);

    const fin = await esperarFin(e, id);
    const r = fin.resumen;
    assert.equal(r.total, 20);
    const esperados = { contesto: 0, no_contesto: 0, ocupado: 0, fallida: 0, error: 0 };
    for (let n = 0; n < 20; n += 1) {
      const d = n % 10;
      if (d <= 4 || d === 8) esperados.contesto += 1;
      else if (d === 5) esperados.no_contesto += 1;
      else if (d === 6) esperados.ocupado += 1;
      else if (d === 7) esperados.fallida += 1;
      else esperados.error += 1;
    }
    for (const [cat, n] of Object.entries(esperados)) assert.equal(r.cuenta[cat], n, `categoría ${cat}`);
    assert.equal(r.cuenta.en_curso, 0);
    assert.equal(r.progreso, 100);

    assert.ok(e.twilioFalso.maxActivas <= 5, `máximo simultáneas ${e.twilioFalso.maxActivas}`);
    assert.ok(e.twilioFalso.maxActivas >= 3, `se aprovechó la concurrencia (${e.twilioFalso.maxActivas})`);

    const creaciones = e.twilioFalso.solicitudes.filter((s) => s.metodo === "post" && /\/Calls\.json$/.test(s.uri));
    assert.ok(creaciones.length >= 18);
    const primera = creaciones[0].datos;
    assert.equal(primera.From, "+526567380528");
    assert.match(primera.Twiml, /<Play>http:\/\/127\.0\.0\.1:\d+\/audio\/generado\/[a-f0-9]{40}\.mp3<\/Play>/);
    assert.equal(primera.Timeout, 40);
    assert.deepEqual(primera.StatusCallbackEvent, ["initiated", "ringing", "answered", "completed"]);
    assert.match(primera.StatusCallback, /\/api\/webhooks\/call-status$/);

    const detalle = (await e.pedir("GET", `/api/campanas/${id}`)).json;
    const contestadas = detalle.filas.filter((f) => f.cat === "contesto");
    assert.ok(contestadas.every((f) => f.duracion === 3), `duraciones: ${contestadas.map((f) => f.duracion)}`);
    assert.ok(detalle.filas.every((f) => f.voz === "Alice" || !f.voz), "todos los contactos terminaron con una voz que funciona");
    const conError = detalle.filas.find((f) => f.cat === "error");
    assert.equal(conError.inc.codigo, "21211");
    const fallida = detalle.filas.find((f) => f.cat === "fallida");
    assert.equal(fallida.sip, "404");
    assert.ok(r.incidencias.some((x) => x.codigo === "21211"));
    assert.ok(r.incidencias.some((x) => x.fuente === "elevenlabs"), "la voz de pago quedó anotada como incidencia");

    assert.ok(contestadas.every((f) => f.tContesta > 0), "las contestadas tienen hora de contestación");
    const sinConexion = detalle.filas.filter((f) => ["fallida", "no_contesto", "ocupado", "error"].includes(f.cat));
    assert.ok(sinConexion.length >= 8);
    assert.ok(sinConexion.every((f) => !f.tContesta), `llamadas sin conexión con hora de contestación: ${sinConexion.filter((f) => f.tContesta).map((f) => f.cat)}`);
    const rechazadas = r.motivosFallo.find((m) => m.codigo === "21211");
    assert.ok(rechazadas && rechazadas.cantidad === esperados.error, "las rechazadas por Twilio aparecen entre los motivos de falla");

    await e.g.datos.enriquecer(e.g, e.g.obtener(id), true);
    const despues = (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen;
    assert.ok(despues.costo > 0, "costo calculado");
    assert.ok(despues.incidencias.some((x) => x.codigo === "32011"), "código exacto de Twilio para la falla");

    const catalogo = (await e.pedir("GET", `/api/campanas/${id}/descargas`)).json.descargas;
    const claves = catalogo.map((d) => d.id);
    for (const k of ["excel", "todo", "respondieron", "no_respondieron", "fallidas", "sin_marcar", "reintentar", "twilio", "errores", "audios", "respaldo"]) assert.ok(claves.includes(k), `falta descarga ${k}`);

    const csvResp = await e.pedir("GET", `/api/campanas/${id}/descargas/respondieron`);
    assert.equal(csvResp.estado, 200);
    assert.match(csvResp.cabeceras["content-disposition"], /attachment; filename="[^"]+_respondieron\.csv"/);
    const lineas = csvResp.buffer.toString("utf8").replace(/^﻿/, "").trim().split(/\r\n/);
    assert.equal(lineas.length - 1, esperados.contesto);
    assert.ok(lineas[0].includes("Duración (seg)"));

    const reintentar = (await e.pedir("GET", `/api/campanas/${id}/descargas/reintentar`)).buffer.toString("utf8").trim().split(/\r\n/);
    assert.equal(reintentar.length - 1, esperados.no_contesto + esperados.ocupado);

    const excel = await e.pedir("GET", `/api/campanas/${id}/descargas/excel`);
    assert.equal(excel.estado, 200);
    const xlsx = leerZip(excel.buffer);
    assert.ok(xlsx.has("xl/workbook.xml") && xlsx.has("xl/styles.xml"));
    const libro = xlsx.get("xl/workbook.xml").toString("utf8");
    for (const hoja of ["Resumen", "Detalle", "Respondieron", "No respondieron", "Fallidas", "Sin marcar", "Por voz", "Errores", "Audios"]) assert.ok(libro.includes(`name="${hoja}"`), `hoja ${hoja}`);
    assert.ok(xlsx.get("xl/worksheets/sheet1.xml").toString("utf8").includes("COUNTIF"));

    const zipAudios = await e.pedir("GET", `/api/campanas/${id}/descargas/audios`);
    assert.equal(zipAudios.estado, 200);
    assert.equal(Number(zipAudios.cabeceras["content-length"]), zipAudios.buffer.length);
    const audios = leerZip(zipAudios.buffer);
    assert.ok(audios.has("indice_audios.csv"));
    const mp3 = [...audios.keys()].filter((k) => k.endsWith(".mp3"));
    assert.equal(mp3.length, 20, "un audio por contacto (el nombre cambia en cada mensaje)");
    assert.ok(mp3[0].startsWith("audios/alice/"));

    const respaldo = leerZip((await e.pedir("GET", `/api/campanas/${id}/descargas/respaldo`)).buffer);
    assert.ok(respaldo.has("reporte.xlsx") && respaldo.has("datos/campana.json") && respaldo.has("csv/respondieron.csv"));
  } finally {
    await e.cerrarTodo();
  }
});

test("pausar, reanudar y detener sin perder contactos", async () => {
  const e = await crearEntorno({ twilio: { duracionLlamada: 6 } });
  try {
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: contactos(40, { inicio: 100 }), modoAudio: "tts", mensaje: "Hola", concurrencia: 3, cps: 30 });
    const id = crear.json.id;
    await hasta(async () => (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen.marcadas >= 3, { mensaje: "primeras llamadas" });

    assert.equal((await e.pedir("POST", `/api/campanas/${id}/pausar`)).estado, 200);
    await new Promise((r) => setTimeout(r, 400));
    const marcadasPausa = (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen.marcadas;
    await new Promise((r) => setTimeout(r, 1200));
    const sigue = (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen;
    assert.equal(sigue.estado, "pausada");
    assert.equal(sigue.marcadas, marcadasPausa, "en pausa no se marca nada nuevo");

    assert.equal((await e.pedir("POST", `/api/campanas/${id}/ajustar`, { concurrencia: 10 })).estado, 200);
    assert.equal((await e.pedir("POST", `/api/campanas/${id}/reanudar`)).estado, 200);
    await hasta(async () => (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen.marcadas > marcadasPausa + 2, { mensaje: "se reanuda" });

    const stop = await e.pedir("POST", `/api/campanas/${id}/detener`);
    assert.equal(stop.estado, 200);
    const detenida = (await esperarFin(e, id, ["detenida"])).resumen;
    assert.ok(detenida.omitidos > 0, "quedaron contactos sin marcar");
    assert.ok(detenida.reanudable);

    const reanudada = await e.pedir("POST", `/api/campanas/${id}/reanudar`);
    assert.equal(reanudada.estado, 200);
    const fin = (await esperarFin(e, id)).resumen;
    assert.equal(fin.cuenta.pendiente + fin.cuenta.omitido + fin.cuenta.en_curso, 0);
    assert.equal(fin.total, 40);
    const creaciones = e.twilioFalso.solicitudes.filter((s) => s.metodo === "post" && /\/Calls\.json$/.test(s.uri)).map((s) => s.datos.To);
    assert.equal(new Set(creaciones).size, creaciones.length, "sin llamadas duplicadas");
  } finally {
    await e.cerrarTodo();
  }
});

test("se pausa sola cuando casi todas las llamadas fallan", async () => {
  const e = await crearEntorno();
  try {
    const filas = Array.from({ length: 60 }, (_, i) => `+52656${String(2000007 + i * 10).slice(-7)},Falla ${i}`).join("\n");
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: `numero,nombre\n${filas}\n`, modoAudio: "tts", mensaje: "Hola", concurrencia: 8, cps: 30 });
    assert.equal(crear.estado, 201);
    const c = await esperarFin(e, crear.json.id, ["pausada"]);
    assert.ok(c.resumen.aviso && c.resumen.aviso.nivel === "error");
    assert.match(c.resumen.aviso.texto, /fallaron/);
    assert.ok(c.resumen.cuenta.fallida >= 20);
    assert.ok(c.resumen.pendientes > 0, "quedaron contactos sin gastar");
    await e.pedir("POST", `/api/campanas/${crear.json.id}/detener`);
  } finally {
    await e.cerrarTodo();
  }
});

test("recupera una campaña tras reiniciar el servidor sin volver a marcar", async () => {
  const e = await crearEntorno({ twilio: { duracionLlamada: 4 } });
  try {
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: contactos(30, { inicio: 200 }), modoAudio: "tts", mensaje: "Hola", concurrencia: 4, cps: 30 });
    const id = crear.json.id;
    await hasta(async () => (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen.terminadas >= 6, { mensaje: "avance" });
    await e.reiniciar();
    const tras = (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen;
    assert.equal(tras.estado, "interrumpida");
    assert.ok(tras.reanudable);
    const rec = await e.pedir("POST", `/api/campanas/${id}/reanudar`);
    assert.equal(rec.estado, 200, JSON.stringify(rec.json));
    const fin = (await esperarFin(e, id)).resumen;
    assert.equal(fin.total, 30);
    assert.equal(fin.cuenta.pendiente + fin.cuenta.omitido + fin.cuenta.en_curso, 0);
    const marcados = e.twilioFalso.solicitudes.filter((s) => s.metodo === "post" && /\/Calls\.json$/.test(s.uri)).map((s) => s.datos.To);
    assert.equal(new Set(marcados).size, marcados.length, "ningún número recibió dos llamadas");
  } finally {
    await e.cerrarTodo();
  }
});
