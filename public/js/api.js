import { guardarArchivo } from "./dom.js";

export class ErrorApi extends Error {
  constructor(mensaje, { status = 0, datos = null } = {}) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
    this.datos = datos || {};
    this.titulo = (datos && datos.titulo) || "";
    this.accion = (datos && datos.accion) || "";
    this.codigo = (datos && datos.codigo) || "";
    this.fuente = (datos && datos.fuente) || "";
  }
}

let pendientes = 0;
let temporizadorBarra = null;
let barraVisible = false;

function mostrarBarra() {
  const barra = document.querySelector("#progreso-fino i");
  if (!barra) return;
  barraVisible = true;
  barra.style.opacity = "1";
  barra.style.width = "72%";
}

function ocultarBarra() {
  const barra = document.querySelector("#progreso-fino i");
  if (!barra || !barraVisible) return;
  barraVisible = false;
  barra.style.width = "100%";
  setTimeout(() => { if (!barraVisible) { barra.style.opacity = "0"; setTimeout(() => { if (!barraVisible) barra.style.width = "0"; }, 320); } }, 220);
}

function cambiarPendientes(delta) {
  pendientes = Math.max(0, pendientes + delta);
  if (pendientes === 1 && delta > 0) temporizadorBarra = setTimeout(mostrarBarra, 280);
  if (pendientes === 0) { clearTimeout(temporizadorBarra); ocultarBarra(); }
}

export function zonaHoraria() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (err) { return ""; }
}

export function urlDescarga(href) {
  const tz = zonaHoraria();
  if (!tz) return href;
  return `${href}${href.includes("?") ? "&" : "?"}tz=${encodeURIComponent(tz)}`;
}

export async function api(ruta, { metodo = "GET", cuerpo, senal, silencioso = false } = {}) {
  if (!silencioso) cambiarPendientes(1);
  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: cuerpo !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: senal,
      cache: "no-store",
    });
  } catch (err) {
    if (!silencioso) cambiarPendientes(-1);
    if (err && err.name === "AbortError") throw err;
    throw new ErrorApi("No se pudo conectar con el servidor. Revisa tu conexión a internet y que el servidor siga encendido.", { status: 0 });
  }
  if (!silencioso) cambiarPendientes(-1);
  let datos = null;
  const tipo = respuesta.headers.get("content-type") || "";
  if (tipo.includes("json")) {
    try { datos = await respuesta.json(); } catch (err) { datos = null; }
  }
  if (!respuesta.ok) {
    let mensaje = (datos && (datos.error || datos.message)) || "";
    if (!mensaje) {
      if (respuesta.status === 401) mensaje = "El acceso expiró. Recarga la página e ingresa tu usuario y contraseña.";
      else if (respuesta.status === 502 || respuesta.status === 504) mensaje = "El servidor no respondió a tiempo. Puede estar reiniciándose; espera unos segundos e inténtalo de nuevo.";
      else mensaje = `El servidor respondió con un error (${respuesta.status}).`;
    }
    throw new ErrorApi(mensaje, { status: respuesta.status, datos });
  }
  return datos;
}

export function abrirEventos(ruta, manejadores, alEstado = () => {}) {
  let fuente = null;
  let cerrado = false;
  let intentos = 0;
  let temporizador = null;

  function conectar() {
    if (cerrado) return;
    fuente = new EventSource(`/api${ruta}`);
    fuente.onopen = () => { intentos = 0; alEstado("conectado"); };
    fuente.onerror = () => {
      if (cerrado) return;
      if (fuente.readyState === EventSource.CLOSED) {
        alEstado("cerrado");
        intentos += 1;
        clearTimeout(temporizador);
        temporizador = setTimeout(conectar, Math.min(30000, 2000 * 2 ** Math.min(intentos, 4)));
      } else {
        alEstado("reconectando");
      }
    };
    for (const [tipo, fn] of Object.entries(manejadores)) {
      fuente.addEventListener(tipo, (ev) => {
        let datos;
        try { datos = JSON.parse(ev.data); } catch (err) { return; }
        try { fn(datos); } catch (err) { console.error(`Error al procesar el evento ${tipo}:`, err); }
      });
    }
  }
  conectar();
  return {
    cerrar() {
      cerrado = true;
      clearTimeout(temporizador);
      if (fuente) fuente.close();
    },
  };
}

function nombreDeCabecera(cabecera) {
  if (!cabecera) return "";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (utf) { try { return decodeURIComponent(utf[1]); } catch (err) { } }
  const simple = /filename="?([^";]+)"?/i.exec(cabecera);
  return simple ? simple[1] : "";
}

export async function descargarDelServidor(ruta, nombreAlterno = "archivo") {
  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, { cache: "no-store" });
  } catch (err) {
    throw new ErrorApi("No se pudo conectar con el servidor. Revisa tu conexión a internet y que el servidor siga encendido.", { status: 0 });
  }
  if (!respuesta.ok) {
    let datos = null;
    try { datos = await respuesta.json(); } catch (err) { datos = null; }
    throw new ErrorApi((datos && datos.error) || `El servidor respondió con un error (${respuesta.status}).`, { status: respuesta.status, datos });
  }
  const nombre = nombreDeCabecera(respuesta.headers.get("content-disposition")) || nombreAlterno;
  const blob = await respuesta.blob();
  guardarArchivo(nombre, blob, blob.type || "application/octet-stream");
  return { nombre, bytes: blob.size };
}
