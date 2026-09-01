require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const path = require("path");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || "52";

const client = twilio(accountSid, authToken);

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

async function llamarConConcurrencia(contactos, mensajeTemplate, audioUrl, concurrencia, campaignId) {
  const resultados = [];
  const campaign = campaigns.get(campaignId);

  for (let i = 0; i < contactos.length; i += concurrencia) {
    const lote = contactos.slice(i, i + concurrencia);
    const promesas = lote.map(async ({ numero, nombre }) => {
      const mensaje = construirMensaje(mensajeTemplate, nombre);
      try {
        let twiml;
        if (audioUrl) {
          twiml = `<Response><Play>${audioUrl}</Play></Response>`;
        } else {
          const textoEscapado = mensaje.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          twiml = `<Response><Say language="es-MX" voice="Polly.Mia">${textoEscapado}</Say></Response>`;
        }

        const call = await client.calls.create({
          to: numero,
          from: fromNumber,
          twiml,
          statusCallback: `${publicBaseUrl}/api/webhooks/call-status`,
          statusCallbackMethod: "POST",
        });

        const res = { numero, nombre, sid: call.sid, estado: "iniciada", error: null };
        if (campaign) campaign.resultados.push(res);
        return res;
      } catch (err) {
        const res = { numero, nombre, sid: null, estado: "error", error: err.message };
        if (campaign) campaign.resultados.push(res);
        return res;
      }
    });

    const loteResultados = await Promise.all(promesas);
    resultados.push(...loteResultados);
    if (campaign) campaign.progreso = Math.min(100, Math.round((resultados.length / contactos.length) * 100));
  }

  if (campaign) campaign.estado = "completada";
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
        const res = { numero, nombre, sid: null, estado: "error", error: err.message };
        if (campaign) campaign.resultados.push(res);
        return res;
      }
    });

    const loteResultados = await Promise.all(promesas);
    resultados.push(...loteResultados);
    if (campaign) campaign.progreso = Math.min(100, Math.round((resultados.length / contactos.length) * 100));
  }

  if (campaign) campaign.estado = "completada";
  return resultados;
}

app.post("/api/calls/bulk", upload.single("csv"), async (req, res) => {
  try {
    const { numeros, mensaje, audioUrl, concurrencia = 10 } = req.body;
    const csvBuffer = req.file ? req.file.buffer : null;

    if (!csvBuffer && !numeros) return res.status(400).json({ error: "Se requiere lista de números o archivo CSV" });
    if (!mensaje && !audioUrl) return res.status(400).json({ error: "Se requiere mensaje o URL de audio" });

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

    llamarConConcurrencia(contactos, mensaje || "", audioUrl || "", parseInt(concurrencia), campaignId).catch(console.error);
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
});