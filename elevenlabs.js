const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const ID_VOZ = /^[A-Za-z0-9]{10,40}$/;
const TEXTO_MAXIMO = 4500;

class ErrorElevenLabs extends Error {
  constructor(mensaje, opciones = {}) {
    super(mensaje);
    this.name = "ErrorElevenLabs";
    this.fatal = Boolean(opciones.fatal);
    this.reintentable = Boolean(opciones.reintentable);
    this.http = opciones.http || null;
    this.codigo = opciones.codigo || null;
  }
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function peticion(metodo, urlTexto, headers, cuerpo) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlTexto);
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(url, { method: metodo, headers, timeout: 60000 }, (res) => {
      const partes = [];
      res.on("data", (parte) => partes.push(parte));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(partes) }));
    });
    req.on("timeout", () => req.destroy(new Error("Tiempo de espera agotado")));
    req.on("error", reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

function leerDetalle(buffer) {
  const crudo = buffer.toString("utf8");
  try {
    const json = JSON.parse(crudo);
    const detalle = json && json.detail !== undefined ? json.detail : json;
    if (typeof detalle === "string") return { tipo: "", codigo: "", mensaje: detalle };
    if (Array.isArray(detalle)) {
      const mensaje = detalle.map((item) => (item && item.msg ? item.msg : JSON.stringify(item))).join("; ");
      return { tipo: "", codigo: "", mensaje };
    }
    if (detalle && typeof detalle === "object") {
      return { tipo: detalle.type || "", codigo: detalle.code || detalle.status || "", mensaje: detalle.message || "" };
    }
  } catch (e) {
    return { tipo: "", codigo: "", mensaje: crudo.slice(0, 200) };
  }
  return { tipo: "", codigo: "", mensaje: crudo.slice(0, 200) };
}

function crearError(status, buffer) {
  const detalle = leerDetalle(buffer);
  const marca = `${detalle.tipo} ${detalle.codigo}`.toLowerCase();
  const codigo = detalle.codigo || detalle.tipo || null;

  if (status === 402 || marca.includes("payment_required") || marca.includes("insufficient_credits") || marca.includes("quota_exceeded")) {
    return new ErrorElevenLabs(
      "La cuenta de ElevenLabs tiene un pago pendiente o no tiene créditos suficientes. Revisa la facturación en elevenlabs.io.",
      { fatal: true, http: status, codigo }
    );
  }
  if (status === 401) {
    return new ErrorElevenLabs(
      "ElevenLabs rechazó la API key. Verifica que ELEVENLABS_API_KEY sea correcta y que la cuenta esté activa.",
      { fatal: true, http: status, codigo }
    );
  }
  if (status === 403 && !marca.includes("voice_access_denied")) {
    return new ErrorElevenLabs(
      `ElevenLabs no permite esta operación con el plan o los permisos de la cuenta${detalle.mensaje ? `: ${detalle.mensaje}` : "."}`,
      { fatal: true, http: status, codigo }
    );
  }
  if (status === 404 || marca.includes("voice_not_found")) {
    return new ErrorElevenLabs("La voz seleccionada no existe en la cuenta de ElevenLabs.", { http: status, codigo });
  }
  if (status === 429 || status >= 500) {
    return new ErrorElevenLabs(
      `ElevenLabs está saturado o no disponible por el momento (${status}${detalle.mensaje ? `: ${detalle.mensaje}` : ""}).`,
      { reintentable: true, http: status, codigo }
    );
  }
  return new ErrorElevenLabs(
    `ElevenLabs rechazó la solicitud (${status})${detalle.mensaje ? `: ${detalle.mensaje}` : "."}`,
    { http: status, codigo }
  );
}

function normalizarVoz(voz) {
  const etiquetas = voz.labels && typeof voz.labels === "object" ? voz.labels : {};
  const idiomas = Array.isArray(voz.verified_languages)
    ? voz.verified_languages.map((item) => item.locale || item.language).filter(Boolean)
    : [];
  return {
    id: voz.voice_id,
    nombre: voz.name || voz.voice_id,
    categoria: voz.category || "",
    genero: etiquetas.gender || "",
    acento: etiquetas.accent || "",
    descripcion: voz.description || etiquetas.descriptive || "",
    idiomas,
  };
}

function crearServicioVoces(opciones) {
  const apiKey = String(opciones.apiKey || "").trim();
  const baseUrl = String(opciones.baseUrl || "https://api.elevenlabs.io").replace(/\/$/, "");
  const modelId = opciones.modelId || "eleven_multilingual_v2";
  const formato = opciones.formato || "mp3_44100_128";
  const directorio = opciones.directorio;
  const publicBaseUrl = String(opciones.publicBaseUrl || "").replace(/\/$/, "");
  const concurrenciaMaxima = Math.max(1, parseInt(opciones.concurrencia, 10) || 3);
  const esperaBase = opciones.esperaBaseMs === undefined ? 1000 : opciones.esperaBaseMs;
  const enVuelo = new Map();
  let cacheVoces = null;
  let cacheVocesHasta = 0;

  function disponible() {
    return Boolean(apiKey);
  }

  function exigirClave() {
    if (!apiKey) {
      throw new ErrorElevenLabs("Falta ELEVENLABS_API_KEY en la configuración del servidor.", { fatal: true, codigo: "sin_clave" });
    }
  }

  function urlPublica(clave) {
    return `${publicBaseUrl}/audio/generado/${clave}.mp3`;
  }

  function claveDeAudio(vozId, texto) {
    return crypto.createHash("sha1").update(`${vozId}|${modelId}|${formato}|${texto}`).digest("hex");
  }

  async function solicitar(metodo, ruta, cuerpoJson) {
    const maximoIntentos = 4;
    let ultimoError = null;

    for (let intento = 0; intento < maximoIntentos; intento += 1) {
      if (intento > 0) await esperar(esperaBase * 2 ** (intento - 1));

      let respuesta;
      try {
        const headers = { "xi-api-key": apiKey, Accept: "*/*" };
        let cuerpo = null;
        if (cuerpoJson !== undefined) {
          cuerpo = Buffer.from(JSON.stringify(cuerpoJson));
          headers["Content-Type"] = "application/json";
          headers["Content-Length"] = cuerpo.length;
        }
        respuesta = await peticion(metodo, `${baseUrl}${ruta}`, headers, cuerpo);
      } catch (err) {
        ultimoError = new ErrorElevenLabs(`No se pudo conectar con ElevenLabs: ${err.message}`, { reintentable: true, codigo: err.code });
        continue;
      }

      if (respuesta.status >= 200 && respuesta.status < 300) return respuesta;

      const error = crearError(respuesta.status, respuesta.cuerpo);
      if (!error.reintentable) throw error;
      ultimoError = error;
    }

    ultimoError.reintentable = false;
    throw ultimoError;
  }

  async function listarVoces() {
    exigirClave();
    if (cacheVoces && Date.now() < cacheVocesHasta) return cacheVoces;

    const voces = [];
    let token = null;
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const consulta = new URLSearchParams({ page_size: "100", include_total_count: "false" });
      if (token) consulta.set("next_page_token", token);
      const respuesta = await solicitar("GET", `/v2/voices?${consulta.toString()}`);
      const json = JSON.parse(respuesta.cuerpo.toString("utf8"));
      (json.voices || []).forEach((voz) => voces.push(normalizarVoz(voz)));
      if (!json.has_more || !json.next_page_token) break;
      token = json.next_page_token;
    }

    voces.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    cacheVoces = voces;
    cacheVocesHasta = Date.now() + 5 * 60 * 1000;
    return voces;
  }

  async function mapaDeNombres() {
    try {
      const voces = await listarVoces();
      const mapa = {};
      voces.forEach((voz) => {
        mapa[voz.id] = voz.nombre;
      });
      return mapa;
    } catch (err) {
      if (err.fatal) throw err;
      return {};
    }
  }

  async function generarAudio(vozId, texto) {
    exigirClave();
    if (!ID_VOZ.test(String(vozId || ""))) {
      throw new ErrorElevenLabs("El identificador de voz no es válido.", { codigo: "voz_invalida" });
    }
    const limpio = String(texto || "").trim();
    if (!limpio) throw new ErrorElevenLabs("El mensaje está vacío.", { codigo: "texto_vacio" });
    if (limpio.length > TEXTO_MAXIMO) {
      throw new ErrorElevenLabs(`El mensaje supera los ${TEXTO_MAXIMO} caracteres permitidos.`, { codigo: "texto_largo" });
    }

    const clave = claveDeAudio(vozId, limpio);
    const archivo = path.join(directorio, `${clave}.mp3`);
    if (fs.existsSync(archivo)) return { clave, archivo, url: urlPublica(clave), nuevo: false };
    if (enVuelo.has(clave)) return enVuelo.get(clave);

    const promesa = (async () => {
      const respuesta = await solicitar(
        "POST",
        `/v1/text-to-speech/${encodeURIComponent(vozId)}?output_format=${encodeURIComponent(formato)}`,
        { text: limpio, model_id: modelId }
      );
      if (!respuesta.cuerpo.length) {
        throw new ErrorElevenLabs("ElevenLabs devolvió un audio vacío.", { codigo: "audio_vacio" });
      }
      fs.mkdirSync(directorio, { recursive: true });
      const temporal = `${archivo}.${process.pid}.tmp`;
      fs.writeFileSync(temporal, respuesta.cuerpo);
      fs.renameSync(temporal, archivo);
      return { clave, archivo, url: urlPublica(clave), nuevo: true };
    })();

    enVuelo.set(clave, promesa);
    try {
      return await promesa;
    } finally {
      enVuelo.delete(clave);
    }
  }

  async function generarVarios(tareas, alProgresar) {
    const resultados = new Map();
    let indice = 0;
    let errorFatal = null;
    let listos = 0;

    async function trabajador() {
      while (!errorFatal) {
        const actual = indice;
        indice += 1;
        if (actual >= tareas.length) return;
        const tarea = tareas[actual];
        try {
          const audio = await generarAudio(tarea.vozId, tarea.texto);
          resultados.set(tarea.clave, { ok: true, url: audio.url });
        } catch (err) {
          if (err.fatal) {
            errorFatal = err;
            return;
          }
          resultados.set(tarea.clave, { ok: false, error: err.message });
        }
        listos += 1;
        if (alProgresar) alProgresar(listos, tareas.length);
      }
    }

    const trabajadores = Math.min(concurrenciaMaxima, tareas.length);
    await Promise.all(Array.from({ length: trabajadores }, trabajador));
    return { resultados, errorFatal };
  }

  return { disponible, listarVoces, mapaDeNombres, generarAudio, generarVarios };
}

module.exports = { crearServicioVoces, ErrorElevenLabs, ID_VOZ };
