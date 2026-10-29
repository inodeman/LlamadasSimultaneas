export const GRUPOS = ["si", "no", "error", "curso", "pendiente"];

export function conteoGrupos(r) {
  const c = (r && r.cuenta) || {};
  return {
    si: c.contesto || 0,
    no: (c.no_contesto || 0) + (c.ocupado || 0) + (c.buzon || 0),
    error: (c.fallida || 0) + (c.error || 0),
    curso: c.en_curso || 0,
    pendiente: (c.pendiente || 0) + (c.omitido || 0) + (c.cancelada || 0),
  };
}

export function conteoGruposDeFilas(filas, grupoDe) {
  const total = { si: 0, no: 0, error: 0, curso: 0, pendiente: 0 };
  for (const f of filas) total[grupoDe(f ? f.cat : "pendiente")] += 1;
  return total;
}

export const ultimoEvento = (f) => (f ? f.tFin || f.tContesta || f.tTimbra || f.tCrea || 0 : 0);

export const normalizar = (t) => String(t === null || t === undefined ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const rangoLinea = (f) => (f.estadoLlamada === "in-progress" || f.estadoLlamada === "answered" ? 3 : f.estadoLlamada === "ringing" ? 2 : 1);

export function lineasActivas(filas) {
  const lista = [];
  for (const f of filas) if (f && f.cat === "en_curso" && f.sid) lista.push(f);
  lista.sort((a, b) => rangoLinea(b) - rangoLinea(a) || (a.tCrea || 0) - (b.tCrea || 0));
  return lista;
}

const ESTADOS_TWILIO = {
  queued: "En cola de Twilio", initiated: "Iniciando", ringing: "Timbrando", "in-progress": "En llamada", answered: "En llamada",
  completed: "Completada", busy: "Ocupado", "no-answer": "No contestó", failed: "Falló", canceled: "Cancelada",
  accepted: "Aceptado", scheduled: "Programado", sending: "Enviando", sent: "Enviado", delivered: "Entregado", undelivered: "No entregado", read: "Leído",
};
export const estadoTwilioTexto = (e) => ESTADOS_TWILIO[e] || e;

export function contestadoPor(valor) {
  switch (valor) {
    case "human": return "Una persona";
    case "machine_start": case "machine_end_beep": case "machine_end_silence": case "machine_end_other": return "Un buzón o contestadora";
    case "fax": return "Un fax";
    case "unknown": return "No se pudo determinar";
    default: return valor || "";
  }
}

export const enlaceLlamadaTwilio = (sid) => `https://console.twilio.com/us1/monitor/logs/calls/${encodeURIComponent(sid)}`;
