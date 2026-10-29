"use strict";
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idCorto(bytes = 3) {
  return crypto.randomBytes(bytes).toString("hex");
}

function limpiarTexto(valor, maximo) {
  const texto = String(valor === undefined || valor === null ? "" : valor)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return maximo ? texto.slice(0, maximo) : texto;
}

function quitarAcentos(texto) {
  return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slug(texto, maximo = 40) {
  const base = quitarAcentos(texto).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || "x").slice(0, maximo);
}

function escaparXml(texto) {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function esUrlHttp(texto) {
  try {
    const url = new URL(String(texto));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (e) {
    return false;
  }
}

function resultadoInvalido(original, motivo) {
  return { ok: false, motivo, original };
}

function normalizarNumero(crudo, codigoPais = "52") {
  const original = String(crudo === undefined || crudo === null ? "" : crudo).trim();
  if (!original) return resultadoInvalido(original, "Número vacío");

  let texto = original.replace(/\s*(ext\.?|extensi[oó]n|x)\s*\d+\s*$/i, "");
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(texto.replace(/\s/g, ""))) {
    return resultadoInvalido(original, "Excel lo convirtió a notación científica; vuelve a exportar el número como texto");
  }

  const conservado = texto.replace(/[^\d+]/g, "");
  let internacional = conservado.startsWith("+");
  let digitos = conservado.replace(/\+/g, "");
  if (!internacional && digitos.startsWith("00")) {
    internacional = true;
    digitos = digitos.slice(2);
  }
  if (!digitos) return resultadoInvalido(original, "No contiene dígitos");

  let numero = null;
  if (internacional) {
    if (digitos.length === 13 && digitos.startsWith("521")) digitos = `52${digitos.slice(3)}`;
    if (digitos.startsWith("52") && digitos.length !== 12) {
      return resultadoInvalido(original, `Número mexicano con ${digitos.length - 2} dígitos; deben ser 10 después del +52`);
    }
    if (digitos.length < 8 || digitos.length > 15) {
      return resultadoInvalido(original, `Longitud inválida (${digitos.length} dígitos)`);
    }
    numero = `+${digitos}`;
  } else if (digitos.length === 10) {
    numero = `+${codigoPais}${digitos}`;
  } else if (digitos.length === 12 && digitos.startsWith("52")) {
    numero = `+${digitos}`;
  } else if (digitos.length === 13 && digitos.startsWith("521")) {
    numero = `+52${digitos.slice(3)}`;
  } else if (digitos.length === 11 && digitos.startsWith("1")) {
    numero = `+${digitos}`;
  } else if (digitos.length < 10) {
    return resultadoInvalido(original, `Faltan dígitos (tiene ${digitos.length}, se esperan 10)`);
  } else if (digitos.length > 15) {
    return resultadoInvalido(original, `Demasiados dígitos (${digitos.length})`);
  } else {
    return resultadoInvalido(original, `Longitud no reconocida (${digitos.length} dígitos). Escríbelo con + y código de país`);
  }

  if (numero.startsWith("+52")) {
    const nacional = numero.slice(3);
    if (!/^[2-9]\d{9}$/.test(nacional)) return resultadoInvalido(original, "Lada inválida (el número no puede empezar con 0 o 1)");
  }
  const soloDigitos = numero.slice(1);
  if (/^(\d)\1+$/.test(soloDigitos) || /1234567890|0123456789/.test(soloDigitos)) {
    return resultadoInvalido(original, "Número de prueba o repetido");
  }
  return { ok: true, numero, original };
}

const ALIAS_NUMERO = ["numero", "num", "telefono", "tel", "celular", "movil", "phone", "number", "whatsapp", "to", "cel"];
const ALIAS_NOMBRE = ["nombre", "name", "nombrecompleto", "contacto", "persona", "cliente"];

function claveColumna(texto) {
  return quitarAcentos(texto).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parecerTelefono(celda) {
  return String(celda || "").replace(/\D/g, "").length >= 7;
}

function detectarDelimitador(texto) {
  const linea = texto.split(/\r?\n/).find((l) => l.trim()) || "";
  const cuentas = [",", ";", "\t", "|"].map((d) => [d, linea.split(d).length - 1]);
  cuentas.sort((a, b) => b[1] - a[1]);
  return cuentas[0][1] > 0 ? cuentas[0][0] : ",";
}

function filasDeTexto(texto) {
  const filas = [];
  String(texto || "").split(/\r?\n/).forEach((linea) => {
    const limpia = linea.trim();
    if (!limpia) return;
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(limpia) && /[,;]/.test(limpia) && !/\t|\s{2,}/.test(limpia)) {
      limpia.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).forEach((n) => filas.push([n, ""]));
      return;
    }
    const m = limpia.match(/^([+()\d][\d\s().\-+]*?)\s*(?:\t|[,;]|\s{2,})\s*(.+)$/)
      || limpia.match(/^([+()\d][\d\s().\-+]*?)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ].*)$/);
    if (m) filas.push([m[1], m[2]]);
    else filas.push([limpia, ""]);
  });
  return filas;
}

function filasDeCsv(texto) {
  const limpio = String(texto || "").replace(/^﻿/, "");
  if (!limpio.trim()) return [];
  const filas = parse(limpio, {
    delimiter: detectarDelimitador(limpio),
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });
  if (!filas.length) return [];
  const primera = filas[0].map(String);
  const esEncabezado = !primera.some(parecerTelefono);
  let iNumero = 0;
  let iNombre = primera.length > 1 ? 1 : -1;
  let inicio = 0;
  if (esEncabezado) {
    inicio = 1;
    const claves = primera.map(claveColumna);
    const encontradoNumero = claves.findIndex((c) => ALIAS_NUMERO.includes(c));
    const encontradoNombre = claves.findIndex((c) => ALIAS_NOMBRE.includes(c));
    iNumero = encontradoNumero >= 0 ? encontradoNumero : 0;
    iNombre = encontradoNombre >= 0 ? encontradoNombre : (iNumero === 0 && primera.length > 1 ? 1 : -1);
  }
  return filas.slice(inicio).map((fila) => [fila[iNumero], iNombre >= 0 ? fila[iNombre] : ""]);
}

function parsearContactos(entrada, opciones = {}) {
  const codigoPais = opciones.codigoPais || "52";
  let filas;
  if (entrada.csvBuffer || entrada.csvTexto) {
    const crudo = entrada.csvTexto !== undefined ? entrada.csvTexto : entrada.csvBuffer.toString("utf8");
    filas = filasDeCsv(crudo);
  } else {
    filas = filasDeTexto(entrada.texto);
  }

  const contactos = [];
  const invalidos = [];
  const duplicados = [];
  const vistos = new Set();
  const motivos = {};

  filas.forEach((fila, indice) => {
    const nombre = limpiarTexto(fila[1], 80);
    const resultado = normalizarNumero(fila[0], codigoPais);
    const numeroFila = indice + 1;
    if (!resultado.ok) {
      invalidos.push({ fila: numeroFila, original: limpiarTexto(fila[0], 60), nombre, motivo: resultado.motivo });
      const clave = resultado.motivo.replace(/\d+/g, "N");
      motivos[clave] = (motivos[clave] || 0) + 1;
      return;
    }
    if (vistos.has(resultado.numero)) {
      duplicados.push({ fila: numeroFila, numero: resultado.numero, nombre });
      return;
    }
    vistos.add(resultado.numero);
    contactos.push({ numero: resultado.numero, nombre, original: resultado.original, fila: numeroFila });
  });

  return { contactos, invalidos, duplicados, totalFilas: filas.length, motivosInvalidos: motivos };
}

function construirMensaje(plantilla, nombre) {
  return String(plantilla || "")
    .replace(/\{nombre\}/gi, nombre || "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function celdaCsv(valor) {
  if (valor === undefined || valor === null) return "";
  let texto = valor instanceof Date ? valor.toISOString() : String(valor);
  if (/^[=@\t\r]/.test(texto) || /^[+\-](?!\d)/.test(texto)) texto = `'${texto}`;
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function filaCsv(valores) {
  return valores.map(celdaCsv).join(",");
}

function construirCsv(encabezados, filas) {
  const lineas = [filaCsv(encabezados)];
  filas.forEach((fila) => lineas.push(filaCsv(fila)));
  return `﻿${lineas.join("\r\n")}\r\n`;
}

const cacheZonas = new Map();
const cacheFormatos = new Map();

function zonaValida(zona, respaldo = "America/Mexico_City") {
  const clave = String(zona || "");
  if (cacheZonas.has(clave)) return cacheZonas.get(clave);
  let elegida = "UTC";
  for (const candidata of [clave, respaldo, "UTC"]) {
    if (!candidata) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidata });
      elegida = candidata;
      break;
    } catch (e) { }
  }
  cacheZonas.set(clave, elegida);
  return elegida;
}

function formateador(tipo, zona, localidad, opciones) {
  const clave = `${tipo}|${zona}`;
  let f = cacheFormatos.get(clave);
  if (!f) {
    f = new Intl.DateTimeFormat(localidad, { timeZone: zona, ...opciones });
    cacheFormatos.set(clave, f);
  }
  return f;
}

function formatoFecha(ms, zona) {
  if (!ms) return "";
  const z = zonaValida(zona);
  const partes = formateador("fecha", z, "sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(ms));
  return partes.replace(",", "");
}

function horaLocal(ms, zona) {
  if (!ms) return null;
  const z = zonaValida(zona);
  const hora = formateador("hora", z, "en-GB", { hour: "2-digit", hour12: false }).format(new Date(ms));
  return parseInt(hora, 10) % 24;
}

class Limitador {
  constructor(porSegundo) {
    this.fijar(porSegundo);
    this.proximo = 0;
  }

  fijar(porSegundo) {
    this.porSegundo = Math.max(0.1, Number(porSegundo) || 1);
    this.intervalo = 1000 / this.porSegundo;
  }

  async tomar() {
    const ahora = Date.now();
    const inicio = Math.max(ahora, this.proximo);
    this.proximo = inicio + this.intervalo;
    if (inicio > ahora) await esperar(inicio - ahora);
  }
}

async function enParalelo(lista, limite, funcion) {
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < lista.length) {
      const indice = siguiente;
      siguiente += 1;
      await funcion(lista[indice], indice);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limite), lista.length) }, trabajador));
}

module.exports = {
  zonaValida,
  esperar, idCorto, limpiarTexto, quitarAcentos, slug, escaparXml, esUrlHttp,
  normalizarNumero, parsearContactos, construirMensaje,
  celdaCsv, filaCsv, construirCsv, formatoFecha, horaLocal, Limitador, enParalelo,
};
