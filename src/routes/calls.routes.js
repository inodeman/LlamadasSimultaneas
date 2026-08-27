const express = require("express");
const { prepareNumbers } = require("../utils/phone");
const { launchCallCampaign } = require("../services/calls.service");
const { createCampaign } = require("../store/campaignStore");

const router = express.Router();

router.post("/bulk", async (req, res) => {
  const { numbers, message, audioUrl, voice, concurrency } = req.body || {};
  const { valid, invalid } = prepareNumbers(numbers);

  if (valid.length === 0) {
    return res.status(400).json({ error: "No se recibieron números válidos." });
  }
  if (!audioUrl && (!message || !String(message).trim())) {
    return res.status(400).json({ error: "Se requiere un mensaje o una URL de audio." });
  }

  const campaign = createCampaign("calls", {
    message: String(message || "").trim(),
    audioUrl: audioUrl ? String(audioUrl).trim() : null,
    total: valid.length
  });

  try {
    const results = await launchCallCampaign({
      numbers: valid,
      message: String(message || "").trim(),
      audioUrl: audioUrl ? String(audioUrl).trim() : null,
      voice,
      concurrency: Math.min(Math.max(parseInt(concurrency, 10) || 10, 1), 50)
    });
    campaign.results = results;
    const sent = results.filter((item) => item.ok).length;
    return res.json({
      campaignId: campaign.id,
      total: valid.length,
      sent,
      failed: valid.length - sent,
      invalid,
      results
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
