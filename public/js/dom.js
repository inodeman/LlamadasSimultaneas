const NS_SVG = "http://www.w3.org/2000/svg";
const PROPIEDADES = new Set(["value", "checked", "disabled", "hidden", "selected", "textContent", "htmlFor", "tabIndex", "open", "indeterminate", "readOnly", "multiple"]);

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

export function h(etiqueta, props, ...hijos) {
  const el = document.createElement(etiqueta);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "style" && typeof v === "object") {
        for (const [p, valor] of Object.entries(v)) {
          if (p.startsWith("--")) el.style.setProperty(p, valor);
          else el.style[p] = valor;
        }
      } else if (PROPIEDADES.has(k)) el[k] = v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  agregar(el, hijos);
  return el;
}

export function agregar(padre, hijos) {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    if (Array.isArray(hijo)) agregar(padre, hijo);
    else if (hijo instanceof Node) padre.appendChild(hijo);
    else padre.appendChild(document.createTextNode(String(hijo)));
  }
  return padre;
}

export function vaciar(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function icono(nombre, { clase = "", titulo = "" } = {}) {
  const svg = document.createElementNS(NS_SVG, "svg");
  svg.setAttribute("class", `icono ${clase}`.trim());
  svg.setAttribute("aria-hidden", titulo ? "false" : "true");
  svg.setAttribute("focusable", "false");
  if (titulo) {
    svg.setAttribute("role", "img");
    const t = document.createElementNS(NS_SVG, "title");
    t.textContent = titulo;
    svg.appendChild(t);
  }
  const uso = document.createElementNS(NS_SVG, "use");
  uso.setAttribute("href", `#i-${nombre}`);
  svg.appendChild(uso);
  return svg;
}

export function lampara(forma, tono, fase) {
  const el = document.createElement("span");
  el.className = `lampara lampara--${tono}`;
  el.dataset.forma = forma;
  if (fase) el.dataset.fase = fase;
  el.setAttribute("aria-hidden", "true");
  return el;
}

export function texto(el, valor) {
  const v = valor === null || valor === undefined ? "" : String(valor);
  if (el.textContent !== v) el.textContent = v;
}

export function sinMovimiento() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export function antirrebote(fn, ms = 300) {
  let t = null;
  const f = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  f.cancelar = () => clearTimeout(t);
  return f;
}

export function enCuadro(fn) {
  let pendiente = false;
  return () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; fn(); });
  };
}

export function reconciliar(contenedor, claves, almacen, crear, actualizar) {
  const vigentes = new Set(claves);
  for (const [clave, nodo] of almacen) {
    if (!vigentes.has(clave)) { nodo.remove(); almacen.delete(clave); }
  }
  let cursor = contenedor.firstChild;
  for (const clave of claves) {
    let nodo = almacen.get(clave);
    if (!nodo) { nodo = crear(clave); almacen.set(clave, nodo); }
    if (actualizar) actualizar(nodo, clave);
    if (nodo === cursor) cursor = cursor.nextSibling;
    else contenedor.insertBefore(nodo, cursor);
  }
}

export function aviso(mensaje, { tipo = "info", titulo = "", duracion, acciones = [] } = {}) {
  const zona = document.getElementById("avisos");
  if (!zona) return null;
  const persistente = tipo === "error";
  const ms = duracion !== undefined ? duracion : (persistente ? 12000 : 5000);
  const nombreIcono = tipo === "ok" ? "check" : tipo === "error" ? "error" : tipo === "aviso" ? "alerta" : "info";
  const cerrar = h("button", { type: "button", class: "toast__cerrar", "aria-label": "Cerrar aviso" }, icono("x"));
  const el = h("div", { class: `toast toast--${tipo}`, role: tipo === "error" ? "alert" : "status" },
    icono(nombreIcono),
    h("div", { class: "toast__cuerpo" }, titulo ? h("b", null, titulo) : null, h("span", null, mensaje),
      acciones.length ? h("div", { class: "aviso__acciones" }, acciones.map((a) => h("button", { type: "button", class: "boton boton--chico boton--fantasma", style: { color: "inherit", border: "1px solid currentColor" }, on: { click: () => { a.fn(); quitar(); } } }, a.texto))) : null),
    cerrar);
  let temporizador = null;
  function quitar() {
    clearTimeout(temporizador);
    if (!el.isConnected) return;
    el.classList.add("saliendo");
    setTimeout(() => el.remove(), 220);
  }
  cerrar.addEventListener("click", quitar);
  zona.appendChild(el);
  const maximo = window.innerWidth < 760 ? 2 : 4;
  while (zona.children.length > maximo) zona.firstChild.remove();
  if (ms > 0) temporizador = setTimeout(quitar, ms);
  return { cerrar: quitar };
}

export function modal({ titulo, texto: descripcion, cuerpo, resumen, aceptar = "Aceptar", cancelar = "Cancelar", peligro = false, soloAceptar = false, validar }) {
  const dlg = document.getElementById("dlg-modal");
  return new Promise((resolver) => {
    vaciar(dlg);
    let enviado = false;
    const form = h("form", { method: "dialog" },
      h("div", { class: "modal__cuerpo" },
        h("h2", { id: "dlg-modal-titulo" }, titulo),
        descripcion ? h("p", null, descripcion) : null,
        resumen && resumen.length ? h("div", { class: "modal__resumen" }, resumen.map(([k, v]) => h("div", null, h("span", null, k), h("span", null, v)))) : null,
        cuerpo || null),
      h("div", { class: "modal__pie" },
        soloAceptar ? null : h("button", { type: "submit", value: "cancelar", class: "boton boton--fantasma", formnovalidate: true }, cancelar),
        h("button", { type: "submit", value: "aceptar", class: `boton ${peligro ? "boton--peligro-solido" : "boton--primario"}`, id: "dlg-modal-aceptar" }, aceptar)));
    form.addEventListener("submit", (ev) => {
      const quien = ev.submitter ? ev.submitter.value : "cancelar";
      if (quien === "aceptar" && validar && validar() === false) { ev.preventDefault(); return; }
      enviado = quien === "aceptar";
    });
    dlg.appendChild(form);
    const alCerrar = () => { dlg.removeEventListener("close", alCerrar); resolver(enviado); };
    dlg.addEventListener("close", alCerrar);
    dlg.showModal();
    const primero = dlg.querySelector("input, select, textarea, #dlg-modal-aceptar");
    if (primero) primero.focus({ preventScroll: true });
  });
}

export async function conCarga(boton, tarea) {
  if (boton.getAttribute("aria-busy") === "true") return undefined;
  boton.setAttribute("aria-busy", "true");
  const rueda = document.createElement("span");
  rueda.className = "cargando";
  boton.appendChild(rueda);
  try {
    return await tarea();
  } finally {
    rueda.remove();
    boton.removeAttribute("aria-busy");
  }
}

export async function copiar(valor, mensaje = "Copiado") {
  try {
    await navigator.clipboard.writeText(valor);
  } catch (err) {
    const area = h("textarea", { value: valor, style: { position: "fixed", opacity: "0" } });
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); } catch (e) { }
    area.remove();
  }
  aviso(mensaje, { tipo: "ok", duracion: 1800 });
}

export function guardarArchivo(nombre, contenido, tipo = "text/csv;charset=utf-8") {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const etiquetaFlotante = {
  mostrar(x, y, valor, detalle) {
    const el = document.getElementById("etiqueta-flotante");
    if (!el) return;
    vaciar(el);
    el.appendChild(h("b", null, valor));
    if (detalle) el.appendChild(h("span", null, detalle));
    el.classList.add("visible");
    const ancho = el.offsetWidth;
    const alto = el.offsetHeight;
    let izq = x + 14;
    let arriba = y - alto - 12;
    if (izq + ancho > window.innerWidth - 8) izq = x - ancho - 14;
    if (arriba < 8) arriba = y + 18;
    el.style.left = `${Math.max(8, izq)}px`;
    el.style.top = `${arriba}px`;
  },
  ocultar() {
    const el = document.getElementById("etiqueta-flotante");
    if (el) el.classList.remove("visible");
  },
};

const animaciones = new WeakMap();

export function contador(el, valor, formato = (n) => String(Math.round(n))) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) { texto(el, "—"); animaciones.delete(el); return; }
  const previo = animaciones.get(el);
  const desde = previo ? previo.actual : (el.dataset.valor !== undefined ? Number(el.dataset.valor) : null);
  el.dataset.valor = String(valor);
  if (previo && previo.raf) cancelAnimationFrame(previo.raf);
  if (desde === null || desde === valor || sinMovimiento() || Math.abs(valor - desde) < 1e-9) {
    texto(el, formato(valor));
    animaciones.set(el, { actual: valor, raf: 0 });
    return;
  }
  const inicio = performance.now();
  const duracion = Math.min(900, 300 + Math.abs(valor - desde) * 4);
  const estado = { actual: desde, raf: 0 };
  animaciones.set(el, estado);
  const entera = Number.isInteger(valor) && Number.isInteger(desde);
  el.classList.remove("cifra-cambia");
  void el.offsetWidth;
  el.classList.add("cifra-cambia");
  const paso = (t) => {
    const p = Math.min(1, (t - inicio) / duracion);
    const suave = 1 - Math.pow(1 - p, 3);
    estado.actual = desde + (valor - desde) * suave;
    el.textContent = formato(p >= 1 ? valor : (entera ? Math.round(estado.actual) : estado.actual));
    if (p < 1) estado.raf = requestAnimationFrame(paso);
    else estado.actual = valor;
  };
  estado.raf = requestAnimationFrame(paso);
}
