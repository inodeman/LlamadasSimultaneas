// generar_audio.js
const https = require("https");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "m7yTemJqdIqrcNleANfX";

const texto = [
  "Hola Alejandro P\u00e9rez Escalante.",
  "Le invitamos a sintonizar hoy el Segundo Informe de Gobierno de la Presidenta Claudia Sheinbaum Pardo,",
  "a partir de las 11 de la ma\u00f1ana.",
  "Siga la transmisi\u00f3n en vivo a trav\u00e9s de las redes sociales oficiales.",
  "No se lo pierda."
].join(" ");

const body = JSON.stringify({
  text: texto,
  model_id: "eleven_multilingual_v2",
  voice_settings: { stability: 0.5, similarity_boost: 0.8 }
});

const options = {
  hostname: "api.elevenlabs.io",
  path: `/v1/text-to-speech/${VOICE_ID}`,
  method: "POST",
  headers: {
    "xi-api-key": ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  }
};

const outPath = path.join(__dirname, "public", "audio", "informe.mp3");
const file = fs.createWriteStream(outPath);

const req = https.request(options, (res) => {
  res.pipe(file);
  file.on("finish", () => {
    file.close();
    console.log("Audio guardado en:", outPath);
    console.log("URL publica:", process.env.PUBLIC_BASE_URL + "/audio/informe.mp3");
  });
});

req.on("error", (e) => console.error("Error:", e.message));
req.write(body);
req.end();