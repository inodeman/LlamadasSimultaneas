"use strict";
const fs = require("fs");
const path = require("path");
const { parsearContactos, limpiarTexto, construirMensaje, esUrlHttp } = require("./util");
const { ID_VOZ } = require("../elevenlabs");

function error400(mensaje, extra) {
  const err = new Error(mensaje);
  err.status = 400;
  if (extra) Object.assign(err, extra);
  return err;
}

function entero(valor, defecto, minimo, maximo) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n)) return defecto;
  return Math.min(maximo, Math.max(minimo, n));
}

function decimal(valor, defecto, minimo, maximo) {
  const n = parseFloat(valor);
  if (!Number.isFinite(n)) return defecto;
  return Math.min(maximo, Math.max(minimo, n));
}

function leerContactos(body, cfg) {
  const csv = typeof body.csvTexto === "string" ? body.csvTexto : "";
  const texto = typeof body.texto === "string" ? body.texto : "";
  const contenido = csv.trim() ? csv : texto;
  if (!contenido.trim()) throw error400("Sube un archivo CSV o pega los números de teléfono.");
  if (contenido.length > 3 * 1024 * 1024) {
    const err = error400("El archivo es demasiado grande (máximo 3 MB). Divídelo en partes.");
    err.status = 413;
    throw err;
  }
  const codigoPais = String(body.codigoPais || cfg.defaultCountryCode).replace(/\D/g, "").slice(0, 3) || cfg.defaultCountryCode;
  return parsearContactos(csv.trim() ? { csvTexto: csv } : { texto }, { codigoPais });
}

function previsualizar(body, g) {
  const lec = leerContactos(body, g.cfg);
  const conNombre = lec.contactos.filter((c) => c.nombre).length;
  return {
    totalFilas: lec.totalFilas,
    validos: lec.contactos.length,
    invalidos: lec.invalidos.length,
    duplicados: lec.duplicados.length,
    conNombre,
    sinNombre: lec.contactos.length - conNombre,
    motivos: lec.motivosInvalidos,
    muestra: lec.contactos.slice(0, 8).map((c) => ({ numero: c.numero, nombre: c.nombre })),
    ejemplosInvalidos: lec.invalidos.slice(0, 50),
    excedeLimite: lec.contactos.length > g.cfg.limites.maxContactos,
    limite: g.cfg.limites.maxContactos,
  };
}

function estimarAudios(contactos, mensaje, voces, servicio) {
  const vistos = new Set();
  let nuevos = 0;
  let reutilizados = 0;
  let caracteres = 0;
  contactos.forEach((c, i) => {
    const vozId = voces[i % voces.length];
    const texto = construirMensaje(mensaje, c.nombre);
    if (!texto) return;
    const clave = `${vozId}|${texto}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    if (servicio.existeAudio(vozId, texto)) {
      reutilizados += 1;
    } else {
      nuevos += 1;
      caracteres += texto.length;
    }
  });
  return {
    audiosUnicos: vistos.size, nuevos, reutilizados, caracteres,
    ejemplo: contactos.length ? construirMensaje(mensaje, contactos[0].nombre) : "",
  };
}

function resolverVoces(body, g) {
  const pedidas = Array.isArray(body.voces) ? body.voces : (body.vozId ? [body.vozId] : []);
  const limpias = [...new Set(pedidas.map((v) => String(v || "").trim()).filter(Boolean))];
  const invalidas = limpias.filter((v) => !ID_VOZ.test(v));
  if (invalidas.length) throw error400(`Identificador de voz no válido: ${invalidas[0]}`);
  if (limpias.length > g.cfg.limites.maxVoces) throw error400(`Elige máximo ${g.cfg.limites.maxVoces} voces.`);
  return limpias.length ? limpias : [g.cfg.elevenlabs.vozPredeterminada];
}

function resolverAudioFijo(body, g) {
  const cfg = g.cfg;
  if (body.archivoAudio) {
    const nombre = path.basename(String(body.archivoAudio));
    if (!/\.(mp3|wav)$/i.test(nombre) || !fs.existsSync(path.join(cfg.dirAudio, nombre))) {
      throw error400(`No encontré el archivo de audio "${nombre}" en la carpeta public/audio del servidor.`);
    }
    return `${cfg.publicBaseUrl}/audio/${encodeURIComponent(nombre)}`;
  }
  const url = String(body.audioUrl || "").trim();
  if (!url || !esUrlHttp(url)) throw error400("Elige un audio de la lista o escribe la dirección completa (https://...) de un archivo mp3.");
  return url;
}

function validarLlamadas(body, g) {
  const cfg = g.cfg;
  if (!g.client) {
    throw error400("Faltan las credenciales de Twilio. Agrega TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en el archivo .env y reinicia el servidor.", { codigo: "sin-credenciales" });
  }
  if (!cfg.twilio.fromNumber) throw error400("Falta TWILIO_PHONE_NUMBER (el número desde el que se llama) en el archivo .env.", { codigo: "sin-numero" });

  const lec = leerContactos(body, cfg);
  if (!lec.contactos.length) {
    throw error400("Ninguno de los números es válido, así que no se marcó nada.", { motivos: lec.motivosInvalidos, ejemplosInvalidos: lec.invalidos.slice(0, 30) });
  }
  if (lec.contactos.length > cfg.limites.maxContactos) {
    throw error400(`Una campaña admite hasta ${cfg.limites.maxContactos} contactos (subiste ${lec.contactos.length}). Divide el archivo.`);
  }

  const modoAudio = ["voces", "mp3", "tts"].includes(body.modoAudio) ? body.modoAudio : "voces";
  const datos = {
    contactos: lec.contactos, invalidos: lec.invalidos, duplicados: lec.duplicados, modoAudio,
    nombre: limpiarTexto(body.nombre, 80),
    mensaje: "", audioUrl: "", voces: [],
    concurrencia: entero(body.concurrencia, 5, 1, cfg.limites.maxConcurrencia),
    cps: decimal(body.cps, cfg.llamadas.porSegundo, 0.2, 30),
    timbradoSeg: entero(body.timbradoSeg, cfg.llamadas.timbradoSegundos, 10, 120),
    detectarBuzon: body.detectarBuzon === undefined ? cfg.llamadas.detectarBuzon : Boolean(body.detectarBuzon),
    autoPausa: body.autoPausa === undefined ? cfg.autoPausa.activa : Boolean(body.autoPausa),
    origen: body.origen && typeof body.origen === "object" ? { campana: String(body.origen.campana || "").slice(0, 60), lista: String(body.origen.lista || "").slice(0, 30) } : null,
  };

  if (modoAudio === "voces") {
    if (!g.voces.disponible()) throw error400("Falta ELEVENLABS_API_KEY en el archivo .env para usar voces de ElevenLabs.", { codigo: "sin-elevenlabs" });
    datos.mensaje = String(body.mensaje || "").replace(/\r\n/g, "\n").trim();
    if (!datos.mensaje) throw error400("Escribe el mensaje que van a escuchar los contactos.");
    if (datos.mensaje.length > cfg.limites.maxTextoVoz) throw error400(`El mensaje es demasiado largo (${datos.mensaje.length} caracteres; máximo ${cfg.limites.maxTextoVoz}).`);
    datos.voces = resolverVoces(body, g);
  } else if (modoAudio === "tts") {
    datos.mensaje = String(body.mensaje || "").replace(/\r\n/g, "\n").trim();
    if (!datos.mensaje) throw error400("Escribe el mensaje que va a leer la voz de Twilio.");
    if (datos.mensaje.length > 1500) throw error400("El mensaje de la voz de Twilio admite hasta 1,500 caracteres.");
  } else {
    datos.audioUrl = resolverAudioFijo(body, g);
  }

  if (cfg.usaLocalhost && modoAudio !== "tts") {
    throw error400("PUBLIC_BASE_URL apunta a localhost, así que Twilio no puede descargar los audios. Escribe en el archivo .env la dirección pública del servidor (por ejemplo http://147.182.177.22).", { codigo: "url-local" });
  }
  return datos;
}

function validarWhatsapp(body, g) {
  const cfg = g.cfg;
  if (!g.client) {
    throw error400("Faltan las credenciales de Twilio. Agrega TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en el archivo .env y reinicia el servidor.", { codigo: "sin-credenciales" });
  }
  const lec = leerContactos(body, cfg);
  if (!lec.contactos.length) {
    throw error400("Ninguno de los números es válido, así que no se envió nada.", { motivos: lec.motivosInvalidos, ejemplosInvalidos: lec.invalidos.slice(0, 30) });
  }
  if (lec.contactos.length > cfg.limites.maxContactos) {
    throw error400(`Una campaña admite hasta ${cfg.limites.maxContactos} contactos (subiste ${lec.contactos.length}). Divide el archivo.`);
  }
  const mensaje = String(body.mensaje || "").replace(/\r\n/g, "\n").trim();
  if (!mensaje) throw error400("Escribe el mensaje de WhatsApp.");
  if (mensaje.length > 1500) throw error400("El mensaje de WhatsApp admite hasta 1,500 caracteres.");
  return {
    contactos: lec.contactos, invalidos: lec.invalidos, duplicados: lec.duplicados, mensaje,
    nombre: limpiarTexto(body.nombre, 80),
    concurrencia: entero(body.concurrencia, 10, 1, cfg.limites.maxConcurrencia),
    cps: decimal(body.cps, cfg.llamadas.whatsappPorSegundo, 0.5, 30),
    autoPausa: body.autoPausa === undefined ? cfg.autoPausa.activa : Boolean(body.autoPausa),
    origen: null,
  };
}

module.exports = { leerContactos, previsualizar, estimarAudios, resolverVoces, validarLlamadas, validarWhatsapp, error400, entero, decimal };
