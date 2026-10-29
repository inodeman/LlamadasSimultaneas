import { h, vaciar, icono, aviso, conCarga, agregar } from "./dom.js";
import { api, descargarDelServidor, urlDescarga, zonaHoraria } from "./api.js";
import { app, irA, cargarCampanas } from "./estado.js";
import { num, plural, fechaHora, dinero, ESTADOS_CAMPANA } from "./fmt.js";
import { estadoTwilioTexto } from "./calculos.js";

const ICONOS = { XLSX: "tabla", CSV: "lista", ZIP: "zip" };
const DESTACADAS = ["excel", "respaldo"];

const hoyLocal = () => new Date().toLocaleDateString("sv-SE");
const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("sv-SE"); };

export function montarDescargas(contenedor) {
  let iniciado = false;
  let visible = false;
  let idActual = "";
  let secuencia = 0;
  const refs = {};

  function etiquetaCampana(x) {
    const estado = (ESTADOS_CAMPANA[x.estado] || {}).texto || x.estado;
    return `${x.nombre || (x.tipo === "whatsapp" ? "Campaña de WhatsApp" : "Campaña de llamadas")} · ${fechaHora(x.inicio || x.creada)} · ${num(x.total)} ${plural(x.total, "contacto", "contactos")} · ${estado}`;
  }

  function llenarSelector() {
    const lista = (app.campanas || []).slice().sort((a, b) => String(b.creada).localeCompare(String(a.creada)));
    vaciar(refs.selector);
    if (!lista.length) { refs.selector.append(h("option", { value: "" }, "No hay campañas todavía")); refs.selector.disabled = true; return; }
    refs.selector.disabled = false;
    lista.forEach((x) => refs.selector.append(h("option", { value: x.id, selected: x.id === idActual }, etiquetaCampana(x))));
  }

  function tarjeta(d) {
    const destacada = DESTACADAS.includes(d.id) && !d.vacio;
    const cantidad = d.cantidad === null || d.cantidad === undefined ? "" : d.id === "audios" ? `${num(d.cantidad)} ${plural(d.cantidad, "audio", "audios")}` : d.id === "errores" ? `${num(d.cantidad)} ${plural(d.cantidad, "error", "errores")}` : `${num(d.cantidad)} ${plural(d.cantidad, "fila", "filas")}`;
    let accion;
    if (d.vacio) {
      accion = h("button", { type: "button", class: "boton", disabled: true }, "Sin datos todavía");
    } else if (d.formato === "ZIP") {
      accion = h("a", { class: `boton ${destacada ? "boton--primario" : ""}`.trim(), href: urlDescarga(d.href), download: "" , on: { click: () => aviso("La descarga empieza en unos segundos. Si hay muchos audios, puede tardar.", { tipo: "info", duracion: 3500 }) } }, icono("descargas"), "Descargar");
    } else {
      accion = h("button", { type: "button", class: `boton ${destacada ? "boton--primario" : ""}`.trim() }, icono("descargas"), "Descargar");
      accion.addEventListener("click", () => conCarga(accion, async () => {
        try {
          const r = await descargarDelServidor(urlDescarga(d.href).replace(/^\/api/, ""), `${d.id}.${d.formato.toLowerCase()}`);
          aviso(r.nombre, { tipo: "ok", titulo: "Descarga lista", duracion: 3500 });
        } catch (err) {
          aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo descargar" });
        }
      }));
    }
    return h("article", { class: `descarga surge${destacada ? " descarga--destacada" : ""}`, dataset: { vacio: String(Boolean(d.vacio)) } },
      h("div", { class: "descarga__cuerpo" },
        h("div", { class: "descarga__cabeza" },
          h("span", { class: "descarga__icono", dataset: { formato: d.formato } }, icono(ICONOS[d.formato] || "archivo")),
          h("div", { class: "descarga__titulo" }, h("b", null, d.titulo)), h("span", { class: "descarga__formato" }, d.formato)),
        h("p", null, d.descripcion),
        destacada ? null : h("div", { class: "descarga__pie" }, h("span", { class: "descarga__cantidad" }, cantidad), accion)),
      destacada ? h("div", { class: "descarga__pie", style: { flexDirection: "column", alignItems: "flex-end", gap: "8px", marginTop: "0" } }, h("span", { class: "descarga__cantidad" }, cantidad), accion) : null);
  }

  async function cargarCatalogo() {
    const marca = (secuencia += 1);
    vaciar(refs.grid);
    if (!idActual) {
      refs.grid.append(h("div", { class: "vacio", style: { gridColumn: "1 / -1" } }, h("div", { class: "vacio__icono" }, icono("descargas")), h("h3", null, "Aún no hay nada que descargar"),
        h("p", null, "Cuando termines una campaña podrás bajar aquí el Excel, las listas, los audios de ElevenLabs y los datos de Twilio."),
        h("div", { class: "cinta", style: { justifyContent: "center" } }, h("a", { class: "boton boton--primario", href: "#/llamadas" }, icono("llamada"), "Nueva campaña de llamadas"))));
      return;
    }
    [0, 1, 2].forEach(() => refs.grid.append(h("div", { class: "esqueleto", style: { height: "150px", borderRadius: "16px" } })));
    try {
      const r = await api(`/campanas/${encodeURIComponent(idActual)}/descargas?tz=${encodeURIComponent(zonaHoraria())}`);
      if (marca !== secuencia) return;
      vaciar(refs.grid);
      const todas = r.descargas || [];
      const orden = [...DESTACADAS.map((id) => todas.find((d) => d.id === id)).filter(Boolean), ...todas.filter((d) => !DESTACADAS.includes(d.id))];
      orden.forEach((d) => refs.grid.append(tarjeta(d)));
    } catch (err) {
      if (marca !== secuencia) return;
      vaciar(refs.grid);
      refs.grid.append(h("div", { class: "aviso aviso--error", style: { gridColumn: "1 / -1" } }, icono("error"),
        h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, err.status === 404 ? "No encontré esa campaña" : "No se pudieron leer las descargas"), h("span", { class: "aviso__texto" }, err.message),
          h("div", { class: "aviso__acciones" }, h("button", { type: "button", class: "boton boton--chico", on: { click: cargarCatalogo } }, icono("reintentar"), "Reintentar")))));
    }
  }

  function construirRegistro() {
    const desde = h("input", { class: "entrada", type: "date", id: "reg-desde", value: hoyLocal(), max: hoyLocal() });
    const hasta = h("input", { class: "entrada", type: "date", id: "reg-hasta", value: hoyLocal(), max: hoyLocal() });
    const resultado = h("div", { class: "resultado-registro", "aria-live": "polite" });
    const rapido = (texto, d, a) => h("button", { type: "button", class: "filtro", on: { click: () => { desde.value = d(); hasta.value = a(); } } }, texto);
    const parametros = (formato) => `desde=${encodeURIComponent(desde.value)}&hasta=${encodeURIComponent(hasta.value)}&formato=${formato}&tz=${encodeURIComponent(zonaHoraria())}`;
    const validar = () => {
      if (!desde.value || !hasta.value) { aviso("Elige la fecha inicial y la final.", { tipo: "aviso" }); return false; }
      return true;
    };
    const error = (err) => aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo consultar Twilio" });

    const verResumen = h("button", { type: "button", class: "boton" }, icono("barras"), "Ver resumen");
    verResumen.addEventListener("click", () => conCarga(verResumen, async () => {
      if (!validar()) return;
      try {
        const r = await api(`/twilio/registro?${parametros("json")}`);
        vaciar(resultado);
        const estados = Object.entries(r.porEstado || {}).sort((a, b) => b[1] - a[1]);
        agregar(resultado, [
          h("div", { class: "datos-fila surge" },
            h("div", { class: "dato" }, h("span", null, "Llamadas en el rango"), h("b", { class: "num" }, num(r.total))),
            h("div", { class: "dato" }, h("span", null, "Costo"), h("b", { class: "num" }, r.costo ? dinero(r.costo) : "—")),
            estados.map(([estado, n]) => h("div", { class: "dato" }, h("span", null, estadoTwilioTexto(estado)), h("b", { class: "num" }, num(n))))),
          r.total ? null : h("p", { class: "texto-3 pequeno" }, "Twilio no tiene llamadas en esas fechas.")]);
      } catch (err) { error(err); }
    }));

    const bajar = (formato, texto) => {
      const b = h("button", { type: "button", class: "boton boton--primario" }, icono("descargas"), texto);
      b.addEventListener("click", () => conCarga(b, async () => {
        if (!validar()) return;
        try {
          const r = await descargarDelServidor(`/twilio/registro?${parametros(formato)}`, `llamadas_twilio_${desde.value}_${hasta.value}.${formato}`);
          aviso(r.nombre, { tipo: "ok", titulo: "Descarga lista", duracion: 3500 });
        } catch (err) { error(err); }
      }));
      return b;
    };

    refs.avisoTwilio = h("div", { class: "seccion", hidden: true });
    return h("section", { class: "panel", "aria-labelledby": "titulo-registro" },
      h("div", { class: "panel__cabeza" }, h("div", null, h("h3", { class: "titulo-seccion", id: "titulo-registro" }, "Registro de llamadas en Twilio"),
        h("p", null, "Todas las llamadas de tu cuenta en un rango de fechas (máximo 31 días), aunque no se hayan hecho desde este panel. Incluye estado, duración, costo y quién contestó."))),
      refs.avisoTwilio,
      h("div", { class: "cinta" }, rapido("Hoy", hoyLocal, hoyLocal), rapido("Ayer", () => diasAtras(1), () => diasAtras(1)), rapido("Últimos 7 días", () => diasAtras(6), hoyLocal), rapido("Últimos 30 días", () => diasAtras(30), hoyLocal)),
      h("div", { class: "registro-twilio" },
        h("div", { class: "campo" }, h("label", { for: "reg-desde" }, "Desde"), desde),
        h("div", { class: "campo" }, h("label", { for: "reg-hasta" }, "Hasta"), hasta),
        verResumen, bajar("xlsx", "Excel"), bajar("csv", "CSV")),
      resultado);
  }

  function pintarAvisoTwilio() {
    vaciar(refs.avisoTwilio);
    refs.avisoTwilio.hidden = !(app.config && !app.config.twilioConfigurado);
    if (app.config && !app.config.twilioConfigurado) {
      refs.avisoTwilio.append(h("div", { class: "aviso aviso--error" }, icono("error"), h("div", { class: "aviso__cuerpo" },
        h("span", { class: "aviso__titulo" }, "Twilio no está configurado"), h("span", { class: "aviso__texto" }, "Agrega TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en el archivo .env del servidor para consultar el registro de llamadas."))));
    }
  }

  function construir() {
    refs.selector = h("select", { class: "selector", id: "sel-campana-descargas" });
    refs.selector.addEventListener("change", () => { if (refs.selector.value) irA(`/descargas/${refs.selector.value}`); });
    refs.grid = h("div", { class: "descargas-grid" });
    const intro = h("div", { class: "intro-vista" }, h("h2", { class: "titulo-pagina" }, "Descargas"),
      h("p", null, "Todo lo que genera una campaña, listo para guardar: el Excel con todas las hojas, las listas en CSV, los audios de ElevenLabs y los datos de Twilio."));
    contenedor.append(intro, h("div", { class: "seccion", style: { marginTop: "20px" } },
      h("div", { class: "descargas-cabeza" }, h("div", { class: "campo" }, h("label", { for: "sel-campana-descargas" }, "Campaña"), refs.selector)),
      refs.grid, construirRegistro()));
  }

  return {
    async mostrar(id) {
      visible = true;
      if (!iniciado) { iniciado = true; construir(); }
      pintarAvisoTwilio();
      if (!(app.campanas || []).length) { try { await cargarCampanas(); } catch (err) { } }
      if (!visible) return;
      const lista = app.campanas || [];
      const existe = id && lista.some((x) => x.id === id);
      const porDefecto = (lista.slice().sort((a, b) => String(b.creada).localeCompare(String(a.creada)))[0] || {}).id || "";
      const elegido = existe ? id : (id ? id : porDefecto);
      if (!id && porDefecto) { location.replace(`#/descargas/${porDefecto}`); return; }
      idActual = elegido || "";
      llenarSelector();
      await cargarCatalogo();
    },
    ocultar() { visible = false; },
  };
}
