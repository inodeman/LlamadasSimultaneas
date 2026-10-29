import { h, vaciar, icono, lampara, aviso, enCuadro, texto, copiar } from "./dom.js";
import { api, abrirEventos } from "./api.js";
import { app, irA } from "./estado.js";
import { num, haceCuanto, ESTADOS_CAMPANA, estaActiva, plural } from "./fmt.js";
import { conteoGrupos } from "./calculos.js";
import { crearPanelTablero } from "./tablero-panel.js";
import { crearMarcador, crearLineas, crearUltimos } from "./marcador.js";
import { crearErrores } from "./errores.js";
import { crearAnalisis } from "./analisis.js";
import { crearTablaContactos } from "./tabla.js";
import { crearControles } from "./envivo-acciones.js";
import { abrirDetalle, actualizarDetalle, cerrarDetalle } from "./detalle.js";

function esqueleto() {
  const bloque = (alto, ancho = "100%") => h("div", { class: "esqueleto", style: { height: alto, width: ancho, borderRadius: "16px" } });
  return h("div", { class: "envivo", "aria-busy": "true", "aria-label": "Cargando la campaña" },
    bloque("38px", "min(420px, 70%)"),
    h("div", { class: "envivo-grid" }, bloque("420px"), h("div", { class: "envivo-lateral" }, bloque("300px"), bloque("180px"))));
}

function vistaVacia({ icon, titulo, texto: descripcion, acciones }) {
  return h("div", { class: "vacio vista-vacia" },
    h("div", { class: "vacio__icono" }, icono(icon)), h("h3", null, titulo), h("p", null, descripcion),
    acciones && acciones.length ? h("div", { class: "cinta", style: { justifyContent: "center" } }, acciones) : null);
}

export function montarEnVivo(contenedor) {
  let S = null;
  let visible = false;
  let secuencia = 0;
  let reloj = 0;

  const boton = (texto_, { clase = "", icon, alClic }) => h("button", { type: "button", class: `boton ${clase}`.trim(), on: { click: alClic } }, icon ? icono(icon) : null, texto_);

  function pintarVacio() {
    vaciar(contenedor);
    contenedor.append(vistaVacia({
      icon: "envivo", titulo: "Todavía no hay campañas",
      texto: "Cuando inicies una, aquí verás en tiempo real quién contesta, quién no y los errores que reporten Twilio o ElevenLabs.",
      acciones: [boton("Nueva campaña de llamadas", { clase: "boton--primario", icon: "llamada", alClic: () => irA("/llamadas") }), boton("Nueva de WhatsApp", { icon: "whatsapp", alClic: () => irA("/whatsapp") })],
    }));
  }

  function pintarError(err, id) {
    vaciar(contenedor);
    const noExiste = err.status === 404;
    contenedor.append(vistaVacia({
      icon: noExiste ? "sin-llamada" : "error", titulo: noExiste ? "No encontré esa campaña" : "No se pudo abrir la campaña",
      texto: noExiste ? "Puede que se haya eliminado. Revisa el historial para ver las campañas que existen." : err.message,
      acciones: [boton("Ir al historial", { clase: "boton--primario", icon: "historial", alClic: () => irA("/historial") }), noExiste ? null : boton("Reintentar", { icon: "reintentar", alClic: () => abrir(id) })],
    }));
  }

  async function mostrar(id) {
    visible = true;
    if (!id) {
      const lista = app.campanas || [];
      const elegida = lista.find((c) => c.activa && c.tipo === "llamadas") || lista.find((c) => c.activa) || lista[0];
      if (elegida) { location.replace(`#/en-vivo/${elegida.id}`); return; }
      cerrarCampana();
      pintarVacio();
      return;
    }
    if (S && S.id === id) { pintar(true); S.tabla.refrescar(true); return; }
    await abrir(id);
  }

  function ocultar() {
    visible = false;
    cerrarCampana();
    vaciar(contenedor);
  }

  async function abrir(id) {
    cerrarCampana();
    const marca = (secuencia += 1);
    vaciar(contenedor);
    contenedor.append(esqueleto());
    let datos;
    try {
      datos = await api(`/campanas/${encodeURIComponent(id)}?filas=0`);
    } catch (err) {
      if (marca === secuencia) pintarError(err, id);
      return;
    }
    if (marca !== secuencia || !visible) return;
    construir(id, datos);
    conectar();
  }

  function construir(id, datos) {
    const r = datos.resumen;
    const tipo = r.tipo;
    const cfg = app.config || {};
    S = {
      id, tipo, resumen: r, config: datos.config || {}, filas: [], buffer: null, cargando: false, cargada: false, grupo: null, codigo: "",
      conexion: "conectando", flujo: null, ultimoAnalisis: 0, twilioConfigurado: Boolean(cfg.twilioConfigurado), estadoPrevio: r.estado, firmaAviso: null, firmaEstado: null,
    };

    const elegirFila = (f) => abrirDetalle({ campanaId: S.id, tipo: S.tipo, fila: f, obtenerFila: (i) => S.filas[i] });
    const alternar = (g) => fijarFiltro({ grupo: S.grupo === g ? null : g });

    S.controles = crearControles({ obtener: () => ({ id: S.id, tipo: S.tipo, resumen: S.resumen }) });
    S.panel = crearPanelTablero({ tipo, obtenerFila: (i) => S.filas[i], alElegirFila: elegirFila, alFiltrar: alternar });
    S.marcador = crearMarcador({ tipo, alFiltrar: alternar, alActualizarTwilio: actualizarTwilio });
    S.lineas = tipo === "llamadas" ? crearLineas({ alElegir: (i) => S.filas[i] && elegirFila(S.filas[i]) }) : null;
    S.ultimos = crearUltimos({ tipo, alElegir: (i) => S.filas[i] && elegirFila(S.filas[i]) });
    S.errores = crearErrores({
      alVerContactos: (codigo) => { fijarFiltro({ grupo: null, codigo }); S.tabla.el.scrollIntoView({ behavior: "smooth", block: "start" }); },
    });
    S.analisis = crearAnalisis({ tipo });
    S.tabla = crearTablaContactos({ tipo, obtenerFilas: () => S.filas, alElegir: elegirFila, alFiltrar: ({ grupo, codigo }) => fijarFiltro({ grupo, codigo }, true) });

    const refs = {
      titulo: h("h2", { class: "titulo-pagina" }),
      chipEstado: h("span", { class: "chip" }),
      chipTipo: h("span", { class: "chip chip--suave" }, icono(tipo === "whatsapp" ? "whatsapp" : "llamada"), tipo === "whatsapp" ? "WhatsApp" : "Llamadas"),
      inicio: h("span"), total: h("span"), audio: h("span"),
      copiarId: h("button", { type: "button", class: "boton boton--chico boton--fantasma", title: "Copiar el identificador de la campaña", on: { click: () => copiar(S.id, "Identificador copiado") } }, icono("copiar"), "ID"),
      aviso: h("div", { class: "seccion", hidden: true }),
    };
    S.refs = refs;
    S.alDesplazar = () => {
      if (!S || !S.refs || !S.refs.cabeza) return;
      const y = window.scrollY;
      const compacta = S.refs.cabeza.classList.contains("compacta");
      if (!compacta && y > 220) S.refs.cabeza.classList.add("compacta");
      else if (compacta && y < 90) S.refs.cabeza.classList.remove("compacta");
    };
    window.addEventListener("scroll", S.alDesplazar, { passive: true });
    refs.cabeza = h("header", { class: "envivo-cabeza" },
      h("div", { class: "envivo-cabeza__id" }, refs.titulo, h("div", { class: "envivo-cabeza__meta" }, refs.chipEstado, refs.chipTipo, refs.inicio, refs.total, refs.audio, refs.copiarId)),
      S.controles.el);

    const lateral = h("div", { class: "envivo-lateral" }, S.marcador.el, S.lineas ? S.lineas.el : null, S.ultimos.el);
    const grid = h("div", { class: "envivo-grid" }, S.panel.el, lateral, S.errores.el);
    vaciar(contenedor);
    contenedor.append(h("div", { class: "envivo" }, refs.cabeza, refs.aviso, grid, S.analisis.el, S.tabla.el));

    if (S.lineas) S.lineas.iniciar();
    clearInterval(reloj);
    reloj = setInterval(() => { if (S && visible && !document.hidden) pintarMeta(S.resumen); }, 15000);
    pintar(true);
  }

  function cerrarCampana() {
    secuencia += 1;
    clearInterval(reloj);
    if (!S) return;
    if (S.flujo) S.flujo.cerrar();
    clearTimeout(S.relojAnalisis);
    if (S.alDesplazar) window.removeEventListener("scroll", S.alDesplazar);
    S.panel.destruir();
    if (S.lineas) S.lineas.detener();
    cerrarDetalle();
    S = null;
    const ctx = document.getElementById("contexto-vista");
    if (ctx) ctx.textContent = "";
  }

  function conectar() {
    const mia = S;
    mia.flujo = abrirEventos(`/campanas/${encodeURIComponent(mia.id)}/eventos`, {
      instantanea(d) { if (S !== mia) return; mia.buffer = new Array(d.total || 0); mia.cargando = true; },
      resumen(r) { if (S !== mia) return; mia.resumen = r; if (!mia.cargando) pedirPintura(); },
      filas(d) {
        if (S !== mia) return;
        if (mia.cargando) { for (const f of d.filas) mia.buffer[f.i] = f; return; }
        for (const f of d.filas) { mia.filas[f.i] = f; mia.panel.cambiar(f.i, f); }
        pedirPintura();
      },
      listo() {
        if (S !== mia) return;
        if (mia.buffer) mia.filas = mia.buffer;
        mia.buffer = null;
        mia.cargando = false;
        const primera = !mia.cargada;
        mia.cargada = true;
        mia.panel.establecer(mia.filas);
        if (primera) mia.panel.prueba();
        mia.tabla.refrescar(true);
        pintar(true);
      },
    }, (estado) => {
      if (S !== mia) return;
      const antes = mia.conexion;
      mia.conexion = estado;
      mia.panel.fijarConexion(estado, !estaActiva(mia.resumen.estado));
      if (estado === "cerrado" && antes !== "cerrado") aviso("Se perdió la conexión en tiempo real con el servidor. Se reintenta sola; los datos se actualizan al volver.", { tipo: "aviso", titulo: "Sin conexión", duracion: 6000 });
      if (estado === "conectado" && (antes === "cerrado" || antes === "reconectando")) aviso("Conexión recuperada.", { tipo: "ok", duracion: 2000 });
    });
  }

  function fijarFiltro({ grupo = S.grupo, codigo = S.codigo }, desdeTabla = false) {
    if (!S) return;
    S.grupo = grupo || null;
    S.codigo = codigo || "";
    S.panel.filtrarGrupo(S.grupo);
    if (!desdeTabla) { S.tabla.fijarGrupo(S.grupo); S.tabla.fijarCodigo(S.codigo); }
    pedirPintura();
  }

  async function actualizarTwilio() {
    try {
      await api(`/campanas/${encodeURIComponent(S.id)}/actualizar-twilio`, { metodo: "POST" });
      aviso("Pidiendo a Twilio el precio, quién contestó y el código exacto de cada falla.", { tipo: "info", duracion: 3500 });
    } catch (err) {
      aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo actualizar" });
    }
  }

  function pintarMeta(r) {
    if (!S) return;
    const { refs } = S;
    const estado = ESTADOS_CAMPANA[r.estado] || { texto: r.estado, chip: "" };
    if (S.firmaEstado !== r.estado) {
      S.firmaEstado = r.estado;
      vaciar(refs.chipEstado);
      refs.chipEstado.className = `chip chip--${estado.chip}`;
      if (estado.animada) refs.chipEstado.append(lampara("curso", "curso", "llamada"));
      refs.chipEstado.append(estado.texto);
    }
    texto(refs.titulo, r.nombre || (r.tipo === "whatsapp" ? "Campaña de WhatsApp" : "Campaña de llamadas"));
    const desde = r.inicio || r.creada;
    texto(refs.inicio, desde ? `${r.fin && !estaActiva(r.estado) ? "Terminó" : "Inició"} ${haceCuanto(r.fin && !estaActiva(r.estado) ? r.fin : desde)}` : "");
    texto(refs.total, `${num(r.total)} ${plural(r.total, "contacto", "contactos")}`);
    const voces = r.voces || [];
    texto(refs.audio, r.tipo === "whatsapp" ? "" : r.modoAudio === "voces" ? `${voces.length} ${plural(voces.length, "voz", "voces")} de ElevenLabs` : r.modoAudio === "mp3" ? "Audio ya grabado" : "Voz de Twilio");
    const ctx = document.getElementById("contexto-vista");
    if (ctx) ctx.textContent = `${r.nombre || "Campaña"} · ${estado.texto}${estaActiva(r.estado) ? ` · ${r.progreso}%` : ""}`;
  }

  function pintarAviso(r) {
    const a = r.aviso;
    const firma = a ? `${a.nivel}|${a.titulo}|${a.ts}|${r.estado}` : "";
    if (S.firmaAviso === firma) return;
    S.firmaAviso = firma;
    const zona = S.refs.aviso;
    vaciar(zona);
    zona.hidden = !a;
    if (!a) return;
    const clase = a.nivel === "error" ? "aviso--error" : a.nivel === "aviso" ? "aviso--aviso" : "";
    const acciones = (a.acciones || []).map((clave) => {
      if (clave === "reanudar") return h("button", { type: "button", class: "boton boton--chico boton--primario", on: { click: () => S.controles.enviar("reanudar", undefined, "Campaña reanudada") } }, icono("play"), "Reanudar");
      if (clave === "detener") return h("button", { type: "button", class: "boton boton--chico boton--peligro", on: { click: () => S.controles.botones.detener.click() } }, icono("detener"), "Detener");
      return null;
    }).filter(Boolean);
    zona.append(h("div", { class: `aviso ${clase}`.trim(), role: a.nivel === "error" ? "alert" : "status" }, icono(a.nivel === "error" ? "error" : a.nivel === "aviso" ? "alerta" : "info"),
      h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, a.titulo), h("span", { class: "aviso__texto" }, a.texto), acciones.length ? h("div", { class: "aviso__acciones" }, acciones) : null)));
  }

  function avisarSiTermino(r) {
    const antes = S.estadoPrevio;
    S.estadoPrevio = r.estado;
    if (!estaActiva(antes) || estaActiva(r.estado)) return;
    const c = conteoGrupos(r);
    const textos = { completada: "La campaña terminó", detenida: "La campaña se detuvo", interrumpida: "La campaña se interrumpió", error: "La campaña terminó con un error" };
    aviso(`${num(c.si)} ${r.tipo === "whatsapp" ? "entregados" : "contestaron"}, ${num(c.no)} no, ${num(c.error)} fallaron. Ya puedes descargar los reportes.`,
      { tipo: r.estado === "completada" ? "ok" : "aviso", titulo: textos[r.estado] || "La campaña terminó", duracion: 9000,
        acciones: [{ texto: "Ir a descargas", fn: () => irA(`/descargas/${S.id}`) }] });
  }

  function pintar(forzar = false) {
    if (!S || !S.resumen || S.cargando || !visible) return;
    const r = S.resumen;
    pintarMeta(r);
    pintarAviso(r);
    S.refs.cabeza.classList.toggle("activa", estaActiva(r.estado));
    S.controles.actualizar(r, S.id);
    S.panel.actualizar(S);
    S.panel.fijarConexion(S.conexion, !estaActiva(r.estado));
    S.marcador.actualizar(S);
    if (S.lineas) S.lineas.actualizar(S);
    S.ultimos.actualizar(S);
    S.errores.actualizar(S);
    const ahora = performance.now();
    if (forzar || ahora - S.ultimoAnalisis > 1500) {
      clearTimeout(S.relojAnalisis); S.relojAnalisis = 0;
      S.analisis.actualizar(S); S.ultimoAnalisis = ahora;
    } else if (!S.relojAnalisis) {
      const mia = S;
      S.relojAnalisis = setTimeout(() => {
        mia.relojAnalisis = 0;
        if (S !== mia || !visible) return;
        mia.analisis.actualizar(mia); mia.ultimoAnalisis = performance.now();
      }, Math.max(50, 1550 - (ahora - S.ultimoAnalisis)));
    }
    S.tabla.refrescar();
    actualizarDetalle();
    avisarSiTermino(r);
  }
  const pedirPintura = enCuadro(() => pintar());

  document.addEventListener("visibilitychange", () => { if (!document.hidden && S) pintar(true); });

  return { mostrar, ocultar };
}
