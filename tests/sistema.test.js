"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { crearEntorno, hasta, esperar, leerZip, contactos } = require("./ayuda");

function escucharEventos(url, ruta, cabeceras = {}) {
  const eventos = [];
  let buffer = "";
  const req = http.get(`${url}${ruta}`, { headers: cabeceras }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (trozo) => {
      buffer += trozo;
      let corte;
      while ((corte = buffer.indexOf("\n\n")) >= 0) {
        const bloque = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        const tipo = /^event: (.+)$/m.exec(bloque);
        const datos = /^data: (.+)$/m.exec(bloque);
        if (tipo && datos) eventos.push({ tipo: tipo[1], datos: JSON.parse(datos[1]) });
      }
    });
  });
  req.on("error", () => {});
  return { eventos, cerrar: () => req.destroy() };
}

test("tiempo real: la pantalla recibe la instantánea y cada cambio", async () => {
  const e = await crearEntorno();
  try {
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: contactos(12, { inicio: 300 }), modoAudio: "tts", mensaje: "Hola", concurrencia: 4, cps: 30 });
    const id = crear.json.id;
    const flujo = escucharEventos(e.urlApp, `/api/campanas/${id}/eventos`);
    await hasta(() => flujo.eventos.some((x) => x.tipo === "listo"), { mensaje: "instantánea inicial" });
    const tipos = flujo.eventos.map((x) => x.tipo);
    assert.deepEqual(tipos.slice(0, 2), ["instantanea", "resumen"]);
    assert.ok(tipos.includes("filas"));
    const inicial = flujo.eventos.filter((x) => x.tipo === "filas").reduce((n, x) => n + x.datos.filas.length, 0);
    assert.equal(inicial, 12, "la instantánea trae todas las filas");

    await hasta(() => flujo.eventos.some((x) => x.tipo === "resumen" && x.datos.estado === "completada"), { tiempo: 30000, mensaje: "campaña completada por SSE" });
    const resumenes = flujo.eventos.filter((x) => x.tipo === "resumen");
    assert.ok(resumenes.length >= 3, "llegaron varias actualizaciones");
    const ultimo = resumenes[resumenes.length - 1].datos;
    assert.equal(ultimo.progreso, 100);
    flujo.cerrar();

    const global = escucharEventos(e.urlApp, "/api/eventos");
    await hasta(() => global.eventos.some((x) => x.tipo === "lista-completa"), { mensaje: "lista global" });
    assert.equal(global.eventos[0].datos.campanas.length, 1);
    global.cerrar();
  } finally {
    await e.cerrarTodo();
  }
});

test("WhatsApp: envía, confirma entrega y explica el error", async () => {
  const e = await crearEntorno();
  try {
    const crear = await e.pedir("POST", "/api/campanas/whatsapp", { csvTexto: contactos(10, { inicio: 400 }), mensaje: "Hola {nombre}", concurrencia: 5 });
    assert.equal(crear.estado, 201, JSON.stringify(crear.json));
    const fin = await hasta(async () => {
      const r = (await e.pedir("GET", `/api/campanas/${crear.json.id}?filas=0`)).json.resumen;
      return r.estado === "completada" && r.cuenta.en_curso === 0 ? r : null;
    }, { tiempo: 30000, mensaje: "WhatsApp completado" });
    assert.equal(fin.cuenta.contesto, 9);
    assert.equal(fin.cuenta.fallida, 1);
    assert.equal(fin.mensajes.entregados, 9);
    assert.ok(fin.incidencias.some((x) => x.codigo === "63024"));
    const csv = (await e.pedir("GET", `/api/campanas/${crear.json.id}/descargas/todo`)).buffer.toString("utf8");
    assert.ok(csv.includes("¿Entregado?"));
  } finally {
    await e.cerrarTodo();
  }
});

test("acceso con usuario y contraseña; Twilio y los audios siguen abiertos", async () => {
  const e = await crearEntorno({ seguridad: { usuario: "admin", clave: "secreta", activa: true } });
  try {
    assert.equal((await e.pedir("GET", "/api/campanas")).estado, 401);
    assert.equal((await e.pedir("GET", "/")).estado, 401);
    const bien = `Basic ${Buffer.from("admin:secreta").toString("base64")}`;
    const mal = `Basic ${Buffer.from("admin:incorrecta").toString("base64")}`;
    assert.equal((await e.pedir("GET", "/api/campanas", undefined, { Authorization: mal })).estado, 401);
    assert.equal((await e.pedir("GET", "/api/campanas", undefined, { Authorization: bien })).estado, 200);
    assert.equal((await e.pedir("GET", "/api/salud")).estado, 200);
    assert.equal((await e.pedir("POST", "/api/webhooks/call-status", undefined)).estado, 204);
    assert.equal((await e.pedir("GET", "/audio/generado/no-existe.mp3")).estado, 404);
  } finally {
    await e.cerrarTodo();
  }
});

test("diagnóstico completo de Twilio, ElevenLabs y servidor", async () => {
  const e = await crearEntorno();
  try {
    const r = (await e.pedir("GET", "/api/diagnostico?profundo=1")).json;
    const por = Object.fromEntries(r.items.map((x) => [x.id, x]));
    for (const id of ["twilio-cuenta", "twilio-saldo", "twilio-numero", "twilio-geo", "eleven-plan", "eleven-voces", "url-publica"]) {
      assert.equal(por[id].estado, "ok", `${id}: ${por[id] && por[id].detalle}`);
    }
    assert.equal(por.seguridad.estado, "aviso", "avisa que el panel no tiene contraseña");
    assert.match(por["twilio-saldo"].detalle, /25\.50 USD/);

    e.twilioFalso.saldo = "0.2000";
    const bajo = (await e.pedir("GET", "/api/diagnostico?profundo=1")).json.items.find((x) => x.id === "twilio-saldo");
    assert.equal(bajo.estado, "error");
  } finally {
    await e.cerrarTodo();
  }
});

test("diagnóstico con credenciales de Twilio incorrectas explica el problema", async () => {
  const e = await crearEntorno({ twilioConfig: {} });
  try {
    e.twilioFalso.authToken = "otro_token";
    const items = (await e.pedir("GET", "/api/diagnostico?profundo=1")).json.items;
    const cuenta = items.find((x) => x.id === "twilio-cuenta");
    assert.equal(cuenta.estado, "error");
    assert.match(cuenta.detalle, /20003|credenciales|autenticaci/i);
  } finally {
    await e.cerrarTodo();
  }
});

test("voces: lista de la cuenta, 15 recomendadas, agregar y muestra con Range", async () => {
  const e = await crearEntorno();
  try {
    const voces = (await e.pedir("GET", "/api/voces")).json;
    assert.equal(voces.disponible, true);
    assert.deepEqual(voces.voces.map((v) => v.nombre).sort(), ["Alice", "Bill", "Brian", "Voz de pago"]);
    assert.equal(voces.aviso, null);

    const rec = (await e.pedir("GET", "/api/voces/recomendadas?n=15")).json;
    assert.equal(rec.voces.length, 15);
    assert.equal(rec.voces[0].origen, "biblioteca");
    assert.ok(rec.voces[0].publicOwnerId);

    const agregada = await e.pedir("POST", "/api/voces/agregar", { publicOwnerId: rec.voces[0].publicOwnerId, vozId: rec.voces[0].id, nombre: rec.voces[0].nombre });
    assert.equal(agregada.estado, 200);
    assert.equal(agregada.json.vozId, rec.voces[0].id);

    const muestra = await e.pedir("POST", "/api/voces/muestra", { vozId: "VozUnoAAAAAAAAAAAAAA", texto: "Hola, esto es una prueba" });
    assert.equal(muestra.estado, 200);
    assert.match(muestra.json.url, /^\/audio\/generado\/[a-f0-9]{40}\.mp3$/);
    const rango = await e.pedir("GET", muestra.json.url, undefined, { Range: "bytes=0-99" });
    assert.equal(rango.estado, 206);
    assert.equal(rango.buffer.length, 100);
    const repetida = await e.pedir("POST", "/api/voces/muestra", { vozId: "VozUnoAAAAAAAAAAAAAA", texto: "Hola, esto es una prueba" });
    assert.equal(repetida.json.nuevo, false, "la misma muestra no vuelve a gastar créditos");

    const pago = await e.pedir("POST", "/api/voces/muestra", { vozId: "MALAvozDDDDDDDDDDDDD" });
    assert.ok(pago.estado >= 400);
    assert.match(pago.json.error, /plan|pago|library|biblioteca/i);

    const malo = await e.pedir("POST", "/api/voces/muestra", { vozId: "x" });
    assert.equal(malo.estado, 400);
  } finally {
    await e.cerrarTodo();
  }
});

test("voces: si ElevenLabs rechaza la API key se muestran las predeterminadas con la explicación", async () => {
  const e = await crearEntorno({ claveEleven: "clave_mala" });
  try {
    const voces = (await e.pedir("GET", "/api/voces")).json;
    assert.equal(voces.voces.length, 18, "17 predeterminadas más la voz del servidor");
    assert.ok(voces.aviso);
    assert.match(voces.aviso.detalle, /API key/i);
    const rec = (await e.pedir("GET", "/api/voces/recomendadas")).json;
    assert.equal(rec.voces.length, 0);
    assert.ok(rec.aviso);
  } finally {
    await e.cerrarTodo();
  }
});

test("una campaña con ElevenLabs sin pago se detiene antes de marcar y se puede reanudar", async () => {
  const e = await crearEntorno();
  try {
    e.eleven.sinPago = true;
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: contactos(6, { inicio: 500 }), modoAudio: "voces", mensaje: "Hola {nombre}", voces: ["VozUnoAAAAAAAAAAAAAA"], concurrencia: 3 });
    const r = await hasta(async () => {
      const x = (await e.pedir("GET", `/api/campanas/${crear.json.id}?filas=0`)).json.resumen;
      return x.estado === "detenida" ? x : null;
    }, { mensaje: "detenida por pago" });
    assert.equal(r.marcadas, 0, "no se hizo ninguna llamada");
    assert.ok(r.incidencias.some((x) => x.fuente === "elevenlabs" && /pago|payment/i.test(x.titulo + x.detalle)));
    assert.equal(r.cuenta.omitido, 6);
    e.eleven.sinPago = false;
    const rean = await e.pedir("POST", `/api/campanas/${crear.json.id}/reanudar`);
    assert.equal(rean.estado, 200);
    const fin = await hasta(async () => {
      const x = (await e.pedir("GET", `/api/campanas/${crear.json.id}?filas=0`)).json.resumen;
      return x.estado === "completada" ? x : null;
    }, { tiempo: 30000, mensaje: "completada tras reanudar" });
    assert.equal(fin.cuenta.omitido, 0);
    assert.equal(fin.marcadas + fin.cuenta.error, 6);
  } finally {
    await e.cerrarTodo();
  }
});

test("registro de la cuenta de Twilio, plantilla de reintento y borrado", async () => {
  const e = await crearEntorno();
  try {
    const crear = await e.pedir("POST", "/api/campanas/llamadas", { csvTexto: contactos(10, { inicio: 600 }), modoAudio: "tts", mensaje: "Hola", concurrencia: 5, cps: 30 });
    const id = crear.json.id;
    await hasta(async () => (await e.pedir("GET", `/api/campanas/${id}?filas=0`)).json.resumen.estado === "completada", { tiempo: 30000, mensaje: "completada" });

    const resumen = (await e.pedir("GET", "/api/twilio/registro?formato=json")).json;
    assert.ok(resumen.total >= 9);
    const xlsx = await e.pedir("GET", "/api/twilio/registro?formato=xlsx");
    assert.equal(xlsx.estado, 200);
    const libro = leerZip(xlsx.buffer).get("xl/workbook.xml").toString("utf8");
    assert.ok(libro.includes("Resumen por día") && libro.includes('name="Llamadas"'));

    const plantilla = (await e.pedir("GET", `/api/campanas/${id}/plantilla?lista=reintentar`)).json;
    assert.ok(plantilla.cantidad > 0);
    assert.ok(plantilla.csvTexto.startsWith("numero,nombre"));
    assert.equal(plantilla.config.modoAudio, "tts");
    const prev = await e.pedir("POST", "/api/contactos/previsualizar", { csvTexto: plantilla.csvTexto });
    assert.equal(prev.json.validos, plantilla.cantidad, "la lista de reintento se puede volver a cargar tal cual");

    const fila = (await e.pedir("GET", `/api/campanas/${id}/filas/0`)).json;
    assert.ok(fila.twilio && fila.twilio.sid, "detalle directo de Twilio");

    assert.equal((await e.pedir("DELETE", `/api/campanas/${id}`)).estado, 200);
    assert.equal((await e.pedir("GET", `/api/campanas/${id}`)).estado, 404);
    await esperar(50);
  } finally {
    await e.cerrarTodo();
  }
});
