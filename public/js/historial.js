import { h, vaciar, icono, lampara, aviso, modal, reconciliar, texto, antirrebote } from "./dom.js";
import { api } from "./api.js";
import { app, cargarCampanas, escuchar, memoria } from "./estado.js";
import { num, pct, dinero, fechaHora, durLarga, ESTADOS_CAMPANA, plural, porcentajeDe } from "./fmt.js";
import { barraApilada } from "./graficos.js";
import { normalizar } from "./calculos.js";

const POR_PAGINA = 20;
const ESTADOS_FILTRO = [
  ["todos", "Todos los estados"], ["activas", "En marcha o en pausa"], ["completada", "Completadas"], ["detenida", "Detenidas"], ["problemas", "Interrumpidas o con error"],
];

function cumpleEstado(x, filtro) {
  switch (filtro) {
    case "activas": return x.activa;
    case "completada": return x.estado === "completada";
    case "detenida": return x.estado === "detenida";
    case "problemas": return x.estado === "interrumpida" || x.estado === "error";
    default: return true;
  }
}

export function montarHistorial(contenedor) {
  let iniciado = false;
  let visible = false;
  let sondeo = 0;
  const est = { tipo: memoria.leer("historial:tipo", "todas"), estado: "todos", busqueda: "", limite: POR_PAGINA };
  const nodos = new Map();
  const refs = {};

  function crearTarjeta() {
    const c = {
      tipo: h("div", { class: "camp__tipo" }), titulo: h("b"), chip: h("span", { class: "chip" }), meta: h("div", { class: "camp__meta" }),
      mensaje: h("div", { class: "camp__mensaje" }), barraEl: h("div"), leyenda: h("div", { class: "camp__leyenda" }), acciones: h("div", { class: "camp__acciones" }),
    };
    c.barra = barraApilada(c.barraEl, "Reparto de resultados");
    const el = h("article", { class: "camp surge" }, c.tipo,
      h("div", { class: "camp__info" }, h("div", { class: "camp__titulo" }, c.titulo, c.chip), c.meta, c.mensaje),
      h("div", { class: "camp__numeros" }, c.barraEl, c.leyenda), c.acciones);
    el._c = c;
    el._firma = "";
    return el;
  }

  function pintarTarjeta(el, x) {
    const firma = `${x.estado}|${x.progreso}|${x.contestaron}|${x.noContestaron}|${x.fallaron}|${x.sinMarcar}|${x.costo}|${x.nombre}|${x.fin}|${x.total}|${x.reanudable}`;
    if (el._firma === firma) return;
    el._firma = firma;
    const c = el._c;
    const wa = x.tipo === "whatsapp";
    const estado = ESTADOS_CAMPANA[x.estado] || { texto: x.estado, chip: "" };
    el.dataset.activa = String(Boolean(x.activa));

    vaciar(c.tipo);
    c.tipo.append(icono(wa ? "whatsapp" : "llamada", { titulo: wa ? "Campaña de WhatsApp" : "Campaña de llamadas" }));
    texto(c.titulo, x.nombre || (wa ? "Campaña de WhatsApp" : "Campaña de llamadas"));
    vaciar(c.chip);
    c.chip.className = `chip chip--${estado.chip}`;
    if (estado.animada) c.chip.append(lampara("curso", "curso", "llamada"));
    c.chip.append(estado.animada && x.progreso !== undefined ? `${estado.texto} · ${x.progreso} %` : estado.texto);

    vaciar(c.meta);
    const inicio = x.inicio || x.creada;
    c.meta.append(h("span", { title: inicio ? new Date(inicio).toLocaleString("es-MX") : "" }, inicio ? fechaHora(inicio) : ""));
    c.meta.append(h("span", null, `${num(x.total)} ${plural(x.total, "contacto", "contactos")}`));
    if (x.inicio && x.fin && !x.activa) c.meta.append(h("span", null, `Duró ${durLarga((new Date(x.fin) - new Date(x.inicio)) / 1000)}`));
    if (x.costo) c.meta.append(h("span", null, dinero(x.costo)));
    if (x.reanudable) c.meta.append(h("span", { class: "chip chip--aviso" }, "Se puede reanudar"));
    texto(c.mensaje, x.mensaje || "");
    c.mensaje.hidden = !x.mensaje;
    c.mensaje.title = x.mensaje || "";

    const resto = Math.max(0, x.total - x.contestaron - x.noContestaron - x.fallaron);
    c.barra.actualizar({ si: x.contestaron, no: x.noContestaron, error: x.fallaron, pend: resto }, x.total,
      `${num(x.contestaron)} ${wa ? "entregados" : "respondieron"}, ${num(x.noContestaron)} no respondieron, ${num(x.fallaron)} fallaron de ${num(x.total)}`);
    vaciar(c.leyenda);
    const item = (forma, tono, t) => h("span", null, lampara(forma, tono), t);
    c.leyenda.append(item("circulo", "si", `${num(x.contestaron)} ${wa ? "entregados" : "respondieron"}`));
    if (!wa) c.leyenda.append(item("anillo", "no", `${num(x.noContestaron)} no respondieron`));
    c.leyenda.append(item("rombo", "error", `${num(x.fallaron)} ${wa ? "no entregados" : "fallaron"}`));
    if (x.sinMarcar) c.leyenda.append(item("cuadro", "neutro", `${num(x.sinMarcar)} sin ${wa ? "enviar" : "marcar"}`));

    vaciar(c.acciones);
    c.acciones.append(
      h("a", { class: `boton boton--chico ${x.activa ? "boton--primario" : "boton--tonal"}`, href: `#/en-vivo/${encodeURIComponent(x.id)}` }, icono("envivo"), x.activa ? "Ver en vivo" : "Ver resultados"),
      h("a", { class: "boton boton--chico", href: `#/descargas/${encodeURIComponent(x.id)}` }, icono("descargas"), "Descargas"),
      x.activa ? null : h("button", { type: "button", class: "boton boton--chico boton--fantasma boton--icono", title: "Eliminar", "aria-label": `Eliminar la campaña ${x.nombre || x.id}`, on: { click: () => eliminar(x) } }, icono("papelera")));
  }

  async function eliminar(x) {
    const ok = await modal({
      titulo: "¿Eliminar esta campaña?", peligro: true, aceptar: "Eliminar",
      texto: `Se borran de este servidor los resultados de ${num(x.total)} contactos de «${x.nombre || "la campaña"}». Descarga antes el reporte si lo necesitas. Las llamadas ya hechas siguen en tu cuenta de Twilio.`,
    });
    if (!ok) return;
    try {
      await api(`/campanas/${encodeURIComponent(x.id)}`, { metodo: "DELETE" });
      aviso("Campaña eliminada", { tipo: "ok", duracion: 2500 });
      await cargarCampanas().catch(() => {});
    } catch (err) {
      aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo eliminar" });
    }
  }

  function construir() {
    refs.resumen = h("div", { class: "datos-fila" });
    const botonesTipo = [["todas", "Todas", null], ["llamadas", "Llamadas", "llamada"], ["whatsapp", "WhatsApp", "whatsapp"]].map(([clave, t, ic]) => {
      const b = h("button", { type: "button", "aria-pressed": String(est.tipo === clave) }, ic ? icono(ic) : null, t);
      b.addEventListener("click", () => { est.tipo = clave; est.limite = POR_PAGINA; memoria.guardar("historial:tipo", clave); botonesTipo.forEach(([k, bb]) => bb.setAttribute("aria-pressed", String(k === clave))); pintar(); });
      return [clave, b];
    });
    const selectorEstado = h("select", { class: "selector", "aria-label": "Filtrar por estado", style: { width: "auto" } }, ESTADOS_FILTRO.map(([v, t]) => h("option", { value: v }, t)));
    selectorEstado.addEventListener("change", () => { est.estado = selectorEstado.value; est.limite = POR_PAGINA; pintar(); });
    const campoBusqueda = h("input", { class: "entrada", type: "search", placeholder: "Buscar por nombre o mensaje", "aria-label": "Buscar campaña", autocomplete: "off" });
    campoBusqueda.addEventListener("input", antirrebote(() => { est.busqueda = campoBusqueda.value; est.limite = POR_PAGINA; pintar(); }, 200));
    refs.lista = h("div", { class: "campanas" });
    refs.vacio = h("div", { class: "vacio", hidden: true });
    refs.mas = h("div", { class: "mas-filas", hidden: true });
    refs.contador = h("p", { class: "texto-3 pequeno", "aria-live": "polite" });

    const intro = h("div", { class: "intro-vista" }, h("h2", { class: "titulo-pagina" }, "Historial de campañas"),
      h("p", null, "Todas las campañas guardadas en este servidor. Ábrelas para ver el detalle de cada contacto, descarga los reportes o repite una con los que no respondieron."));
    contenedor.append(intro, h("div", { class: "seccion", style: { marginTop: "20px" } },
      refs.resumen,
      h("div", { class: "filtros-historial" }, h("div", { class: "segmentado", role: "group", "aria-label": "Tipo de campaña" }, botonesTipo.map(([, b]) => b)), selectorEstado, h("div", { class: "buscador" }, icono("buscar"), campoBusqueda)),
      refs.contador, refs.lista, refs.vacio, refs.mas));
  }

  function pintar() {
    if (!iniciado) return;
    const todas = app.campanas || [];

    const llamadas = todas.filter((x) => x.tipo === "llamadas");
    const contactos = todas.reduce((s, x) => s + (x.total || 0), 0);
    const respondieron = llamadas.reduce((s, x) => s + (x.contestaron || 0), 0);
    const marcadas = llamadas.reduce((s, x) => s + (x.contestaron || 0) + (x.noContestaron || 0) + (x.fallaron || 0), 0);
    const costo = todas.reduce((s, x) => s + (x.costo || 0), 0);
    vaciar(refs.resumen);
    const dato = (t, v, sub) => h("div", { class: "dato" }, h("span", null, t), h("b", { class: "num" }, v), sub ? h("span", { class: "pequeno" }, sub) : null);
    refs.resumen.append(dato("Campañas", num(todas.length)), dato("Contactos", num(contactos)),
      dato("Respuesta en llamadas", marcadas ? pct(Math.round(porcentajeDe(respondieron, marcadas) * 10) / 10) : "—", marcadas ? `${num(respondieron)} de ${num(marcadas)}` : ""),
      dato("Costo en Twilio", costo ? dinero(costo) : "—"));

    const q = normalizar(est.busqueda).trim();
    const filtradas = todas.filter((x) => (est.tipo === "todas" || x.tipo === est.tipo) && cumpleEstado(x, est.estado)
      && (!q || normalizar(x.nombre).includes(q) || normalizar(x.mensaje).includes(q)))
      .sort((a, b) => Number(b.activa) - Number(a.activa) || String(b.creada).localeCompare(String(a.creada)));
    const visibles = filtradas.slice(0, est.limite);

    reconciliar(refs.lista, visibles.map((x) => x.id), nodos, crearTarjeta, (el, id) => pintarTarjeta(el, filtradas.find((x) => x.id === id)));
    refs.lista.hidden = !visibles.length;
    refs.vacio.hidden = Boolean(visibles.length);
    if (!visibles.length) {
      vaciar(refs.vacio);
      refs.vacio.append(h("div", { class: "vacio__icono" }, icono(todas.length ? "buscar" : "historial")),
        h("h3", null, todas.length ? "Ninguna campaña coincide" : "Todavía no hay campañas"),
        h("p", null, todas.length ? "Prueba con otro filtro o borra la búsqueda." : "Cuando termines tu primera campaña aparecerá aquí con sus resultados."),
        todas.length ? null : h("div", { class: "cinta", style: { justifyContent: "center" } },
          h("a", { class: "boton boton--primario", href: "#/llamadas" }, icono("llamada"), "Nueva campaña de llamadas"), h("a", { class: "boton", href: "#/whatsapp" }, icono("whatsapp"), "Nueva de WhatsApp")));
    }
    texto(refs.contador, todas.length ? `${filtradas.length === todas.length ? "" : `${num(filtradas.length)} de `}${num(todas.length)} ${plural(todas.length, "campaña", "campañas")}` : "");
    const restan = filtradas.length - visibles.length;
    refs.mas.hidden = restan <= 0;
    if (restan > 0) {
      vaciar(refs.mas);
      refs.mas.append(h("button", { type: "button", class: "boton", on: { click: () => { est.limite += POR_PAGINA; pintar(); } } }, icono("abajo"), `Mostrar ${num(Math.min(POR_PAGINA, restan))} más`));
    }
  }

  function programarSondeo() {
    clearInterval(sondeo);
    sondeo = setInterval(() => {
      if (!visible || document.hidden) return;
      if ((app.campanas || []).some((x) => x.activa)) cargarCampanas().catch(() => {});
    }, 4000);
  }

  return {
    async mostrar() {
      visible = true;
      if (!iniciado) {
        iniciado = true;
        construir();
        escuchar("lista", () => { if (visible) pintar(); });
      }
      pintar();
      programarSondeo();
      try { await cargarCampanas(); } catch (err) { aviso(err.message, { tipo: "error", titulo: "No se pudo leer el historial" }); }
      if (visible) pintar();
    },
    ocultar() { visible = false; clearInterval(sondeo); },
  };
}
