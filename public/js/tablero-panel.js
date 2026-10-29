import { h, vaciar, lampara, contador, texto } from "./dom.js";
import { Tablero } from "./tablero.js";
import { barraApilada } from "./graficos.js";
import { num, faltan, gruposDe, ORDEN_GRUPOS } from "./fmt.js";
import { conteoGrupos } from "./calculos.js";

export function crearPanelTablero({ tipo, obtenerFila, alElegirFila, alFiltrar }) {
  const wa = tipo === "whatsapp";
  const grupos = gruposDe(tipo);

  const lienzo = h("canvas", { tabindex: "0", role: "group", "aria-roledescription": "tablero de contactos", "aria-label": "Tablero de contactos" });
  const tip = h("div", { class: "tablero__tip", role: "status" });
  const contenedorLienzo = h("div", { class: "tablero__lienzo" }, lienzo, tip);
  const tablero = new Tablero(lienzo, tip, {
    tipo, obtenerFila: (i) => obtenerFila(i) || null,
    alElegir: (i) => { const f = obtenerFila(i); if (f) alElegirFila(f); },
  });

  const luz = h("span", { class: "luz-conexion", "data-estado": "busca" });
  const textoConexion = h("span", null, "Conectando");
  const conexion = h("span", { class: "tablero__conexion", role: "status" }, luz, textoConexion);

  const chips = new Map();
  const leyenda = h("div", { class: "tablero__leyenda", role: "group", "aria-label": "Mostrar solo un resultado" });
  for (const g of ORDEN_GRUPOS) {
    if (wa && g === "no") continue;
    const cuenta = h("span", { class: "num" }, "0");
    const boton = h("button", { type: "button", class: "tablero-filtro", "aria-pressed": "false" }, lampara(grupos[g].forma, grupos[g].tono, g === "curso" ? "llamada" : ""), grupos[g].etiqueta, cuenta);
    boton.addEventListener("click", () => alFiltrar(g));
    chips.set(g, { boton, cuenta });
    leyenda.append(boton);
  }

  const barraEl = h("div");
  const barra = barraApilada(barraEl, "Reparto de resultados");
  const datosPie = h("div", { class: "tablero__pie-datos" });
  const pie = h("div", { class: "tablero__pie" }, barraEl, datosPie);

  const el = h("section", { class: "tablero encendiendo", "aria-label": "Estado de cada contacto" },
    h("div", { class: "tablero__cabeza" },
      h("div", null, h("h3", null, "Cada contacto, en vivo"), h("p", null, "Cada lámpara es un contacto. Pasa el cursor o toca una para ver quién es.")),
      conexion),
    leyenda, contenedorLienzo, pie);

  function dato(etiqueta, valor) {
    return h("span", null, `${etiqueta} `, h("b", null, valor));
  }

  function actualizar(S) {
    const r = S.resumen;
    if (!r) return;
    const c = conteoGrupos(r);
    for (const [g, ch] of chips) {
      contador(ch.cuenta, c[g], num);
      ch.boton.setAttribute("aria-pressed", String(S.grupo === g));
    }
    const total = r.total || 0;
    const descripcion = `${num(c.si)} ${grupos.si.etiqueta.toLowerCase()}, ${num(c.no)} ${grupos.no.etiqueta.toLowerCase()}, ${num(c.error)} ${grupos.error.etiqueta.toLowerCase()}, ${num(c.curso)} en curso y ${num(c.pendiente)} pendientes de ${num(total)} contactos`;
    barra.actualizar({ si: c.si, no: c.no, error: c.error, curso: c.curso, pend: c.pendiente }, total, descripcion);
    lienzo.setAttribute("aria-label", `Tablero de ${num(total)} contactos: ${descripcion}. Con las flechas puedes recorrerlos y con Enter abrir el detalle.`);

    vaciar(datosPie);
    const activa = ["preparando", "generando_audios", "en_curso", "finalizando"].includes(r.estado);
    datosPie.append(dato(wa ? "Enviados" : "Marcadas", `${num(r.marcadas)} de ${num(total)}`));
    if (activa && r.ritmoPorMin) datosPie.append(dato("Ritmo", `${num(r.ritmoPorMin)} por min`));
    if (activa && r.etaSeg) datosPie.append(dato("Quedan", faltan(r.etaSeg)));
    if (!wa && r.escucharonMedibles) datosPie.append(dato("Escucharon completo", `${num(r.escucharonCompleto)} de ${num(r.escucharonMedibles)}`));
    if (r.omitidos) datosPie.append(dato("Sin marcar", num(r.omitidos)));
  }

  function fijarConexion(estado, terminada) {
    if (terminada) { luz.dataset.estado = ""; texto(textoConexion, "Campaña terminada"); return; }
    const mapa = { conectado: ["ok", "En vivo"], reconectando: ["busca", "Reconectando…"], cerrado: ["error", "Sin conexión, reintentando"], conectando: ["busca", "Conectando"] };
    const [d, t] = mapa[estado] || mapa.conectando;
    luz.dataset.estado = d;
    texto(textoConexion, t);
  }

  return {
    el, tablero, actualizar, fijarConexion,
    establecer(filas) { tablero.establecer(filas); },
    cambiar(i, f, silencioso) { return tablero.cambiar(i, f, silencioso); },
    filtrarGrupo(g) { tablero.filtrarGrupo(g); },
    prueba() { tablero.prueba(); },
    destruir() { tablero.destruir(); },
  };
}
