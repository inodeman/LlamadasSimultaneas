const nfEntero = new Intl.NumberFormat("es-MX");
const nfDecimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const nfPorcentaje = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const nfBytes = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

const vacio = (n) => n === null || n === undefined || (typeof n === "number" && Number.isNaN(n));

export const num = (n) => (vacio(n) ? "—" : nfEntero.format(n));
export const decimal = (n) => (vacio(n) ? "—" : nfDecimal.format(n));
export const pct = (n) => (vacio(n) ? "—" : `${nfPorcentaje.format(n)} %`);

export function porcentajeDe(parte, total) {
  return total > 0 ? (parte / total) * 100 : 0;
}

export function dur(seg) {
  if (vacio(seg)) return "—";
  const s = Math.max(0, Math.round(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const rr = String(r).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rr}` : `${m}:${rr}`;
}

export function durLarga(seg) {
  if (vacio(seg)) return "—";
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return `${m} min${s % 60 ? ` ${s % 60} s` : ""}`;
  const horas = Math.floor(m / 60);
  const minutos = m % 60;
  return `${horas} h${minutos ? ` ${minutos} min` : ""}`;
}

export function faltan(seg) {
  if (vacio(seg)) return "";
  if (seg < 45) return "menos de 1 min";
  const m = Math.round(seg / 60);
  if (m < 60) return `unos ${m} min`;
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  if (horas >= 48) return `${Math.round(horas / 24)} días`;
  return `${horas} h${resto ? ` ${resto} min` : ""}`;
}

export function dinero(usd) {
  if (vacio(usd)) return "—";
  const decimales = usd > 0 && usd < 1 ? 4 : 2;
  return `US$ ${new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: decimales }).format(usd)}`;
}

export function bytes(n) {
  if (vacio(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${nfBytes.format(n / 1024)} KB`;
  return `${nfBytes.format(n / 1024 / 1024)} MB`;
}

const aFecha = (v) => (v instanceof Date ? v : new Date(v));

export function hora(v) {
  if (!v) return "—";
  return aFecha(v).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function horaCorta(v) {
  if (!v) return "—";
  return aFecha(v).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fechaHora(v) {
  if (!v) return "—";
  const d = aFecha(v);
  return `${d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}, ${horaCorta(d)}`;
}

export function fechaLarga(v) {
  if (!v) return "—";
  return aFecha(v).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function haceCuanto(v) {
  if (!v) return "";
  const seg = Math.round((Date.now() - aFecha(v).getTime()) / 1000);
  if (seg < 5) return "ahora";
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} d`;
}

export function telefono(e164) {
  const t = String(e164 || "");
  const m = /^\+52(\d{3})(\d{3})(\d{4})$/.exec(t);
  if (m) return `+52 ${m[1]} ${m[2]} ${m[3]}`;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(t);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  return t;
}

export const plural = (n, uno, varios) => (n === 1 ? uno : varios);

export function grupoDe(cat) {
  switch (cat) {
    case "contesto": return "si";
    case "no_contesto": case "ocupado": case "buzon": return "no";
    case "fallida": case "error": return "error";
    case "en_curso": return "curso";
    default: return "pendiente";
  }
}

const GRUPOS_LLAMADA = {
  si: { etiqueta: "Respondieron", singular: "Respondió", tono: "si", forma: "circulo" },
  no: { etiqueta: "No respondieron", singular: "No respondió", tono: "no", forma: "anillo" },
  error: { etiqueta: "Fallaron", singular: "Falló", tono: "error", forma: "rombo" },
  curso: { etiqueta: "En curso", singular: "En curso", tono: "curso", forma: "curso" },
  pendiente: { etiqueta: "Pendientes", singular: "Pendiente", tono: "neutro", forma: "punto" },
};

const GRUPOS_WHATSAPP = {
  si: { etiqueta: "Entregados", singular: "Entregado", tono: "si", forma: "circulo" },
  no: { etiqueta: "Sin respuesta", singular: "Sin respuesta", tono: "no", forma: "anillo" },
  error: { etiqueta: "No entregados", singular: "No entregado", tono: "error", forma: "rombo" },
  curso: { etiqueta: "Enviados", singular: "Enviado", tono: "curso", forma: "curso" },
  pendiente: { etiqueta: "Pendientes", singular: "Pendiente", tono: "neutro", forma: "punto" },
};

export const ORDEN_GRUPOS = ["si", "no", "error", "curso", "pendiente"];

export function gruposDe(tipo) {
  return tipo === "whatsapp" ? GRUPOS_WHATSAPP : GRUPOS_LLAMADA;
}

const CATS_LLAMADA = {
  contesto: ["Contestó", "si", "circulo"],
  buzon: ["Buzón o contestadora", "no", "anillo"],
  no_contesto: ["No contestó", "no", "anillo"],
  ocupado: ["Ocupado", "no", "anillo"],
  fallida: ["Falló", "error", "rombo"],
  error: ["Error antes de marcar", "error", "rombo"],
  cancelada: ["Cancelada", "neutro", "cuadro"],
  omitido: ["Sin marcar", "neutro", "cuadro"],
  pendiente: ["Pendiente", "neutro", "punto"],
};

const CATS_WHATSAPP = {
  contesto: ["Entregado", "si", "circulo"],
  fallida: ["No entregado", "error", "rombo"],
  error: ["Error al enviar", "error", "rombo"],
  omitido: ["Sin enviar", "neutro", "cuadro"],
  pendiente: ["Pendiente", "neutro", "punto"],
};

export function infoFila(fila, tipo) {
  const wa = tipo === "whatsapp";
  const cat = fila.cat || "pendiente";
  if (cat === "en_curso") {
    const e = fila.estadoLlamada;
    if (wa) return { etiqueta: e === "sent" ? "Enviado" : "En cola", tono: "curso", forma: "curso", fase: "cola", grupo: "curso" };
    if (e === "ringing") return { etiqueta: "Timbrando", tono: "curso", forma: "curso", fase: "timbre", grupo: "curso" };
    if (e === "in-progress" || e === "answered") return { etiqueta: "En llamada", tono: "curso", forma: "curso", fase: "llamada", grupo: "curso" };
    return { etiqueta: "En cola", tono: "curso", forma: "curso", fase: "cola", grupo: "curso" };
  }
  const t = (wa ? CATS_WHATSAPP : CATS_LLAMADA)[cat] || CATS_LLAMADA[cat] || [cat, "neutro", "punto"];
  return { etiqueta: t[0], tono: t[1], forma: t[2], fase: "", grupo: grupoDe(cat) };
}

export function etiquetaCodigo(codigo) {
  const c = String(codigo === null || codigo === undefined ? "" : codigo).trim();
  if (!c) return "";
  const corto = c.split(":")[0];
  const sip = /^sip-(\d{3})$/i.exec(corto);
  return sip ? `SIP ${sip[1]}` : `Código ${corto}`;
}
export function tituloConCodigo(titulo, codigo) {
  const c = String(codigo === null || codigo === undefined ? "" : codigo).trim();
  return /^\d{3,6}$/.test(c) ? `${titulo} (${c})` : titulo;
}
export function detalleDeFila(fila, tipo) {
  if (fila.inc && fila.inc.titulo) return tituloConCodigo(fila.inc.titulo, fila.inc.codigo);
  if (fila.error) return fila.error;
  if (fila.cat === "contesto" && tipo !== "whatsapp") {
    if (fila.audioSeg && fila.duracion >= fila.audioSeg * 0.9) return "Escuchó el mensaje completo";
    if (fila.duracion) return `Escuchó ${fila.duracion} s${fila.audioSeg ? ` de ${Math.round(fila.audioSeg)} s` : ""}`;
    return "";
  }
  if (fila.cat === "buzon") return "Contestó una grabadora";
  if (fila.cat === "ocupado") return "La línea estaba ocupada";
  if (fila.cat === "no_contesto") return "Sonó y nadie contestó";
  if (fila.cat === "fallida" && fila.sip) return `Código SIP ${fila.sip}`;
  return "";
}

export function escuchoCompleto(fila) {
  return Boolean(fila.audioSeg) && fila.cat === "contesto" && fila.duracion >= fila.audioSeg * 0.9;
}

export const ESTADOS_CAMPANA = {
  preparando: { texto: "Preparando", chip: "info", animada: true },
  generando_audios: { texto: "Generando audios", chip: "info", animada: true },
  en_curso: { texto: "En curso", chip: "info", animada: true },
  pausada: { texto: "En pausa", chip: "aviso" },
  finalizando: { texto: "Terminando llamadas", chip: "info", animada: true },
  completada: { texto: "Completada", chip: "ok" },
  detenida: { texto: "Detenida", chip: "aviso" },
  interrumpida: { texto: "Interrumpida", chip: "aviso" },
  error: { texto: "Con error", chip: "peligro" },
};

export const estaActiva = (estado) => ["preparando", "generando_audios", "en_curso", "pausada", "finalizando"].includes(estado);
export const enMarcha = (estado) => ["preparando", "generando_audios", "en_curso", "finalizando"].includes(estado);

export function nombreFuente(f) {
  return f === "elevenlabs" ? "ElevenLabs" : f === "twilio" ? "Twilio" : "Sistema";
}
