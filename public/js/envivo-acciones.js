import { h, icono, aviso, modal, conCarga } from "./dom.js";
import { api } from "./api.js";
import { app, irA, cargarCampanas } from "./estado.js";
import { num, plural, estaActiva } from "./fmt.js";
import { campoRango } from "./campos.js";

const LISTAS = [
  ["no_respondieron", "noRespondieron", "No respondieron", "Sonó y nadie contestó, estaba ocupado o contestó una grabadora."],
  ["fallidas", "fallidas", "Fallaron", "La llamada no se pudo completar. Revisa antes la causa en el panel de errores."],
  ["sin_marcar", "sinMarcar", "No se marcaron", "Se quedaron sin llamar porque la campaña se detuvo o se pausó."],
  ["reintentar", "reintentar", "Todo lo que vale la pena reintentar", "Suma de las anteriores sin los números que no existen."],
];

export function crearControles({ obtener }) {
  const botones = {};
  let ocupado = false;

  function boton(clave, { icon, texto, clase = "", conTexto = false, alClic }) {
    const b = h("button", { type: "button", class: `boton ${clase}${conTexto ? " con-texto" : ""}`.trim(), title: texto },
      icono(icon), h("span", { class: "texto-boton" }, texto));
    b.addEventListener("click", () => {
      if (ocupado) return;
      ocupado = true;
      conCarga(b, alClic).finally(() => { ocupado = false; });
    });
    botones[clave] = b;
    return b;
  }

  function error(err, titulo) {
    aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || titulo });
  }

  async function enviar(accion, cuerpo, mensajeOk) {
    const { id } = obtener();
    try {
      await api(`/campanas/${encodeURIComponent(id)}/${accion}`, { metodo: "POST", cuerpo });
      if (mensajeOk) aviso(mensajeOk, { tipo: "ok", duracion: 2500 });
      return true;
    } catch (err) {
      error(err, "No se pudo hacer");
      return false;
    }
  }

  async function ajustarRitmo() {
    const { resumen } = obtener();
    const limite = (app.config && app.config.limites && app.config.limites.concurrencia) || 30;
    const valores = (app.config && app.config.valores) || {};
    const conc = campoRango({ etiqueta: "Llamadas a la vez", min: 1, max: limite, valor: Math.min(limite, resumen.concurrencia || valores.concurrencia || 5), ayuda: "Sube o baja cuántas líneas se mantienen abiertas. Aplica de inmediato." });
    const cps = campoRango({ etiqueta: "Arranques por segundo", min: 0.5, max: 10, paso: 0.5, valor: valores.cps || 1, formato: (x) => x.toLocaleString("es-MX"), ayuda: "Cuántas llamadas nuevas se piden cada segundo." });
    const ok = await modal({ titulo: "Ajustar el ritmo", texto: "Puedes cambiarlo mientras la campaña está en marcha, sin reiniciarla.", cuerpo: h("div", { class: "seccion" }, conc.el, cps.el), aceptar: "Aplicar" });
    if (ok) await enviar("ajustar", { concurrencia: conc.valor(), cps: cps.valor() }, "Ritmo actualizado");
  }

  async function detener() {
    const { resumen } = obtener();
    const pendientes = (resumen.pendientes || 0) + (resumen.cuenta ? resumen.cuenta.omitido || 0 : 0);
    const ok = await modal({
      titulo: "¿Detener la campaña?", peligro: true, aceptar: "Detener",
      texto: `${pendientes ? `${num(pendientes)} ${plural(pendientes, "contacto quedará", "contactos quedarán")} sin marcar y podrás continuar después con Reanudar. ` : ""}Las llamadas que ya están en conversación terminan solas; las que apenas suenan se cancelan.`,
    });
    if (ok) await enviar("detener", undefined, "Campaña detenida");
  }

  async function reintentar() {
    const { id, tipo } = obtener();
    let catalogo = [];
    try { catalogo = (await api(`/campanas/${encodeURIComponent(id)}/descargas`)).descargas || []; } catch (err) { error(err, "No se pudo leer la campaña"); return; }
    const cantidad = (clave) => (catalogo.find((d) => d.id === clave) || {}).cantidad || 0;
    const opciones = LISTAS.filter(([clave]) => cantidad(clave) > 0);
    if (!opciones.length) { aviso("No quedan contactos por reintentar en esta campaña.", { tipo: "info" }); return; }
    let elegida = opciones[opciones.length - 1][1];
    const grupo = h("div", { class: "seccion", role: "radiogroup", "aria-label": "Qué contactos reintentar" },
      opciones.map(([clave, lista, titulo, ayuda], k) => {
        const entrada = h("input", { type: "radio", name: "lista-reintento", value: lista, checked: k === opciones.length - 1 });
        entrada.addEventListener("change", () => { elegida = lista; });
        return h("label", { class: "opcion-radio" }, entrada, h("span", { class: "interruptor__texto" }, h("b", null, `${titulo} (${num(cantidad(clave))})`), h("span", null, ayuda)));
      }));
    const ok = await modal({ titulo: "Reintentar con otra campaña", texto: "Se prepara una campaña nueva con los mismos ajustes y esos contactos. Podrás revisarla antes de iniciar.", cuerpo: grupo, aceptar: "Preparar campaña" });
    if (!ok) return;
    try {
      const p = await api(`/campanas/${encodeURIComponent(id)}/plantilla?lista=${encodeURIComponent(elegida)}`);
      if (!p.cantidad) { aviso("Esa lista quedó vacía.", { tipo: "info" }); return; }
      const nombre = (LISTAS.find((x) => x[1] === elegida) || [])[2] || "";
      app.plantilla = { ...p, origen: { campana: id, lista: elegida }, etiqueta: `Contactos de la lista «${nombre}» de la campaña anterior` };
      irA(`/${tipo === "whatsapp" ? "whatsapp" : "llamadas"}`);
    } catch (err) { error(err, "No se pudo preparar el reintento"); }
  }

  async function eliminar() {
    const { id, resumen } = obtener();
    const ok = await modal({
      titulo: "¿Eliminar esta campaña?", peligro: true, aceptar: "Eliminar",
      texto: `Se borran los resultados de ${num(resumen.total)} contactos de este servidor. Descarga antes el reporte si lo necesitas: esto no se puede deshacer. Las llamadas ya hechas siguen en tu cuenta de Twilio.`,
    });
    if (!ok) return;
    try {
      await api(`/campanas/${encodeURIComponent(id)}`, { metodo: "DELETE" });
      aviso("Campaña eliminada", { tipo: "ok", duracion: 2500 });
      await cargarCampanas().catch(() => {});
      irA("/historial");
    } catch (err) { error(err, "No se pudo eliminar"); }
  }

  const el = h("div", { class: "envivo-cabeza__controles" },
    boton("pausar", { icon: "pausa", texto: "Pausar", alClic: () => enviar("pausar", undefined, "Campaña en pausa") }),
    boton("reanudar", { icon: "play", texto: "Reanudar", clase: "boton--primario", conTexto: true, alClic: () => enviar("reanudar", undefined, "Campaña reanudada") }),
    boton("ritmo", { icon: "ajustes", texto: "Ritmo", alClic: ajustarRitmo }),
    boton("detener", { icon: "detener", texto: "Detener", clase: "boton--peligro", alClic: detener }),
    boton("reintentar", { icon: "reintentar", texto: "Reintentar", clase: "boton--tonal", conTexto: true, alClic: reintentar }),
    h("a", { class: "boton con-texto", href: "#", id: "enlace-descargas", title: "Descargar resultados, audios y reportes" }, icono("descargas"), h("span", { class: "texto-boton" }, "Descargas")),
    boton("eliminar", { icon: "papelera", texto: "Eliminar", clase: "boton--fantasma", alClic: eliminar }));

  function actualizar(r, id) {
    const activa = estaActiva(r.estado);
    const c = r.cuenta || {};
    const reintentables = (c.no_contesto || 0) + (c.ocupado || 0) + (c.buzon || 0) + (c.fallida || 0) + (c.error || 0) + (c.pendiente || 0) + (c.omitido || 0) + (c.cancelada || 0);
    botones.pausar.hidden = r.estado !== "en_curso";
    botones.reanudar.hidden = !(r.estado === "pausada" || (!activa && r.reanudable));
    botones.ritmo.hidden = !activa;
    botones.detener.hidden = !activa;
    botones.reintentar.hidden = activa || r.reanudable || !reintentables;
    botones.eliminar.hidden = activa;
    el.querySelector("#enlace-descargas").setAttribute("href", `#/descargas/${encodeURIComponent(id)}`);
  }

  return { el, actualizar, botones, enviar };
}
