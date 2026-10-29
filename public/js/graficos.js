import { h, vaciar, etiquetaFlotante, reconciliar } from "./dom.js";
import { num, pct, dur, decimal } from "./fmt.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (nombre, atributos = {}) => {
  const el = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, String(v));
  return el;
};

export function barraApilada(contenedor, etiquetaAria) {
  contenedor.classList.add("apilada");
  contenedor.setAttribute("role", "img");
  const segmentos = {};
  for (const clave of ["si", "no", "error", "curso", "pend"]) {
    const el = document.createElement("i");
    el.className = `seg--${clave}`;
    contenedor.appendChild(el);
    segmentos[clave] = el;
  }
  return {
    actualizar(valores, total, descripcion) {
      const t = Math.max(1, total);
      for (const clave of Object.keys(segmentos)) {
        const v = valores[clave] || 0;
        segmentos[clave].style.width = `${(v / t) * 100}%`;
        segmentos[clave].style.display = v > 0 || clave === "pend" ? "" : "none";
      }
      contenedor.setAttribute("aria-label", descripcion || etiquetaAria || "Reparto de resultados");
    },
  };
}

export function lineaDeRitmo(contenedor, { unidad = "terminadas", cadaSeg = 10 } = {}) {
  const lienzo = svg("svg", { class: "ritmo-grafico", role: "img", "aria-label": "Llamadas terminadas en los últimos 5 minutos" });
  const area = svg("path", { class: "area-datos" });
  const linea = svg("path", { class: "linea-datos" });
  const guia = svg("line", { class: "guia" });
  const punto = svg("circle", { class: "punto-final", r: 4.5 });
  lienzo.append(area, linea, guia, punto);
  contenedor.appendChild(lienzo);
  let valores = [];
  let ancho = 300;
  const alto = 88;
  const margen = 8;

  const coord = (v, i, max) => [
    margen + (valores.length > 1 ? (i * (ancho - margen * 2)) / (valores.length - 1) : 0),
    alto - margen - (v / max) * (alto - margen * 2),
  ];

  function dibujar() {
    lienzo.setAttribute("viewBox", `0 0 ${ancho} ${alto}`);
    if (!valores.length) { linea.removeAttribute("d"); area.removeAttribute("d"); punto.setAttribute("r", 0); return; }
    const max = Math.max(1, ...valores);
    const puntos = valores.map((v, i) => coord(v, i, max));
    linea.setAttribute("d", puntos.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" "));
    area.setAttribute("d", `${puntos.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${puntos[puntos.length - 1][0].toFixed(1)} ${alto - margen} L${puntos[0][0].toFixed(1)} ${alto - margen} Z`);
    const ultimo = puntos[puntos.length - 1];
    punto.setAttribute("cx", ultimo[0]); punto.setAttribute("cy", ultimo[1]); punto.setAttribute("r", 4.5);
  }

  const observador = new ResizeObserver(() => {
    const nuevo = Math.max(120, Math.floor(contenedor.clientWidth));
    if (nuevo !== ancho) { ancho = nuevo; dibujar(); }
  });
  observador.observe(contenedor);

  lienzo.addEventListener("pointermove", (ev) => {
    if (valores.length < 2) return;
    const caja = lienzo.getBoundingClientRect();
    const x = ((ev.clientX - caja.left) / caja.width) * ancho;
    const i = Math.max(0, Math.min(valores.length - 1, Math.round(((x - margen) / (ancho - margen * 2)) * (valores.length - 1))));
    const max = Math.max(1, ...valores);
    const [px] = coord(valores[i], i, max);
    guia.setAttribute("x1", px); guia.setAttribute("x2", px); guia.setAttribute("y1", margen); guia.setAttribute("y2", alto - margen);
    guia.classList.add("visible");
    const hace = (valores.length - 1 - i) * cadaSeg;
    etiquetaFlotante.mostrar(ev.clientX, ev.clientY, `${num(valores[i])} ${unidad}`, hace === 0 ? "En los últimos 10 s" : `Hace ${hace >= 60 ? `${Math.round(hace / 60 * 10) / 10} min` : `${hace} s`}`);
  });
  lienzo.addEventListener("pointerleave", () => { guia.classList.remove("visible"); etiquetaFlotante.ocultar(); });

  return {
    actualizar(nuevos) {
      valores = Array.isArray(nuevos) ? nuevos.slice() : [];
      dibujar();
      const max = Math.max(0, ...valores);
      lienzo.setAttribute("aria-label", `Llamadas terminadas cada ${cadaSeg} segundos en los últimos ${Math.round((valores.length * cadaSeg) / 60)} minutos. El máximo fue ${max}.`);
    },
    maximo: () => Math.max(0, ...valores),
    destruir: () => observador.disconnect(),
  };
}

export function barrasHorizontales(contenedor) {
  contenedor.classList.add("barras-h");
  const nodos = new Map();
  return {
    actualizar(items) {
      reconciliar(contenedor, items.map((x) => x.clave), nodos,
        () => {
          const relleno = h("i", { class: "barra-h__relleno", style: { width: "0%" } });
          const nombre = h("span", { class: "barra-h__nombre" });
          const valor = h("span", { class: "barra-h__valor" });
          const fila = h("div", { class: "barra-h", tabindex: "0" }, nombre, h("span", { class: "barra-h__pista" }, relleno), valor);
          fila._p = { relleno, nombre, valor };
          const mostrar = (ev) => { const d = fila._detalle; if (d) etiquetaFlotante.mostrar(ev.clientX, ev.clientY, d[0], d[1]); };
          fila.addEventListener("pointermove", mostrar);
          fila.addEventListener("pointerleave", () => etiquetaFlotante.ocultar());
          fila.addEventListener("focus", () => { const c = fila.getBoundingClientRect(); const d = fila._detalle; if (d) etiquetaFlotante.mostrar(c.left + 40, c.top, d[0], d[1]); });
          fila.addEventListener("blur", () => etiquetaFlotante.ocultar());
          return fila;
        },
        (fila, clave) => {
          const x = items.find((i) => i.clave === clave);
          fila._detalle = x.detalle || null;
          fila._p.nombre.textContent = x.nombre;
          fila._p.nombre.title = x.nombre;
          fila._p.relleno.style.width = `${Math.max(0, Math.min(100, x.valor))}%`;
          fila._p.relleno.dataset.tono = x.tono || "";
          fila._p.valor.textContent = "";
          fila._p.valor.append(x.texto, x.pie ? h("small", null, ` ${x.pie}`) : "");
        });
    },
  };
}

export function columnas(contenedor) {
  const caja = h("div", { class: "columnas" });
  const ejes = h("div", { class: "columnas-ejes" });
  contenedor.append(caja, ejes);
  const nodos = new Map();
  return {
    actualizar(items) {
      reconciliar(caja, items.map((x) => x.clave), nodos,
        () => {
          const barra = h("i", { style: { height: "0%" } });
          const col = h("div", { class: "columna-g", tabindex: "0" }, barra);
          col._barra = barra;
          col.addEventListener("pointermove", (ev) => { if (col._detalle) etiquetaFlotante.mostrar(ev.clientX, ev.clientY, col._detalle[0], col._detalle[1]); });
          col.addEventListener("pointerleave", () => etiquetaFlotante.ocultar());
          col.addEventListener("focus", () => { const c = col.getBoundingClientRect(); if (col._detalle) etiquetaFlotante.mostrar(c.left + c.width / 2, c.top, col._detalle[0], col._detalle[1]); });
          col.addEventListener("blur", () => etiquetaFlotante.ocultar());
          return col;
        },
        (col, clave) => {
          const x = items.find((i) => i.clave === clave);
          col._detalle = x.detalle || null;
          col._barra.style.height = `${Math.max(0, Math.min(100, x.valor))}%`;
        });
      vaciar(ejes);
      items.forEach((x, i) => ejes.appendChild(h("span", null, items.length > 14 && i % 2 ? "" : x.etiqueta)));
    },
  };
}

export function tablaEquivalente(encabezados, filas) {
  return h("div", { class: "tabla-wrap grafico__tabla" },
    h("table", { class: "tabla" },
      h("thead", null, h("tr", null, encabezados.map((e, i) => h("th", { class: i ? "der" : "" }, e)))),
      h("tbody", null, filas.map((f) => h("tr", null, f.map((c, i) => h("td", { class: i ? "der num" : "" }, c)))))));
}

export const formatos = { num, pct, dur, decimal };
