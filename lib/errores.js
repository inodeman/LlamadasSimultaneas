"use strict";

const CODIGOS_TWILIO = {
  10001: ["Cuenta de Twilio no activa", "Twilio dice que la cuenta no está activa.", "Entra a console.twilio.com y revisa el estado de la cuenta, el saldo y los datos de facturación.", true],
  20003: ["Twilio rechazó las credenciales", "El Account SID o el Auth Token no son válidos o la cuenta está suspendida.", "Revisa TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en el archivo .env y que la cuenta esté activa y con saldo.", true],
  20005: ["Cuenta de Twilio no activa", "La cuenta está suspendida o cerrada.", "Entra a console.twilio.com para reactivarla.", true],
  20404: ["Recurso no encontrado en Twilio", "Twilio no encontró el recurso solicitado.", "Si se repite, avisa a soporte con el código 20404."],
  20429: ["Demasiadas solicitudes a Twilio", "Se superó el límite de peticiones por segundo de la API.", "El sistema reduce el ritmo y reintenta solo."],
  21201: ["Falta el número destino", "La llamada no tenía número de destino.", "Revisa que el contacto tenga un número válido."],
  21205: ["URL inválida", "Twilio rechazó una de las URL de la llamada.", "Revisa PUBLIC_BASE_URL en el .env."],
  21210: ["Número de origen no verificado", "El número desde el que se llama no está verificado en esta cuenta.", "Verifica el número en Twilio o usa uno comprado en la cuenta."],
  21211: ["Número destino inválido", "Twilio no reconoce este número como un teléfono válido.", "Corrige el número del contacto."],
  21212: ["Número de origen inválido", "TWILIO_PHONE_NUMBER no es un número válido.", "Revisa TWILIO_PHONE_NUMBER en el .env (formato +52...)."],
  21213: ["Falta el número de origen", "No se configuró el número desde el que se llama.", "Agrega TWILIO_PHONE_NUMBER en el .env."],
  21214: ["No se puede llegar a este número", "Twilio indica que el número destino no es alcanzable.", "Verifica el número; si es correcto, el operador no lo enruta."],
  21215: ["Sin permiso para llamar a ese país", "La cuenta no tiene habilitados los permisos geográficos para este destino.", "En console.twilio.com entra a Voice, Settings, Geo permissions y activa México."],
  21216: ["Llamada bloqueada por Twilio", "El destino está en una lista de bloqueo.", "Prueba con otro número o revisa la lista de bloqueo en Twilio."],
  21217: ["Número no parece válido", "El número destino no tiene un formato válido.", "Corrige el número del contacto."],
  21219: ["Número destino no verificado", "Es una cuenta de prueba (trial) y solo puede llamar a números verificados.", "Actualiza la cuenta a una cuenta de pago o verifica el número."],
  21220: ["Estado de llamada inválido", "La llamada ya no se puede modificar en su estado actual.", "No requiere acción."],
  21401: ["Número inválido", "El número no es válido para Twilio.", "Corrige el número del contacto."],
  21408: ["Sin permiso para enviar a esa región", "La cuenta no tiene permiso para enviar mensajes a esa región.", "Activa los permisos geográficos de mensajería en Twilio."],
  21608: ["Número no verificado (cuenta de prueba)", "Una cuenta de prueba solo puede enviar a números verificados.", "Verifica el número o actualiza la cuenta."],
  21610: ["Destinatario dado de baja", "La persona respondió STOP y ya no recibe mensajes.", "No se puede enviar a este número."],
  21612: ["Número destino no alcanzable desde el origen", "El número de origen no puede enviar a este destino.", "Revisa los permisos y el origen del mensaje."],
  21614: ["No es un celular válido", "El destino no es un número móvil válido.", "Corrige el número."],
  21617: ["Mensaje demasiado largo", "El texto supera el máximo permitido.", "Acorta el mensaje."],
  21619: ["Mensaje vacío", "El mensaje no tiene texto.", "Escribe el mensaje."],
  30001: ["Cola de mensajes llena", "El mensaje no se pudo enviar porque la cola estaba llena.", "Envía a menor ritmo."],
  30002: ["Cuenta suspendida", "La cuenta de Twilio está suspendida.", "Revisa console.twilio.com."],
  30003: ["Teléfono inalcanzable", "El teléfono está apagado o fuera de cobertura.", "Reintenta más tarde."],
  30004: ["Mensaje bloqueado", "El destinatario o el operador bloqueó el mensaje.", "No se puede enviar a este número."],
  30005: ["Número desconocido", "El número destino no existe o está inactivo.", "Corrige el número."],
  30006: ["Línea fija o sin cobertura del operador", "El destino es una línea fija o el operador no es alcanzable.", "No se puede enviar a este número."],
  30007: ["Filtrado por el operador", "El operador filtró el mensaje como spam.", "Cambia el contenido del mensaje."],
  30008: ["Error desconocido de entrega", "Twilio no pudo determinar la causa.", "Reintenta más tarde."],
  63003: ["Destinatario sin WhatsApp", "No se encontró el canal de WhatsApp del destinatario.", "Verifica que el número tenga WhatsApp."],
  63007: ["Número de WhatsApp de origen no válido", "Twilio no encontró el canal de WhatsApp del número de origen.", "Revisa TWILIO_WHATSAPP_NUMBER en el .env."],
  63015: ["Destinatario no unido al Sandbox", "En el Sandbox de WhatsApp el destinatario debe enviar primero el código de unión.", "Pídele que envíe el código al número del Sandbox."],
  63016: ["Fuera de la ventana de 24 horas", "WhatsApp solo permite mensajes libres dentro de las 24 horas posteriores a que el cliente escribe; fuera de ese plazo se requiere una plantilla aprobada.", "Usa una plantilla de mensaje aprobada."],
  63018: ["Límite de velocidad de WhatsApp", "Se superó el ritmo permitido de envío.", "Envía a menor ritmo."],
  63024: ["Destinatario de WhatsApp inválido", "El número no es válido para WhatsApp.", "Corrige el número."],
  63038: ["Límite diario de WhatsApp alcanzado", "La cuenta alcanzó su tope diario de conversaciones.", "Espera 24 horas o solicita un aumento del límite."],
  11100: ["URL con formato inválido", "Twilio no pudo interpretar una URL de la llamada.", "Revisa PUBLIC_BASE_URL en el .env."],
  11200: ["Twilio no pudo descargar el audio o la URL", "Al contestar, Twilio intentó leer el audio desde tu servidor y falló. La persona escucha un mensaje de error.", "Revisa que PUBLIC_BASE_URL sea la URL pública del servidor, que responda desde internet y que el archivo exista."],
  11205: ["No se pudo conectar con tu servidor", "Twilio no logró abrir conexión con el servidor.", "Revisa que el servidor esté encendido y accesible desde internet (puerto 80 o 443)."],
  11206: ["Respuesta HTTP inválida", "Tu servidor respondió algo que Twilio no entiende.", "Revisa los registros del servidor."],
  11210: ["Dominio no encontrado", "Twilio no pudo resolver el dominio de PUBLIC_BASE_URL.", "Revisa PUBLIC_BASE_URL en el .env."],
  12100: ["TwiML mal formado", "La respuesta de la llamada no es un documento TwiML válido.", "Revisa el mensaje o la URL del audio."],
  12300: ["Tipo de contenido inválido", "El servidor devolvió un tipo de archivo que Twilio no acepta.", "Verifica que el audio sea un MP3 válido."],
  12400: ["Falla interna de Twilio", "Twilio tuvo un problema interno al procesar la llamada.", "Reintenta; si persiste, contacta a soporte de Twilio."],
  13223: ["Formato de número inválido al marcar", "El formato del número no es válido.", "Corrige el número."],
  13224: ["Número inválido al marcar", "El número no es válido.", "Corrige el número."],
  13225: ["Número prohibido", "Twilio no permite marcar a este número.", "No se puede llamar a este destino."],
  13226: ["Código de país inválido", "El código de país del número no es válido.", "Corrige el número."],
  13227: ["Sin autorización internacional", "La cuenta no tiene autorización para llamadas internacionales a ese destino.", "Activa el país en Geo permissions de Voice."],
  13230: ["Identificador de llamada inválido", "El número de origen no es válido para esta cuenta.", "Revisa TWILIO_PHONE_NUMBER en el .env."],
};

const CODIGOS_SIP = {
  400: ["Solicitud inválida (SIP 400)", "El operador rechazó la solicitud de llamada por formato."],
  401: ["No autorizada (SIP 401)", "El operador no autorizó la llamada."],
  402: ["Pago requerido (SIP 402)", "El operador exige saldo o pago para completar la llamada."],
  403: ["Rechazada por el operador (SIP 403)", "El operador bloqueó la llamada. Suele ser por permisos del destino, identificador de llamada no registrado o filtros anti-spam."],
  404: ["Número no existe o no se alcanza (SIP 404)", "El operador dice que el número no está asignado o no tiene ruta."],
  408: ["El operador no respondió a tiempo (SIP 408)", "La red del destino tardó demasiado en contestar la solicitud."],
  410: ["Número fuera de servicio (SIP 410)", "El número ya no existe."],
  480: ["Teléfono no disponible (SIP 480)", "Está apagado, sin cobertura o fuera de la red."],
  484: ["Número incompleto (SIP 484)", "Al número le faltan dígitos."],
  486: ["Ocupado (SIP 486)", "La línea estaba ocupada."],
  487: ["Cancelada antes de contestar (SIP 487)", "Nadie contestó dentro del tiempo de timbrado."],
  488: ["No aceptada (SIP 488)", "El destino no aceptó el tipo de llamada."],
  500: ["Error en la red del operador (SIP 500)", "Falla interna del operador del destino."],
  502: ["Puerta de enlace inválida (SIP 502)", "Falla entre operadores."],
  503: ["Operador saturado o sin ruta (SIP 503)", "La red del destino no tiene capacidad o ruta disponible en este momento."],
  504: ["Tiempo agotado en la red (SIP 504)", "La red del destino no respondió a tiempo."],
  600: ["Ocupado en todos lados (SIP 600)", "El usuario está ocupado en todos sus dispositivos."],
  603: ["La persona rechazó la llamada (SIP 603)", "Alguien vio la llamada y la rechazó."],
  604: ["Número no existe (SIP 604)", "El número no existe en ninguna red."],
  606: ["No aceptable (SIP 606)", "El destino no aceptó la llamada."],
};

const ERRORES_DE_RED = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPIPE", "ESOCKETTIMEDOUT", "ECONNABORTED"]);

function enlaceTwilio(codigo) {
  return /^\d{4,6}$/.test(String(codigo)) ? `https://www.twilio.com/docs/api/errors/${codigo}` : "";
}

function explicarCodigoTwilio(codigo, textoOriginal) {
  const clave = String(codigo || "");
  const conocido = CODIGOS_TWILIO[clave];
  if (conocido) {
    return { codigo: clave, titulo: conocido[0], detalle: conocido[1], accion: conocido[2], fatal: Boolean(conocido[3]), enlace: enlaceTwilio(clave) };
  }
  return {
    codigo: clave || "desconocido",
    titulo: clave ? `Error de Twilio ${clave}` : "Error de Twilio",
    detalle: textoOriginal || "Twilio no dio más detalles.",
    accion: clave ? `Consulta el código ${clave} en la documentación de Twilio.` : "Revisa los registros en console.twilio.com.",
    fatal: false,
    enlace: enlaceTwilio(clave),
  };
}

function explicarSip(codigo) {
  const n = parseInt(codigo, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const conocido = CODIGOS_SIP[n];
  if (conocido) return { codigo: String(n), titulo: conocido[0], detalle: conocido[1] };
  const familia = n >= 500 ? "Falla en la red del operador" : n >= 400 ? "El operador rechazó la llamada" : "Respuesta del operador";
  return { codigo: String(n), titulo: `${familia} (SIP ${n})`, detalle: "Código devuelto por el operador del destino." };
}

function explicarErrorTwilio(err) {
  const http = err && err.status ? Number(err.status) : null;
  const codigo = err && err.code !== undefined && err.code !== null ? err.code : null;
  const esRed = Boolean(err && !http && (ERRORES_DE_RED.has(err.code) || /timeout|socket|network|ECONN|ENOTFOUND/i.test(String(err.message || ""))));

  if (esRed) {
    return {
      fuente: "twilio", codigo: "red", titulo: "Sin conexión con Twilio",
      detalle: `No se pudo hablar con la API de Twilio (${err.code || err.message}).`,
      accion: "Revisa la conexión a internet del servidor. El sistema reintenta solo.",
      fatal: false, reintentable: true, ambiguo: true, http: null,
    };
  }
  const base = explicarCodigoTwilio(codigo || (http === 401 ? 20003 : ""), err && err.message);
  const fatal = base.fatal || http === 401 || /authentication failed/i.test(String(err && err.message));
  const limite = http === 429 || Number(codigo) === 20429;
  const servidor = http !== null && http >= 500;
  return {
    fuente: "twilio",
    codigo: base.codigo === "desconocido" && http ? `http-${http}` : base.codigo,
    titulo: fatal && base.codigo === "desconocido" ? "Twilio rechazó las credenciales" : base.titulo,
    detalle: base.detalle,
    accion: base.accion,
    enlace: base.enlace,
    fatal,
    reintentable: limite || servidor,
    ambiguo: servidor,
    http,
  };
}

function explicarLlamadaTerminada(estadoTwilio, sip, alerta) {
  if (alerta && alerta.codigo) {
    const base = explicarCodigoTwilio(alerta.codigo, alerta.texto);
    return { fuente: "twilio", codigo: base.codigo, titulo: base.titulo, detalle: alerta.texto && base.codigo === "desconocido" ? alerta.texto : base.detalle, accion: base.accion, enlace: base.enlace };
  }
  const s = explicarSip(sip);
  if (estadoTwilio === "failed") {
    if (s) return { fuente: "twilio", codigo: `sip-${s.codigo}`, titulo: s.titulo, detalle: s.detalle, accion: accionParaSip(s.codigo) };
    return {
      fuente: "twilio", codigo: "failed", titulo: "Twilio no pudo completar la llamada",
      detalle: "La llamada falló antes de timbrar. Twilio no informó el motivo exacto.",
      accion: "Pulsa 'Actualizar datos de Twilio' para consultar el motivo, o revisa console.twilio.com, Monitor, Logs, Errors.",
    };
  }
  if (estadoTwilio === "busy") return { fuente: "twilio", codigo: "busy", titulo: "Línea ocupada", detalle: "El número estaba ocupado.", accion: "Reintenta más tarde." };
  if (estadoTwilio === "no-answer") {
    return { fuente: "twilio", codigo: "no-answer", titulo: "No contestó", detalle: "Timbró el tiempo configurado y nadie contestó.", accion: "Reintenta en otro horario." };
  }
  if (estadoTwilio === "canceled") return { fuente: "twilio", codigo: "canceled", titulo: "Llamada cancelada", detalle: "Se canceló antes de ser contestada (por el botón Detener o por tiempo).", accion: "" };
  return null;
}

function accionParaSip(codigo) {
  const n = parseInt(codigo, 10);
  if (n === 403) return "Revisa los permisos geográficos de la cuenta y que el número de origen esté registrado para llamar a México.";
  if (n === 404 || n === 410 || n === 604 || n === 484) return "El número parece inexistente; corrígelo o descártalo.";
  if (n === 480) return "Reintenta en otro horario.";
  if (n === 503 || n === 500 || n === 502 || n === 504) return "Falla del operador; reintenta más tarde y a menor ritmo.";
  return "Si el porcentaje de fallos es alto, revisa console.twilio.com, Monitor, Logs, Errors.";
}

function claveIncidencia(inc) {
  return `${inc.fuente}:${inc.codigo}`;
}

module.exports = {
  CODIGOS_TWILIO, CODIGOS_SIP, explicarCodigoTwilio, explicarSip, explicarErrorTwilio,
  explicarLlamadaTerminada, claveIncidencia, enlaceTwilio,
};
