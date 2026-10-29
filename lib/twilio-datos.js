"use strict";
const { enParalelo } = require("./util");
const { aplicarEstadoLlamada, aplicarEstadoMensaje, esTerminalLlamada, esTerminalMensaje } = require("./estados");
const { explicarLlamadaTerminada } = require("./errores");

const VENTANA_VIGENCIA_MS = 2 * 60 * 60 * 1000;
const VENTANA_WHATSAPP_MS = 30 * 60 * 1000;
const MAX_REINTENTOS_PRECIO = 4;

class Datos {
  constructor() {
    this.conciliando = false;
    this.enriqueciendo = new Set();
    this.temporizadores = new Map();
    this.umbralReciente = 45000;
    this.umbralAntiguo = 15000;
  }

  vigente(g, c, ahora) {
    if (g.estaActiva(c) || c.estado === "interrumpida") return true;
    const fin = c.fin ? new Date(c.fin).getTime() : 0;
    return Boolean(fin) && ahora - fin < VENTANA_VIGENCIA_MS;
  }

  esPendiente(c, r, ahora) {
    if (!r.sid) return false;
    if (c.tipo === "whatsapp") return !esTerminalMensaje(r) && ahora - (r.tCrea || ahora) < VENTANA_WHATSAPP_MS;
    return !esTerminalLlamada(r);
  }

  async conciliar(g) {
    if (this.conciliando || !g.client) return;
    this.conciliando = true;
    try {
      const ahora = Date.now();
      const candidatos = [];
      for (const c of g.campanas.values()) {
        if (!this.vigente(g, c, ahora)) continue;
        for (const r of c.resultados) {
          if (!this.esPendiente(c, r, ahora)) continue;
          const ultimo = r.ultimoUpdate || r.tCrea || 0;
          const edad = ahora - (r.tCrea || ahora);
          const umbral = edad > 120000 ? this.umbralAntiguo : this.umbralReciente;
          if (ahora - ultimo < umbral) continue;
          if ((r.reconFallos || 0) >= 5 && ahora - (r.ultimaConsulta || 0) < 120000) continue;
          candidatos.push({ c, r, prioridad: ultimo });
        }
      }
      if (!candidatos.length) return;
      candidatos.sort((a, b) => a.prioridad - b.prioridad);
      await enParalelo(candidatos.slice(0, 40), 8, ({ c, r }) => this.consultarFila(g, c, r));
    } finally {
      this.conciliando = false;
    }
  }

  async conciliarCampana(g, c) {
    if (!g.client) return;
    const ahora = Date.now();
    const filas = c.resultados.filter((r) => this.esPendiente(c, r, ahora));
    await enParalelo(filas, 8, (r) => this.consultarFila(g, c, r));
  }

  async consultarFila(g, c, r) {
    const ahora = Date.now();
    r.ultimaConsulta = ahora;
    try {
      if (c.tipo === "whatsapp") {
        const m = await g.client.messages(r.sid).fetch();
        r.reconFallos = 0;
        if (m.errorCode) g.asignarErrorMensaje(c, r, m.errorCode, m.errorMessage);
        if (aplicarEstadoMensaje(r, m.status, { ahora })) g.cambio(c, r);
        r.ultimoUpdate = ahora;
        return;
      }
      const ll = await g.client.calls(r.sid).fetch();
      r.reconFallos = 0;
      const cambio = aplicarEstadoLlamada(r, ll.status, { duracion: ll.duration, answeredBy: ll.answeredBy, precio: ll.price, ahora });
      if (ll.endTime && esTerminalLlamada(r)) r.tFin = new Date(ll.endTime).getTime() || r.tFin;
      r.ultimoUpdate = ahora;
      if (cambio) g.alCambiarLlamada(c, r, true);
    } catch (err) {
      r.reconFallos = (r.reconFallos || 0) + 1;
      r.ultimoUpdate = ahora;
      if (err && err.status === 404 && c.tipo === "llamadas") {
        r.reconFallos = 99;
        aplicarEstadoLlamada(r, "failed", { ahora });
        g.alCambiarLlamada(c, r, true);
        g.reasignarIncidencia(c, r, {
          fuente: "twilio", codigo: "no-encontrada", titulo: "Twilio no encontró la llamada",
          detalle: "El identificador de la llamada ya no existe en Twilio.", accion: "Revisa el registro en console.twilio.com.",
        });
      }
    }
  }

  programarEnriquecimiento(g, c, retardoMs) {
    if (!g.client || c.tipo !== "llamadas") return;
    clearTimeout(this.temporizadores.get(c.id));
    const t = setTimeout(() => {
      this.temporizadores.delete(c.id);
      this.enriquecer(g, c).catch((err) => console.error(`Enriquecimiento ${c.id}: ${err.message}`));
    }, retardoMs);
    if (t.unref) t.unref();
    this.temporizadores.set(c.id, t);
  }

  cancelarTemporizadores() {
    this.temporizadores.forEach((t) => clearTimeout(t));
    this.temporizadores.clear();
  }

  async enriquecer(g, c, manual = false) {
    if (!g.client) throw new Error("Twilio no está configurado");
    if (this.enriqueciendo.has(c.id)) return c.enriquecimiento;
    this.enriqueciendo.add(c.id);
    if (manual) c.enriquecimientoIntentos = 0;
    const estado = { estado: "en_curso", hecho: 0, total: 0, ts: Date.now(), alertas: 0, conCodigo: 0, sinPrecio: 0, nota: "" };
    c.enriquecimiento = estado;
    g.cambio(c);
    try {
      await this.conciliarCampana(g, c);
      const llamadas = c.resultados.filter((r) => r.sid && esTerminalLlamada(r));

      const porConsultar = llamadas.filter((r) => (r.cat === "contesto" || r.cat === "buzon") && !r.enriquecida);
      const problemas = llamadas.filter((r) => r.cat === "fallida");
      estado.total = porConsultar.length + problemas.length;
      g.cambio(c);

      await enParalelo(porConsultar, 6, async (r) => {
        try {
          const ll = await g.client.calls(r.sid).fetch();
          aplicarEstadoLlamada(r, ll.status, { duracion: ll.duration, answeredBy: ll.answeredBy, precio: ll.price });
          if (ll.price !== null && ll.price !== undefined && ll.price !== "") r.enriquecida = true;
          g.cambio(c, r);
        } catch (err) { }
        estado.hecho += 1;
        if (estado.hecho % 10 === 0) g.cambio(c);
      });
      estado.sinPrecio = porConsultar.filter((r) => !r.enriquecida).length;

      const alertas = await this.alertasDe(g, c, estado);
      this.asignarAlertas(g, c, llamadas, alertas, estado);

      const sinCodigo = problemas.filter((r) => !r.incidenciaDeTwilio).slice(0, 200);
      await enParalelo(sinCodigo, 5, async (r) => {
        try {
          const lista = await g.client.calls(r.sid).notifications.list({ limit: 5 });
          const n = lista.find((x) => x.errorCode);
          if (n) {
            const inc = explicarLlamadaTerminada("failed", r.sip, { codigo: String(n.errorCode), texto: n.messageText });
            r.incidenciaDeTwilio = true;
            estado.conCodigo += 1;
            g.reasignarIncidencia(c, r, inc);
          }
        } catch (err) { }
        estado.hecho += 1;
        if (estado.hecho % 10 === 0) g.cambio(c);
      });

      estado.estado = "hecho";
      estado.ts = Date.now();
      estado.hecho = estado.total;
      g.cambio(c);
      g.vaciar(c, true);

      if (estado.sinPrecio > 0 && (c.enriquecimientoIntentos || 0) < MAX_REINTENTOS_PRECIO) {
        c.enriquecimientoIntentos = (c.enriquecimientoIntentos || 0) + 1;
        this.programarEnriquecimiento(g, c, 120000);
      }
      return estado;
    } catch (err) {
      estado.estado = "error";
      estado.nota = err.message;
      g.cambio(c);
      throw err;
    } finally {
      this.enriqueciendo.delete(c.id);
    }
  }

  async alertasDe(g, c, estado) {
    const mapa = new Map();
    const inicioMs = new Date(c.inicio || c.creada).getTime() || Date.now();
    const finMs = c.fin ? new Date(c.fin).getTime() : Date.now();
    const inicio = new Date(Math.max(Date.now() - 29 * 86400000, inicioMs - 10 * 60000));
    const fin = new Date(Math.min(Date.now() + 60000, finMs + 30 * 60000));
    try {
      const lista = await g.client.monitor.v1.alerts.list({ logLevel: "error", startDate: inicio, endDate: fin, pageSize: 1000, limit: 5000 });
      estado.alertas = lista.length;
      lista.forEach((a) => {
        if (!a.resourceSid || !/^CA/.test(a.resourceSid)) return;
        if (!mapa.has(a.resourceSid)) mapa.set(a.resourceSid, { codigo: String(a.errorCode || ""), texto: a.alertText || "" });
      });
    } catch (err) {
      estado.nota = `No se pudieron leer las alertas de Twilio (${err.message}).`;
    }
    return mapa;
  }

  asignarAlertas(g, c, llamadas, alertas, estado) {
    llamadas.forEach((r) => {
      const alerta = alertas.get(r.sid);
      if (!alerta || !alerta.codigo) return;
      if (r.incidencia && String(r.incidencia.codigo) === alerta.codigo) {
        r.incidenciaDeTwilio = true;
        return;
      }
      const inc = explicarLlamadaTerminada(r.estadoLlamada, r.sip, alerta);
      if (!inc) return;
      inc.nivel = r.cat === "fallida" ? "error" : "aviso";
      r.incidenciaDeTwilio = true;
      estado.conCodigo += 1;
      g.reasignarIncidencia(c, r, inc);
    });
  }

  async detalleLlamada(g, sid) {
    if (!g.client) throw new Error("Twilio no está configurado");
    const ll = await g.client.calls(sid).fetch();
    let notificaciones = [];
    try {
      const lista = await g.client.calls(sid).notifications.list({ limit: 10 });
      notificaciones = lista.map((n) => ({
        codigo: String(n.errorCode || ""), nivel: n.log === "0" ? "error" : n.log === "1" ? "aviso" : "info",
        texto: n.messageText || "", fecha: n.messageDate ? new Date(n.messageDate).toISOString() : "",
        enlace: n.moreInfo || "",
      }));
    } catch (err) { }
    return {
      sid: ll.sid, estado: ll.status, de: ll.from, para: ll.to, duracion: ll.duration === null ? null : parseInt(ll.duration, 10),
      precio: ll.price === null || ll.price === undefined ? null : Math.abs(parseFloat(ll.price)), moneda: ll.priceUnit || "USD",
      contestadoPor: ll.answeredBy || "", inicio: ll.startTime ? new Date(ll.startTime).toISOString() : "",
      fin: ll.endTime ? new Date(ll.endTime).toISOString() : "", creada: ll.dateCreated ? new Date(ll.dateCreated).toISOString() : "",
      notificaciones,
    };
  }

  async registroLlamadas(g, { desde, hasta, limite = 10000 }) {
    if (!g.client) throw new Error("Twilio no está configurado");
    const lista = await g.client.calls.list({ startTimeAfter: desde, startTimeBefore: hasta, pageSize: 1000, limit: limite });
    return lista.map((l) => ({
      sid: l.sid, de: l.from, para: l.to, direccion: l.direction, estado: l.status,
      duracion: l.duration === null || l.duration === undefined ? null : parseInt(l.duration, 10),
      precio: l.price === null || l.price === undefined ? null : Math.abs(parseFloat(l.price)),
      moneda: l.priceUnit || "USD",
      inicio: l.startTime ? new Date(l.startTime).getTime() : (l.dateCreated ? new Date(l.dateCreated).getTime() : 0),
      fin: l.endTime ? new Date(l.endTime).getTime() : 0,
      creada: l.dateCreated ? new Date(l.dateCreated).getTime() : 0,
      contestadoPor: l.answeredBy || "",
    }));
  }
}

module.exports = { Datos };
