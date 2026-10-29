import { h, vaciar, icono, contador } from "./dom.js";
import { lineaDeRitmo, barrasHorizontales, columnas, tablaEquivalente } from "./graficos.js";
import { num, decimal, pct, dur, nombreFuente, plural, porcentajeDe, tituloConCodigo } from "./fmt.js";
import { estadoTwilioTexto } from "./calculos.js";

const TONO_ESTADO = { completed: "si", "in-progress": "curso", answered: "curso", ringing: "curso", queued: "curso", initiated: "curso", failed: "error", busy: "no", "no-answer": "no", canceled: "neutro" };

const ACTIVA = ["preparando", "generando_audios", "en_curso", "finalizando", "pausada"];

function panelGrafico({ titulo, descripcion }) {
  const cuerpo = h("div", { class: "grafico__cuerpo" });
  const tabla = h("div", { hidden: true });
  const boton = h("button", { type: "button", class: "boton boton--chico boton--fantasma", "aria-pressed": "false" }, icono("tabla"), "Ver como tabla");
  boton.addEventListener("click", () => {
    const ver = boton.getAttribute("aria-pressed") !== "true";
    boton.setAttribute("aria-pressed", String(ver));
    cuerpo.hidden = ver;
    tabla.hidden = !ver;
    boton.lastChild.textContent = ver ? "Ver gráfico" : "Ver como tabla";
  });
  const subtitulo = h("p", null, descripcion);
  const el = h("section", { class: "panel grafico", hidden: true }, h("div", { class: "grafico__cabeza" }, h("div", null, h("h3", null, titulo), subtitulo), boton), cuerpo, tabla);
  return {
    el, cuerpo, subtitulo,
    ponerTabla(encabezados, filas) { vaciar(tabla); tabla.append(tablaEquivalente(encabezados, filas)); },
  };
}

export function crearAnalisis({ tipo }) {
  const wa = tipo === "whatsapp";

  const pRitmo = panelGrafico({ titulo: "Ritmo de la campaña", descripcion: wa ? "Mensajes con resultado cada 10 segundos, últimos 5 minutos" : "Llamadas terminadas cada 10 segundos, últimos 5 minutos" });
  const cifraRitmo = h("b", { class: "num", style: { fontSize: "1.75rem", fontStretch: "78%", lineHeight: "1" } }, "—");
  const unidadRitmo = h("span", { class: "texto-3 pequeno" }, "por minuto");
  const ritmo = lineaDeRitmo(pRitmo.cuerpo, { unidad: wa ? "mensajes" : "llamadas", cadaSeg: 10 });
  pRitmo.cuerpo.prepend(h("div", { class: "cinta", style: { alignItems: "baseline", marginBottom: "8px" } }, cifraRitmo, unidadRitmo));

  const pVoz = panelGrafico({ titulo: "Respuesta por voz", descripcion: "Qué porcentaje de las llamadas contestó con cada voz" });
  const barrasVoz = barrasHorizontales(pVoz.cuerpo);

  const pHora = panelGrafico({ titulo: "Respuesta por hora del día", descripcion: "Porcentaje de llamadas contestadas según la hora en que se hicieron" });
  const colHora = columnas(pHora.cuerpo);

  const pFallas = panelGrafico({ titulo: wa ? "Por qué no se entregaron" : "Por qué fallaron", descripcion: "Causas reportadas por Twilio, de la más frecuente a la menos" });
  const barrasFallas = barrasHorizontales(pFallas.cuerpo);

  const pEstados = panelGrafico({ titulo: "Estados que reporta Twilio", descripcion: "El estado final de cada llamada tal como lo informa Twilio" });
  const barrasEstados = barrasHorizontales(pEstados.cuerpo);

  const el = h("div", { class: "analisis" }, pRitmo.el, pVoz.el, pHora.el, pFallas.el, pEstados.el);

  function actualizar(S) {
    const r = S.resumen;
    if (!r) return;
    const activa = ACTIVA.includes(r.estado);

    const hayRitmo = (r.sparkline || []).length > 0 && (activa || Math.max(0, ...r.sparkline) > 0);
    pRitmo.el.hidden = !hayRitmo;
    if (hayRitmo) {
      ritmo.actualizar(r.sparkline);
      contador(cifraRitmo, r.ritmoPorMin || 0, (n) => decimal(Math.round(n * 10) / 10));
      const ult = r.sparkline.slice().reverse();
      pRitmo.ponerTabla(["Hace", wa ? "Mensajes" : "Llamadas"], ult.map((v, k) => [k === 0 ? "Últimos 10 s" : `${k * 10} s`, num(v)]).filter((_, k) => k < 30));
    }

    const voces = r.porVoz || [];
    const mostrarVoz = !wa && voces.length > 0 && (voces.length > 1 || voces[0].voz !== "(sin voz)");
    pVoz.el.hidden = !mostrarVoz;
    if (mostrarVoz) {
      barrasVoz.actualizar(voces.map((v) => ({
        clave: v.voz, nombre: v.voz, valor: v.tasa, texto: pct(v.tasa), pie: `${num(v.contestaron)} de ${num(v.marcadas)}`,
        detalle: [v.voz, `${num(v.contestaron)} de ${num(v.marcadas)} contestaron · promedio ${v.duracionPromedio ? dur(v.duracionPromedio) : "—"} · ${num(v.completos)} escucharon todo`],
      })));
      pVoz.ponerTabla(["Voz", "Marcadas", "Contestaron", "Tasa", "Duración promedio", "Escucharon todo"],
        voces.map((v) => [v.voz, num(v.marcadas), num(v.contestaron), pct(v.tasa), v.duracionPromedio ? dur(v.duracionPromedio) : "—", num(v.completos)]));
    }

    const horas = r.porHora || [];
    pHora.el.hidden = horas.length < 2;
    if (horas.length >= 2) {
      colHora.actualizar(horas.map((x) => ({
        clave: String(x.hora), etiqueta: String(x.hora), valor: x.tasa,
        detalle: [`${String(x.hora).padStart(2, "0")}:00`, `${num(x.contestaron)} de ${num(x.marcadas)} contestaron (${pct(x.tasa)})`],
      })));
      pHora.ponerTabla(["Hora", "Marcadas", "Contestaron", "Tasa"], horas.map((x) => [`${String(x.hora).padStart(2, "0")}:00`, num(x.marcadas), num(x.contestaron), pct(x.tasa)]));
    }

    const fallos = r.motivosFallo || [];
    pFallas.el.hidden = !fallos.length;
    if (fallos.length) {
      const totalFallos = fallos.reduce((s, x) => s + x.cantidad, 0);
      const maximo = Math.max(...fallos.map((x) => x.cantidad));
      barrasFallas.actualizar(fallos.map((x) => ({
        clave: x.clave, nombre: x.titulo, valor: (x.cantidad / maximo) * 100, texto: num(x.cantidad), pie: pct(porcentajeDe(x.cantidad, totalFallos)), tono: "error",
        detalle: [tituloConCodigo(x.titulo, x.codigo), `${nombreFuente(x.fuente)} · ${num(x.cantidad)} ${plural(x.cantidad, "contacto", "contactos")}${x.accion ? ` · ${x.accion}` : ""}`],
      })));
      pFallas.ponerTabla(["Origen", "Código", "Motivo", "Contactos", "% de las fallas"],
        fallos.map((x) => [nombreFuente(x.fuente), String(x.codigo || "—").split(":")[0], x.titulo, num(x.cantidad), pct(porcentajeDe(x.cantidad, totalFallos))]));
    }

    const estados = Object.entries(r.estadosTwilio || {}).sort((a, b) => b[1] - a[1]);
    pEstados.el.hidden = !estados.length || wa;
    if (estados.length && !wa) {
      const total = estados.reduce((s, [, n]) => s + n, 0);
      barrasEstados.actualizar(estados.map(([estado, n]) => ({
        clave: estado, nombre: estadoTwilioTexto(estado), valor: porcentajeDe(n, total), texto: num(n), pie: pct(porcentajeDe(n, total)), tono: TONO_ESTADO[estado] || "neutro",
        detalle: [estadoTwilioTexto(estado), `${num(n)} de ${num(total)} llamadas`],
      })));
      pEstados.ponerTabla(["Estado", "Llamadas", "%"], estados.map(([estado, n]) => [`${estadoTwilioTexto(estado)} (${estado})`, num(n), pct(porcentajeDe(n, total))]));
    }
  }

  return { el, actualizar };
}
