"use strict";
const fs = require("fs");
const zlib = require("zlib");

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(buffer, previo = 0) {
  let c = (previo ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buffer.length; i += 1) c = TABLA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const cacheCrc = new Map();

function crcDeArchivo(ruta, tamano, mtimeMs) {
  const clave = `${ruta}|${tamano}|${mtimeMs}`;
  if (cacheCrc.has(clave)) return Promise.resolve(cacheCrc.get(clave));
  return new Promise((ok, fallo) => {
    let crc = 0;
    const lector = fs.createReadStream(ruta);
    lector.on("data", (trozo) => { crc = crc32(trozo, crc); });
    lector.on("error", fallo);
    lector.on("end", () => {
      if (cacheCrc.size > 20000) cacheCrc.clear();
      cacheCrc.set(clave, crc);
      ok(crc);
    });
  });
}

function fechaDos(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha || Date.now());
  const anio = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((anio - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function limpiarNombre(nombre) {
  return String(nombre).replace(/\\/g, "/").replace(/^\/+/, "").replace(/[\u0000-\u001f]/g, "");
}

function entradaDeBuffer(def) {
  const bruto = Buffer.isBuffer(def.buffer) ? def.buffer : Buffer.from(def.texto === undefined ? "" : String(def.texto), "utf8");
  const quiereComprimir = def.comprimir !== false && bruto.length > 200;
  const comprimido = quiereComprimir ? zlib.deflateRawSync(bruto, { level: 6 }) : null;
  const usar = comprimido && comprimido.length < bruto.length;
  const f = fechaDos(def.fecha);
  return {
    nombre: Buffer.from(limpiarNombre(def.nombre), "utf8"),
    metodo: usar ? 8 : 0,
    crc: crc32(bruto),
    tam: bruto.length,
    tamC: usar ? comprimido.length : bruto.length,
    datos: usar ? comprimido : bruto,
    ruta: null,
    hora: f.hora,
    dia: f.dia,
    desplazamiento: 0,
  };
}

async function entradaDeArchivo(def) {
  const info = await fs.promises.stat(def.ruta);
  const crc = await crcDeArchivo(def.ruta, info.size, info.mtimeMs);
  const f = fechaDos(def.fecha || info.mtime);
  return {
    nombre: Buffer.from(limpiarNombre(def.nombre), "utf8"),
    metodo: 0, crc, tam: info.size, tamC: info.size, datos: null, ruta: def.ruta,
    hora: f.hora, dia: f.dia, desplazamiento: 0,
  };
}

async function prepararEntradas(defs) {
  const lista = [];
  for (const def of defs) {
    if (def.ruta) {
      try {
        lista.push(await entradaDeArchivo(def));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    } else {
      lista.push(entradaDeBuffer(def));
    }
  }
  return lista;
}

function cabeceraLocal(e) {
  const b = Buffer.alloc(30 + e.nombre.length);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4);
  b.writeUInt16LE(0x0800, 6);
  b.writeUInt16LE(e.metodo, 8);
  b.writeUInt16LE(e.hora, 10);
  b.writeUInt16LE(e.dia, 12);
  b.writeUInt32LE(e.crc, 14);
  b.writeUInt32LE(e.tamC, 18);
  b.writeUInt32LE(e.tam, 22);
  b.writeUInt16LE(e.nombre.length, 26);
  b.writeUInt16LE(0, 28);
  e.nombre.copy(b, 30);
  return b;
}

function cabeceraCentral(e) {
  const b = Buffer.alloc(46 + e.nombre.length);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(0x0314, 4);
  b.writeUInt16LE(20, 6);
  b.writeUInt16LE(0x0800, 8);
  b.writeUInt16LE(e.metodo, 10);
  b.writeUInt16LE(e.hora, 12);
  b.writeUInt16LE(e.dia, 14);
  b.writeUInt32LE(e.crc, 16);
  b.writeUInt32LE(e.tamC, 20);
  b.writeUInt32LE(e.tam, 24);
  b.writeUInt16LE(e.nombre.length, 28);
  b.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
  b.writeUInt32LE(e.desplazamiento, 42);
  e.nombre.copy(b, 46);
  return b;
}

function finDeDirectorio(cantidad, tamanoDir, desplazamientoDir) {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(cantidad, 8);
  b.writeUInt16LE(cantidad, 10);
  b.writeUInt32LE(tamanoDir, 12);
  b.writeUInt32LE(desplazamientoDir, 16);
  return b;
}

function medir(entradas) {
  if (entradas.length > 65000) throw new Error("Demasiados archivos para un solo ZIP");
  let pos = 0;
  let central = 0;
  for (const e of entradas) {
    e.desplazamiento = pos;
    pos += 30 + e.nombre.length + e.tamC;
    central += 46 + e.nombre.length;
  }
  const total = pos + central + 22;
  if (total >= 0xffffffff) throw new Error("El ZIP supera los 4 GB; descárgalo por partes");
  return total;
}

function crearZipBuffer(defs) {
  const entradas = defs.map((d) => entradaDeBuffer(d));
  medir(entradas);
  const partes = [];
  let posicion = 0;
  entradas.forEach((e) => { partes.push(cabeceraLocal(e), e.datos); posicion += 30 + e.nombre.length + e.tamC; });
  const central = entradas.map(cabeceraCentral);
  const tamanoCentral = central.reduce((s, b) => s + b.length, 0);
  return Buffer.concat([...partes, ...central, finDeDirectorio(entradas.length, tamanoCentral, posicion)]);
}

function escribir(destino, buffer) {
  if (destino.write(buffer)) return Promise.resolve();
  return new Promise((ok, fallo) => {
    const limpiar = () => {
      destino.off("drain", alDrenar);
      destino.off("close", alCerrar);
      destino.off("error", alCerrar);
    };
    const alDrenar = () => { limpiar(); ok(); };
    const alCerrar = () => { limpiar(); fallo(new Error("Conexión cerrada")); };
    destino.once("drain", alDrenar);
    destino.once("close", alCerrar);
    destino.once("error", alCerrar);
  });
}

function volcarArchivo(ruta, destino, esperado) {
  return new Promise((ok, fallo) => {
    const lector = fs.createReadStream(ruta);
    let bytes = 0;
    const alCerrar = () => { lector.destroy(); fallo(new Error("Conexión cerrada")); };
    destino.once("close", alCerrar);
    lector.on("data", (trozo) => { bytes += trozo.length; });
    lector.on("error", (err) => { destino.off("close", alCerrar); fallo(err); });
    lector.on("end", () => {
      destino.off("close", alCerrar);
      if (bytes !== esperado) fallo(new Error(`El archivo ${ruta} cambió mientras se descargaba`));
      else ok();
    });
    lector.pipe(destino, { end: false });
  });
}

async function transmitir(entradas, destino) {
  medir(entradas);
  let posicion = 0;
  for (const e of entradas) {
    await escribir(destino, cabeceraLocal(e));
    if (e.datos) await escribir(destino, e.datos);
    else await volcarArchivo(e.ruta, destino, e.tam);
    posicion += 30 + e.nombre.length + e.tamC;
  }
  const central = entradas.map(cabeceraCentral);
  const tamanoCentral = central.reduce((s, b) => s + b.length, 0);
  await escribir(destino, Buffer.concat([...central, finDeDirectorio(entradas.length, tamanoCentral, posicion)]));
}

module.exports = { crc32, crcDeArchivo, crearZipBuffer, prepararEntradas, medir, transmitir };
