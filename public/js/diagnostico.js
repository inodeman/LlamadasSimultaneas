import { h, vaciar, icono, conCarga } from "./dom.js";
import { api } from "./api.js";

const ICONO = { ok: "check", aviso: "alerta", error: "error", info: "info" };
const TEXTO_BARRA = { ok: "Todo bien", aviso: "Revisar", error: "Hay un problema" };
const GRUPOS = [["twilio", "Twilio"], ["eleven", "ElevenLabs"], ["servidor", "Servidor"]];
const ORDEN = { error: 0, aviso: 1, info: 2, ok: 3 };

let ultimo = null;
let temporizador = 0;
let refs = null;

const grupoDe = (id) => (id.startsWith("twilio-") ? "twilio" : id.startsWith("eleven-") ? "eleven" : "servidor");
const peor = (items) => (items.some((x) => x.estado === "error") ? "error" : items.some((x) => x.estado === "aviso") ? "aviso" : "ok");

function pintarBarra(r) {
  const boton = document.getElementById("btn-estado");
  if (!boton) return;
  const luz = (id, estado) => { const el = document.getElementById(id); if (el) el.dataset.estado = estado; };
  if (!r) {
    luz("luz-servidor", "error"); luz("luz-twilio", ""); luz("luz-eleven", "");
    boton.dataset.nivel = "error";
    document.getElementById("texto-estado").textContent = "Sin conexión";
    return;
  }
  const por = { twilio: [], eleven: [], servidor: [] };
  r.items.forEach((x) => por[grupoDe(x.id)].push(x));
  luz("luz-servidor", peor(por.servidor));
  luz("luz-twilio", por.twilio.length ? peor(por.twilio) : "aviso");
  luz("luz-eleven", por.eleven.length ? peor(por.eleven) : "aviso");
  boton.dataset.nivel = r.estado;
  document.getElementById("texto-estado").textContent = TEXTO_BARRA[r.estado] || "Revisar";
}

function itemDiag(x) {
  return h("div", { class: "diag-item", dataset: { estado: x.estado } },
    h("span", { class: "diag-item__icono" }, icono(ICONO[x.estado] || "info")),
    h("div", { class: "diag-item__texto" },
      h("b", null, x.titulo, x.codigo ? h("span", { class: "diag-item__codigo" }, `Código ${x.codigo}`) : null),
      x.detalle ? h("p", null, x.detalle) : null,
      x.accion ? h("p", { class: "accion" }, h("b", null, "Qué hacer: "), x.accion) : null,
      x.enlace ? h("a", { href: x.enlace, target: "_blank", rel: "noopener noreferrer" }, "Ver la explicación en Twilio") : null));
}

function pintarCajon(r) {
  if (!refs) return;
  vaciar(refs.cuerpo);
  const problemas = r.items.filter((x) => x.estado === "error").length;
  const avisos = r.items.filter((x) => x.estado === "aviso").length;
  const titulo = problemas ? `${problemas} ${problemas === 1 ? "problema por resolver" : "problemas por resolver"}` : avisos ? `${avisos} ${avisos === 1 ? "cosa por revisar" : "cosas por revisar"}` : "Todo está en orden";
  const detalle = problemas ? "Mientras no se resuelvan, las campañas pueden fallar." : avisos ? "No impiden usar el sistema, pero conviene atenderlas." : "Twilio, ElevenLabs y el servidor responden bien.";
  refs.cuerpo.append(h("div", { class: "diag-resumen", dataset: { nivel: r.estado } }, icono(ICONO[r.estado] || "info", { clase: "texto-2" }), h("div", null, h("b", null, titulo), h("span", null, detalle))));
  for (const [clave, nombre] of GRUPOS) {
    const items = r.items.filter((x) => grupoDe(x.id) === clave).sort((a, b) => (ORDEN[a.estado] ?? 4) - (ORDEN[b.estado] ?? 4));
    if (!items.length) continue;
    refs.cuerpo.append(h("section", { class: "seccion" }, h("h3", { class: "titulo-seccion" }, nombre), h("div", { class: "diag-lista" }, items.map(itemDiag))));
  }
  refs.hora.textContent = `Revisado a las ${new Date(r.ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}${r.profundo ? " (revisión a fondo)" : ""}`;
}

export async function revisarSistema(profundo = false) {
  try {
    const r = await api(`/diagnostico${profundo ? "?profundo=1" : ""}`, { silencioso: true });
    ultimo = r;
    pintarBarra(r);
    pintarCajon(r);
    return r;
  } catch (err) {
    pintarBarra(null);
    if (refs) {
      vaciar(refs.cuerpo);
      refs.cuerpo.append(h("div", { class: "aviso aviso--error" }, icono("error"), h("div", { class: "aviso__cuerpo" },
        h("span", { class: "aviso__titulo" }, "No se pudo revisar el sistema"), h("span", { class: "aviso__texto" }, err.message))));
    }
    return null;
  }
}

export function abrirEstado() {
  const dlg = document.getElementById("dlg-estado");
  vaciar(dlg);
  refs = { cuerpo: h("div", { class: "cajon__cuerpo" }), hora: h("span", { class: "texto-3 pequeno", style: { flex: "1" } }) };
  const profundo = h("button", { type: "button", class: "boton boton--primario" }, icono("actualizar"), "Revisar a fondo");
  profundo.addEventListener("click", () => conCarga(profundo, () => revisarSistema(true)));
  dlg.append(
    h("div", { class: "cajon__cabeza" }, h("div", null, h("h2", { class: "titulo-seccion", id: "dlg-estado-titulo" }, "Estado del sistema"), h("p", { class: "texto-3 pequeno" }, "Lo que ven Twilio, ElevenLabs y el servidor ahora mismo")),
      h("button", { type: "button", class: "boton boton--fantasma boton--icono", "aria-label": "Cerrar", on: { click: () => dlg.close() } }, icono("x"))),
    refs.cuerpo,
    h("div", { class: "cajon__pie" }, refs.hora, profundo));
  dlg.onclick = (ev) => { if (ev.target === dlg) dlg.close(); };
  dlg.onclose = () => { refs = null; };
  dlg.showModal();
  if (ultimo) pintarCajon(ultimo);
  else refs.cuerpo.append(h("div", { class: "esqueleto", style: { height: "70px", borderRadius: "14px" } }));
  revisarSistema(false);
}

export function iniciarEstadoSistema() {
  const boton = document.getElementById("btn-estado");
  if (boton) boton.addEventListener("click", abrirEstado);
  revisarSistema(false);
  clearInterval(temporizador);
  temporizador = setInterval(() => { if (!document.hidden) revisarSistema(false); }, 120000);
}
