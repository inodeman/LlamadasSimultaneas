"use strict";
const zlib = require("zlib");
const { ErrorElevenLabs } = require("../elevenlabs");
const { explicarErrorTwilio } = require("./errores");

const asincrono = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function enviarJson(req, res, datos, estado = 200) {
  const cuerpo = Buffer.from(JSON.stringify(datos));
  res.status(estado).set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  if (cuerpo.length > 2048 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    zlib.gzip(cuerpo, (err, comprimido) => {
      if (err) return res.end(cuerpo);
      res.set({ "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      return res.end(comprimido);
    });
  } else {
    res.end(cuerpo);
  }
}

function limitador(maximo, ventanaMs) {
  const marcas = [];
  return (req, res, next) => {
    const ahora = Date.now();
    while (marcas.length && ahora - marcas[0] > ventanaMs) marcas.shift();
    if (marcas.length >= maximo) {
      res.status(429).json({ error: "Demasiadas solicitudes seguidas. Espera unos segundos e inténtalo de nuevo." });
      return;
    }
    marcas.push(ahora);
    next();
  };
}

function aRespuesta(err) {
  if (err instanceof ErrorElevenLabs) {
    const http = err.http && err.http >= 400 && err.http < 500 && err.http !== 401 && err.http !== 403 ? err.http : 502;
    return { status: http, cuerpo: { error: err.message, titulo: err.titulo, accion: err.accion, codigo: err.codigo, fuente: "elevenlabs" } };
  }
  if (err && err.type === "entity.too.large") return { status: 413, cuerpo: { error: "La solicitud es demasiado grande. Divide el archivo de contactos en partes." } };
  if (err && err.type === "entity.parse.failed") return { status: 400, cuerpo: { error: "La solicitud no se pudo leer (JSON no válido)." } };
  if (err && err.moreInfo !== undefined) {
    const inc = explicarErrorTwilio(err);
    return { status: 502, cuerpo: { error: `${inc.titulo}: ${inc.detalle}`, titulo: inc.titulo, accion: inc.accion, codigo: inc.codigo, fuente: "twilio" } };
  }
  if (err && err.status && err.status >= 400 && err.status < 500) {
    const cuerpo = { error: err.message };
    ["codigo", "motivos", "ejemplosInvalidos", "campanaId", "titulo", "accion"].forEach((k) => {
      if (err[k] !== undefined) cuerpo[k] = err[k];
    });
    return { status: err.status, cuerpo };
  }
  return { status: 500, cuerpo: { error: "Error interno del servidor.", detalle: err && err.message ? err.message : String(err) } };
}

function manejarError(err, req, res, next) {
  const { status, cuerpo } = aRespuesta(err);
  if (status >= 500) console.error(`Error en ${req.method} ${req.originalUrl}: ${err && err.stack ? err.stack : err}`);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(status).json(cuerpo);
}

function cabecerasDescarga(res, nombre, tipo, tamano) {
  const ascii = String(nombre).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const cabeceras = {
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    "Cache-Control": "no-store",
  };
  if (tamano !== undefined && tamano !== null) cabeceras["Content-Length"] = String(tamano);
  res.set(cabeceras);
}

module.exports = { asincrono, enviarJson, limitador, manejarError, cabecerasDescarga, aRespuesta };
