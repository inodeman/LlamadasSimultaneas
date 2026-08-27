const express = require("express");
const { registerStatusEvent } = require("../store/campaignStore");

const router = express.Router();

router.post("/call-status", (req, res) => {
  const event = {
    kind: "call",
    sid: req.body.CallSid,
    to: req.body.To,
    status: req.body.CallStatus,
    timestamp: new Date().toISOString()
  };
  registerStatusEvent(event);
  console.log(`[webhook] llamada ${event.sid} -> ${event.status}`);
  res.sendStatus(200);
});

router.post("/message-status", (req, res) => {
  const event = {
    kind: "message",
    sid: req.body.MessageSid,
    to: req.body.To,
    status: req.body.MessageStatus,
    timestamp: new Date().toISOString()
  };
  registerStatusEvent(event);
  console.log(`[webhook] mensaje ${event.sid} -> ${event.status}`);
  res.sendStatus(200);
});

module.exports = router;
