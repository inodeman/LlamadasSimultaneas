"use strict";
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const { explicarErrorTwilio } = require("./errores");

function conTiempo(promesa, ms) {
  let temporizador;
  const limite = new Promise((_, rechazo) => {
    temporizador = setTimeout(() => {
      const err = new Error("Tiempo de espera agotado");
      err.code = "ETIMEDOUT";
      rechazo(err);
    }, ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

function item(id, titulo, estado, detalle, accion, extra) {
  return { id, titulo, estado, detalle: detalle || "", accion: accion || "", ...(extra || {}) };
}

function itemTwilio(id, titulo, err) {
  const inc = explicarErrorTwilio(err);
  return item(id, titulo, "error", `${inc.titulo}: ${inc.detalle}`, inc.accion, { codigo: inc.codigo, enlace: inc.enlace || "" });
}

async function revisarTwilio(g) {
  const tw = g.cfg.twilio;
  if (!g.client) {
    return [item("twilio-credenciales", "Credenciales de Twilio", "error", "Faltan TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN, o no tienen el formato correcto.", "Agrégalos en el archivo .env y reinicia el servidor.")];
  }
  const salida = [];
  const tareas = [
    (async () => {
      try {
        const cuenta = await conTiempo(g.client.api.accounts(tw.accountSid).fetch(), 9000);
        const activa = cuenta.status === "active";
        salida.push(item("twilio-cuenta", "Cuenta de Twilio", activa ? "ok" : "error", `${cuenta.friendlyName} · estado: ${cuenta.status} · tipo: ${cuenta.type}`, activa ? "" : "La cuenta no está activa. Revísala en console.twilio.com."));
        if (String(cuenta.type).toLowerCase() === "trial") {
          salida.push(item("twilio-prueba", "Cuenta de prueba (Trial)", "aviso", "Una cuenta de prueba solo puede llamar a números verificados y antepone un mensaje de Twilio a cada llamada.", "Actualiza la cuenta en console.twilio.com para llamar a cualquier número."));
        }
      } catch (err) {
        salida.push(itemTwilio("twilio-cuenta", "Cuenta de Twilio", err));
      }
    })(),
    (async () => {
      try {
        const saldo = await conTiempo(g.client.balance.fetch(), 9000);
        const valor = parseFloat(saldo.balance);
        const estado = !Number.isFinite(valor) ? "info" : valor <= 0.5 ? "error" : valor < 5 ? "aviso" : "ok";
        salida.push(item("twilio-saldo", "Saldo de Twilio", estado, `${Number.isFinite(valor) ? valor.toFixed(2) : saldo.balance} ${saldo.currency}`, estado === "ok" ? "" : "Recarga saldo en console.twilio.com, Billing. Sin saldo las llamadas fallan."));
      } catch (err) {
        salida.push(itemTwilio("twilio-saldo", "Saldo de Twilio", err));
      }
    })(),
    (async () => {
      if (!tw.fromNumber) {
        salida.push(item("twilio-numero", "Número de origen", "error", "Falta TWILIO_PHONE_NUMBER.", "Agrégalo en el archivo .env."));
        return;
      }
      try {
        const propios = await conTiempo(g.client.incomingPhoneNumbers.list({ phoneNumber: tw.fromNumber, limit: 1 }), 9000);
        if (propios.length) {
          const voz = propios[0].capabilities && propios[0].capabilities.voice;
          salida.push(item("twilio-numero", "Número de origen", voz === false ? "error" : "ok", `${tw.fromNumber}${voz === false ? " · sin capacidad de voz" : " · con voz habilitada"}`, voz === false ? "Elige un número con capacidad de voz." : ""));
          return;
        }
        const verificados = await conTiempo(g.client.outgoingCallerIds.list({ phoneNumber: tw.fromNumber, limit: 1 }), 9000);
        salida.push(verificados.length
          ? item("twilio-numero", "Número de origen", "ok", `${tw.fromNumber} · identificador de llamada verificado`, "")
          : item("twilio-numero", "Número de origen", "error", `${tw.fromNumber} no pertenece a esta cuenta de Twilio ni está verificado.`, "Compra o verifica ese número en console.twilio.com, o cambia TWILIO_PHONE_NUMBER."));
      } catch (err) {
        salida.push(itemTwilio("twilio-numero", "Número de origen", err));
      }
    })(),
    (async () => {
      try {
        const pais = await conTiempo(g.client.voice.v1.dialingPermissions.countries("MX").fetch(), 9000);
        const habilitado = pais.lowRiskNumbersEnabled !== false;
        salida.push(item("twilio-geo", "Permiso para llamar a México", habilitado ? "ok" : "error",
          habilitado ? "Las llamadas a números de México están habilitadas." : "Las llamadas a México están deshabilitadas en esta cuenta.",
          habilitado ? "" : "Actívalas en console.twilio.com, Voice, Settings, Geo permissions. Sin esto todas las llamadas fallan con el error 21215."));
      } catch (err) {
        salida.push(item("twilio-geo", "Permiso para llamar a México", "info", `No se pudo consultar (${err.message}).`, "Revisa console.twilio.com, Voice, Settings, Geo permissions."));
      }
    })(),
  ];
  await Promise.all(tareas);
  return salida;
}

async function revisarElevenLabs(g) {
  if (!g.voces.disponible()) {
    return [item("eleven-clave", "ElevenLabs", "aviso", "No hay ELEVENLABS_API_KEY; solo funcionarán los audios MP3 fijos y la voz de Twilio.", "Agrégala en el archivo .env para usar voces de ElevenLabs.")];
  }
  const salida = [];
  await Promise.all([
    (async () => {
      try {
        const sus = await conTiempo(g.voces.suscripcion(), 9000);
        if (!sus) {
          salida.push(item("eleven-plan", "Créditos de ElevenLabs", "info", "La API key no tiene permiso para ver la suscripción.", "Activa el permiso 'User' en la API key si quieres ver los créditos aquí."));
          return;
        }
        const restantes = sus.limite !== null && sus.usados !== null ? sus.limite - sus.usados : null;
        const estadoPlan = /^(active|trialing|free)$/i.test(sus.estado || "active") ? "ok" : "error";
        let estado = estadoPlan;
        if (estado === "ok" && restantes !== null) estado = restantes < 500 ? "error" : restantes < 5000 ? "aviso" : "ok";
        salida.push(item("eleven-plan", "Créditos de ElevenLabs", estado,
          `Plan ${sus.plan || "?"}${sus.estado ? ` (${sus.estado})` : ""}${restantes !== null ? ` · quedan ${restantes.toLocaleString("es-MX")} de ${sus.limite.toLocaleString("es-MX")} caracteres` : ""}${sus.reinicio ? ` · se renuevan el ${new Date(sus.reinicio).toLocaleDateString("es-MX")}` : ""}`,
          estado === "ok" ? "" : "Recarga o mejora el plan en elevenlabs.io para generar más audios."));
      } catch (err) {
        salida.push(item("eleven-plan", "Créditos de ElevenLabs", "error", `${err.titulo || "Error de ElevenLabs"}: ${err.message}`, err.accion || ""));
      }
    })(),
    (async () => {
      try {
        const voces = await conTiempo(g.voces.listarVoces(true), 12000);
        salida.push(item("eleven-voces", "Voces de ElevenLabs", voces.length ? "ok" : "aviso", `${voces.length} voces disponibles en la cuenta.`, voces.length ? "" : "La cuenta no tiene voces; se mostrarán las voces predeterminadas."));
      } catch (err) {
        salida.push(item("eleven-voces", "Voces de ElevenLabs", "error", `${err.titulo || "Error de ElevenLabs"}: ${err.message}`, err.accion || ""));
      }
    })(),
  ]);
  return salida;
}

function pedirSalud(url) {
  return new Promise((resolve) => {
    const modulo = url.startsWith("https") ? https : http;
    const solicitud = modulo.get(`${url}/api/salud`, { timeout: 4000 }, (respuesta) => {
      let cuerpo = "";
      respuesta.on("data", (t) => { cuerpo += t; if (cuerpo.length > 5000) respuesta.destroy(); });
      respuesta.on("end", () => resolve({ estado: respuesta.statusCode, cuerpo }));
      respuesta.on("close", () => resolve({ estado: respuesta.statusCode, cuerpo }));
    });
    solicitud.on("timeout", () => { solicitud.destroy(); resolve({ error: "tiempo de espera agotado" }); });
    solicitud.on("error", (err) => resolve({ error: err.code || err.message }));
  });
}

async function revisarServidor(g, profundo) {
  const cfg = g.cfg;
  const salida = [];

  if (cfg.usaLocalhost) {
    salida.push(item("url-publica", "Dirección pública", "error", `PUBLIC_BASE_URL es ${cfg.publicBaseUrl}; Twilio no puede llegar a esa dirección.`, "Escribe en el archivo .env la dirección pública del servidor, por ejemplo http://147.182.177.22, y reinicia."));
  } else if (profundo) {
    const r = await pedirSalud(cfg.publicBaseUrl);
    const bien = r.estado === 200 && /"ok"\s*:\s*true/.test(r.cuerpo || "");
    salida.push(bien
      ? item("url-publica", "Dirección pública", "ok", `${cfg.publicBaseUrl} responde correctamente.`, "")
      : item("url-publica", "Dirección pública", "aviso", `El servidor no pudo abrir ${cfg.publicBaseUrl} desde adentro (${r.error || `HTTP ${r.estado}`}). Puede ser normal si el proveedor no permite llamarse a sí mismo.`, "Abre esa dirección desde tu navegador; si carga, Twilio también podrá usarla."));
  } else {
    salida.push(item("url-publica", "Dirección pública", "info", cfg.publicBaseUrl, "Pulsa 'Revisar a fondo' para comprobar que responde."));
  }

  if (!cfg.seguridad.activa) {
    salida.push(item("seguridad", "Acceso al panel", "aviso", "El panel no pide usuario ni contraseña: cualquiera que conozca la dirección puede lanzar llamadas.", "Define PANEL_USUARIO y PANEL_CLAVE en el archivo .env y reinicia."));
  } else if (!/^https:/i.test(cfg.publicBaseUrl)) {
    salida.push(item("seguridad", "Acceso al panel", "info", "Hay contraseña, pero la conexión es HTTP sin cifrar.", "Cuando tengas un dominio, agrega HTTPS (certbot con Nginx)."));
  } else {
    salida.push(item("seguridad", "Acceso al panel", "ok", "El panel está protegido con usuario y contraseña.", ""));
  }

  salida.push(item("firma", "Validación de avisos de Twilio", cfg.twilio.validarFirma ? "ok" : "info",
    cfg.twilio.validarFirma ? "Se verifica la firma de cada aviso que llega de Twilio." : "No se verifica la firma de los avisos (válido para el uso normal).",
    cfg.twilio.validarFirma ? "" : "Activa VALIDAR_FIRMA_TWILIO=true para rechazar avisos falsos."));

  const memoria = process.memoryUsage();
  const rss = Math.round(memoria.rss / 1048576);
  const totalMb = Math.round(os.totalmem() / 1048576);
  salida.push(item("memoria", "Memoria del servidor", rss > totalMb * 0.8 ? "aviso" : "ok", `El sistema usa ${rss} MB de ${totalMb} MB · Node ${process.version} · activo hace ${Math.round(process.uptime() / 60)} min.`, rss > totalMb * 0.8 ? "Reduce la cantidad de campañas guardadas (MAX_CAMPANAS) o reinicia con pm2 restart." : ""));

  try {
    const info = fs.statfsSync(cfg.dirDatos);
    const libreMb = Math.round((info.bavail * info.bsize) / 1048576);
    salida.push(item("disco", "Espacio en disco", libreMb < 200 ? "error" : libreMb < 1000 ? "aviso" : "ok", `${libreMb.toLocaleString("es-MX")} MB libres.`, libreMb < 1000 ? "Libera espacio: borra campañas viejas desde Historial o reduce RETENCION_AUDIOS_DIAS." : ""));
  } catch (err) { }

  try {
    fs.accessSync(cfg.dirDatos, fs.constants.W_OK);
    salida.push(item("datos", "Carpeta de datos", "ok", `${cfg.dirDatos} · ${g.campanas.size} campañas guardadas.`, ""));
  } catch (err) {
    salida.push(item("datos", "Carpeta de datos", "error", `No se puede escribir en ${cfg.dirDatos}.`, "Revisa los permisos de la carpeta; sin ella no se guardan las campañas."));
  }
  return salida;
}

async function diagnosticar(g, profundo) {
  const [twilio, eleven, servidor] = await Promise.all([revisarTwilio(g), revisarElevenLabs(g), revisarServidor(g, profundo)]);
  const items = [...twilio, ...eleven, ...servidor];
  const peor = items.some((x) => x.estado === "error") ? "error" : items.some((x) => x.estado === "aviso") ? "aviso" : "ok";
  return { ts: Date.now(), profundo: Boolean(profundo), estado: peor, items };
}

module.exports = { diagnosticar, conTiempo };
