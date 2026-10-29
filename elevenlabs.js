"use strict";
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
    this.porVoz = Boolean(opciones.porVoz);
    this.limiteConcurrencia = Boolean(opciones.limiteConcurrencia);
    this.http = opciones.http || null;
    this.codigo = opciones.codigo || null;
    this.titulo = opciones.titulo || "Error de ElevenLabs";
    this.accion = opciones.accion || "";
  }

  aIncidencia() {
    return {
      fuente: "elevenlabs",
      codigo: String(this.codigo || this.http || "error"),
      titulo: this.titulo,
      detalle: this.message,
      accion: this.accion,
      fatal: this.fatal,
    };
  }
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const agenteHttps = new https.Agent({ keepAlive: true, maxSockets: 12 });
const agenteHttp = new http.Agent({ keepAlive: true, maxSockets: 12 });

function peticion(metodo, urlTexto, headers, cuerpo) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlTexto);
    const esHttp = url.protocol === "http:";
    const lib = esHttp ? http : https;
    const req = lib.request(url, { method: metodo, headers, timeout: 60000, agent: esHttp ? agenteHttp : agenteHttps }, (res) => {
      const partes = [];
      res.on("data", (parte) => partes.push(parte));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(partes) }));
      res.on("error", reject);
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
  const marca = `${detalle.tipo} ${detalle.codigo} ${detalle.mensaje}`.toLowerCase();
  const codigo = detalle.codigo || detalle.tipo || null;
  const extra = detalle.mensaje ? ` Detalle de ElevenLabs: ${detalle.mensaje}` : "";

  if (marca.includes("detected_unusual_activity")) {
    return new ErrorElevenLabs(
      `ElevenLabs bloqueó el uso gratuito de la cuenta por actividad inusual (por ejemplo, uso de VPN, proxy o varias cuentas).${extra}`,
      { fatal: true, http: status, codigo: "detected_unusual_activity", titulo: "Cuenta de ElevenLabs bloqueada", accion: "Contrata un plan de pago en elevenlabs.io o contacta a su soporte." }
    );
  }
  if (marca.includes("paid_plan_required") || marca.includes("free users cannot use library voices") || marca.includes("only_for_creator") || marca.includes("pro_voice_limit")) {
    return new ErrorElevenLabs(
      `Esta voz requiere un plan de pago de ElevenLabs para usarse desde la API.${extra}`,
      { porVoz: true, http: status, codigo: "paid_plan_required", titulo: "Voz no disponible en tu plan", accion: "Elige una voz predeterminada o mejora el plan de ElevenLabs." }
    );
  }
  if (status === 402 || marca.includes("payment_required") || marca.includes("payment_issue") || marca.includes("insufficient_credits") || marca.includes("past_due")) {
    return new ErrorElevenLabs(
      `La cuenta de ElevenLabs tiene un pago pendiente o no tiene créditos suficientes.${extra}`,
      { fatal: true, http: status, codigo: codigo || "payment_required", titulo: "Pago pendiente o sin créditos en ElevenLabs", accion: "Revisa la facturación y los créditos en elevenlabs.io, Settings, Subscription." }
    );
  }
  if (marca.includes("quota_exceeded") || marca.includes("exceeds your quota")) {
    return new ErrorElevenLabs(
      `Ya no quedan caracteres o créditos suficientes en ElevenLabs para generar estos audios.${extra}`,
      { fatal: true, http: status, codigo: "quota_exceeded", titulo: "Créditos de ElevenLabs agotados", accion: "Recarga créditos o mejora el plan en elevenlabs.io. Los audios ya generados no se vuelven a cobrar." }
    );
  }
  if (marca.includes("too_many_concurrent_requests") || marca.includes("concurrent")) {
    return new ErrorElevenLabs(
      `ElevenLabs recibió demasiadas solicitudes simultáneas para el plan actual.${extra}`,
      { reintentable: true, limiteConcurrencia: true, http: status, codigo: "too_many_concurrent_requests", titulo: "Límite de solicitudes simultáneas", accion: "El sistema baja el ritmo automáticamente." }
    );
  }
  if (marca.includes("missing_permissions")) {
    return new ErrorElevenLabs(
      `La API key de ElevenLabs no tiene permiso para esta consulta.${extra}`,
      { http: status, codigo: "missing_permissions", titulo: "API key con permisos limitados", accion: "Si quieres ver los créditos en pantalla, activa el permiso de lectura de usuario en la API key." }
    );
  }
  if (status === 401 || marca.includes("invalid_api_key") || marca.includes("needs_authorization")) {
    return new ErrorElevenLabs(
      `ElevenLabs rechazó la API key. Verifica que ELEVENLABS_API_KEY sea correcta y que la cuenta esté activa.${extra}`,
      { fatal: true, http: status, codigo: codigo || "invalid_api_key", titulo: "API key de ElevenLabs inválida", accion: "Revisa ELEVENLABS_API_KEY en el archivo .env y reinicia el servidor." }
    );
  }
  if (status === 403 && !marca.includes("voice_access_denied")) {
    return new ErrorElevenLabs(
      `ElevenLabs no permite esta operación con el plan o los permisos de la cuenta.${extra}`,
      { fatal: true, http: status, codigo: codigo || "forbidden", titulo: "Sin permisos en ElevenLabs", accion: "Revisa los permisos de la API key y el plan de la cuenta." }
    );
  }
  if (marca.includes("voice_limit_reached") || marca.includes("max_voices") || marca.includes("voice limit")) {
    return new ErrorElevenLabs(
      `La cuenta alcanzó el máximo de voces permitido por su plan.${extra}`,
      { http: status, codigo: "voice_limit_reached", titulo: "Límite de voces del plan", accion: "Elimina voces que no uses en elevenlabs.io o mejora el plan." }
    );
  }
  if (marca.includes("max_character_limit") || marca.includes("text_too_long") || marca.includes("too long")) {
    return new ErrorElevenLabs(
      `El mensaje es demasiado largo para ElevenLabs.${extra}`,
      { http: status, codigo: "max_character_limit_exceeded", titulo: "Mensaje demasiado largo", accion: "Acorta el mensaje." }
    );
  }
  if (status === 404 || marca.includes("voice_not_found") || marca.includes("voice does not exist") || marca.includes("was not found")) {
    return new ErrorElevenLabs(
      `La voz seleccionada no existe o no está agregada a tu cuenta de ElevenLabs.${extra}`,
      { porVoz: true, http: status, codigo: "voice_not_found", titulo: "Voz no encontrada", accion: "Agrega la voz a 'My Voices' en elevenlabs.io o elige otra." }
    );
  }
  if (status === 429 || status >= 500 || marca.includes("system_busy")) {
    return new ErrorElevenLabs(
      `ElevenLabs está saturado o no disponible por el momento (${status}).${extra}`,
      { reintentable: true, http: status, codigo: codigo || String(status), titulo: "ElevenLabs saturado", accion: "El sistema reintenta solo." }
    );
  }
  return new ErrorElevenLabs(
    `ElevenLabs rechazó la solicitud (${status}).${extra}`,
    { http: status, codigo: codigo || String(status), titulo: "ElevenLabs rechazó la solicitud", accion: "Revisa el mensaje y la voz elegida." }
  );
}

function kbpsDeFormato(formato) {
  const m = /^mp3_\d+_(\d+)$/.exec(String(formato || ""));
  return m ? parseInt(m[1], 10) : null;
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
    genero: etiquetas.gender || voz.gender || "",
    acento: etiquetas.accent || voz.accent || "",
    edad: etiquetas.age || voz.age || "",
    estilo: etiquetas.descriptive || etiquetas.use_case || voz.descriptive || voz.use_case || "",
    descripcion: voz.description || etiquetas.descriptive || "",
    idiomas,
    previewUrl: voz.preview_url || "",
    origen: "cuenta",
  };
}

function normalizarVozBiblioteca(voz) {
  const idiomas = Array.isArray(voz.verified_languages)
    ? voz.verified_languages.map((item) => item.locale || item.language).filter(Boolean)
    : (voz.language ? [voz.language] : []);
  return {
    id: voz.voice_id,
    publicOwnerId: voz.public_owner_id || "",
    nombre: voz.name || voz.voice_id,
    categoria: voz.category || "",
    genero: voz.gender || "",
    acento: voz.accent || "",
    edad: voz.age || "",
    estilo: voz.descriptive || voz.use_case || "",
    descripcion: voz.description || "",
    idiomas,
    previewUrl: voz.preview_url || "",
    gratisPermitido: voz.free_users_allowed !== false,
    usos: voz.usage_character_count_1y || 0,
    origen: "biblioteca",
  };
}

function crearServicioVoces(opciones) {
  const apiKey = String(opciones.apiKey || "").trim();
  const baseUrl = String(opciones.baseUrl || "https://api.elevenlabs.io").replace(/\/$/, "");
  const modelId = opciones.modelId || "eleven_multilingual_v2";
  let formato = opciones.formato || "mp3_44100_128";
  if (!/^mp3_/.test(formato)) formato = "mp3_44100_128";
  const ajustesVoz = opciones.ajustesVoz || null;
  const directorio = opciones.directorio;
  const publicBaseUrl = String(opciones.publicBaseUrl || "").replace(/\/$/, "");
  const concurrenciaMaxima = Math.max(1, parseInt(opciones.concurrencia, 10) || 3);
  const esperaBase = opciones.esperaBaseMs === undefined ? 1000 : opciones.esperaBaseMs;
  const enVuelo = new Map();
  const kbps = kbpsDeFormato(formato);
  let limiteActual = concurrenciaMaxima;
  let activos = 0;
  const cola = [];
  let cacheVoces = null;
  let cacheVocesHasta = 0;
  let cacheRecomendadas = null;
  let cacheRecomendadasHasta = 0;

  function disponible() {
    return Boolean(apiKey);
  }

  function exigirClave() {
    if (!apiKey) {
      throw new ErrorElevenLabs("Falta ELEVENLABS_API_KEY en la configuración del servidor.", {
        fatal: true, codigo: "sin_clave", titulo: "Falta la API key de ElevenLabs", accion: "Agrega ELEVENLABS_API_KEY en el archivo .env y reinicia el servidor.",
      });
    }
  }

  function adquirir() {
    return new Promise((resolve) => {
      const intentar = () => {
        if (activos < limiteActual) {
          activos += 1;
          resolve();
        } else {
          cola.push(intentar);
        }
      };
      intentar();
    });
  }

  function liberar() {
    activos = Math.max(0, activos - 1);
    const siguiente = cola.shift();
    if (siguiente) siguiente();
  }

  function urlPublica(clave) {
    return `${publicBaseUrl}/audio/generado/${clave}.mp3`;
  }

  function rutaAudio(clave) {
    return path.join(directorio, `${String(clave).replace(/[^a-f0-9]/gi, "")}.mp3`);
  }

  function claveDeAudio(vozId, texto) {
    return crypto.createHash("sha1").update(`${vozId}|${modelId}|${formato}|${JSON.stringify(ajustesVoz)}|${texto}`).digest("hex");
  }

  function segundosEstimados(bytes) {
    return kbps && bytes ? Math.round((bytes * 8) / (kbps * 1000) * 10) / 10 : null;
  }

  async function solicitar(metodo, ruta, cuerpoJson) {
    const maximoIntentos = 5;
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
        ultimoError = new ErrorElevenLabs(`No se pudo conectar con ElevenLabs: ${err.message}`, {
          reintentable: true, codigo: err.code || "red", titulo: "Sin conexión con ElevenLabs", accion: "Revisa la conexión a internet del servidor.",
        });
        continue;
      }

      if (respuesta.status >= 200 && respuesta.status < 300) return respuesta;

      const error = crearError(respuesta.status, respuesta.cuerpo);
      if (error.limiteConcurrencia && limiteActual > 1) limiteActual -= 1;
      if (!error.reintentable) throw error;
      ultimoError = error;
    }

    ultimoError.reintentable = false;
    throw ultimoError;
  }

  function leerJson(respuesta) {
    try {
      return JSON.parse(respuesta.cuerpo.toString("utf8"));
    } catch (err) {
      throw new ErrorElevenLabs("ElevenLabs devolvió una respuesta que no se pudo leer.", { codigo: "respuesta_invalida", titulo: "Respuesta inesperada de ElevenLabs" });
    }
  }

  async function listarVoces(forzar) {
    exigirClave();
    if (!forzar && cacheVoces && Date.now() < cacheVocesHasta) return cacheVoces;

    const voces = [];
    let token = null;
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const consulta = new URLSearchParams({ page_size: "100", include_total_count: "false" });
      if (token) consulta.set("next_page_token", token);
      const respuesta = await solicitar("GET", `/v2/voices?${consulta.toString()}`);
      const json = leerJson(respuesta);
      (json.voices || []).forEach((voz) => voces.push(normalizarVoz(voz)));
      if (!json.has_more || !json.next_page_token) break;
      token = json.next_page_token;
    }

    voces.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    cacheVoces = voces;
    cacheVocesHasta = Date.now() + 5 * 60 * 1000;
    return voces;
  }

  function invalidarVoces() {
    cacheVoces = null;
    cacheVocesHasta = 0;
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

  async function suscripcion() {
    exigirClave();
    try {
      const respuesta = await solicitar("GET", "/v1/user/subscription");
      const s = leerJson(respuesta);
      return {
        plan: s.tier || "",
        estado: s.status || "",
        usados: s.character_count !== undefined ? s.character_count : null,
        limite: s.character_limit !== undefined ? s.character_limit : null,
        reinicio: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : null,
        puedeExtender: Boolean(s.can_extend_character_limit),
        vocesUsadas: s.voice_slots_used !== undefined ? s.voice_slots_used : null,
        vocesLimite: s.voice_limit !== undefined ? s.voice_limit : null,
      };
    } catch (err) {
      if (err.codigo === "missing_permissions") return null;
      throw err;
    }
  }

  async function recomendadas(cantidad = 15, forzar = false) {
    exigirClave();
    if (!forzar && cacheRecomendadas && Date.now() < cacheRecomendadasHasta && cacheRecomendadas.length >= cantidad) {
      return cacheRecomendadas.slice(0, cantidad);
    }
    const propias = new Set((await listarVoces().catch(() => [])).map((v) => v.id));
    const vistas = new Set();
    const salida = [];

    async function consultar(filtros) {
      const consulta = new URLSearchParams({ page_size: "40", sort: "usage_character_count_1y", language: "es", ...filtros });
      const respuesta = await solicitar("GET", `/v1/shared-voices?${consulta.toString()}`);
      const json = leerJson(respuesta);
      (Array.isArray(json.voices) ? json.voices : []).forEach((voz) => {
        if (!voz || !voz.voice_id || vistas.has(voz.voice_id) || propias.has(voz.voice_id)) return;
        vistas.add(voz.voice_id);
        salida.push(normalizarVozBiblioteca(voz));
      });
    }

    await consultar({ accent: "mexican" });
    if (salida.length < cantidad) await consultar({});
    cacheRecomendadas = salida;
    cacheRecomendadasHasta = Date.now() + 60 * 60 * 1000;
    return salida.slice(0, cantidad);
  }

  async function agregarVozCompartida(publicOwnerId, vozId, nombre) {
    exigirClave();
    if (!/^[A-Za-z0-9]{10,80}$/.test(String(publicOwnerId || "")) || !ID_VOZ.test(String(vozId || ""))) {
      throw new ErrorElevenLabs("Datos de la voz no válidos.", { codigo: "voz_invalida", titulo: "Voz no válida" });
    }
    const respuesta = await solicitar("POST", `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(vozId)}`, {
      new_name: String(nombre || vozId).slice(0, 80),
    });
    invalidarVoces();
    const json = leerJson(respuesta);
    return json.voice_id || vozId;
  }

  async function generarAudio(vozId, texto) {
    exigirClave();
    if (!ID_VOZ.test(String(vozId || ""))) {
      throw new ErrorElevenLabs("El identificador de voz no es válido.", { codigo: "voz_invalida", titulo: "Voz no válida", porVoz: true });
    }
    const limpio = String(texto || "").trim();
    if (!limpio) throw new ErrorElevenLabs("El mensaje está vacío.", { codigo: "texto_vacio", titulo: "Mensaje vacío" });
    if (limpio.length > TEXTO_MAXIMO) {
      throw new ErrorElevenLabs(`El mensaje supera los ${TEXTO_MAXIMO} caracteres permitidos.`, { codigo: "texto_largo", titulo: "Mensaje demasiado largo" });
    }

    const clave = claveDeAudio(vozId, limpio);
    const archivo = path.join(directorio, `${clave}.mp3`);
    const datosCache = () => {
      const bytes = fs.statSync(archivo).size;
      return { clave, archivo, url: urlPublica(clave), nuevo: false, bytes, segundos: segundosEstimados(bytes), caracteres: limpio.length };
    };
    if (fs.existsSync(archivo)) return datosCache();
    if (enVuelo.has(clave)) return enVuelo.get(clave);

    const promesa = (async () => {
      await adquirir();
      try {
        const respuesta = await solicitar(
          "POST",
          `/v1/text-to-speech/${encodeURIComponent(vozId)}?output_format=${encodeURIComponent(formato)}`,
          ajustesVoz ? { text: limpio, model_id: modelId, voice_settings: ajustesVoz } : { text: limpio, model_id: modelId }
        );
        if (!respuesta.cuerpo.length) {
          throw new ErrorElevenLabs("ElevenLabs devolvió un audio vacío.", { codigo: "audio_vacio", titulo: "Audio vacío" });
        }
        fs.mkdirSync(directorio, { recursive: true });
        const temporal = `${archivo}.${process.pid}.tmp`;
        fs.writeFileSync(temporal, respuesta.cuerpo);
        fs.renameSync(temporal, archivo);
        const bytes = respuesta.cuerpo.length;
        return { clave, archivo, url: urlPublica(clave), nuevo: true, bytes, segundos: segundosEstimados(bytes), caracteres: limpio.length };
      } finally {
        liberar();
      }
    })();

    enVuelo.set(clave, promesa);
    try {
      return await promesa;
    } finally {
      enVuelo.delete(clave);
    }
  }

  async function generarVarios(tareas, alProgresar, debeParar) {
    const resultados = new Map();
    let indice = 0;
    let errorFatal = null;
    let listos = 0;

    async function trabajador() {
      while (!errorFatal) {
        if (debeParar && debeParar()) return;
        const actual = indice;
        indice += 1;
        if (actual >= tareas.length) return;
        const tarea = tareas[actual];
        try {
          const audio = await generarAudio(tarea.vozId, tarea.texto);
          resultados.set(tarea.clave, { ok: true, url: audio.url, archivo: audio.archivo, claveArchivo: audio.clave, bytes: audio.bytes, segundos: audio.segundos, caracteres: audio.caracteres, nuevo: audio.nuevo });
        } catch (err) {
          if (err.fatal) {
            errorFatal = err;
            return;
          }
          resultados.set(tarea.clave, { ok: false, error: err.message, codigo: err.codigo, titulo: err.titulo, accion: err.accion, porVoz: Boolean(err.porVoz), vozId: tarea.vozId });
        }
        listos += 1;
        if (alProgresar) alProgresar(listos, tareas.length);
      }
    }

    const trabajadores = Math.min(Math.max(concurrenciaMaxima, 1), tareas.length);
    await Promise.all(Array.from({ length: trabajadores }, trabajador));
    return { resultados, errorFatal };
  }

  function estado() {
    return { limiteActual, concurrenciaMaxima, activos, enEspera: cola.length };
  }

  function existeAudio(vozId, texto) {
    return fs.existsSync(path.join(directorio, `${claveDeAudio(vozId, String(texto || "").trim())}.mp3`));
  }

  return {
    disponible, listarVoces, invalidarVoces, mapaDeNombres, suscripcion, recomendadas, agregarVozCompartida,
    generarAudio, generarVarios, rutaAudio, urlPublica, estado, existeAudio, formato, modelId,
  };
}

module.exports = { crearServicioVoces, ErrorElevenLabs, ID_VOZ, TEXTO_MAXIMO };
