"use strict";
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const zlib = require("zlib");

const configBase = require("../lib/config");
const { iniciar } = require("../server");
const { crearServicioVoces } = require("../elevenlabs");
const { FalsoTwilio } = require("./falso-twilio");
const { FalsoEleven } = require("./falso-eleven");
const { crc32 } = require("../lib/zip");

function puertoLibre() {
  return new Promise((ok, fallo) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
    s.on("error", fallo);
  });
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hasta(condicion, { tiempo = 20000, cada = 50, mensaje = "condición" } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < tiempo) {
    const valor = await condicion();
    if (valor) return valor;
    await esperar(cada);
  }
  throw new Error(`Se agotó el tiempo esperando: ${mensaje}`);
}

async function crearEntorno(opciones = {}) {
  const raiz = opciones.raiz || fs.mkdtempSync(path.join(os.tmpdir(), "llamadas-prueba-"));
  const puerto = opciones.puerto || await puertoLibre();
  const eleven = opciones.eleven || new FalsoEleven(opciones.elevenOpciones);
  if (!eleven.url) await eleven.iniciar();
  const urlApp = `http://127.0.0.1:${puerto}`;
  const twilioFalso = opciones.twilioFalso || new FalsoTwilio({ urlApp, velocidad: 0.12, ...(opciones.twilio || {}) });

  const cfg = {
    ...configBase,
    PORT: puerto,
    dirPublic: path.join(configBase.raiz, "public"),
    dirAudio: path.join(raiz, "audio"),
    dirAudioGenerado: path.join(raiz, "audio", "generado"),
    dirDatos: path.join(raiz, "data"),
    publicBaseUrl: urlApp,
    usaLocalhost: false,
    twilio: { ...configBase.twilio, accountSid: twilioFalso.accountSid, authToken: twilioFalso.authToken, fromNumber: "+526567380528", validarFirma: false, ...(opciones.twilioConfig || {}) },
    elevenlabs: { ...configBase.elevenlabs, apiKey: opciones.claveEleven || "clave_buena", baseUrl: eleven.url, vozPredeterminada: "VozUnoAAAAAAAAAAAAAA" },
    llamadas: { ...configBase.llamadas, porSegundo: 30, liberarSinContestarMs: 1500, esperaMaximaMs: 15000, ...(opciones.llamadas || {}) },
    autoPausa: { ...configBase.autoPausa, ...(opciones.autoPausa || {}) },
    seguridad: { usuario: "", clave: "", activa: false, ...(opciones.seguridad || {}) },
  };
  fs.mkdirSync(cfg.dirAudioGenerado, { recursive: true });

  const entorno = { raiz, cfg, eleven, twilioFalso, urlApp, puerto, sistema: null };

  entorno.arrancar = () => {
    const voces = crearServicioVoces({
      apiKey: cfg.elevenlabs.apiKey, baseUrl: eleven.url, modelId: cfg.elevenlabs.modelId, formato: cfg.elevenlabs.formato, ajustesVoz: cfg.elevenlabs.ajustesVoz,
      directorio: cfg.dirAudioGenerado, publicBaseUrl: cfg.publicBaseUrl, concurrencia: 3, esperaBaseMs: 5,
    });
    entorno.sistema = iniciar({ config: cfg, client: twilioFalso.cliente, voces, almacen: { retardoMs: 50 }, host: "127.0.0.1" });
    entorno.g = entorno.sistema.g;
    entorno.g.datos.umbralReciente = 800;
    entorno.g.datos.umbralAntiguo = 400;
    return new Promise((ok) => entorno.sistema.servidor.on("listening", ok));
  };
  entorno.parar = async () => {
    if (entorno.sistema) await entorno.sistema.cerrar();
    entorno.sistema = null;
  };
  entorno.reiniciar = async () => { await entorno.parar(); await entorno.arrancar(); };
  entorno.cerrarTodo = async () => {
    await entorno.parar();
    twilioFalso.detener();
    await eleven.cerrar();
    await esperar(150);
    fs.rmSync(raiz, { recursive: true, force: true });
  };
  entorno.pedir = (metodo, ruta, cuerpo, cabeceras) => pedir(urlApp, metodo, ruta, cuerpo, cabeceras);
  await entorno.arrancar();
  return entorno;
}

function pedir(base, metodo, ruta, cuerpo, cabeceras = {}) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : Buffer.from(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo));
    const req = http.request(`${base}${ruta}`, { method: metodo, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": datos.length } : {}), ...cabeceras } }, (res) => {
      const partes = [];
      res.on("data", (p) => partes.push(p));
      res.on("end", () => {
        const buffer = Buffer.concat(partes);
        let json = null;
        if (/json/.test(res.headers["content-type"] || "")) {
          let texto = buffer;
          if (res.headers["content-encoding"] === "gzip") texto = zlib.gunzipSync(buffer);
          try { json = JSON.parse(texto.toString("utf8")); } catch (e) { json = null; }
        }
        resolve({ estado: res.statusCode, cabeceras: res.headers, buffer, json });
      });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

function leerZip(buffer) {
  let fin = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("No es un ZIP válido (falta el final del directorio)");
  const cantidad = buffer.readUInt16LE(fin + 10);
  let pos = buffer.readUInt32LE(fin + 16);
  const entradas = new Map();
  for (let k = 0; k < cantidad; k += 1) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Directorio central dañado");
    const metodo = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const tamC = buffer.readUInt32LE(pos + 20);
    const tam = buffer.readUInt32LE(pos + 24);
    const largoNombre = buffer.readUInt16LE(pos + 28);
    const extra = buffer.readUInt16LE(pos + 30);
    const comentario = buffer.readUInt16LE(pos + 32);
    const desplazamiento = buffer.readUInt32LE(pos + 42);
    const nombre = buffer.slice(pos + 46, pos + 46 + largoNombre).toString("utf8");
    const inicioDatos = desplazamiento + 30 + buffer.readUInt16LE(desplazamiento + 26) + buffer.readUInt16LE(desplazamiento + 28);
    const crudo = buffer.slice(inicioDatos, inicioDatos + tamC);
    const datos = metodo === 8 ? zlib.inflateRawSync(crudo) : crudo;
    if (datos.length !== tam) throw new Error(`Tamaño incorrecto en ${nombre}`);
    if (crc32(datos) !== crc) throw new Error(`CRC incorrecto en ${nombre}`);
    entradas.set(nombre, datos);
    pos += 46 + largoNombre + extra + comentario;
  }
  return entradas;
}

function contactos(cantidad, { inicio = 0, nombres = true } = {}) {
  const filas = [];
  for (let i = 0; i < cantidad; i += 1) {
    const n = inicio + i;
    filas.push(`+52656${String(1000000 + n).slice(-7)},${nombres ? `Persona ${n}` : ""}`);
  }
  return `numero,nombre\n${filas.join("\n")}\n`;
}

module.exports = { crearEntorno, pedir, hasta, esperar, leerZip, contactos, puertoLibre };
