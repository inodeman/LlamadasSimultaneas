"use strict";
const http = require("http");

const VOCES = [
  ["VozUnoAAAAAAAAAAAAAA", "Alice", "female", "British"],
  ["VozDosBBBBBBBBBBBBBB", "Bill", "male", "American"],
  ["VozTresCCCCCCCCCCCCC", "Brian", "male", "American"],
  ["MALAvozDDDDDDDDDDDDD", "Voz de pago", "female", "Mexican"],
];

class FalsoEleven {
  constructor({ limite = 100000, usados = 1000 } = {}) {
    this.limite = limite;
    this.usados = usados;
    this.solicitudes = [];
    this.audios = 0;
    this.caracteres = 0;
    this.sinPago = false;
    this.servidor = http.createServer((req, res) => this.atender(req, res));
  }

  iniciar() {
    return new Promise((ok) => this.servidor.listen(0, "127.0.0.1", () => { this.url = `http://127.0.0.1:${this.servidor.address().port}`; ok(this.url); }));
  }

  cerrar() {
    return new Promise((ok) => { if (this.servidor.closeAllConnections) this.servidor.closeAllConnections(); this.servidor.close(ok); });
  }

  responder(res, estado, cuerpo, tipo = "application/json") {
    res.writeHead(estado, { "Content-Type": tipo });
    res.end(typeof cuerpo === "string" || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo));
  }

  atender(req, res) {
    const partes = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => {
      const cuerpo = Buffer.concat(partes).toString("utf8");
      const url = new URL(req.url, "http://x");
      this.solicitudes.push({ metodo: req.method, ruta: url.pathname, consulta: url.search, cuerpo, clave: req.headers["xi-api-key"] });
      if (req.headers["xi-api-key"] !== "clave_buena") {
        return this.responder(res, 401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
      }
      let m;
      if (req.method === "GET" && url.pathname === "/v2/voices") {
        return this.responder(res, 200, {
          voices: VOCES.map(([id, name, gender, accent]) => ({ voice_id: id, name, category: "premade", labels: { gender, accent, descriptive: "natural" }, preview_url: `${this.url}/muestra/${id}.mp3` })),
          has_more: false, next_page_token: null,
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/user/subscription") {
        return this.responder(res, 200, { tier: "creator", status: "active", character_count: this.usados + this.caracteres, character_limit: this.limite, can_extend_character_limit: false, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 10, voice_slots_used: 4, voice_limit: 30 });
      }
      if (req.method === "GET" && url.pathname === "/v1/shared-voices") {
        const voces = Array.from({ length: 20 }, (_, i) => ({ voice_id: `Biblioteca${String(i).padStart(2, "0")}XXXXXXXXXX`, public_owner_id: `dueno${String(i).padStart(8, "0")}`, name: `Voz de biblioteca ${i + 1}`, gender: i % 2 ? "male" : "female", accent: "mexican", language: "es", preview_url: `${this.url}/muestra/b${i}.mp3`, usage_character_count_1y: 100000 - i * 1000, free_users_allowed: true }));
        return this.responder(res, 200, { voices: voces, has_more: false });
      }
      if (req.method === "POST" && (m = /^\/v1\/voices\/add\/([^/]+)\/([^/]+)$/.exec(url.pathname))) {
        return this.responder(res, 200, { voice_id: m[2] });
      }
      if (req.method === "POST" && (m = /^\/v1\/text-to-speech\/([^/]+)$/.exec(url.pathname))) {
        const voz = decodeURIComponent(m[1]);
        const datos = JSON.parse(cuerpo || "{}");
        if (this.sinPago) return this.responder(res, 402, { detail: { status: "payment_issue", message: "Your subscription payment failed." } });
        if (voz.startsWith("MALA")) return this.responder(res, 402, { detail: { status: "paid_plan_required", message: "Free users cannot use library voices via the API." } });
        if (!datos.text) return this.responder(res, 422, { detail: [{ msg: "text is required" }] });
        this.audios += 1;
        this.caracteres += datos.text.length;
        const bytes = Math.max(4000, Math.round(datos.text.length * 160));
        return this.responder(res, 200, Buffer.alloc(bytes, 0x49), "audio/mpeg");
      }
      return this.responder(res, 404, { detail: { status: "not_found", message: `Ruta no simulada: ${req.method} ${url.pathname}` } });
    });
  }
}

module.exports = { FalsoEleven, VOCES };
