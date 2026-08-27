const express = require("express");
const { getCampaign, listCampaigns } = require("../store/campaignStore");

const router = express.Router();

router.get("/", (req, res) => {
  const items = listCampaigns().map((campaign) => ({
    id: campaign.id,
    type: campaign.type,
    createdAt: campaign.createdAt,
    total: campaign.results.length
  }));
  res.json({ campaigns: items });
});

router.get("/:id", (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: "Campaña no encontrada." });
  }
  res.json(campaign);
});

module.exports = router;
