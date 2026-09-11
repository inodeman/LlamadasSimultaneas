require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "m7yTemJqdIqrcNleANfX";

const texto = "Buenos d\u00edas Guillermo, te informamos que tu folio es el 1234, tu beca para la universidad ha sido aceptada, adem\u00e1s de eso recibir\u00e1s una laptop con todas las capacidades que puedas necesitar. Muchas gracias, la direcci\u00f3n municipal te agradece.";

const body = JSON.stringify({
  text: texto,
  model_id: "eleven_multilingual_v2",
  voice_settings: { stability: 0.3, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true }
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

const outPath = path.join(__dirname, "public", "audio", "informe2.mp3");
const file = fs.createWriteStream(outPath);

const req = https.request(options, (res) => {
  res.pipe(file);
  file.on("finish", () => {
    file.close();
    console.log("Audio guardado en:", outPath);
    console.log("URL publica:", process.env.PUBLIC_BASE_URL + "/audio/informe2.mp3");
  });
});

req.on("error", (e) => console.error("Error:", e.message));
req.write(body);
req.end();