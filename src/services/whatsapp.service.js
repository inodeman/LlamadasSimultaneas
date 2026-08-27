const { client, whatsappNumber, publicBaseUrl } = require("../config/twilio");
const { runWithConcurrency } = require("../utils/concurrency");

async function launchWhatsappCampaign({ numbers, message, concurrency }) {
  const statusCallback = publicBaseUrl ? `${publicBaseUrl}/api/webhooks/message-status` : null;

  const outcomes = await runWithConcurrency(numbers, concurrency, (to) => {
    const params = {
      from: `whatsapp:${whatsappNumber}`,
      to: `whatsapp:${to}`,
      body: message
    };
    if (statusCallback) {
      params.statusCallback = statusCallback;
    }
    return client.messages.create(params);
  });

  return numbers.map((to, index) => {
    const outcome = outcomes[index];
    if (outcome.status === "fulfilled") {
      return { to, ok: true, sid: outcome.value.sid, lastStatus: outcome.value.status, error: null };
    }
    return { to, ok: false, sid: null, lastStatus: "failed", error: outcome.reason.message };
  });
}

module.exports = { launchWhatsappCampaign };
