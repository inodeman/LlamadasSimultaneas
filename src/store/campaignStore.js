const campaigns = new Map();
let counter = 0;

function createCampaign(type, payload) {
  counter += 1;
  const id = `${type}-${Date.now()}-${counter}`;
  const campaign = {
    id,
    type,
    createdAt: new Date().toISOString(),
    payload,
    results: [],
    statusEvents: []
  };
  campaigns.set(id, campaign);
  return campaign;
}

function getCampaign(id) {
  return campaigns.get(id) || null;
}

function listCampaigns() {
  return Array.from(campaigns.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function registerStatusEvent(event) {
  for (const campaign of campaigns.values()) {
    const match = campaign.results.find((result) => result.sid && result.sid === event.sid);
    if (match) {
      match.lastStatus = event.status;
      campaign.statusEvents.push(event);
      return true;
    }
  }
  return false;
}

module.exports = { createCampaign, getCampaign, listCampaigns, registerStatusEvent };
