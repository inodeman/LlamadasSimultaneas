require("dotenv").config();

const path = require("path");
const express = require("express");

const { voiceNumber, whatsappNumber, publicBaseUrl } = require("./config/twilio");
const callsRoutes = require("./routes/calls.routes");
const whatsappRoutes = require("./routes/whatsapp.routes");
const webhooksRoutes = require("./routes/webhooks.routes");
const campaignsRoutes = require("./routes/campaigns.routes");

const app = express();
const port = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    voiceNumber,
    whatsappNumber,
    webhooksEnabled: Boolean(publicBaseUrl)
  });
});

app.use("/api/calls", callsRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/webhooks", webhooksRoutes);
app.use("/api/campaigns", campaignsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port}`);
  console.log(`Número de voz: ${voiceNumber}`);
  console.log(`Número de WhatsApp: ${whatsappNumber}`);
  if (!publicBaseUrl) {
    console.log("PUBLIC_BASE_URL vacío: los webhooks de estado están desactivados (opcional).");
  }
});
