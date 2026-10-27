require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const path = require("path");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const { crearServicioVoces, ID_VOZ } = require("./elevenlabs");

const app = express();
const PORT = process.env.PORT || 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || "52";

const client = twilio(accountSid, authToken);

const servicioVoces = crearServicioVoces({
  apiKey: process.env.ELEVENLABS_API_KEY,
  baseUrl: process.env.ELEVENLABS_BASE_URL,
  modelId: process.env.ELEVENLABS_MODEL_ID,
  formato: process.env.ELEVENLABS_OUTPUT_FORMAT,
  concurrencia: process.env.ELEVENLABS_CONCURRENCY,
  directorio: path.join(__dirname, "public", "audio", "generado"),
  publicBaseUrl,
});

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const campaigns = new Map();

function normalizarNumero(raw) {
  let num = String(raw).trim().replace(/\s+/g, "").replace(/-/g, "");
  if (num.startsWith("+")) return num;
  if (num.startsWith("00")) return "+" + num.slice(2);
  if (num.length === 10) return `+${defaultCountryCode}${num}`;
  if (num.length === 12 && num.startsWith(defaultCountryCode)) return `+${num}`;
  return `+${num}`;
}

function parsearContactos(texto, csvBuffer) {
  if (csvBuffer) {
    const rows = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    return rows.map((r) => ({
      numero: normalizarNumero(r.numero || r.phone || r.telefono || r.number || Object.values(r)[0]),
      nombre: r.nombre || r.name || r.nombre_completo || "",
    }));
  }

  return texto
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|  +/);
      const numero = normalizarNumero(parts[0]);
      const nombre = parts[1] ? parts[1].trim() : "";
      return { numero, nombre };
    });
}

function construirMensaje(template, nombre) {
  return template.replace(/\{nombre\}/gi, nombre || "").trim();
}

function esErrorFatalDeTwilio(err) {
  if (!err) return false;
  if (err.status === 401) return true;
  if (err.code === 20003 || err.code === 20005 || err.code === 10001) return true;
  return String(err.message || "").toLowerCase().includes("authentication failed");
}

function detenerCampana(campaign, err) {
  if (!campaign || campaign.estado === "detenida") return;
  campaign.estado = "detenida";
  campaign.error = "Twilio rechazó la autenticación de la cuenta. Revisa en console.twilio.com que la cuenta esté activa y con saldo, y que el Auth Token del archivo .env sea el vigente.";
  campaign.detalle = err.message;
  console.error(`Campaña ${campaign.id} detenida: ${err.message}`);
}

function escaparXml(texto) {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parsearVoces(valor) {
  if (!valor) return [];
  let lista = valor;
  if (typeof valor === "string") {
    try {
      lista = JSON.parse(valor);
    } catch (e) {
      lista = valor.split(",");
    }
  }
  if (!Array.isArray(lista)) lista = [lista];
  const limpias = lista.map((v) => String(v).trim()).filter((v) => ID_VOZ.test(v));
  return [...new Set(limpias)].slice(0, 20);
}

function detenerPorVoces(campaign, totalContactos, err) {
  if (!campaign) return;
  campaign.estado = "detenida";
  campaign.error = err.message;
  campaign.omitidos = totalContactos;
  console.error(`Campaña ${campaign.id} detenida por ElevenLabs: ${err.message}`);
}

async function prepararAudiosDeVoces(contactos, mensajeTemplate, voces, campaign) {
  const nombres = await servicioVoces.mapaDeNombres();
  const tareas = new Map();

  contactos.forEach((contacto, i) => {
    const vozId = voces[i % voces.length];
    const texto = construirMensaje(mensajeTemplate, contacto.nombre);
    contacto.voz = nombres[vozId] || vozId;
    contacto.claveAudio = `${vozId}|${texto}`;
    if (texto && !tareas.has(contacto.claveAudio)) {
      tareas.set(contacto.claveAudio, { clave: contacto.claveAudio, vozId, texto });
    }
  });

  if (campaign) {
    campaign.estado = "generando_audios";
    campaign.audiosTotal = tareas.size;
    campaign.audiosListos = 0;
  }

  const generacion = await servicioVoces.generarVarios([...tareas.values()], (listos) => {
    if (campaign) campaign.audiosListos = listos;
  });

  if (campaign && !generacion.errorFatal) campaign.estado = "en_progreso";
  return generacion;
}

async function llamarConConcurrencia(contactos, mensajeTemplate, audioUrl, concurrencia, campaignId, voces = []) {
  const resultados = [];
  const campaign = campaigns.get(campaignId);
  let audios = null;

  if (voces.length) {
    try {
      const generacion = await prepararAudiosDeVoces(contactos, mensajeTemplate, voces, campaign);
      if (generacion.errorFatal) {
        detenerPorVoces(campaign, contactos.length, generacion.errorFatal);
        return resultados;
      }
      audios = generacion.resultados;
    } catch (err) {
      detenerPorVoces(campaign, contactos.length, err);
      return resultados;
    }
  }

  for (let i = 0; i < contactos.length; i += concurrencia) {
    const lote = contactos.slice(i, i + concurrencia);
    const promesas = lote.map(async (contacto) => {
      const { numero, nombre } = contacto;
      const extra = contacto.voz ? { voz: contacto.voz } : {};
      const mensaje = construirMensaje(mensajeTemplate, nombre);
      try {
        let twiml;
        if (audios) {
          const audio = audios.get(contacto.claveAudio);
          if (!audio || !audio.ok) {
            const fallo = { numero, nombre, ...extra, sid: null, estado: "error", error: audio ? audio.error : "El mensaje está vacío." };
            if (campaign) campaign.resultados.push(fallo);
            return fallo;
          }
          twiml = `<Response><Play>${escaparXml(audio.url)}</Play></Response>`;
        } else if (audioUrl) {
          twiml = `<Response><Play>${escaparXml(audioUrl)}</Play></Response>`;
        } else {
          twiml = `<Response><Say language="es-MX" voice="Polly.Mia">${escaparXml(mensaje)}</Say></Response>`;
        }

        const call = await client.calls.create({
          to: numero,
          from: fromNumber,
          twiml,
          statusCallback: `${publicBaseUrl}/api/webhooks/call-status`,
          statusCallbackMethod: "POST",
        });

        const res = { numero, nombre, ...extra, sid: call.sid, estado: "iniciada", error: null };
        if (campaign) campaign.resultados.push(res);
        return res;
      } catch (err) {
        if (esErrorFatalDeTwilio(err)) detenerCampana(campaign, err);
        const res = { numero, nombre, ...extra, sid: null, estado: "error", error: err.message };
        if (campaign) campaign.resultados.push(res);
        return res;
      }
    });

    const loteResultados = await Promise.all(promesas);
    resultados.push(...loteResultados);
    if (campaign) campaign.progreso = Math.min(100, Math.round((resultados.length / contactos.length) * 100));
    if (campaign && campaign.estado === "detenida") {
      campaign.omitidos = contactos.length - resultados.length;
      break;
    }
  }

  if (campaign && campaign.estado !== "detenida") campaign.estado = "completada";
  return resultados;
}

async function enviarWhatsAppConConcurrencia(contactos, mensajeTemplate, concurrencia, campaignId) {
  const resultados = [];
  const campaign = campaigns.get(campaignId);

  for (let i = 0; i < contactos.length; i += concurrencia) {
    const lote = contactos.slice(i, i + concurrencia);
    const promesas = lote.map(async ({ numero, nombre }) => {
      const mensaje = construirMensaje(mensajeTemplate, nombre);
      try {
        const msg = await client.messages.create({
          from: whatsappFrom,
          to: `whatsapp:${numero}`,
          body: mensaje,
          statusCallback: `${publicBaseUrl}/api/webhooks/message-status`,
        });

        const res = { numero, nombre, sid: msg.sid, estado: "enviado", error: null };
        if (campaign) campaign.resultados.push(res);
        return res;
      } catch (err) {
        if (esErrorFatalDeTwilio(err)) detenerCampana(campaign, err);
        const res = { numero, nombre, sid: null, estado: "error", error: err.message };
        if (campaign) campaign.resultados.push(res);
        return res;
      }
    });

    const loteResultados = await Promise.all(promesas);
    resultados.push(...loteResultados);
    if (campaign) campaign.progreso = Math.min(100, Math.round((resultados.length / contactos.length) * 100));
    if (campaign && campaign.estado === "detenida") {
      campaign.omitidos = contactos.length - resultados.length;
      break;
    }
  }

  if (campaign && campaign.estado !== "detenida") campaign.estado = "completada";
  return resultados;
}

async function verificarCuentaTwilio() {
  try {
    const cuenta = await client.api.v2010.accounts(accountSid).fetch();
    console.log(`Cuenta Twilio: ${cuenta.status} (${cuenta.type})`);
    if (cuenta.status !== "active") {
      console.error(`ATENCIÓN: la cuenta de Twilio está en estado "${cuenta.status}" y no podrá hacer llamadas.`);
    }
    return { ok: cuenta.status === "active", estado: cuenta.status, tipo: cuenta.type };
  } catch (err) {
    if (esErrorFatalDeTwilio(err)) {
      console.error(`ATENCIÓN: Twilio rechazó la autenticación: ${err.message}`);
    } else {
      console.error(`ATENCIÓN: no se pudo verificar la cuenta de Twilio: ${err.message}`);
    }
    return { ok: false, estado: "error", rechazada: esErrorFatalDeTwilio(err), http: err.status || null, codigo: err.code || null };
  }
}

app.post("/api/calls/bulk", upload.single("csv"), async (req, res) => {
  try {
    const { numeros, mensaje, audioUrl, concurrencia = 10, voces } = req.body;
    const csvBuffer = req.file ? req.file.buffer : null;
    const listaVoces = parsearVoces(voces);

    if (!csvBuffer && !numeros) return res.status(400).json({ error: "Se requiere lista de números o archivo CSV" });
    if (!mensaje && !audioUrl) return res.status(400).json({ error: "Se requiere mensaje o URL de audio" });

    if (voces && !listaVoces.length) return res.status(400).json({ error: "Selecciona al menos una voz válida de ElevenLabs" });

    if (listaVoces.length) {
      if (!mensaje) return res.status(400).json({ error: "Escribe el mensaje de voz para generar el audio" });
      if (!servicioVoces.disponible()) return res.status(400).json({ error: "Falta ELEVENLABS_API_KEY en la configuración del servidor" });
      if (/localhost|127\.0\.0\.1/.test(publicBaseUrl)) {
        return res.status(400).json({ error: "PUBLIC_BASE_URL debe ser la URL pública del servidor para que Twilio pueda descargar los audios" });
      }
    }

    const contactos = parsearContactos(numeros, csvBuffer);
    if (!contactos.length) return res.status(400).json({ error: "No se encontraron números válidos" });

    const campaignId = `calls_${Date.now()}`;
    campaigns.set(campaignId, {
      id: campaignId,
      tipo: "llamadas",
      total: contactos.length,
      progreso: 0,
      estado: "en_progreso",
      resultados: [],
      inicio: new Date().toISOString(),
    });

    res.json({ campaignId, total: contactos.length, mensaje: `Iniciando ${contactos.length} llamadas` });

    llamarConConcurrencia(contactos, mensaje || "", audioUrl || "", parseInt(concurrencia), campaignId, listaVoces).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/whatsapp/bulk", upload.single("csv"), async (req, res) => {
  try {
    const { numeros, mensaje, concurrencia = 10 } = req.body;
    const csvBuffer = req.file ? req.file.buffer : null;

    if (!csvBuffer && !numeros) return res.status(400).json({ error: "Se requiere lista de números o archivo CSV" });
    if (!mensaje) return res.status(400).json({ error: "Se requiere mensaje" });

    const contactos = parsearContactos(numeros, csvBuffer);
    if (!contactos.length) return res.status(400).json({ error: "No se encontraron números válidos" });

    const campaignId = `wa_${Date.now()}`;
    campaigns.set(campaignId, {
      id: campaignId,
      tipo: "whatsapp",
      total: contactos.length,
      progreso: 0,
      estado: "en_progreso",
      resultados: [],
      inicio: new Date().toISOString(),
    });

    res.json({ campaignId, total: contactos.length, mensaje: `Enviando a ${contactos.length} contactos` });

    enviarWhatsAppConConcurrencia(contactos, mensaje, parseInt(concurrencia), campaignId).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/campaigns/:id", (req, res) => {
  const campaign = campaigns.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Campaña no encontrada" });
  res.json(campaign);
});

app.post("/api/webhooks/call-status", express.urlencoded({ extended: false }), (req, res) => {
  console.log("Estado llamada:", req.body.CallSid, req.body.CallStatus);
  res.sendStatus(200);
});

app.post("/api/webhooks/message-status", express.urlencoded({ extended: false }), (req, res) => {
  console.log("Estado mensaje:", req.body.MessageSid, req.body.MessageStatus);
  res.sendStatus(200);
});

app.get("/audio/:archivo", (req, res) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  const filePath = path.join(__dirname, "public", "audio", req.params.archivo);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "Archivo no encontrado" });
  }
});

function responderErrorVoces(res, err) {
  const status = err && err.codigo === "sin_clave" ? 503 : 502;
  res.status(status).json({ error: err && err.message ? err.message : "Error al consultar ElevenLabs" });
}

app.get("/api/voces", async (req, res) => {
  try {
    const voces = await servicioVoces.listarVoces();
    res.json({ voces });
  } catch (err) {
    responderErrorVoces(res, err);
  }
});

let muestras = { inicio: Date.now(), total: 0 };

app.post("/api/voces/muestra", async (req, res) => {
  const ahora = Date.now();
  if (ahora - muestras.inicio > 60000) muestras = { inicio: ahora, total: 0 };
  muestras.total += 1;
  if (muestras.total > 20) return res.status(429).json({ error: "Demasiadas muestras seguidas. Espera un minuto." });

  const vozId = String((req.body && req.body.vozId) || "").trim();
  if (!ID_VOZ.test(vozId)) return res.status(400).json({ error: "Voz no válida" });

  const base = String((req.body && req.body.texto) || "").trim() || "Hola {nombre}, esta es una muestra de mi voz. Así sonará el mensaje en tus llamadas.";
  const texto = construirMensaje(base, "Carlos").slice(0, 300);

  try {
    const audio = await servicioVoces.generarAudio(vozId, texto);
    res.type("audio/mpeg");
    res.sendFile(audio.archivo);
  } catch (err) {
    responderErrorVoces(res, err);
  }
});

app.get("/api/twilio/status", async (req, res) => {
  res.json(await verificarCuentaTwilio());
});

app.get("/api/config", (req, res) => {
  res.json({
    defaultCountryCode,
    fromNumber,
    whatsappFrom,
    publicBaseUrl,
  });
});

app.listen(PORT, () => {
  console.log(`BroadcastDemo corriendo en http://localhost:${PORT}`);
  console.log(`Número saliente: ${fromNumber}`);
  console.log(`WhatsApp: ${whatsappFrom}`);
  if (!process.env.PUBLIC_BASE_URL) {
    console.error("ATENCIÓN: PUBLIC_BASE_URL no está definido; los estados de las llamadas no llegarán desde Twilio.");
  }
  if (!servicioVoces.disponible()) {
    console.log("ElevenLabs: sin ELEVENLABS_API_KEY, las voces de ElevenLabs no estarán disponibles.");
  }
  verificarCuentaTwilio();
});