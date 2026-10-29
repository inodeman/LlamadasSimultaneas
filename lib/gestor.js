"use strict";
const { calcularResumen } = require("./resumen");
const { aplicarEstadoLlamada, aplicarEstadoMensaje, esTerminalLlamada } = require("./estados");
const { explicarLlamadaTerminada, explicarCodigoTwilio, claveIncidencia } = require("./errores");

const ESTADOS_ACTIVOS = new Set(["preparando", "generando_audios", "en_curso", "pausada", "finalizando"]);
const ESTADOS_EN_MARCHA = new Set(["preparando", "generando_audios", "en_curso", "finalizando"]);

function filaPublica(r) {
  return {
    i: r.i, numero: r.numero, nombre: r.nombre, voz: r.voz, sid: r.sid, estado: r.estado,
    estadoLlamada: r.estadoLlamada, cat: r.cat, respondio: r.respondio, duracion: r.duracion,
    sip: r.sip, precio: r.precio, error: r.incidencia ? "" : r.error,
    inc: r.incidencia ? { codigo: r.incidencia.codigo, titulo: r.incidencia.titulo } : null,
    tCrea: r.tCrea, tTimbra: r.tTimbra, tContesta: r.tContesta, tFin: r.tFin, audioSeg: r.audioSeg || null,
    buzon: r.buzon || false,
  };
}

class Gestor {
  constructor({ config, client, voces, almacen, eventos }) {
    this.cfg = config;
    this.client = client;
    this.voces = voces;
    this.almacen = almacen;
    this.eventos = eventos;
    this.campanas = new Map();
    this.rt = new Map();
    this.sidIndex = new Map();
    this.huerfanos = new Map();
    this.temporizadores = [];
    this.motor = null;
    this.datos = null;
  }

  registrar(campana) {
    this.campanas.set(campana.id, campana);
    if (!this.rt.has(campana.id)) {
      this.rt.set(campana.id, { detener: false, pausa: false, cambios: new Set(), temporizador: null, ventana: [], erroresApi: null, cursor: 0 });
    }
    campana.resultados.forEach((fila) => {
      if (fila.sid) this.sidIndex.set(fila.sid, { id: campana.id, i: fila.i });
    });
    return campana;
  }

  obtener(id) {
    return this.campanas.get(id) || null;
  }

  runtimeDe(id) {
    return this.rt.get(id);
  }

  estaActiva(campana) {
    return ESTADOS_ACTIVOS.has(campana.estado);
  }

  enMarcha(campana) {
    return ESTADOS_EN_MARCHA.has(campana.estado);
  }

  campanaActiva(tipo) {
    for (const campana of this.campanas.values()) {
      if (campana.tipo === tipo && ESTADOS_ACTIVOS.has(campana.estado)) return campana;
    }
    return null;
  }

  filaPorSid(sid) {
    const ref = this.sidIndex.get(sid);
    if (!ref) return null;
    const campana = this.campanas.get(ref.id);
    if (!campana) return null;
    const fila = campana.resultados[ref.i];
    return fila && fila.sid === sid ? { campana, fila } : null;
  }

  vincularSid(campana, fila, sid) {
    fila.sid = sid;
    this.sidIndex.set(sid, { id: campana.id, i: fila.i });
    const pendiente = this.huerfanos.get(sid);
    if (pendiente) {
      this.huerfanos.delete(sid);
      pendiente.eventos.forEach((e) => (e.tipo === "mensaje" ? this.aplicarMensaje(e.params) : this.aplicarLlamada(e.params)));
    }
  }

  guardarHuerfano(sid, tipo, params) {
    if (!sid) return;
    let entrada = this.huerfanos.get(sid);
    if (!entrada) {
      if (this.huerfanos.size > 2000) return;
      entrada = { ts: Date.now(), eventos: [] };
      this.huerfanos.set(sid, entrada);
    }
    if (entrada.eventos.length < 10) entrada.eventos.push({ tipo, params });
  }

  cambio(campana, fila) {
    const rt = this.rt.get(campana.id);
    if (!rt) return;
    if (fila) rt.cambios.add(fila.i);
    campana.version = (campana.version || 0) + 1;
    if (!rt.temporizador) {
      rt.temporizador = setTimeout(() => {
        rt.temporizador = null;
        this.vaciar(campana);
      }, 400);
      if (rt.temporizador.unref) rt.temporizador.unref();
    }
  }

  resumenDe(campana) {
    return calcularResumen(campana, { zona: this.cfg.zonaHoraria });
  }

  vaciar(campana, inmediato = false) {
    const rt = this.rt.get(campana.id);
    if (!rt) return;
    const indices = [...rt.cambios];
    rt.cambios.clear();
    const resumen = this.resumenDe(campana);
    campana.res = resumen;
    for (let desde = 0; desde < indices.length; desde += 400) {
      const lote = indices.slice(desde, desde + 400).map((i) => filaPublica(campana.resultados[i])).filter(Boolean);
      this.eventos.emitir("filas", { id: campana.id, filas: lote }, campana.id);
    }
    this.eventos.emitir("resumen", resumen, campana.id);
    this.eventos.emitir("lista", { id: campana.id, estado: campana.estado, progreso: resumen.progreso }, null);
    this.almacen.guardar(campana, inmediato);
  }

  cambiarEstado(campana, estado, extra = {}) {
    campana.estado = estado;
    Object.assign(campana, extra);
    this.cambio(campana);
    this.vaciar(campana, estado === "completada" || estado === "detenida");
  }

  aviso(campana, nivel, titulo, texto, acciones) {
    campana.aviso = texto || titulo ? { nivel, titulo, texto, acciones: acciones || [], ts: Date.now() } : null;
    this.cambio(campana);
  }

  limpiarAviso(campana) {
    if (campana.aviso) {
      campana.aviso = null;
      this.cambio(campana);
    }
  }

  incidencia(campana, inc, numero) {
    if (!inc) return;
    const lista = campana.incidencias || (campana.incidencias = []);
    const clave = claveIncidencia(inc);
    let registro = lista.find((x) => x.clave === clave);
    const ahora = Date.now();
    if (!registro) {
      registro = {
        clave, fuente: inc.fuente, codigo: String(inc.codigo), titulo: inc.titulo, detalle: inc.detalle || "",
        accion: inc.accion || "", enlace: inc.enlace || "", nivel: inc.nivel || "error", cantidad: 0, primera: ahora, ultima: ahora, ejemplos: [],
      };
      lista.push(registro);
      if (lista.length > 80) lista.splice(0, lista.length - 80);
    }
    registro.cantidad += 1;
    registro.ultima = ahora;
    if (numero && registro.ejemplos.length < 5 && !registro.ejemplos.includes(numero)) registro.ejemplos.push(numero);
    lista.sort((a, b) => (b.nivel === "error") - (a.nivel === "error") || b.cantidad - a.cantidad);
    this.cambio(campana);
  }

  aplicarLlamada(params) {
    const sid = params.CallSid;
    const ref = this.filaPorSid(sid);
    if (!ref) {
      this.guardarHuerfano(sid, "llamada", params);
      return false;
    }
    const { campana, fila } = ref;
    const estado = params.CallStatus;
    const duracion = params.CallDuration !== undefined && params.CallDuration !== "" ? params.CallDuration : undefined;
    const cambio = aplicarEstadoLlamada(fila, estado, { duracion, sip: params.SipResponseCode, answeredBy: params.AnsweredBy });
    if (cambio) this.alCambiarLlamada(campana, fila);
    return true;
  }

  aplicarMensaje(params) {
    const ref = this.filaPorSid(params.MessageSid || params.SmsSid);
    if (!ref) {
      this.guardarHuerfano(params.MessageSid || params.SmsSid, "mensaje", params);
      return false;
    }
    const { campana, fila } = ref;
    const estado = params.MessageStatus || params.SmsStatus;
    if (params.ErrorCode) this.asignarErrorMensaje(campana, fila, params.ErrorCode, params.ErrorMessage);
    if (aplicarEstadoMensaje(fila, estado)) this.cambio(campana, fila);
    return true;
  }

  asignarErrorMensaje(campana, fila, codigo, texto) {
    if (fila.incidencia && String(fila.incidencia.codigo) === String(codigo)) return;
    const base = explicarCodigoTwilio(codigo, texto);
    fila.incidencia = { fuente: "twilio", codigo: base.codigo, titulo: base.titulo, detalle: base.detalle, accion: base.accion, enlace: base.enlace };
    fila.error = `${base.titulo}: ${base.detalle}`;
    this.incidencia(campana, fila.incidencia, fila.numero);
  }

  aplicarAmd(params) {
    const ref = this.filaPorSid(params.CallSid);
    if (!ref || !params.AnsweredBy) return false;
    const { campana, fila } = ref;
    fila.answeredBy = params.AnsweredBy;
    aplicarEstadoLlamada(fila, fila.estadoLlamada || "in-progress", { answeredBy: params.AnsweredBy });
    this.cambio(campana, fila);
    return true;
  }

  alCambiarLlamada(campana, fila, desdeConciliacion) {
    this.cambio(campana, fila);
    if (!esTerminalLlamada(fila)) return;
    if (!fila.motivoAnotado) {
      fila.motivoAnotado = true;
      const inc = explicarLlamadaTerminada(fila.estadoLlamada, fila.sip, null);
      if (fila.estadoLlamada === "failed" || (fila.estadoLlamada === "canceled" && !campana.manual)) {
        fila.incidencia = fila.incidencia || inc;
        if (inc) fila.error = `${inc.titulo}${inc.detalle ? `: ${inc.detalle}` : ""}`;
        if (fila.estadoLlamada === "failed") this.incidencia(campana, inc, fila.numero);
      }
      if (this.motor) this.motor.alTerminarLlamada(this, campana, fila);
    }
  }

  reasignarIncidencia(campana, fila, nueva) {
    const lista = campana.incidencias || [];
    if (fila.incidencia) {
      const previa = lista.find((x) => x.clave === claveIncidencia(fila.incidencia));
      if (previa) {
        previa.cantidad -= 1;
        previa.ejemplos = previa.ejemplos.filter((n) => n !== fila.numero);
        if (previa.cantidad <= 0) lista.splice(lista.indexOf(previa), 1);
      }
    }
    fila.incidencia = nueva;
    fila.error = nueva ? `${nueva.titulo}${nueva.detalle ? `: ${nueva.detalle}` : ""}` : "";
    if (nueva) this.incidencia(campana, nueva, fila.numero);
    this.cambio(campana, fila);
  }

  async pausar(id) {
    const campana = this.obtener(id);
    if (!campana) throw this.errorHttp(404, "Campaña no encontrada");
    if (campana.estado !== "en_curso") throw this.errorHttp(409, "Solo se puede pausar una campaña en curso.");
    this.rt.get(id).pausa = true;
    this.cambiarEstado(campana, "pausada");
    this.aviso(campana, "aviso", "Campaña en pausa", "No se marcarán más llamadas hasta que pulses Reanudar. Las llamadas ya iniciadas siguen su curso.", ["reanudar", "detener"]);
    return campana;
  }

  errorHttp(status, mensaje) {
    const err = new Error(mensaje);
    err.status = status;
    return err;
  }

  iniciarTareas() {
    const cada = (ms, fn) => {
      const t = setInterval(() => { Promise.resolve().then(fn).catch((err) => console.error(`Tarea periódica: ${err.message}`)); }, ms);
      if (t.unref) t.unref();
      this.temporizadores.push(t);
    };
    cada(1000, () => this.revisarFinalizacion());
    cada(5000, () => this.datos && this.datos.conciliar(this));
    cada(10000, () => { for (const c of this.campanas.values()) if (this.estaActiva(c)) this.vaciar(c); });
  }

  revisarFinalizacion() {
    const corte = Date.now() - 120000;
    for (const [sid, entrada] of this.huerfanos.entries()) if (entrada.ts < corte) this.huerfanos.delete(sid);
    for (const campana of this.campanas.values()) {
      if (campana.estado !== "finalizando") continue;
      const pendientes = campana.resultados.filter((r) => r.sid && !esTerminalLlamada(r) && campana.tipo === "llamadas").length;
      const espera = Date.now() - (campana.finDespacho || Date.now());
      if (pendientes === 0 || espera > 240000) {
        campana.fin = new Date().toISOString();
        campana.reanudable = false;
        if (pendientes > 0) {
          this.aviso(campana, "aviso", "Faltan resultados finales", `${pendientes} llamadas aún no tienen resultado final; se siguen consultando a Twilio.`, []);
        }
        this.cambiarEstado(campana, "completada");
        if (this.datos) this.datos.programarEnriquecimiento(this, campana, 20000);
      }
    }
  }

  apagar() {
    this.temporizadores.forEach((t) => clearInterval(t));
    this.temporizadores = [];
    const modificadas = [];
    for (const campana of this.campanas.values()) {
      const rt = this.rt.get(campana.id);
      if (rt) rt.detener = true;
      if (this.estaActiva(campana)) {
        campana.estado = "interrumpida";
        campana.reanudable = true;
        campana.aviso = {
          nivel: "aviso", titulo: "Servidor reiniciado",
          texto: "El servidor se reinició con la campaña en curso. Pulsa Reanudar para continuar con los contactos que faltan.", acciones: ["reanudar"], ts: Date.now(),
        };
        campana.resultados.forEach((fila) => { if (fila.estado === "marcando") { fila.estado = "pendiente"; fila.dudosa = true; } });
        modificadas.push(campana);
      }
    }
    this.almacen.vaciarSync();
    modificadas.forEach((campana) => this.almacen.escribirSync(campana));
  }
}

module.exports = { Gestor, filaPublica, ESTADOS_ACTIVOS, ESTADOS_EN_MARCHA };
