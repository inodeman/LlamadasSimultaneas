const twilio = require("twilio");

const requiredVars = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_WHATSAPP_NUMBER"
];

const missing = requiredVars.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Faltan variables de entorno: ${missing.join(", ")}`);
  console.error("Copia .env.example a .env y coloca tus credenciales de Twilio.");
  process.exit(1);
}

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

module.exports = {
  client,
  voiceNumber: process.env.TWILIO_PHONE_NUMBER,
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || "+52"
};
