import { h, vaciar, icono, copiar, reconciliar, texto } from "./dom.js";
import { num, plural, nombreFuente, telefono, fechaHora, etiquetaCodigo } from "./fmt.js";

const ORDEN_NIVEL = { error: 0, aviso: 1, info: 2 };

export function crearErrores({ alVerContactos }) {
  const resumen = h("div", { class: "cinta" });
  const cuerpo = h("div", { class: "errores" });
  const nodos = new Map();
  const el = h("section", { class: "panel panel-errores", "aria-labelledby": "titulo-errores" },
    h("div", { class: "panel__cabeza" },
      h("div", null, h("h3", { class: "titulo-seccion", id: "titulo-errores" }, "Errores de Twilio y ElevenLabs"),
        h("p", null, "Cada problema aparece una sola vez, con su código, a cuántos contactos afectó y qué hacer."))),
    resumen, cuerpo);

  function crear() {
    const c = {
      fuente: h("span", { class: "chip chip--suave" }),
      codigo: h("span", { class: "error-item__codigo" }),
      titulo: h("b"),
      cantidad: h("b", { class: "num" }),
      unidad: h("span"),
      detalle: h("p"),
      accion: h("p"),
      ejemplos: h("ul"),
      pie: h("div", { class: "error-item__pie" }),
    };
    const item = h("article", { class: "error-item" },
      h("div", { class: "error-item__cabeza" }, c.fuente, c.codigo, c.titulo),
      h("div", { class: "error-item__cantidad" }, c.cantidad, c.unidad),
      h("div", { class: "error-item__cuerpo" }, c.detalle, c.accion, c.ejemplos, c.pie));
    item._c = c;
    item._firma = "";
    return item;
  }

  function pintar(item, x) {
    const firma = `${x.cantidad}|${x.ultima}|${x.nivel}|${x.codigo}|${(x.ejemplos || []).length}`;
    if (item._firma === firma) return;
    item._firma = firma;
    const c = item._c;
    item.dataset.nivel = x.nivel === "aviso" ? "aviso" : x.nivel === "info" ? "info" : "error";
    texto(c.fuente, nombreFuente(x.fuente));
    c.codigo.hidden = !x.codigo;
    texto(c.codigo, x.codigo ? etiquetaCodigo(x.codigo) : "");
    texto(c.titulo, x.titulo);
    texto(c.cantidad, num(x.cantidad));
    texto(c.unidad, plural(x.cantidad, "vez", "veces"));
    c.detalle.hidden = !x.detalle;
    texto(c.detalle, x.detalle || "");
    c.accion.hidden = !x.accion;
    vaciar(c.accion);
    if (x.accion) c.accion.append(h("b", null, "Qué hacer: "), x.accion);

    const ejemplos = (x.ejemplos || []).slice(0, 6);
    c.ejemplos.hidden = !ejemplos.length;
    vaciar(c.ejemplos);
    ejemplos.forEach((n) => c.ejemplos.append(h("li", null, telefono(n))));
    if (x.cantidad > ejemplos.length && ejemplos.length) c.ejemplos.append(h("li", null, `y ${num(x.cantidad - ejemplos.length)} más`));

    vaciar(c.pie);
    if (x.primera) c.pie.append(h("span", null, `Primera vez: ${fechaHora(x.primera)}`));
    if (x.ultima && x.ultima !== x.primera) c.pie.append(h("span", null, `Última: ${fechaHora(x.ultima)}`));
    if (x.enlace) c.pie.append(h("a", { href: x.enlace, target: "_blank", rel: "noopener noreferrer" }, icono("externo"), "Explicación de Twilio"));
    if (x.codigo) c.pie.append(h("button", { type: "button", class: "boton boton--chico boton--fantasma", on: { click: () => copiar(String(x.codigo), "Código copiado") } }, icono("copiar"), "Copiar código"));
    if (x.codigo) c.pie.append(h("button", { type: "button", class: "boton boton--chico", on: { click: () => alVerContactos(String(x.codigo)) } }, icono("lista"), "Ver contactos afectados"));
  }

  function actualizar(S) {
    const r = S.resumen;
    if (!r) return;
    const lista = (r.incidencias || []).slice().sort((a, b) => (ORDEN_NIVEL[a.nivel] ?? 3) - (ORDEN_NIVEL[b.nivel] ?? 3) || b.cantidad - a.cantidad);
    const porFuente = { twilio: 0, elevenlabs: 0, sistema: 0 };
    for (const x of lista) porFuente[x.fuente] = (porFuente[x.fuente] || 0) + 1;

    vaciar(resumen);
    if (lista.length) {
      resumen.append(h("span", { class: "chip chip--peligro" }, icono("error"), `${num(lista.length)} ${plural(lista.length, "problema distinto", "problemas distintos")}`));
      if (porFuente.twilio) resumen.append(h("span", { class: "chip" }, `Twilio: ${num(porFuente.twilio)}`));
      if (porFuente.elevenlabs) resumen.append(h("span", { class: "chip" }, `ElevenLabs: ${num(porFuente.elevenlabs)}`));
      if (porFuente.sistema) resumen.append(h("span", { class: "chip" }, `Sistema: ${num(porFuente.sistema)}`));
    }

    const vacio = cuerpo.querySelector(".errores-ok");
    if (!lista.length) {
      reconciliar(cuerpo, [], nodos, crear, pintar);
      if (!vacio) cuerpo.append(h("div", { class: "errores-ok" }, icono("check"), "Sin errores hasta ahora. Si Twilio o ElevenLabs reportan algo, aparecerá aquí al instante."));
      return;
    }
    if (vacio) vacio.remove();
    reconciliar(cuerpo, lista.map((x) => x.clave), nodos, crear, (item, clave) => pintar(item, lista.find((x) => x.clave === clave)));
  }

  return { el, actualizar };
}
