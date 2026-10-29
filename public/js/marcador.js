import { h, vaciar, icono, lampara, contador, texto, reconciliar } from "./dom.js";
import { num, decimal, pct, dur, durLarga, dinero, faltan, gruposDe, ORDEN_GRUPOS, telefono, plural, porcentajeDe, infoFila, detalleDeFila, horaCorta } from "./fmt.js";
import { conteoGrupos, lineasActivas, rangoLinea } from "./calculos.js";

const ACTIVA = ["preparando", "generando_audios", "en_curso", "finalizando"];

function metrica(etiqueta, valor, nota) {
  return h("div", { class: "metrica" }, h("span", null, etiqueta), h("b", { class: "num" }, valor), nota ? h("small", null, nota) : null);
}

export function crearMarcador({ tipo, alFiltrar, alActualizarTwilio }) {
  const wa = tipo === "whatsapp";
  const grupos = gruposDe(tipo);

  const cifra = h("span", { class: "libro__cifra num" }, "—");
  const sub = h("span", { class: "libro__sub" });
  const hero = h("div", { class: "libro__hero" },
    h("div", { class: "libro__etiqueta" }, lampara(grupos.si.forma, grupos.si.tono), wa ? "Tasa de entrega" : "Tasa de respuesta"), cifra, sub);

  const filas = new Map();
  const lista = h("div", { class: "libro__lista" });
  for (const g of ORDEN_GRUPOS) {
    if (wa && g === "no") continue;
    const cifraFila = h("span", { class: "libro__fila-cifra num" }, "0");
    const pctFila = h("span", { class: "libro__fila-pct num" }, "0 %");
    const boton = h("button", { type: "button", class: "libro__fila", "aria-pressed": "false", title: "Ver solo estos contactos" },
      lampara(grupos[g].forma, grupos[g].tono, g === "curso" ? "llamada" : ""), h("span", { class: "libro__fila-nombre" }, grupos[g].etiqueta), cifraFila, pctFila);
    boton.addEventListener("click", () => alFiltrar(g));
    filas.set(g, { boton, cifra: cifraFila, pct: pctFila });
    lista.append(boton);
  }

  const metricas = h("div", { class: "libro__metricas" });

  const textoTwilio = h("p");
  const botonTwilio = h("button", { type: "button", class: "boton boton--chico", on: { click: () => alActualizarTwilio() } }, icono("actualizar"), "Actualizar con Twilio");
  const franjaTwilio = h("div", { class: "datos-twilio" }, textoTwilio, botonTwilio);

  const el = h("section", { class: "panel libro", "aria-label": "Marcador" }, hero, lista, metricas, wa ? null : franjaTwilio);

  function pintarMetricas(r) {
    vaciar(metricas);
    const activa = ACTIVA.includes(r.estado);
    if (wa) {
      const m = r.mensajes || {};
      metricas.append(
        metrica("Enviados a Twilio", num(m.enviados || 0), m.enCola ? `${num(m.enCola)} en cola` : ""),
        metrica("Entregados", num(m.entregados || 0), m.enviadosSinEntrega ? `${num(m.enviadosSinEntrega)} enviados sin confirmar` : ""),
        metrica("Leídos", num(m.leidos || 0), "Solo si el contacto tiene activadas las confirmaciones"),
        metrica("No entregados", num(m.fallidos || 0), r.tasaFallos ? pct(r.tasaFallos) : ""),
        metrica("Costo", r.costoConDatos ? dinero(r.costo) : "—", r.costoConDatos ? `${num(r.costoConDatos)} con precio` : ""),
        activa ? metrica("Tiempo restante", r.etaSeg ? faltan(r.etaSeg) : "—", r.ritmoPorMin ? `${decimal(r.ritmoPorMin)} por min` : "") : metrica("Duración", r.inicio && r.fin ? durLarga((new Date(r.fin) - new Date(r.inicio)) / 1000) : "—"));
      return;
    }
    const completo = r.escucharonMedibles ? porcentajeDe(r.escucharonCompleto, r.escucharonMedibles) : null;
    metricas.append(
      metrica("Duración promedio", r.duracionPromedio ? dur(r.duracionPromedio) : "—", "de quienes contestaron"),
      metrica("Escucharon todo el mensaje", completo === null ? "—" : pct(completo), completo === null ? "Se mide cuando termina la llamada" : `${num(r.escucharonCompleto)} de ${num(r.escucharonMedibles)}`),
      metrica("Costo", r.costoConDatos ? dinero(r.costo) : "—", r.costoConDatos ? `${num(r.costoConDatos)} ${plural(r.costoConDatos, "llamada con precio", "llamadas con precio")}` : "Twilio lo calcula unos minutos después"),
      metrica(activa ? "Tiempo restante" : "Duración de la campaña", activa ? (r.etaSeg ? faltan(r.etaSeg) : "—") : (r.inicio && r.fin ? durLarga((new Date(r.fin) - new Date(r.inicio)) / 1000) : "—"), activa && r.ritmoPorMin ? `${decimal(r.ritmoPorMin)} llamadas por min` : ""),
      metrica("Llamada más larga", r.duracionMax ? dur(r.duracionMax) : "—"),
      metrica("Contestan, sin contar fallas", r.cuenta && (r.cuenta.contesto + r.cuenta.no_contesto + r.cuenta.ocupado + r.cuenta.buzon) ? pct(r.tasaContactables) : "—", r.cuenta && r.cuenta.buzon ? `${num(r.cuenta.buzon)} fueron buzón` : ""));
  }

  function pintarTwilio(r, cuentaConTwilio) {
    const e = r.enriquecimiento;
    const terminada = !ACTIVA.includes(r.estado) && r.estado !== "pausada";
    let t = "El precio, quién contestó y el código exacto de cada falla se completan solos cuando termina la campaña.";
    if (e && e.estado === "en_curso") t = `Completando datos con Twilio: ${num(e.hecho)} de ${num(e.total)}…`;
    else if (e && e.estado === "hecho") {
      const partes = [];
      if (e.conCodigo) partes.push(`${num(e.conCodigo)} ${plural(e.conCodigo, "falla con su código exacto", "fallas con su código exacto")}`);
      if (e.alertas) partes.push(`${num(e.alertas)} ${plural(e.alertas, "alerta", "alertas")} de Twilio revisadas`);
      if (e.sinPrecio) partes.push(`${num(e.sinPrecio)} sin precio todavía (Twilio tarda unos minutos)`);
      t = partes.length ? `Datos de Twilio al día. ${partes.join("; ")}.` : "Datos de Twilio al día.";
    } else if (e && e.estado === "error") t = `No se pudieron completar los datos de Twilio: ${e.nota || "error desconocido"}. Se puede volver a intentar.`;
    texto(textoTwilio, t);
    botonTwilio.disabled = !cuentaConTwilio || (e && e.estado === "en_curso") || !r.marcadas;
    botonTwilio.hidden = !terminada && r.estado !== "pausada" && !(e && e.estado);
  }

  function actualizar(S) {
    const r = S.resumen;
    if (!r) return;
    const c = conteoGrupos(r);
    const total = r.total || 0;
    const base = (r.terminadas || 0) - ((r.cuenta && r.cuenta.cancelada) || 0);
    contador(cifra, base > 0 ? r.tasaRespuesta : null, (n) => pct(Math.round(n * 10) / 10));
    texto(sub, base > 0
      ? `${num(c.si)} ${wa ? "entregados" : "contestaron"} de ${num(base)} ${wa ? "mensajes con resultado" : "llamadas con resultado"}`
      : "Todavía no hay resultados.");
    for (const [g, f] of filas) {
      contador(f.cifra, c[g], num);
      texto(f.pct, total ? pct(Math.round((c[g] / total) * 1000) / 10) : "—");
      f.boton.setAttribute("aria-pressed", String(S.grupo === g));
    }
    pintarMetricas(r);
    if (!wa) pintarTwilio(r, S.twilioConfigurado);
  }

  return { el, actualizar };
}

const MAX_LINEAS = 12;

export function crearLineas({ alElegir }) {
  const conteo = h("span", { class: "chip" }, "0 de 0");
  const ranuras = h("div", { class: "lineas__ranuras", "aria-hidden": "true" });
  const lista = h("div", { class: "lineas__lista" });
  const mas = h("p", { class: "texto-3 pequeno", hidden: true });
  const nodos = new Map();
  let temporizador = 0;

  const el = h("section", { class: "panel lineas", "aria-label": "Líneas abiertas en este momento" },
    h("div", { class: "lineas__cabeza" }, h("div", null, h("h3", { class: "titulo-seccion" }, "Líneas abiertas ahora"), h("p", { class: "texto-3 pequeno" }, "Lo que está pasando en este instante")), conteo),
    ranuras, lista, mas);

  function crearLinea(i) {
    const c = { quien: h("b"), estado: h("span"), tiempo: h("span", { class: "num" }), nota: h("small") };
    const boton = h("button", { type: "button", class: "linea", dataset: { i: String(i) } },
      h("span", { class: "linea__lampara" }),
      h("span", { class: "linea__quien" }, c.quien, c.estado),
      h("span", { class: "linea__tiempo" }, c.tiempo, c.nota));
    boton._c = c;
    boton._fase = "";
    boton.addEventListener("click", () => alElegir(i));
    return boton;
  }

  function pintarLinea(boton, f) {
    const c = boton._c;
    const rango = rangoLinea(f);
    const fase = rango === 3 ? "llamada" : rango === 2 ? "timbre" : "cola";
    if (boton._fase !== fase) {
      boton._fase = fase;
      boton.firstChild.replaceChildren(lampara("curso", "curso", fase));
    }
    texto(c.quien, f.nombre || telefono(f.numero));
    texto(c.estado, `${fase === "llamada" ? "Hablando" : fase === "timbre" ? "Timbrando" : "Esperando línea"}${f.nombre ? ` · ${telefono(f.numero)}` : ""}${f.voz ? ` · ${f.voz}` : ""}`);
    boton.dataset.desde = String(fase === "llamada" ? (f.tContesta || f.tTimbra || f.tCrea || Date.now()) : (f.tCrea || Date.now()));
    texto(c.nota, fase === "llamada" ? "en llamada" : fase === "timbre" ? "sonando" : "en cola");
    tic();
  }

  function tic() {
    const ahora = Date.now();
    for (const boton of nodos.values()) {
      const desde = Number(boton.dataset.desde);
      if (desde) texto(boton._c.tiempo, dur(Math.max(0, (ahora - desde) / 1000)));
    }
  }

  function actualizar(S) {
    const r = S.resumen;
    if (!r) return;
    const activas = lineasActivas(S.filas);
    const limite = r.concurrencia || activas.length;
    const total = Math.min(60, Math.max(limite, activas.length));
    texto(conteo, `${num(activas.length)} de ${num(limite)}`);

    const hablando = activas.filter((f) => rangoLinea(f) === 3).length;
    while (ranuras.children.length > total) ranuras.lastChild.remove();
    while (ranuras.children.length < total) ranuras.append(h("i", { class: "ranura" }));
    for (let k = 0; k < total; k += 1) {
      const estado = k < hablando ? "llamada" : k < activas.length ? "timbrando" : "";
      if (ranuras.children[k].dataset.estado !== estado) ranuras.children[k].dataset.estado = estado;
    }

    const visibles = activas.slice(0, MAX_LINEAS);
    reconciliar(lista, visibles.map((f) => f.i), nodos, crearLinea, (boton, i) => pintarLinea(boton, S.filas[i]));
    let vacio = lista.querySelector(".lineas__vacio");
    if (!visibles.length) {
      if (!vacio) { vacio = h("div", { class: "lineas__vacio" }); lista.append(vacio); }
      const t = r.estado === "pausada" ? "Campaña en pausa: no se están abriendo llamadas nuevas."
        : ACTIVA.includes(r.estado) ? (r.estado === "generando_audios" ? "Preparando los audios; las llamadas empiezan en unos segundos." : "Esperando la siguiente llamada…")
          : "No hay llamadas abiertas. La campaña ya no está marcando.";
      texto(vacio, t);
    } else if (vacio) vacio.remove();
    mas.hidden = activas.length <= MAX_LINEAS;
    if (activas.length > MAX_LINEAS) texto(mas, `y ${num(activas.length - MAX_LINEAS)} más`);
  }

  return {
    el, actualizar,
    iniciar() { if (!temporizador) temporizador = setInterval(tic, 1000); },
    detener() { clearInterval(temporizador); temporizador = 0; },
  };
}

const MAX_ULTIMOS = 8;

export function crearUltimos({ tipo, alElegir }) {
  const lista = h("div", { class: "lineas__lista" });
  const nodos = new Map();
  const el = h("section", { class: "panel lineas", "aria-label": "Últimos resultados" },
    h("div", { class: "lineas__cabeza" }, h("div", null, h("h3", { class: "titulo-seccion" }, "Últimos resultados"), h("p", { class: "texto-3 pequeno" }, "Según van terminando"))),
    lista);

  function crear(i) {
    const c = { quien: h("b"), estado: h("span"), hora: h("span", { class: "num" }) };
    const boton = h("button", { type: "button", class: "linea surge", dataset: { i: String(i) } },
      h("span", { class: "linea__lampara" }), h("span", { class: "linea__quien" }, c.quien, c.estado), h("span", { class: "linea__tiempo" }, c.hora));
    boton._c = c;
    boton._forma = "";
    boton.addEventListener("click", () => alElegir(i));
    return boton;
  }

  function pintar(boton, f) {
    const c = boton._c;
    const info = infoFila(f, tipo);
    const clave = `${info.forma}|${info.tono}`;
    if (boton._forma !== clave) { boton._forma = clave; boton.firstChild.replaceChildren(lampara(info.forma, info.tono)); }
    const detalle = detalleDeFila(f, tipo);
    texto(c.quien, f.nombre || telefono(f.numero));
    texto(c.estado, `${info.etiqueta}${detalle && detalle !== info.etiqueta ? ` · ${detalle}` : ""}`);
    texto(c.hora, horaCorta(f.tFin));
  }

  function actualizar(S) {
    const top = [];
    for (const f of S.filas) {
      if (!f || !f.tFin || f.cat === "en_curso" || f.cat === "pendiente") continue;
      if (top.length < MAX_ULTIMOS || f.tFin > top[top.length - 1].tFin) {
        top.push(f);
        top.sort((a, b) => b.tFin - a.tFin);
        if (top.length > MAX_ULTIMOS) top.pop();
      }
    }
    reconciliar(lista, top.map((f) => f.i), nodos, crear, (boton, i) => pintar(boton, S.filas[i]));
    let vacio = lista.querySelector(".lineas__vacio");
    if (!top.length) {
      if (!vacio) { vacio = h("div", { class: "lineas__vacio" }, "Todavía no termina ninguna. Aquí aparecerán en cuanto haya resultados."); lista.append(vacio); }
    } else if (vacio) vacio.remove();
  }

  return { el, actualizar };
}
