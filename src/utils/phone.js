const { defaultCountryCode } = require("../config/twilio");

function parseNumberList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }
  if (typeof raw === "string") {
    return raw.split(/[\n,;]+/);
  }
  return [];
}

function normalizeNumber(value) {
  const cleaned = String(value).replace(/[^\d+]/g, "");
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith("+")) {
    return `+${cleaned.replace(/\D/g, "")}`;
  }
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${defaultCountryCode}${digits}`;
  }
  return `+${digits}`;
}

function prepareNumbers(raw) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const item of parseNumberList(raw)) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = normalizeNumber(trimmed);
    if (!normalized || normalized.replace(/\D/g, "").length < 10) {
      invalid.push(trimmed);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
  }
  return { valid, invalid };
}

module.exports = { prepareNumbers };
