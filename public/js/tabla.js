import { h, vaciar, icono, lampara, reconciliar, texto, antirrebote, guardarArchivo, agregar } from "./dom.js";
import { num, dur, horaCorta, dinero, telefono, infoFila, detalleDeFila, gruposDe, ORDEN_GRUPOS, grupoDe, plural, etiquetaCodigo } from "./fmt.js";
import { normalizar, ultimoEvento } from "./calculos.js";

const PAGINA = 100;
const ORDENES = [
  ["lista", "Orden de la lista"],
  ["reciente", "Lo más reciente primero"],
  ["resultado", "Por resultado"],
  ["duracion", "Mayor duración"],
];

const csvCelda = (v) => {
  const t = v === null || v === undefined ? "" : String(v);
  const seguro = /^[=+\-@]/.test(t) && !/^\+?\d[\d\s]*$/.test(t) ? `'${t}` : t;
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

export function crearTablaContactos({ tipo, obtenerFilas, alElegir, alFiltrar = () => {} }) {
  const wa = tipo === "whatsapp";
  const grupos = gruposDe(tipo);
  const est = { grupo: null, codigo: "", busqueda: "", orden: "lista", limite: PAGINA, sucio: true, ultima: 0, temporizador: 0, pendienteRaton: false, ultimaLista: [] };
  const nodos = new Map();

  const campoBusqueda = h("input", { class: "entrada", type: "search", placeholder: "Buscar por nombre o número", "aria-label": "Buscar contacto", autocomplete: "off", spellcheck: false });
  const buscador = h("div", { class: "buscador" }, icono("buscar"), campoBusqueda);
  const selectorOrden = h("select", { class: "selector", id: "orden-contactos" }, ORDENES.map(([v, t]) => h("option", { value: v }, t)));
  const ordenar = h("div", { class: "contactos__ordenar" }, h("label", { for: "orden-contactos" }, "Ordenar"), selectorOrden);
  const botonCsv = h("button", { type: "button", class: "boton boton--chico", title: "Descarga lo que ves ahora, con el filtro y la búsqueda aplicados" }, icono("descargas"), "Descargar esta vista");
  const barra = h("div", { class: "contactos__barra" }, buscador, ordenar, botonCsv);
  const filtros = h("div", { class: "contactos__filtros", role: "group", "aria-label": "Filtrar por resultado" });
  const chips = new Map();

  function chip(clave, etiqueta, forma, tono) {
    const cuenta = h("span", { class: "insignia num" }, "0");
    const boton = h("button", { type: "button", class: "filtro", "aria-pressed": "false", dataset: { grupo: clave } }, forma ? lampara(forma, tono) : null, etiqueta, cuenta);
    boton.addEventListener("click", () => { fijarGrupo(est.grupo === clave ? null : clave); alFiltrar({ grupo: est.grupo, codigo: est.codigo }); });
    chips.set(clave, { boton, cuenta });
    return boton;
  }
  const chipTodos = chip("todos", "Todos", null, null);
  filtros.append(chipTodos);
  chipTodos.addEventListener("click", () => { fijarGrupo(null); fijarCodigo(""); alFiltrar({ grupo: null, codigo: "" }); });
  for (const g of ORDEN_GRUPOS) {
    if (wa && g === "no") continue;
    filtros.append(chip(g, grupos[g].etiqueta, grupos[g].forma, grupos[g].tono));
  }
  const chipCodigo = h("button", { type: "button", class: "filtro", "aria-pressed": "true", hidden: true, title: "Quitar este filtro" });
  chipCodigo.addEventListener("click", () => { fijarCodigo(""); alFiltrar({ grupo: est.grupo, codigo: "" }); });
  filtros.append(chipCodigo);

  const claseCol = (c) => `${c}`;
  const tbody = h("tbody");
  const cabeza = h("thead", null, h("tr", null,
    h("th", { class: "c-num" }, "#"), h("th", { class: "c-contacto" }, "Contacto"), h("th", { class: "c-resultado" }, "Resultado"),
    h("th", { class: "c-detalle" }, "Detalle"), h("th", { class: claseCol("c-duracion") }, wa ? "" : "Duración"),
    h("th", { class: "c-voz" }, "Voz"), h("th", { class: "c-hora" }, "Hora"), h("th", { class: "c-costo der" }, "Costo")));
  const tabla = h("table", { class: `tabla tabla-contactos${wa ? " es-whatsapp" : ""}` }, h("caption", { class: "solo-lectores" }, "Contactos de la campaña y su resultado"), cabeza, tbody);
  const envoltura = h("div", { class: "tabla-wrap" }, tabla);
  const vacio = h("div", { class: "sin-resultados", hidden: true });
  const cuantos = h("p", { class: "texto-3 pequeno", "aria-live": "polite" });
  const masFilas = h("div", { class: "mas-filas", hidden: true });

  function crearFila(i) {
    const c = {
      num: h("td", { class: "c-num num" }),
      nombre: h("div", { class: "nombre truncar" }),
      numero: h("div", { class: "secundario num" }),
      etiqueta: h("span"),
      resultado: h("span", { class: "estado-celda" }),
      detalle: h("td", { class: "c-detalle" }),
      dTexto: h("span"),
      barraI: h("i"),
      barra: h("span", { class: "mini-barra", hidden: true }),
      voz: h("td", { class: "c-voz" }),
      hora: h("td", { class: "c-hora num" }),
      costo: h("td", { class: "c-costo num der" }),
    };
    c.barra.append(c.barraI);
    c.resultado.append(c.etiqueta);
    const tr = h("tr", { tabindex: "0", dataset: { i: String(i) }, "data-clic": "" },
      c.num,
      h("td", { class: "c-contacto" }, c.nombre, c.numero),
      h("td", { class: "c-resultado" }, c.resultado),
      c.detalle,
      h("td", { class: "c-duracion num" }, c.dTexto, c.barra),
      c.voz, c.hora, c.costo);
    tr._c = c;
    tr._firma = "";
    tr._pintada = false;
    return tr;
  }

  function pintarFila(tr, f) {
    if (!f) return;
    const firma = `${f.cat}|${f.estadoLlamada}|${f.duracion}|${f.precio}|${f.voz}|${f.error}|${f.sip}|${f.tFin}|${f.tContesta}|${f.nombre}|${f.inc ? f.inc.codigo : ""}`;
    if (tr._firma === firma) return;
    const c = tr._c;
    const info = infoFila(f, tipo);
    const cambioResultado = tr._pintada && tr._etiqueta !== info.etiqueta;
    texto(c.num, f.i + 1);
    texto(c.nombre, f.nombre || telefono(f.numero));
    c.nombre.title = f.nombre || "";
    texto(c.numero, f.nombre ? telefono(f.numero) : "");
    if (tr._forma !== `${info.forma}|${info.tono}|${info.fase}`) {
      tr._forma = `${info.forma}|${info.tono}|${info.fase}`;
      const nueva = lampara(info.forma, info.tono, info.fase);
      if (c.lampara) c.lampara.replaceWith(nueva); else c.resultado.prepend(nueva);
      c.lampara = nueva;
    }
    texto(c.etiqueta, info.etiqueta);
    texto(c.detalle, detalleDeFila(f, tipo));
    if (!wa) {
      texto(c.dTexto, f.duracion ? dur(f.duracion) : (f.cat === "contesto" ? "—" : ""));
      const fraccion = f.audioSeg && f.duracion ? Math.min(100, (f.duracion / f.audioSeg) * 100) : 0;
      c.barra.hidden = !fraccion;
      c.barraI.style.width = `${fraccion}%`;
      c.barra.title = fraccion ? `Escuchó ${Math.round(fraccion)} % del mensaje` : "";
      texto(c.voz, f.voz || "");
    }
    texto(c.hora, ultimoEvento(f) ? horaCorta(ultimoEvento(f)) : "");
    texto(c.costo, f.precio ? dinero(Math.abs(f.precio)) : "");
    tr._firma = firma;
    tr._etiqueta = info.etiqueta;
    tr._pintada = true;
    if (cambioResultado) {
      tr.classList.remove("destello");
      void tr.offsetWidth;
      tr.classList.add("destello");
    }
  }

  function filtrar(filas) {
    const q = normalizar(est.busqueda).trim();
    const dig = q.replace(/\D/g, "");
    const porNumero = Boolean(q) && /^[\d\s+()-]+$/.test(q) && dig.length >= 3;
    const salida = [];
    for (const f of filas) {
      if (!f) continue;
      if (est.grupo && grupoDe(f.cat) !== est.grupo) continue;
      if (est.codigo && !(f.inc && String(f.inc.codigo) === est.codigo)) continue;
      if (q) {
        if (porNumero) { if (!String(f.numero).replace(/\D/g, "").includes(dig)) continue; }
        else if (!normalizar(f.nombre).includes(q) && !normalizar(f.numero).includes(q) && !normalizar(f.voz).includes(q)) continue;
      }
      salida.push(f);
    }
    return salida;
  }

  function ordenarLista(lista) {
    switch (est.orden) {
      case "reciente": return lista.sort((a, b) => ultimoEvento(b) - ultimoEvento(a) || a.i - b.i);
      case "duracion": return lista.sort((a, b) => (b.duracion || 0) - (a.duracion || 0) || a.i - b.i);
      case "resultado": return lista.sort((a, b) => ORDEN_GRUPOS.indexOf(grupoDe(a.cat)) - ORDEN_GRUPOS.indexOf(grupoDe(b.cat)) || String(a.cat).localeCompare(String(b.cat)) || a.i - b.i);
      default: return lista;
    }
  }

  function pintar() {
    est.sucio = false;
    est.ultima = performance.now();
    const todas = obtenerFilas();
    const conteo = { todos: 0, si: 0, no: 0, error: 0, curso: 0, pendiente: 0 };
    for (const f of todas) { if (!f) continue; conteo.todos += 1; conteo[grupoDe(f.cat)] += 1; }
    for (const [clave, c] of chips) {
      texto(c.cuenta, num(conteo[clave] || 0));
      c.boton.setAttribute("aria-pressed", String(clave === "todos" ? !est.grupo && !est.codigo : est.grupo === clave));
    }
    chipCodigo.hidden = !est.codigo;
    if (est.codigo) { vaciar(chipCodigo); chipCodigo.append(etiquetaCodigo(est.codigo), icono("x")); }

    const lista = ordenarLista(filtrar(todas));
    est.ultimaLista = lista;
    const visibles = lista.slice(0, est.limite);
    reconciliar(tbody, visibles.map((f) => f.i), nodos, crearFila, (tr, i) => pintarFila(tr, todas[i]));

    const hayDatos = conteo.todos > 0;
    envoltura.hidden = !visibles.length;
    vacio.hidden = Boolean(visibles.length);
    if (!visibles.length) {
      vaciar(vacio);
      if (!hayDatos) vacio.append(h("div", { class: "cinta", style: { justifyContent: "center" } }, [0, 1, 2].map(() => h("div", { class: "esqueleto", style: { height: "16px", width: "30%" } }))));
      else vacio.append("Ningún contacto coincide con lo que buscas.", " ", h("button", { type: "button", class: "boton boton--chico", on: { click: () => { limpiarFiltros(); alFiltrar({ grupo: null, codigo: "" }); } } }, "Quitar filtros"));
    }
    texto(cuantos, hayDatos ? `${lista.length === conteo.todos ? "" : `${num(lista.length)} de `}${num(conteo.todos)} ${plural(conteo.todos, "contacto", "contactos")}${lista.length > visibles.length ? ` · mostrando los primeros ${num(visibles.length)}` : ""}` : "");

    const restan = lista.length - visibles.length;
    masFilas.hidden = restan <= 0;
    if (restan > 0) {
      vaciar(masFilas);
      agregar(masFilas, [
        h("button", { type: "button", class: "boton", on: { click: () => { est.limite += PAGINA; refrescar(true); } } }, icono("abajo"), `Mostrar ${num(Math.min(PAGINA, restan))} más`),
        restan > PAGINA * 2 ? h("button", { type: "button", class: "boton boton--fantasma", on: { click: () => { est.limite = Infinity; refrescar(true); } } }, `Mostrar todos (${num(lista.length)})`) : null]);
    }
  }

  function enPantalla() {
    return el.isConnected && el.getClientRects().length > 0 && !document.hidden;
  }

  function refrescar(ahora = false) {
    est.sucio = true;
    if (ahora) {
      clearTimeout(est.temporizador); est.temporizador = 0;
      if (enPantalla()) pintar();
      return;
    }
    if (est.temporizador) return;
    const espera = Math.max(0, 700 - (performance.now() - est.ultima));
    est.temporizador = setTimeout(() => {
      est.temporizador = 0;
      if (!est.sucio || !enPantalla()) return;
      if (est.orden !== "lista" && envoltura.matches(":hover")) { est.pendienteRaton = true; return; }
      pintar();
    }, espera);
  }

  function fijarGrupo(g) { est.grupo = g || null; est.limite = PAGINA; refrescar(true); }
  function fijarCodigo(c) { est.codigo = c ? String(c) : ""; est.limite = PAGINA; refrescar(true); }
  function limpiarFiltros() { est.grupo = null; est.codigo = ""; est.busqueda = ""; campoBusqueda.value = ""; est.limite = PAGINA; refrescar(true); }

  const buscar = antirrebote(() => { est.busqueda = campoBusqueda.value; est.limite = PAGINA; refrescar(true); }, 220);
  campoBusqueda.addEventListener("input", buscar);
  selectorOrden.addEventListener("change", () => { est.orden = selectorOrden.value; est.limite = PAGINA; refrescar(true); });
  envoltura.addEventListener("pointerleave", () => { if (est.pendienteRaton) { est.pendienteRaton = false; refrescar(true); } });
  const abrir = (ev) => {
    const tr = ev.target.closest("tr[data-i]");
    if (!tr) return;
    const f = obtenerFilas()[Number(tr.dataset.i)];
    if (f) alElegir(f);
  };
  tbody.addEventListener("click", abrir);
  tbody.addEventListener("keydown", (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("tr")) { ev.preventDefault(); abrir(ev); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && est.sucio) refrescar(true); });

  botonCsv.addEventListener("click", () => {
    const lista = est.ultimaLista;
    if (!lista.length) return;
    const cab = wa ? ["Número", "Nombre", "Resultado", "Detalle", "Hora"] : ["Número", "Nombre", "Resultado", "Detalle", "Duración (seg)", "Voz", "Hora", "SID de Twilio", "Precio (USD)"];
    const filasCsv = lista.map((f) => {
      const info = infoFila(f, tipo);
      const base = [f.numero, f.nombre || "", info.etiqueta, detalleDeFila(f, tipo)];
      const hora = ultimoEvento(f) ? new Date(ultimoEvento(f)).toLocaleString("es-MX") : "";
      return wa ? [...base, hora] : [...base, f.duracion || "", f.voz || "", hora, f.sid || "", f.precio ? Math.abs(f.precio) : ""];
    });
    const csv = `﻿${[cab, ...filasCsv].map((fila) => fila.map(csvCelda).join(",")).join("\r\n")}\r\n`;
    guardarArchivo(`contactos_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.csv`, csv);
  });

  const el = h("section", { class: "seccion", "aria-labelledby": "titulo-contactos" },
    h("div", { class: "seccion__cabeza" }, h("div", null, h("h3", { class: "titulo-seccion", id: "titulo-contactos" }, "Contactos"), cuantos)),
    barra, filtros, envoltura, vacio, masFilas);

  return { el, refrescar, fijarGrupo, fijarCodigo, limpiarFiltros, estado: est };
}
