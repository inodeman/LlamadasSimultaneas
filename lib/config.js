"use strict";
require("dotenv").config();
const path = require("path");

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

function booleano(valor, defecto) {
  if (valor === undefined || valor === null || valor === "") return defecto;
  return /^(1|true|si|sí|yes|on)$/i.test(String(valor).trim());
}

const raiz = path.join(__dirname, "..");
const PORT = entero(process.env.PORT, 3000, 1, 65535);
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).trim().replace(/\/+$/, "");

const config = {
  version: "3.0.0",
  PORT,
  raiz,
  dirPublic: path.join(raiz, "public"),
  dirAudio: path.join(raiz, "public", "audio"),
  dirAudioGenerado: path.join(raiz, "public", "audio", "generado"),
  dirDatos: path.resolve(process.env.DATA_DIR || path.join(raiz, "data")),

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_PHONE_NUMBER,
    whatsappFrom: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
    validarFirma: booleano(process.env.VALIDAR_FIRMA_TWILIO, false),
  },
  publicBaseUrl,
  defaultCountryCode: String(process.env.DEFAULT_COUNTRY_CODE || "52").replace(/\D/g, "") || "52",
  zonaHoraria: process.env.TZ_REPORTES || "America/Mexico_City",

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    vozPredeterminada: process.env.ELEVENLABS_VOICE_ID || "m7yTemJqdIqrcNleANfX",
    modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    formato: process.env.ELEVENLABS_OUTPUT_FORMAT,
    concurrencia: entero(process.env.ELEVENLABS_CONCURRENCY, 3, 1, 10),
    baseUrl: process.env.ELEVENLABS_BASE_URL,
    ajustesVoz: { stability: 0.3, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
  },

  limites: {
    maxContactos: entero(process.env.MAX_CONTACTOS, 5000, 1, 50000),
    maxConcurrencia: entero(process.env.MAX_CONCURRENCIA, 50, 1, 200),
    maxVoces: 60,
    maxTextoVoz: 4500,
    maxBytesJson: "4mb",
    maxCampanasGuardadas: entero(process.env.MAX_CAMPANAS, 40, 5, 500),
    retencionAudiosDias: entero(process.env.RETENCION_AUDIOS_DIAS, 60, 1, 3650),
  },

  llamadas: {
    porSegundo: decimal(process.env.LLAMADAS_POR_SEGUNDO, 1, 0.2, 30),
    timbradoSegundos: entero(process.env.TIMBRADO_SEGUNDOS, 40, 10, 120),
    duracionMaximaSegundos: entero(process.env.DURACION_MAXIMA_SEGUNDOS, 0, 0, 14400),
    liberarSinContestarMs: process.env.ESPERA_FIN_LLAMADA_MS !== undefined
      ? Math.max(0, parseInt(process.env.ESPERA_FIN_LLAMADA_MS, 10) || 0)
      : 45000,
    esperaMaximaMs: 300000,
    detectarBuzon: booleano(process.env.DETECTAR_BUZON, false),
    whatsappPorSegundo: decimal(process.env.WHATSAPP_POR_SEGUNDO, 5, 0.5, 30),
  },

  autoPausa: {
    activa: booleano(process.env.AUTO_PAUSA_FALLOS, true),
    umbralPct: entero(process.env.UMBRAL_FALLOS_PCT, 60, 10, 100),
    ventana: entero(process.env.VENTANA_FALLOS, 30, 10, 200),
    minimo: 20,
    erroresSeguidos: entero(process.env.ERRORES_SEGUIDOS_PAUSA, 10, 3, 100),
  },

  seguridad: {
    usuario: process.env.PANEL_USUARIO || "",
    clave: process.env.PANEL_CLAVE || "",
  },
};

config.seguridad.activa = Boolean(config.seguridad.usuario && config.seguridad.clave);
config.usaLocalhost = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(publicBaseUrl);

module.exports = config;
