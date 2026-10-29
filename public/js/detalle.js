import { h, vaciar, icono, lampara, copiar } from "./dom.js";
import { api } from "./api.js";
import { dur, durLarga, telefono, hora, dinero, infoFila, detalleDeFila, nombreFuente, tituloConCodigo } from "./fmt.js";
import { contestadoPor, enlaceLlamadaTwilio, estadoTwilioTexto } from "./calculos.js";

const CHIP_POR_TONO = { si: "chip--ok", no: "chip--aviso", error: "chip--peligro", curso: "chip--info", neutro: "" };

let abierto = null;

function dato(dl, etiqueta, valor, { copiable = false } = {}) {
  if (valor === "" || valor === null || valor === undefined) return;
  const contenido = copiable
    ? h("button", { type: "button", class: "copiable", title: "Copiar", on: { click: () => copiar(String(valor), "Copiado") } }, String(valor), icono("copiar", { clase: "texto-3" }))
    : valor;
  dl.append(h("dt", null, etiqueta), h("dd", null, contenido));
}

function bloqueIncidencia(f) {
  const inc = f.incidencia;
  if (!inc && !f.error) return null;
  if (!inc) return h("div", { class: "aviso aviso--error" }, icono("error"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, "Qué falló"), h("span", { class: "aviso__texto" }, f.error)));
  return h("div", { class: `aviso ${inc.nivel === "aviso" ? "aviso--aviso" : "aviso--error"}` }, icono(inc.nivel === "aviso" ? "alerta" : "error"),
    h("div", { class: "aviso__cuerpo" },
      h("span", { class: "aviso__titulo" }, tituloConCodigo(inc.titulo, inc.codigo)),
      h("span", { class: "aviso__texto" }, `Origen: ${nombreFuente(inc.fuente)}.`),
      inc.detalle ? h("span", { class: "aviso__texto" }, inc.detalle) : null,
      inc.accion ? h("span", { class: "aviso__texto" }, h("b", null, "Qué hacer: "), inc.accion) : null,
      inc.enlace ? h("div", { class: "aviso__acciones" }, h("a", { class: "boton boton--chico", href: inc.enlace, target: "_blank", rel: "noopener noreferrer" }, icono("externo"), "Ver la explicación en Twilio")) : null));
}

function pasosLlamada(f, info, final) {
  const cat = f.cat;
  if (cat === "pendiente" || cat === "omitido") return [[cat === "omitido" ? "Se omitió este contacto" : "Esperando su turno", 0, ""]];
  if (cat === "error" && !f.sid) return [["Se intentó crear la llamada", f.tCrea || f.tFin, ""], [info.etiqueta, f.tFin || f.tCrea, "error"]];
  const conecto = cat === "contesto" || cat === "buzon" || Boolean(f.tContesta);
  const pasos = [["Llamada creada", f.tCrea, ""]];
  if (f.tTimbra || conecto || cat === "no_contesto") pasos.push(["Timbrando", f.tTimbra, ""]);
  if (conecto) pasos.push([cat === "buzon" ? "Contestó una grabadora" : "Contestaron", f.tContesta, ""]);
  pasos.push([conecto && cat !== "en_curso" ? "Terminó la llamada" : (final ? info.etiqueta : "Termina"), f.tFin, final]);
  return pasos;
}

function cronologia(f, tipo) {
  const wa = tipo === "whatsapp";
  const info = infoFila(f, tipo);
  const final = ["si", "no", "error"].includes(info.grupo) ? info.grupo : "";
  const pasos = wa
    ? [["Enviado a Twilio", f.tCrea, ""], [final === "si" ? "Entregado" : final === "error" ? "No se entregó" : "Resultado", f.tFin, final]]
    : pasosLlamada(f, info, final);
  const hecho = pasos.map(([, t], k) => Boolean(t) || pasos.slice(k + 1).some(([, t2]) => Boolean(t2)));
  return h("ul", { class: "cronologia", "aria-label": "Qué pasó con esta llamada" },
    pasos.map(([texto, t, fin], k) => h("li", { dataset: { hecho: String(hecho[k]), final: t ? fin : "" } },
      h("span", { class: "cronologia__punto" }, h("i")), h("b", null, texto), h("span", null, t ? hora(t) : "—"))));
}

function pintarLocal(refs) {
  const { tipo, campanaId } = abierto;
  const f = abierto.fila;
  const info = infoFila(f, tipo);
  const wa = tipo === "whatsapp";
  vaciar(refs.local);

  const explicacion = detalleDeFila(f, tipo);
  refs.local.append(h("section", { class: "seccion" },
    h("div", { class: "cinta" }, h("span", { class: `chip ${CHIP_POR_TONO[info.tono] || ""}` }, lampara(info.forma, info.tono, info.fase), info.etiqueta)),
    explicacion && !f.incidencia ? h("p", { class: "texto-2" }, explicacion) : null));

  const inc = bloqueIncidencia(f);
  if (inc) refs.local.append(inc);

  refs.local.append(h("section", { class: "seccion" }, h("h3", { class: "titulo-seccion" }, "Qué pasó"), cronologia(f, tipo)));

  const dl = h("dl", { class: "lista-def" });
  dato(dl, "Número", telefono(f.numero));
  if (f.nombre) dato(dl, "Nombre", f.nombre);
  if (!wa) {
    if (f.duracion) dato(dl, "Duración", `${durLarga(f.duracion)} (${dur(f.duracion)})`);
    if (f.audioSeg && f.duracion) {
      const pct = Math.min(100, Math.round((f.duracion / f.audioSeg) * 100));
      dato(dl, "Escuchó", `${pct} % del mensaje (${Math.round(f.audioSeg)} s de audio)`);
    }
    if (f.voz) dato(dl, "Voz", f.voz);
    if (f.answeredBy) dato(dl, "Quién contestó", contestadoPor(f.answeredBy));
    if (f.sip) dato(dl, "Código SIP", String(f.sip));
  }
  if (f.precio) dato(dl, "Costo", dinero(Math.abs(f.precio)));
  if (f.intentos > 1) dato(dl, "Intentos", String(f.intentos));
  if (f.sid) dato(dl, "SID de Twilio", f.sid, { copiable: true });
  refs.local.append(h("section", { class: "seccion" }, h("h3", { class: "titulo-seccion" }, "Datos"), dl));

  if (!wa && f.audioClave) {
    const url = `/api/campanas/${encodeURIComponent(campanaId)}/audios/${encodeURIComponent(f.audioClave)}`;
    refs.local.append(h("section", { class: "seccion" }, h("h3", { class: "titulo-seccion" }, f.cat === "contesto" || f.cat === "buzon" ? "Audio que escuchó" : "Audio de este contacto"),
      h("audio", { controls: true, preload: "none", src: url, style: { width: "100%" } }),
      h("a", { class: "boton boton--chico", href: url, download: "" }, icono("descargas"), "Descargar este audio")));
  }
}

function pintarTwilio(refs) {
  vaciar(refs.twilio);
  const { tipo, twilio, twilioError, cargandoTwilio } = abierto;
  if (tipo === "whatsapp" || !abierto.fila.sid) { refs.twilio.hidden = true; return; }
  refs.twilio.hidden = false;
  refs.twilio.append(h("h3", { class: "titulo-seccion" }, "Lo que dice Twilio ahora"));
  if (cargandoTwilio) {
    refs.twilio.append(h("div", { class: "esqueleto", style: { height: "16px", width: "70%" } }), h("div", { class: "esqueleto", style: { height: "16px", width: "50%" } }));
    return;
  }
  if (twilioError) {
    refs.twilio.append(h("div", { class: "aviso aviso--aviso" }, icono("alerta"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, "No se pudo consultar a Twilio"), h("span", { class: "aviso__texto" }, twilioError))));
    return;
  }
  if (!twilio) return;
  const dl = h("dl", { class: "lista-def" });
  dato(dl, "Estado", estadoTwilioTexto(twilio.estado));
  dato(dl, "Desde", twilio.de);
  dato(dl, "Hacia", twilio.para);
  if (twilio.duracion !== null && twilio.duracion !== undefined) dato(dl, "Duración", `${twilio.duracion} s`);
  if (twilio.precio !== null && twilio.precio !== undefined) dato(dl, "Precio", `${twilio.precio} ${twilio.moneda || "USD"}`);
  if (twilio.contestadoPor) dato(dl, "Detectado como", contestadoPor(twilio.contestadoPor));
  if (twilio.inicio) dato(dl, "Inició", new Date(twilio.inicio).toLocaleString("es-MX"));
  if (twilio.fin) dato(dl, "Terminó", new Date(twilio.fin).toLocaleString("es-MX"));
  refs.twilio.append(dl);
  const notas = twilio.notificaciones || [];
  if (notas.length) {
    refs.twilio.append(h("h4", { class: "texto-2", style: { fontWeight: "650" } }, "Avisos y errores que Twilio registró"),
      h("div", { class: "errores" }, notas.map((n) => h("div", { class: "error-item", dataset: { nivel: n.nivel === "error" ? "error" : n.nivel === "aviso" ? "aviso" : "info" } },
        h("div", { class: "error-item__cabeza" }, n.codigo ? h("span", { class: "error-item__codigo" }, n.codigo) : null, h("b", null, n.texto || "Aviso de Twilio")),
        h("div", { class: "error-item__pie" }, n.fecha ? h("span", null, new Date(n.fecha).toLocaleString("es-MX")) : null,
          n.enlace ? h("a", { href: n.enlace, target: "_blank", rel: "noopener noreferrer" }, icono("externo"), "Más información") : null)))));
  } else refs.twilio.append(h("p", { class: "texto-3 pequeno" }, "Twilio no registró avisos ni errores para esta llamada."));
}

export function abrirDetalle({ campanaId, tipo, fila, obtenerFila }) {
  const dlg = document.getElementById("dlg-detalle");
  if (abierto && abierto.control) abierto.control.abort();
  const control = new AbortController();
  abierto = { campanaId, tipo, i: fila.i, fila, obtenerFila, extra: null, twilio: null, twilioError: "", cargandoTwilio: tipo === "llamadas" && Boolean(fila.sid), control };
  vaciar(dlg);

  const titulo = fila.nombre || telefono(fila.numero);
  const cerrar = h("button", { type: "button", class: "boton boton--fantasma boton--icono", "aria-label": "Cerrar", on: { click: () => dlg.close() } }, icono("x"));
  const refs = { local: h("div", { class: "seccion" }), twilio: h("section", { class: "seccion", hidden: true }) };
  const botones = [
    h("button", { type: "button", class: "boton", on: { click: () => copiar(abierto.fila.numero, "Número copiado") } }, icono("copiar"), "Copiar número"),
    fila.sid && tipo === "llamadas" ? h("a", { class: "boton", href: enlaceLlamadaTwilio(fila.sid), target: "_blank", rel: "noopener noreferrer" }, icono("externo"), "Ver en Twilio") : null,
  ];
  dlg.append(
    h("div", { class: "cajon__cabeza" }, h("div", null, h("h2", { class: "titulo-seccion", id: "dlg-detalle-titulo" }, titulo), fila.nombre ? h("p", { class: "texto-3 num" }, telefono(fila.numero)) : null), cerrar),
    h("div", { class: "cajon__cuerpo" }, refs.local, refs.twilio),
    h("div", { class: "cajon__pie" }, botones));
  abierto.refs = refs;
  dlg.onclick = (ev) => { if (ev.target === dlg) dlg.close(); };
  dlg.onclose = () => { if (abierto && abierto.control) abierto.control.abort(); abierto = null; };
  pintarLocal(refs);
  pintarTwilio(refs);
  if (!dlg.open) dlg.showModal();

  api(`/campanas/${encodeURIComponent(campanaId)}/filas/${fila.i}`, { senal: control.signal, silencioso: true })
    .then((r) => {
      if (!abierto || abierto.control !== control) return;
      abierto.extra = r.fila || null;
      if (r.fila) abierto.fila = { ...abierto.fila, ...r.fila };
      abierto.twilio = r.twilio || null;
      abierto.twilioError = r.twilioError || "";
      abierto.cargandoTwilio = false;
      pintarLocal(refs);
      pintarTwilio(refs);
    })
    .catch((err) => {
      if (!abierto || abierto.control !== control || (err && err.name === "AbortError")) return;
      abierto.cargandoTwilio = false;
      abierto.twilioError = err.message;
      pintarTwilio(refs);
    });
}

export function actualizarDetalle() {
  if (!abierto || !abierto.obtenerFila) return;
  const nueva = abierto.obtenerFila(abierto.i);
  if (!nueva) return;
  abierto.fila = { ...abierto.fila, ...nueva };
  pintarLocal(abierto.refs);
}

export function cerrarDetalle() {
  const dlg = document.getElementById("dlg-detalle");
  if (dlg && dlg.open) dlg.close();
}
