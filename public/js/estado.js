import { api } from "./api.js";

export const app = {
  config: null,
  campanas: [],
  activas: { llamadas: null, whatsapp: null },
  plantilla: null,
  vista: "",
};

const bus = new EventTarget();

export function emitir(nombre, detalle) {
  bus.dispatchEvent(new CustomEvent(nombre, { detail: detalle }));
}

export function escuchar(nombre, fn) {
  const f = (ev) => fn(ev.detail);
  bus.addEventListener(nombre, f);
  return () => bus.removeEventListener(nombre, f);
}

export async function cargarConfig() {
  app.config = await api("/config", { silencioso: true });
  emitir("config", app.config);
  return app.config;
}

export async function cargarCampanas() {
  const datos = await api("/campanas", { silencioso: true });
  aplicarLista(datos.campanas || []);
  return datos;
}

export function aplicarLista(lista) {
  app.campanas = lista;
  app.activas = {
    llamadas: (lista.find((c) => c.tipo === "llamadas" && c.activa) || {}).id || null,
    whatsapp: (lista.find((c) => c.tipo === "whatsapp" && c.activa) || {}).id || null,
  };
  emitir("lista", lista);
}

export function actualizarItemLista(parcial) {
  const i = app.campanas.findIndex((c) => c.id === parcial.id);
  if (parcial.eliminada) {
    if (i >= 0) app.campanas.splice(i, 1);
  } else if (i >= 0) {
    const actual = app.campanas[i];
    Object.assign(actual, { estado: parcial.estado, progreso: parcial.progreso });
    actual.activa = ["preparando", "generando_audios", "en_curso", "pausada", "finalizando"].includes(parcial.estado);
  } else {
    return false;
  }
  aplicarLista(app.campanas);
  return true;
}

export function irA(ruta) {
  if (location.hash === `#${ruta}`) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = ruta;
}

export const memoria = {
  leer(clave, defecto = null) {
    try {
      const v = localStorage.getItem(`ls3:${clave}`);
      return v === null ? defecto : JSON.parse(v);
    } catch (err) { return defecto; }
  },
  guardar(clave, valor) {
    try { localStorage.setItem(`ls3:${clave}`, JSON.stringify(valor)); } catch (err) { }
  },
  borrar(clave) {
    try { localStorage.removeItem(`ls3:${clave}`); } catch (err) { }
  },
};
