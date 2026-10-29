import { $, $$, aviso, vaciar } from "./dom.js";
import { abrirEventos } from "./api.js";
import { app, cargarConfig, cargarCampanas, aplicarLista, actualizarItemLista, escuchar, memoria } from "./estado.js";
import { montarCompositor } from "./compositor.js";
import { montarEnVivo } from "./envivo.js";
import { montarHistorial } from "./historial.js";
import { montarDescargas } from "./descargas.js";
import { iniciarEstadoSistema } from "./diagnostico.js";

const TITULOS = {
  llamadas: ["Llamadas", "Nueva campaña"],
  whatsapp: ["WhatsApp", "Nueva campaña"],
  "en-vivo": ["En vivo", ""],
  historial: ["Historial", ""],
  descargas: ["Descargas", ""],
};

function temaEfectivo() {
  const guardado = document.documentElement.dataset.tema;
  if (guardado === "claro" || guardado === "oscuro") return guardado;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

function pintarIconoTema() {
  const uso = document.querySelector("#icono-tema use");
  if (uso) uso.setAttribute("href", temaEfectivo() === "oscuro" ? "#i-sol" : "#i-luna");
  const boton = $("#btn-tema");
  if (boton) boton.setAttribute("aria-label", temaEfectivo() === "oscuro" ? "Cambiar al tema claro" : "Cambiar al tema oscuro");
}

function iniciarTema() {
  const guardado = memoria.leer("tema", null);
  if (guardado === "claro" || guardado === "oscuro") document.documentElement.dataset.tema = guardado;
  pintarIconoTema();
  $("#btn-tema").addEventListener("click", () => {
    const nuevo = temaEfectivo() === "oscuro" ? "claro" : "oscuro";
    document.documentElement.dataset.tema = nuevo;
    memoria.guardar("tema", nuevo);
    pintarIconoTema();
  });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", pintarIconoTema);
}

const compositores = { llamadas: montarCompositor($("#vista-llamadas"), "llamadas"), whatsapp: montarCompositor($("#vista-whatsapp"), "whatsapp") };
const vistas = {
  llamadas: compositores.llamadas,
  whatsapp: compositores.whatsapp,
  "en-vivo": montarEnVivo($("#vista-en-vivo")),
  historial: montarHistorial($("#vista-historial")),
  descargas: montarDescargas($("#vista-descargas")),
};
let actual = "";

function parsearRuta() {
  const limpio = location.hash.replace(/^#\/?/, "");
  const [nombre, ...resto] = limpio.split("/");
  let arg = resto.join("/");
  try { arg = decodeURIComponent(arg); } catch (err) { }
  return { nombre: TITULOS[nombre] ? nombre : "llamadas", arg };
}

function enrutar() {
  const { nombre, arg } = parsearRuta();
  if (actual && actual !== nombre && vistas[actual].ocultar) vistas[actual].ocultar();
  for (const seccion of $$(".vista")) seccion.hidden = seccion.dataset.vista !== nombre;
  for (const enlace of $$("[data-nav]")) {
    if (enlace.dataset.nav === nombre) enlace.setAttribute("aria-current", "page"); else enlace.removeAttribute("aria-current");
  }
  const [titulo, contexto] = TITULOS[nombre];
  $("#titulo-vista").textContent = titulo;
  $("#contexto-vista").textContent = contexto;
  document.title = `${titulo} · Llamadas simultáneas`;
  const seccion = $(`#vista-${nombre}`);
  if (actual !== nombre) {
    seccion.classList.remove("entra");
    void seccion.offsetWidth;
    seccion.classList.add("entra");
    window.scrollTo({ top: 0, behavior: "auto" });
    const contenido = $("#contenido");
    if (contenido && actual) contenido.focus({ preventScroll: true });
  }
  actual = nombre;
  Promise.resolve(vistas[nombre].mostrar(arg)).catch((err) => {
    console.error(err);
    aviso(err.message || "Algo salió mal al abrir esta sección.", { tipo: "error", titulo: "No se pudo abrir" });
  });
}

function pintarInsignia() {
  const n = Object.values(app.activas).filter(Boolean).length;
  const el = $("#aviso-envivo");
  if (!el) return;
  el.hidden = n === 0;
  el.textContent = String(n);
  el.setAttribute("aria-label", `${n} ${n === 1 ? "campaña activa" : "campañas activas"}`);
}

function abrirEventosGlobales() {
  abrirEventos("/eventos", {
    "lista-completa": (d) => aplicarLista(d.campanas || []),
    lista: (d) => { if (!actualizarItemLista(d)) cargarCampanas().catch(() => {}); },
  });
}

async function configInicial() {
  const intento = () => cargarConfig().then(() => true, () => false);
  const espera = new Promise((r) => setTimeout(() => r("tarde"), 4000));
  const resultado = await Promise.race([intento(), espera]);
  if (resultado === true) return;
  aviso("No se pudo leer la configuración del servidor. Se sigue intentando.", { tipo: "aviso", titulo: "Servidor sin respuesta", duracion: 6000 });
  const reintentar = setInterval(async () => {
    if (await intento()) {
      clearInterval(reintentar);
      aviso("Servidor conectado.", { tipo: "ok", duracion: 2000 });
      if (compositores[actual]) compositores[actual].reiniciar();
    }
  }, 5000);
}

async function iniciar() {
  iniciarTema();
  iniciarEstadoSistema();
  escuchar("lista", pintarInsignia);
  escuchar("config", (c) => { const v = $("#version-app"); if (v && c && c.version) v.textContent = `v${c.version}`; });

  await Promise.all([configInicial(), cargarCampanas().catch(() => {})]);
  pintarInsignia();
  abrirEventosGlobales();

  window.addEventListener("hashchange", enrutar);
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    const activa = app.activas.llamadas || app.activas.whatsapp;
    location.replace(activa ? `#/en-vivo/${activa}` : "#/llamadas");
    if (!location.hash) enrutar();
  } else enrutar();
}

window.addEventListener("unhandledrejection", (ev) => {
  const err = ev.reason;
  if (err && err.name === "AbortError") return;
  console.error(err);
  aviso((err && err.message) || "Ocurrió un error inesperado.", { tipo: "error", titulo: "Algo falló" });
});
window.addEventListener("offline", () => aviso("Se perdió la conexión a internet. Lo que veas en pantalla puede estar desactualizado.", { tipo: "aviso", titulo: "Sin internet", duracion: 6000 }));
window.addEventListener("online", () => aviso("Internet de vuelta. Los datos se actualizan solos.", { tipo: "ok", duracion: 2500 }));

iniciar().catch((err) => {
  console.error(err);
  const zona = $("#contenido");
  if (zona) { vaciar(zona); zona.textContent = `No se pudo iniciar la aplicación: ${err.message}`; }
});
