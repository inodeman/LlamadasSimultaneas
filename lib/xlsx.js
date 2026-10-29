"use strict";
const { crearZipBuffer } = require("./zip");

const E = {
  normal: 0, encabezado: 1, fecha: 2, moneda: 3, entero: 4, porcentaje: 5, titulo: 6, etiqueta: 7,
  ajustar: 8, miles: 9, verde: 10, ambar: 11, rojo: 12, azul: 13, gris: 14, subtitulo: 15, decimal: 16,
  texto: 17, etiquetaGris: 18,
};

const INVALIDOS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const SUBROGADOS_SUELTOS = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function limpiar(texto) {
  return String(texto).replace(INVALIDOS, "").replace(SUBROGADOS_SUELTOS, "");
}

function xml(texto) {
  return limpiar(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function letraColumna(indice) {
  let n = indice + 1;
  let letras = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

const formateadores = new Map();

function serialLocal(ms, zona) {
  if (!ms) return null;
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formateadores.set(zona, f);
  }
  const p = {};
  f.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return local / 86400000 + 25569;
}

function celda(valor, estilo, formula) {
  return { v: valor, e: estilo, f: formula };
}

function xmlCelda(ref, dato) {
  let v = dato;
  let e = null;
  let f = null;
  if (dato !== null && typeof dato === "object" && !(dato instanceof Date) && Object.prototype.hasOwnProperty.call(dato, "v")) {
    v = dato.v;
    e = dato.e === undefined ? null : dato.e;
    f = dato.f || null;
  }
  const s = e !== null && e !== 0 ? ` s="${e}"` : "";
  if (f) {
    const formula = `<f>${xml(f)}</f>`;
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}>${formula}<v>${v}</v></c>`;
    if (typeof v === "string") return `<c r="${ref}"${s} t="str">${formula}<v>${xml(v)}</v></c>`;
    return `<c r="${ref}"${s}>${formula}</c>`;
  }
  if (v === null || v === undefined || v === "") return e ? `<c r="${ref}"${s}/>` : "";
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : "";
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  const texto = limpiar(v).slice(0, 32000);
  const espacios = /^\s|\s$|\n/.test(texto) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t${espacios}>${xml(texto)}</t></is></c>`;
}

function xmlHoja(hoja) {
  const columnas = hoja.columnas || [];
  const filas = hoja.filas || [];
  const conEncabezado = columnas.some((c) => c.titulo !== undefined);
  const todas = [];
  if (conEncabezado) todas.push(columnas.map((c) => celda(c.titulo === undefined ? "" : c.titulo, E.encabezado)));
  filas.forEach((f) => todas.push(f));

  let maxColumna = columnas.length;
  todas.forEach((f) => { if (f.length > maxColumna) maxColumna = f.length; });
  const ultimaFila = Math.max(1, todas.length);

  const partes = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
  if (hoja.color) partes.push(`<sheetPr><tabColor rgb="${hoja.color}"/></sheetPr>`);
  partes.push(`<dimension ref="A1:${letraColumna(Math.max(0, maxColumna - 1))}${ultimaFila}"/>`);

  const congelarFilas = hoja.congelar && hoja.congelar.filas ? hoja.congelar.filas : 0;
  const congelarColumnas = hoja.congelar && hoja.congelar.columnas ? hoja.congelar.columnas : 0;
  let vista = '<sheetViews><sheetView workbookViewId="0"';
  if (hoja.sinCuadricula) vista += ' showGridLines="0"';
  if (hoja.activa) vista += ' tabSelected="1"';
  vista += ">";
  if (congelarFilas || congelarColumnas) {
    const celdaSuperior = `${letraColumna(congelarColumnas)}${congelarFilas + 1}`;
    const panel = congelarFilas && congelarColumnas ? "bottomRight" : congelarFilas ? "bottomLeft" : "topRight";
    vista += `<pane${congelarColumnas ? ` xSplit="${congelarColumnas}"` : ""}${congelarFilas ? ` ySplit="${congelarFilas}"` : ""} topLeftCell="${celdaSuperior}" activePane="${panel}" state="frozen"/>`;
    vista += `<selection pane="${panel}"/>`;
  }
  vista += "</sheetView></sheetViews>";
  partes.push(vista);
  partes.push('<sheetFormatPr defaultRowHeight="15"/>');

  if (columnas.length) {
    partes.push("<cols>");
    columnas.forEach((c, i) => partes.push(`<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 14}" customWidth="1"/>`));
    partes.push("</cols>");
  }

  partes.push("<sheetData>");
  todas.forEach((fila, k) => {
    const numero = k + 1;
    const alto = hoja.altos && hoja.altos[k] ? hoja.altos[k] : (conEncabezado && k === 0 ? 30 : 0);
    const atributos = alto ? ` ht="${alto}" customHeight="1"` : "";
    let celdas = "";
    for (let j = 0; j < fila.length; j += 1) {
      const dato = fila[j];
      if (dato === undefined || dato === null) continue;
      let dd = dato;
      const colEstilo = columnas[j] && columnas[j].estilo !== undefined && !(conEncabezado && k === 0) ? columnas[j].estilo : null;
      if (colEstilo !== null && (typeof dato !== "object" || dato instanceof Date)) dd = celda(dato instanceof Date ? serialLocal(dato.getTime(), "UTC") : dato, colEstilo);
      else if (colEstilo !== null && typeof dato === "object" && dato.e === undefined) dd = { ...dato, e: colEstilo };
      celdas += xmlCelda(`${letraColumna(j)}${numero}`, dd);
    }
    partes.push(`<row r="${numero}"${atributos}>${celdas}</row>`);
  });
  partes.push("</sheetData>");

  if (hoja.autofiltro && conEncabezado && filas.length) {
    partes.push(`<autoFilter ref="A1:${letraColumna(Math.max(0, columnas.length - 1))}${todas.length}"/>`);
  }
  if (hoja.combinar && hoja.combinar.length) {
    partes.push(`<mergeCells count="${hoja.combinar.length}">${hoja.combinar.map((r) => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>`);
  }
  partes.push('<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  partes.push(`<pageSetup orientation="${hoja.horizontal === false ? "portrait" : "landscape"}" fitToHeight="0"/>`);
  partes.push("</worksheet>");
  return partes.join("");
}

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm:ss"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.0000"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="5">
<font><sz val="11"/><color rgb="FF202124"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF202124"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="18"/><color rgb="FF1B6EF3"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5F6368"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B6EF3"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF7E0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE8E6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D5DD"/></left><right style="thin"><color rgb="FFD0D5DD"/></right><top style="thin"><color rgb="FFD0D5DD"/></top><bottom style="thin"><color rgb="FFD0D5DD"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function nombreHoja(nombre, usados) {
  let base = limpiar(nombre).replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Hoja";
  let candidato = base;
  let k = 2;
  while (usados.has(candidato.toLowerCase())) {
    const sufijo = ` ${k}`;
    candidato = base.slice(0, 31 - sufijo.length) + sufijo;
    k += 1;
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

function crearXlsx({ titulo, creador, hojas }) {
  const usados = new Set();
  const nombres = hojas.map((h) => nombreHoja(h.nombre, usados));
  hojas[0].activa = true;

  const archivos = [];
  archivos.push({
    nombre: "[Content_Types].xml",
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  });
  archivos.push({
    nombre: "_rels/.rels",
    texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
  });
  archivos.push({
    nombre: "docProps/core.xml",
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(titulo || "Reporte")}</dc:title><dc:creator>${xml(creador || "Llamadas Simultáneas")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
  });
  archivos.push({
    nombre: "docProps/app.xml",
    texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Llamadas Simultaneas</Application></Properties>',
  });
  archivos.push({
    nombre: "xl/workbook.xml",
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  });
  archivos.push({
    nombre: "xl/_rels/workbook.xml.rels",
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  });
  archivos.push({ nombre: "xl/styles.xml", texto: ESTILOS_XML });
  hojas.forEach((hoja, i) => archivos.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, texto: xmlHoja(hoja) }));
  return crearZipBuffer(archivos);
}

module.exports = { crearXlsx, celda, E, serialLocal, letraColumna };
