const twilio = require("twilio");
const { client, voiceNumber, publicBaseUrl } = require("../config/twilio");
const { runWithConcurrency } = require("../utils/concurrency");

function buildTwiml({ message, audioUrl, voice }) {
  const response = new twilio.twiml.VoiceResponse();
  if (audioUrl) {
    response.play(audioUrl);
    response.pause({ length: 1 });
    response.play(audioUrl);
  } else {
    const sayOptions = { voice: voice || "Polly.Mia", language: "es-MX" };
    response.say(sayOptions, message);
    response.pause({ length: 1 });
    response.say(sayOptions, message);
  }
  return response.toString();
}

async function launchCallCampaign({ numbers, message, audioUrl, voice, concurrency }) {
  const twiml = buildTwiml({ message, audioUrl, voice });
  const statusCallback = publicBaseUrl ? `${publicBaseUrl}/api/webhooks/call-status` : null;

  const outcomes = await runWithConcurrency(numbers, concurrency, (to) => {
    const params = { to, from: voiceNumber, twiml };
    if (statusCallback) {
      params.statusCallback = statusCallback;
      params.statusCallbackMethod = "POST";
      params.statusCallbackEvent = ["initiated", "ringing", "answered", "completed"];
    }
    return client.calls.create(params);
  });

  return numbers.map((to, index) => {
    const outcome = outcomes[index];
    if (outcome.status === "fulfilled") {
      return { to, ok: true, sid: outcome.value.sid, lastStatus: outcome.value.status, error: null };
    }
    return { to, ok: false, sid: null, lastStatus: "failed", error: outcome.reason.message };
  });
}

module.exports = { launchCallCampaign };
