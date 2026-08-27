const express = require("express");
const { prepareNumbers } = require("../utils/phone");
const { launchWhatsappCampaign } = require("../services/whatsapp.service");
const { createCampaign } = require("../store/campaignStore");

const router = express.Router();

router.post("/bulk", async (req, res) => {
  const { numbers, message, concurrency } = req.body || {};
  const { valid, invalid } = prepareNumbers(numbers);

  if (valid.length === 0) {
    return res.status(400).json({ error: "No se recibieron números válidos." });
  }
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: "Se requiere el texto del mensaje." });
  }

  const campaign = createCampaign("whatsapp", {
    message: String(message).trim(),
    total: valid.length
  });

  try {
    const results = await launchWhatsappCampaign({
      numbers: valid,
      message: String(message).trim(),
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
