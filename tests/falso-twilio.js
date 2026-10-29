"use strict";
const http = require("http");
const twilio = require("twilio");

function rfc2822(ms) {
  return ms ? new Date(ms).toUTCString().replace("GMT", "+0000") : null;
}

class FalsoTwilio {
  constructor({ accountSid, authToken, urlApp, velocidad = 1, duracionLlamada = 3, avisos = true, saldo = "25.5000" }) {
    this.accountSid = accountSid || "AC00000000000000000000000000000000";
    this.authToken = authToken || "token_falso";
    this.urlApp = urlApp;
    this.velocidad = velocidad;
    this.duracionLlamada = duracionLlamada;
    this.avisos = avisos;
    this.saldo = saldo;
    this.llamadas = new Map();
    this.mensajes = new Map();
    this.solicitudes = [];
    this.contador = 0;
    this.activas = 0;
    this.maxActivas = 0;
    this.temporizadores = new Set();
    this.cliente = twilio(this.accountSid, this.authToken, { httpClient: this });
    this.alertas = [];
  }

  pausa(ms, fn) {
    const t = setTimeout(() => { this.temporizadores.delete(t); fn(); }, Math.max(1, ms * this.velocidad));
    this.temporizadores.add(t);
  }

  detener() {
    this.temporizadores.forEach((t) => clearTimeout(t));
    this.temporizadores.clear();
  }

  enviarAviso(ruta, campos) {
    if (!this.urlApp) return;
    const cuerpo = new URLSearchParams(campos).toString();
    const req = http.request(`${this.urlApp}${ruta}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(cuerpo) } }, (res) => res.resume());
    req.on("error", () => {});
    req.end(cuerpo);
  }

  aviso(llamada, extra = {}) {
    if (!this.avisos || llamada.sinAvisos) return;
    this.enviarAviso("/api/webhooks/call-status", {
      CallSid: llamada.sid, CallStatus: llamada.status, From: llamada.from, To: llamada.to, Direction: "outbound-api", ...extra,
    });
  }

  json(llamada) {
    return {
      sid: llamada.sid, account_sid: this.accountSid, to: llamada.to, from: llamada.from, status: llamada.status, direction: "outbound-api",
      date_created: rfc2822(llamada.creada), date_updated: rfc2822(Date.now()), start_time: rfc2822(llamada.inicio), end_time: rfc2822(llamada.fin),
      duration: llamada.duracion === null ? null : String(llamada.duracion), price: llamada.precio, price_unit: "USD", answered_by: llamada.contestadoPor || null,
      parent_call_sid: null, uri: `/2010-04-01/Accounts/${this.accountSid}/Calls/${llamada.sid}.json`,
    };
  }

  crearLlamada(datos) {
    const to = datos.To;
    const ultimo = parseInt(String(to).slice(-1), 10);
    if (ultimo === 9) {
      return { statusCode: 400, body: { code: 21211, message: `The 'To' number ${to} is not a valid phone number.`, more_info: "https://www.twilio.com/docs/errors/21211", status: 400 } };
    }
    this.contador += 1;
    const sid = `CA${String(this.contador).padStart(32, "0")}`;
    const ahora = Date.now();
    const llamada = { sid, to, from: datos.From, status: "queued", creada: ahora, inicio: null, fin: null, duracion: null, precio: null, contestadoPor: datos.MachineDetection ? "human" : null, parametros: datos, sinAvisos: ultimo === 8 };
    this.llamadas.set(sid, llamada);
    this.activas += 1;
    this.maxActivas = Math.max(this.maxActivas, this.activas);
    this.aviso(llamada, { CallStatus: "initiated" });

    const terminar = (estado, segundos, extra = {}) => {
      llamada.status = estado;
      llamada.fin = Date.now();
      llamada.duracion = segundos;
      if (estado === "completed" && segundos > 0) llamada.precio = "-0.0130";
      this.activas = Math.max(0, this.activas - 1);
      this.aviso(llamada, { CallDuration: String(segundos), Duration: String(Math.ceil(segundos / 60)), ...extra });
    };

    if (ultimo === 7) {
      this.pausa(300, () => {
        llamada.status = "failed";
        this.alertas.push({ resourceSid: sid, errorCode: "32011", texto: "Number not reachable" });
        terminar("failed", 0, { SipResponseCode: "404" });
      });
    } else {
      this.pausa(300, () => { llamada.status = "ringing"; this.aviso(llamada); });
      if (ultimo <= 4 || ultimo === 8) {
        this.pausa(1000, () => {
          if (llamada.status === "canceled") return;
          llamada.status = "in-progress";
          llamada.inicio = Date.now();
          this.aviso(llamada);
        });
        this.pausa(1000 + this.duracionLlamada * 1000, () => { if (llamada.status === "in-progress") terminar("completed", this.duracionLlamada); });
      } else if (ultimo === 5) {
        this.pausa(1500, () => { if (llamada.status === "ringing") terminar("no-answer", 0); });
      } else if (ultimo === 6) {
        this.pausa(900, () => { if (llamada.status === "ringing") terminar("busy", 0); });
      }
    }
    return { statusCode: 201, body: this.json(llamada) };
  }

  actualizarLlamada(sid, datos) {
    const llamada = this.llamadas.get(sid);
    if (!llamada) return { statusCode: 404, body: { code: 20404, message: "The requested resource was not found", status: 404, more_info: "https://www.twilio.com/docs/errors/20404" } };
    if (datos.Status === "canceled" && ["queued", "ringing"].includes(llamada.status)) {
      llamada.status = "canceled";
      llamada.fin = Date.now();
      llamada.duracion = 0;
      this.activas = Math.max(0, this.activas - 1);
      this.aviso(llamada, { CallDuration: "0", Duration: "0" });
    }
    return { statusCode: 200, body: this.json(llamada) };
  }

  crearMensaje(datos) {
    this.contador += 1;
    const sid = `SM${String(this.contador).padStart(32, "0")}`;
    const mensaje = { sid, to: datos.To, from: datos.From, body: datos.Body, status: "queued" };
    this.mensajes.set(sid, mensaje);
    const ultimo = parseInt(String(datos.To).slice(-1), 10);
    this.pausa(300, () => { mensaje.status = ultimo === 7 ? "undelivered" : "delivered"; if (ultimo === 7) mensaje.errorCode = 63024; this.enviarAviso("/api/webhooks/message-status", { MessageSid: sid, MessageStatus: mensaje.status, ...(ultimo === 7 ? { ErrorCode: "63024" } : {}) }); });
    return { statusCode: 201, body: { sid, status: "queued", to: mensaje.to, from: mensaje.from, body: mensaje.body, date_created: rfc2822(Date.now()), error_code: null, error_message: null } };
  }

  async request(opts) {
    this.solicitudes.push({ metodo: opts.method, uri: opts.uri, datos: opts.data, params: opts.params });
    const uri = String(opts.uri);
    const metodo = String(opts.method).toLowerCase();
    const ok = (body, statusCode = 200) => ({ statusCode, body, headers: {} });
    let m;

    if (opts.username !== this.accountSid || opts.password !== this.authToken) {
      return ok({ code: 20003, message: "Authenticate", status: 401, more_info: "https://www.twilio.com/docs/errors/20003" }, 401);
    }
    if ((m = /\/Accounts\/[^/]+\/Calls\.json$/.exec(uri))) {
      if (metodo === "post") return this.crearLlamada(opts.data || {});
      const p = opts.params || {};
      let lista = [...this.llamadas.values()];
      if (p.To) lista = lista.filter((l) => l.to === p.To);
      if (p.From) lista = lista.filter((l) => l.from === p.From);
      lista = lista.sort((a, b) => b.creada - a.creada).slice(0, p.PageSize ? parseInt(p.PageSize, 10) : 50);
      return ok({ calls: lista.map((l) => this.json(l)), next_page_uri: null, page: 0, page_size: lista.length });
    }
    if ((m = /\/Accounts\/[^/]+\/Calls\/(CA\w+)\/Notifications\.json$/.exec(uri))) {
      const sid = m[1];
      const alertas = this.alertas.filter((a) => a.resourceSid === sid);
      return ok({ notifications: alertas.map((a, i) => ({ sid: `NO${i}`, error_code: a.errorCode, message_text: a.texto, message_date: rfc2822(Date.now()), more_info: `https://www.twilio.com/docs/errors/${a.errorCode}`, log: "0", call_sid: sid })), next_page_uri: null, page: 0, page_size: 50 });
    }
    if ((m = /\/Accounts\/[^/]+\/Calls\/(CA\w+)\.json$/.exec(uri))) {
      const llamada = this.llamadas.get(m[1]);
      if (metodo === "post") return this.actualizarLlamada(m[1], opts.data || {});
      if (!llamada) return ok({ code: 20404, message: "The requested resource was not found", status: 404, more_info: "https://www.twilio.com/docs/errors/20404" }, 404);
      return ok(this.json(llamada));
    }
    if (/\/Accounts\/[^/]+\/Messages\.json$/.test(uri)) {
      if (metodo === "post") return this.crearMensaje(opts.data || {});
      return ok({ messages: [], next_page_uri: null, page: 0, page_size: 0 });
    }
    if ((m = /\/Accounts\/[^/]+\/Messages\/(SM\w+)\.json$/.exec(uri))) {
      const mensaje = this.mensajes.get(m[1]);
      if (!mensaje) return ok({ code: 20404, message: "not found", status: 404 }, 404);
      return ok({ sid: mensaje.sid, status: mensaje.status, error_code: mensaje.errorCode || null, error_message: null, to: mensaje.to, from: mensaje.from });
    }
    if (/\/Accounts\/[^/]+\/Balance\.json$/.test(uri)) return ok({ account_sid: this.accountSid, balance: this.saldo, currency: "USD" });
    if (/\/Accounts\/[^/]+\/IncomingPhoneNumbers\.json$/.test(uri)) {
      return ok({ incoming_phone_numbers: [{ sid: "PN1", phone_number: (opts.params || {}).PhoneNumber || "+526567380528", capabilities: { voice: true, sms: true, mms: false } }], next_page_uri: null, page: 0, page_size: 1 });
    }
    if (/\/Accounts\/[^/]+\/OutgoingCallerIds\.json$/.test(uri)) return ok({ outgoing_caller_ids: [], next_page_uri: null, page: 0, page_size: 0 });
    if (/\/Accounts\/[^/]+\.json$/.test(uri)) return ok({ sid: this.accountSid, friendly_name: "Cuenta de prueba", status: "active", type: "Full" });
    if (/DialingPermissions\/Countries\/MX$/.test(uri)) {
      return ok({ iso_code: "MX", name: "Mexico", continent: "NORTH_AMERICA", country_codes: ["52"], low_risk_numbers_enabled: true, high_risk_special_numbers_enabled: false, high_risk_tollfraud_numbers_enabled: false, url: uri, links: {} });
    }
    if (/monitor\.twilio\.com\/v1\/Alerts/.test(uri)) {
      const alertas = this.alertas.map((a, i) => ({ sid: `NO${i}`, error_code: a.errorCode, alert_text: a.texto, resource_sid: a.resourceSid, date_created: new Date().toISOString(), log_level: "error" }));
      return ok({ alerts: alertas, meta: { page: 0, page_size: 1000, first_page_url: uri, previous_page_url: null, url: uri, next_page_url: null, key: "alerts" } });
    }
    return ok({ code: 20404, message: `Ruta no simulada: ${metodo} ${uri}`, status: 404 }, 404);
  }
}

module.exports = { FalsoTwilio };
