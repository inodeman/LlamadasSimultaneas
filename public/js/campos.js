import { h } from "./dom.js";

let contadorId = 0;
export const nuevoId = (prefijo = "c") => `${prefijo}-${(contadorId += 1)}`;

export function campoRango({ etiqueta, ayuda, min, max, paso = 1, valor, formato = (v) => String(v), alCambiar = () => {} }) {
  const id = nuevoId("rango");
  const entrada = h("input", { type: "range", class: "rango", id, min, max, step: paso, value: valor, "aria-describedby": `${id}-ayuda` });
  const salida = h("b", null, formato(valor));
  const actualizar = () => {
    const v = Number(entrada.value);
    salida.textContent = formato(v);
    entrada.style.setProperty("--lleno", `${((v - min) / (max - min)) * 100}%`);
  };
  entrada.addEventListener("input", () => { actualizar(); alCambiar(Number(entrada.value)); });
  actualizar();
  const el = h("div", { class: "campo" },
    h("div", { class: "campo__etiqueta" }, h("label", { for: id }, etiqueta), h("span", { class: "ritmo__valor" }, salida)),
    entrada,
    ayuda ? h("p", { class: "campo__ayuda", id: `${id}-ayuda` }, ayuda) : null);
  return {
    el,
    valor: () => Number(entrada.value),
    establecer(v) { entrada.value = String(Math.min(max, Math.max(min, v))); actualizar(); },
    maximo(nuevoMax) { entrada.max = String(nuevoMax); actualizar(); },
  };
}

export function interruptor({ titulo, ayuda, marcado = false, alCambiar = () => {} }) {
  const entrada = h("input", { type: "checkbox", checked: marcado });
  entrada.addEventListener("change", () => alCambiar(entrada.checked));
  const el = h("label", { class: "interruptor" }, entrada, h("span", { class: "interruptor__pista" }),
    h("span", { class: "interruptor__texto" }, h("b", null, titulo), ayuda ? h("span", null, ayuda) : null));
  return { el, valor: () => entrada.checked, establecer(v) { entrada.checked = Boolean(v); } };
}

export function campoTexto({ etiqueta, ayuda, placeholder = "", maxlength, valor = "", alCambiar = () => {} }) {
  const id = nuevoId("txt");
  const entrada = h("input", { class: "entrada", id, type: "text", placeholder, maxlength, value: valor, autocomplete: "off", "aria-describedby": ayuda ? `${id}-ayuda` : null });
  entrada.addEventListener("input", () => alCambiar(entrada.value));
  const el = h("div", { class: "campo" }, h("label", { for: id }, etiqueta), entrada, ayuda ? h("p", { class: "campo__ayuda", id: `${id}-ayuda` }, ayuda) : null);
  return { el, entrada, valor: () => entrada.value, establecer(v) { entrada.value = v || ""; } };
}

export function campoMensaje({ etiqueta, ayuda, placeholder = "", maximo = 1500, valor = "", alCambiar = () => {} }) {
  const id = nuevoId("msg");
  const area = h("textarea", { class: "area", id, placeholder, value: valor, rows: 5, "aria-describedby": `${id}-ayuda`, spellcheck: true });
  const contador = h("span", { class: "contador-largo num" });
  const insertar = h("button", { type: "button", class: "boton boton--chico", title: "Pone el nombre de cada contacto en esta parte del mensaje", on: { click: () => {
    const ini = area.selectionStart ?? area.value.length;
    const fin = area.selectionEnd ?? area.value.length;
    area.setRangeText("{nombre}", ini, fin, "end");
    area.focus();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  } } }, "Insertar {nombre}");
  const pintar = () => {
    const n = area.value.length;
    contador.textContent = `${n} / ${maximo}`;
    contador.dataset.nivel = n > maximo ? "error" : n > maximo * 0.9 ? "aviso" : "";
  };
  area.addEventListener("input", () => { pintar(); alCambiar(area.value); });
  pintar();
  const el = h("div", { class: "campo" },
    h("label", { for: id }, etiqueta),
    h("div", { class: "texto-mensaje" }, area, h("div", { class: "texto-mensaje__pie" }, insertar, contador)),
    ayuda ? h("p", { class: "campo__ayuda", id: `${id}-ayuda` }, ayuda) : null);
  return {
    el, area,
    valor: () => area.value,
    establecer(v) { area.value = v || ""; pintar(); },
    excedido: () => area.value.length > maximo,
  };
}
