"use strict";
const { esperar, idCorto, Limitador, construirMensaje, escaparXml, enParalelo } = require("./util");
const { filaNueva, aplicarEstadoLlamada, aplicarEstadoMensaje, esTerminalLlamada, RANGO_LLAMADA } = require("./estados");
const { explicarErrorTwilio } = require("./errores");
const { prepararAudios, marcarOmitidos } = require("./audios");

function errorHttp(status, mensaje) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

function crearCampana(g, tipo, datos) {
  const cfg = g.cfg;
  const esWa = tipo === "whatsapp";
  const id = `${esWa ? "wa" : "calls"}_${Date.now()}_${idCorto(2)}`;
  const concurrencia = Math.min(cfg.limites.maxConcurrencia, Math.max(1, parseInt(datos.concurrencia, 10) || (esWa ? 10 : 5)));
  const campana = {
    id,
    tipo: esWa ? "whatsapp" : "llamadas",
    nombre: String(datos.nombre || "").slice(0, 80),
    creada: new Date().toISOString(),
    inicio: null,
    fin: null,
    estado: "preparando",
    config: {
      modoAudio: esWa ? "texto" : datos.modoAudio,
      mensaje: datos.mensaje || "",
      audioUrl: datos.audioUrl || "",
      voces: datos.voces || [],
      vocesNombres: [],
      concurrencia,
      cps: datos.cps || (esWa ? cfg.llamadas.whatsappPorSegundo : cfg.llamadas.porSegundo),
      timbradoSeg: datos.timbradoSeg || cfg.llamadas.timbradoSegundos,
      detectarBuzon: datos.detectarBuzon === undefined ? cfg.llamadas.detectarBuzon : Boolean(datos.detectarBuzon),
      autoPausa: datos.autoPausa === undefined ? cfg.autoPausa.activa : Boolean(datos.autoPausa),
    },
    resultados: datos.contactos.map((contacto, i) => filaNueva(i, contacto)),
    invalidos: (datos.invalidos || []).slice(0, 2000),
    invalidosTotal: (datos.invalidos || []).length,
    duplicados: (datos.duplicados || []).length || 0,
    audios: {},
    audiosTotal: 0,
    audiosListos: 0,
    incidencias: [],
    aviso: null,
    version: 0,
    reanudable: false,
    manual: false,
    omitidos: 0,
    origen: datos.origen || null,
  };
  g.registrar(campana);
  g.runtimeDe(id).objetivo = concurrencia;
  g.almacen.guardar(campana, true);
  return campana;
}

function iniciarCampana(g, campana) {
  correr(g, campana);
  return campana;
}

async function correr(g, c) {
  const rt = g.runtimeDe(c.id);
  try {
    c.inicio = c.inicio || new Date().toISOString();
    g.cambiarEstado(c, "preparando");
    if (c.tipo === "llamadas") await correrLlamadas(g, c, rt);
    else await correrWhatsapp(g, c, rt);
  } catch (err) {
    console.error(`Campaña ${c.id}: error inesperado: ${err.stack || err.message}`);
    rt.detener = true;
    c.reanudable = true;
    g.incidencia(c, {
      fuente: "sistema", codigo: "interno", titulo: "Error interno de la campaña", detalle: err.message,
      accion: "Pulsa Reanudar para continuar con los contactos que faltan. Si se repite, revisa los registros del servidor.",
    });
    marcarOmitidos(c, g);
    c.fin = new Date().toISOString();
    g.aviso(c, "error", "Error inesperado", `${err.message}. La campaña se detuvo; puedes reanudarla.`, ["reanudar"]);
    g.cambiarEstado(c, "error");
  }
}

function siguientePendiente(c, rt) {
  const filas = c.resultados;
  while (rt.cursor < filas.length) {
    const fila = filas[rt.cursor];
    rt.cursor += 1;
    if (fila.estado === "pendiente") {
      fila.estado = "marcando";
      return fila;
    }
  }
  return null;
}

function twimlDe(c, fila) {
  const cfg = c.config;
  if (cfg.modoAudio === "voces") return `<Response><Play>${escaparXml(fila.audioUrl)}</Play></Response>`;
  if (cfg.modoAudio === "mp3") return `<Response><Play>${escaparXml(cfg.audioUrl)}</Play></Response>`;
  return `<Response><Say language="es-MX" voice="Polly.Mia">${escaparXml(construirMensaje(cfg.mensaje, fila.nombre))}</Say></Response>`;
}

function fallarFila(g, c, fila, inc) {
  fila.estado = "error";
  fila.cat = "error";
  fila.incidencia = inc;
  fila.error = `${inc.titulo}: ${inc.detalle}`;
  fila.tFin = Date.now();
  g.incidencia(c, inc, fila.numero);
  g.cambio(c, fila);
}

function cancelarLlamada(g, sid) {
  if (!g.client) return Promise.resolve();
  return Promise.resolve(g.client.calls(sid).update({ status: "canceled" })).catch(() => {});
}

async function buscarLlamadaReciente(g, numero, desdeMs) {
  const lista = await g.client.calls.list({ to: numero, from: g.cfg.twilio.fromNumber, limit: 3 });
  return lista.find((l) => l.dateCreated && new Date(l.dateCreated).getTime() >= desdeMs - 5000) || null;
}

function alCrearLlamada(g, c, rt, fila, llamada) {
  fila.tCrea = Date.now();
  g.vincularSid(c, fila, llamada.sid);
  const estadoInicial = llamada.status && RANGO_LLAMADA[llamada.status] ? llamada.status : "queued";
  aplicarEstadoLlamada(fila, estadoInicial, { ahora: fila.tCrea });
  rt.erroresApi = null;
  g.cambio(c, fila);
  if (rt.detener) cancelarLlamada(g, llamada.sid);
}

function detenerPorFatal(g, c, rt, inc) {
  rt.detener = true;
  g.incidencia(c, inc);
  marcarOmitidos(c, g);
  c.reanudable = true;
  c.fin = new Date().toISOString();
  g.aviso(c, "error", inc.titulo, `${inc.detalle} ${inc.accion || ""}`.trim(), ["reanudar"]);
  g.cambiarEstado(c, "detenida");
  console.error(`Campaña ${c.id} detenida: ${inc.titulo}: ${inc.detalle}`);
}

function pausarAutomatico(g, c, rt, texto) {
  if (c.estado !== "en_curso") return;
  rt.pausa = true;
  rt.ventana = [];
  rt.erroresApi = null;
  c.pausaAutomatica = true;
  g.cambiarEstado(c, "pausada");
  g.aviso(c, "error", "Campaña pausada automáticamente", texto, ["reanudar", "detener"]);
  console.warn(`Campaña ${c.id} pausada automáticamente: ${texto}`);
}

function registrarErrorApi(g, c, rt, inc) {
  const clave = `${inc.fuente}:${inc.codigo}`;
  if (rt.erroresApi && rt.erroresApi.clave === clave) rt.erroresApi.cuenta += 1;
  else rt.erroresApi = { clave, cuenta: 1 };
  if (c.config.autoPausa && rt.erroresApi.cuenta >= g.cfg.autoPausa.erroresSeguidos) {
    pausarAutomatico(g, c, rt, `Las últimas ${rt.erroresApi.cuenta} llamadas seguidas fallaron con el mismo error: ${inc.titulo}. ${inc.detalle} ${inc.accion || ""}`.trim());
  }
}

async function crearLlamada(g, c, rt, fila) {
  const cfg = c.config;
  const tw = g.cfg.twilio;
  if (!g.client) {
    detenerPorFatal(g, c, rt, {
      fuente: "twilio", codigo: "sin-credenciales", titulo: "Faltan las credenciales de Twilio",
      detalle: "No hay un TWILIO_ACCOUNT_SID y un TWILIO_AUTH_TOKEN válidos.", accion: "Agrégalos en el archivo .env y reinicia el servidor.", fatal: true,
    });
    return;
  }
  const params = {
    to: fila.numero,
    from: tw.fromNumber,
    twiml: twimlDe(c, fila),
    timeout: cfg.timbradoSeg,
    statusCallback: `${g.cfg.publicBaseUrl}/api/webhooks/call-status`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  };
  if (g.cfg.llamadas.duracionMaximaSegundos > 0) params.timeLimit = g.cfg.llamadas.duracionMaximaSegundos;
  if (cfg.detectarBuzon) {
    params.machineDetection = "Enable";
    params.asyncAmd = "true";
    params.asyncAmdStatusCallback = `${g.cfg.publicBaseUrl}/api/webhooks/amd`;
    params.asyncAmdStatusCallbackMethod = "POST";
  }

  fila.intentos = 0;
  while (true) {
    fila.intentos += 1;
    const inicioIntento = Date.now();
    try {
      const llamada = await g.client.calls.create(params);
      alCrearLlamada(g, c, rt, fila, llamada);
      return;
    } catch (err) {
      const inc = explicarErrorTwilio(err);
      if (inc.fatal) {
        fallarFila(g, c, fila, inc);
        detenerPorFatal(g, c, rt, inc);
        return;
      }
      if (rt.detener && inc.reintentable) {
        fila.estado = "omitido";
        fila.cat = "omitido";
        g.cambio(c, fila);
        return;
      }
      if (inc.reintentable && fila.intentos <= 4 && !rt.detener) {
        if (inc.ambiguo) {
          const existente = await buscarLlamadaReciente(g, fila.numero, inicioIntento).catch(() => null);
          if (existente) {
            alCrearLlamada(g, c, rt, fila, existente);
            return;
          }
        }
        if (inc.http === 429 || String(inc.codigo) === "20429") rt.limitador.fijar(Math.max(0.2, rt.limitador.porSegundo * 0.7));
        await esperar(1000 * 2 ** (fila.intentos - 1));
        continue;
      }
      fallarFila(g, c, fila, inc);
      registrarErrorApi(g, c, rt, inc);
      return;
    }
  }
}

async function esperarFinDeLlamada(fila, rt, cfgLlamadas) {
  const inicio = Date.now();
  while (true) {
    if (esTerminalLlamada(fila)) return;
    if (rt.detener) return;
    const transcurrido = Date.now() - inicio;
    if ((fila.rangoLlamada || 0) < 3 && transcurrido >= cfgLlamadas.liberarSinContestarMs) return;
    if (transcurrido >= cfgLlamadas.esperaMaximaMs) return;
    await esperar(500);
  }
}

async function trabajadorLlamadas(g, c, rt, k) {
  while (!rt.detener) {
    if (rt.cursor >= c.resultados.length) return;
    if (k >= rt.objetivo || rt.pausa) {
      await esperar(400);
      continue;
    }
    const fila = siguientePendiente(c, rt);
    if (!fila) return;
    await rt.limitador.tomar();
    while (rt.pausa && !rt.detener) await esperar(400);
    if (rt.detener) return;
    await crearLlamada(g, c, rt, fila);
    if (fila.sid && !rt.detener) await esperarFinDeLlamada(fila, rt, g.cfg.llamadas);
  }
}

async function correrLlamadas(g, c, rt) {
  const cfg = c.config;
  if (cfg.modoAudio === "voces") {
    const listo = await prepararAudios(g, c, rt);
    if (!listo) return;
  }
  if (rt.detener) return;
  rt.limitador = new Limitador(cfg.cps);
  rt.objetivo = cfg.concurrencia;
  rt.cursor = 0;
  g.cambiarEstado(c, "en_curso");

  await Promise.all(Array.from({ length: g.cfg.limites.maxConcurrencia }, (_, k) => trabajadorLlamadas(g, c, rt, k)));
  if (rt.detener) return;

  c.finDespacho = Date.now();
  const sinResultado = c.resultados.some((r) => r.sid && !esTerminalLlamada(r));
  if (sinResultado) {
    g.cambiarEstado(c, "finalizando");
  } else {
    c.fin = new Date().toISOString();
    c.reanudable = false;
    g.cambiarEstado(c, "completada");
    if (g.datos) g.datos.programarEnriquecimiento(g, c, 20000);
  }
}

function alTerminarLlamada(g, c, fila) {
  const rt = g.runtimeDe(c.id);
  if (!rt || c.tipo !== "llamadas") return;
  if (fila.estadoLlamada === "canceled" && c.manual) return;
  const cfgAuto = g.cfg.autoPausa;
  rt.ventana.push(fila.estadoLlamada === "failed" ? 1 : 0);
  if (rt.ventana.length > cfgAuto.ventana) rt.ventana.shift();
  if (!c.config.autoPausa || c.estado !== "en_curso" || rt.ventana.length < cfgAuto.minimo) return;
  const fallos = rt.ventana.reduce((a, b) => a + b, 0);
  const pct = Math.round((fallos / rt.ventana.length) * 100);
  if (pct < cfgAuto.umbralPct) return;
  const top = (c.incidencias || []).filter((x) => x.fuente === "twilio").sort((a, b) => b.cantidad - a.cantidad)[0];
  const causa = top ? ` Causa más frecuente: ${top.titulo}. ${top.detalle}` : " Twilio no ha informado todavía el motivo; revisa la sección de errores.";
  pausarAutomatico(g, c, rt, `${fallos} de las últimas ${rt.ventana.length} llamadas fallaron (${pct}%).${causa} Revisa antes de continuar para no gastar los contactos restantes.`);
}

async function buscarMensajeReciente(g, numero, desdeMs) {
  const lista = await g.client.messages.list({ to: `whatsapp:${numero}`, from: g.cfg.twilio.whatsappFrom, limit: 3 });
  return lista.find((m) => m.dateCreated && new Date(m.dateCreated).getTime() >= desdeMs - 5000) || null;
}

async function enviarMensaje(g, c, rt, fila) {
  if (!g.client) {
    detenerPorFatal(g, c, rt, {
      fuente: "twilio", codigo: "sin-credenciales", titulo: "Faltan las credenciales de Twilio",
      detalle: "No hay un TWILIO_ACCOUNT_SID y un TWILIO_AUTH_TOKEN válidos.", accion: "Agrégalos en el archivo .env y reinicia el servidor.", fatal: true,
    });
    return;
  }
  const params = {
    from: g.cfg.twilio.whatsappFrom,
    to: `whatsapp:${fila.numero}`,
    body: construirMensaje(c.config.mensaje, fila.nombre),
    statusCallback: `${g.cfg.publicBaseUrl}/api/webhooks/message-status`,
  };
  fila.intentos = 0;
  while (true) {
    fila.intentos += 1;
    const inicioIntento = Date.now();
    try {
      const mensaje = await g.client.messages.create(params);
      fila.tCrea = Date.now();
      g.vincularSid(c, fila, mensaje.sid);
      aplicarEstadoMensaje(fila, mensaje.status || "queued");
      rt.erroresApi = null;
      g.cambio(c, fila);
      return;
    } catch (err) {
      const inc = explicarErrorTwilio(err);
      if (inc.fatal) {
        fallarFila(g, c, fila, inc);
        detenerPorFatal(g, c, rt, inc);
        return;
      }
      if (inc.reintentable && fila.intentos <= 4 && !rt.detener) {
        if (inc.ambiguo) {
          const existente = await buscarMensajeReciente(g, fila.numero, inicioIntento).catch(() => null);
          if (existente) {
            fila.tCrea = Date.now();
            g.vincularSid(c, fila, existente.sid);
            aplicarEstadoMensaje(fila, existente.status || "queued");
            g.cambio(c, fila);
            return;
          }
        }
        if (inc.http === 429) rt.limitador.fijar(Math.max(0.5, rt.limitador.porSegundo * 0.7));
        await esperar(1000 * 2 ** (fila.intentos - 1));
        continue;
      }
      fallarFila(g, c, fila, inc);
      registrarErrorApi(g, c, rt, inc);
      return;
    }
  }
}

async function trabajadorWhatsapp(g, c, rt, k) {
  while (!rt.detener) {
    if (rt.cursor >= c.resultados.length) return;
    if (k >= rt.objetivo || rt.pausa) {
      await esperar(400);
      continue;
    }
    const fila = siguientePendiente(c, rt);
    if (!fila) return;
    await rt.limitador.tomar();
    while (rt.pausa && !rt.detener) await esperar(400);
    if (rt.detener) return;
    await enviarMensaje(g, c, rt, fila);
  }
}

async function correrWhatsapp(g, c, rt) {
  rt.limitador = new Limitador(c.config.cps);
  rt.objetivo = c.config.concurrencia;
  rt.cursor = 0;
  g.cambiarEstado(c, "en_curso");
  await Promise.all(Array.from({ length: g.cfg.limites.maxConcurrencia }, (_, k) => trabajadorWhatsapp(g, c, rt, k)));
  if (rt.detener) return;
  c.fin = new Date().toISOString();
  c.reanudable = false;
  g.cambiarEstado(c, "completada");
}

async function detener(g, id) {
  const c = g.obtener(id);
  if (!c) throw errorHttp(404, "Campaña no encontrada");
  if (!g.estaActiva(c)) return c;
  const rt = g.runtimeDe(id);
  rt.detener = true;
  rt.pausa = false;
  c.manual = true;
  c.reanudable = true;
  c.fin = new Date().toISOString();
  const cancelables = c.tipo === "llamadas" ? c.resultados.filter((r) => r.sid && (r.rangoLlamada || 0) < 3) : [];
  const omitidos = marcarOmitidos(c, g);
  g.aviso(c, "aviso", "Campaña detenida", `Se detuvo manualmente. ${omitidos} contactos quedaron sin marcar${omitidos ? "; puedes continuar más tarde con Reanudar" : ""}. Las llamadas que ya estaban en conversación terminan solas.`, omitidos ? ["reanudar"] : []);
  g.cambiarEstado(c, "detenida");
  console.log(`Campaña ${c.id} detenida manualmente (${omitidos} omitidos, ${cancelables.length} por cancelar)`);
  enParalelo(cancelables, 10, (fila) => cancelarLlamada(g, fila.sid)).catch(() => {});
  return c;
}

async function reanudar(g, id) {
  const c = g.obtener(id);
  if (!c) throw errorHttp(404, "Campaña no encontrada");
  const rt = g.runtimeDe(id);

  if (c.estado === "pausada") {
    rt.pausa = false;
    rt.ventana = [];
    rt.erroresApi = null;
    c.pausaAutomatica = false;
    g.limpiarAviso(c);
    g.cambiarEstado(c, "en_curso");
    return c;
  }
  if (!["detenida", "interrumpida", "error"].includes(c.estado)) throw errorHttp(409, "Esta campaña no se puede reanudar en su estado actual.");
  const activa = g.campanaActiva(c.tipo);
  if (activa && activa.id !== c.id) throw errorHttp(409, "Ya hay otra campaña en curso. Termínala o deténla antes de reanudar esta.");

  const pendientes = c.resultados.filter((r) => ["omitido", "pendiente", "marcando"].includes(r.estado));
  if (!pendientes.length) throw errorHttp(409, "No quedan contactos por marcar en esta campaña.");
  if (c.estado === "interrumpida" && g.datos) await g.datos.conciliarCampana(g, c).catch(() => {});
  pendientes.forEach((r) => {
    r.estado = "pendiente";
    r.cat = "pendiente";
    g.cambio(c, r);
  });
  Object.assign(rt, { detener: false, pausa: false, cursor: 0, ventana: [], erroresApi: null });
  c.manual = false;
  c.fin = null;
  c.omitidos = 0;
  c.reanudable = false;
  c.aviso = null;
  g.cambiarEstado(c, "preparando");
  correr(g, c);
  return c;
}

function ajustar(g, id, { concurrencia, cps }) {
  const c = g.obtener(id);
  if (!c) throw errorHttp(404, "Campaña no encontrada");
  const rt = g.runtimeDe(id);
  if (!g.estaActiva(c)) throw errorHttp(409, "Solo se puede ajustar una campaña activa.");
  if (concurrencia !== undefined) {
    const n = Math.min(g.cfg.limites.maxConcurrencia, Math.max(1, parseInt(concurrencia, 10) || 1));
    rt.objetivo = n;
    c.config.concurrencia = n;
  }
  if (cps !== undefined && rt.limitador) {
    const v = Math.min(30, Math.max(0.2, parseFloat(cps) || 1));
    rt.limitador.fijar(v);
    c.config.cps = v;
  }
  g.cambio(c);
  return c;
}

async function recuperar(g) {
  for (const c of g.campanas.values()) {
    const estabaActiva = g.estaActiva(c);
    if (!estabaActiva && c.estado !== "interrumpida") continue;
    const dudosas = c.resultados.filter((r) => r.estado === "marcando" || r.dudosa);
    if (estabaActiva) {
      c.estado = "interrumpida";
      c.reanudable = true;
      c.aviso = {
        nivel: "aviso", titulo: "Servidor reiniciado",
        texto: "El servidor se reinició mientras la campaña estaba en curso. Los resultados de las llamadas ya hechas se están sincronizando con Twilio. Pulsa Reanudar para continuar con los contactos que faltan.",
        acciones: ["reanudar"], ts: Date.now(),
      };
    }
    for (const fila of dudosas) {
      let adoptada = null;
      if (g.client && c.tipo === "llamadas") adoptada = await buscarLlamadaReciente(g, fila.numero, new Date(c.inicio || c.creada).getTime()).catch(() => null);
      if (adoptada) {
        g.vincularSid(c, fila, adoptada.sid);
        aplicarEstadoLlamada(fila, RANGO_LLAMADA[adoptada.status] ? adoptada.status : "queued", { duracion: adoptada.duration });
        fila.tCrea = fila.tCrea || Date.now();
      } else {
        fila.estado = "pendiente";
        fila.cat = "pendiente";
      }
      fila.dudosa = false;
    }
    if (estabaActiva || dudosas.length) {
      g.cambio(c);
      g.vaciar(c, true);
    }
  }
}

module.exports = {
  crearCampana, iniciarCampana, detener, reanudar, ajustar, recuperar, alTerminarLlamada, errorHttp, cancelarLlamada,
};
