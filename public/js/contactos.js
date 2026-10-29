import { h, vaciar, icono, guardarArchivo, antirrebote } from "./dom.js";
import { num, bytes, telefono, plural } from "./fmt.js";

const LIMITE_BYTES = 3 * 1024 * 1024;
const EJEMPLO_CSV = "numero,nombre\r\n+526561234567,María López\r\n6561234568,Juan Pérez\r\n656 123 4569,\r\n";

async function leerArchivo(archivo) {
  if (/\.(xlsx?|ods)$/i.test(archivo.name)) {
    throw new Error("Ese es un archivo de Excel. Ábrelo y guárdalo como «CSV (delimitado por comas)», luego súbelo de nuevo.");
  }
  if (archivo.size > LIMITE_BYTES) throw new Error(`El archivo pesa ${bytes(archivo.size)} y el máximo es 3 MB. Divídelo en partes.`);
  const buffer = await archivo.arrayBuffer();
  const cabecera = new Uint8Array(buffer.slice(0, 4));
  if (cabecera[0] === 0x50 && cabecera[1] === 0x4b) throw new Error("Ese archivo está comprimido (parece un Excel). Guárdalo como CSV y súbelo de nuevo.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (err) {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function crearCargadorContactos({ codigoPais = "52", alCambiar = () => {}, tipo = "llamadas" }) {
  const estado = { csvTexto: "", nombreArchivo: "", bytes: 0, modo: "archivo", codigoPais, previa: null, error: "", cargando: false };

  const entrada = h("input", { type: "file", accept: ".csv,.txt,text/csv,text/plain", class: "solo-lectores", tabindex: "-1", "aria-hidden": "true" });
  const zona = h("div", { class: "zona-carga", role: "group", "aria-label": "Subir archivo de contactos" });
  const tarjetaArchivo = h("div", { class: "archivo-cargado", hidden: true });
  const area = h("textarea", { class: "area", rows: 6, placeholder: "+526561234567, María López\n6561234568, Juan Pérez\n656 123 4569", "aria-label": "Números de teléfono, uno por línea", spellcheck: false });
  const cajaPegar = h("div", { class: "campo", hidden: true }, area, h("p", { class: "campo__ayuda" }, "Un contacto por línea: el número y, si quieres, el nombre separado por coma."));
  const zonaPrevia = h("div", { class: "seccion", "aria-live": "polite" });
  const campoPais = h("input", { class: "entrada num", id: "campo-pais", inputmode: "numeric", maxlength: 3, value: codigoPais, "aria-describedby": "ayuda-pais", style: { maxWidth: "110px" } });

  const botonArchivo = h("button", { type: "button", class: "segmentado__boton", "aria-pressed": "true", on: { click: () => cambiarModo("archivo") } }, icono("subir"), "Subir archivo");
  const botonPegar = h("button", { type: "button", "aria-pressed": "false", on: { click: () => cambiarModo("pegar") } }, icono("lista"), "Pegar números");

  function cambiarModo(modo) {
    estado.modo = modo;
    botonArchivo.setAttribute("aria-pressed", String(modo === "archivo"));
    botonPegar.setAttribute("aria-pressed", String(modo === "pegar"));
    cajaPegar.hidden = modo !== "pegar";
    zona.hidden = modo !== "archivo" || Boolean(estado.nombreArchivo);
    tarjetaArchivo.hidden = modo !== "archivo" || !estado.nombreArchivo;
    estado.csvTexto = modo === "pegar" ? area.value : (estado.nombreArchivo ? estado.csvTexto : "");
    estado.previa = null; estado.error = "";
    pintarPrevia();
    alCambiar();
  }

  async function recibirArchivo(archivo) {
    if (!archivo) return;
    estado.error = "";
    try {
      estado.csvTexto = await leerArchivo(archivo);
      estado.nombreArchivo = archivo.name;
      estado.bytes = archivo.size;
      zona.hidden = true;
      pintarTarjeta();
      estado.previa = null;
      pintarPrevia();
      alCambiar();
    } catch (err) {
      estado.error = err.message;
      pintarPrevia();
    }
  }

  function quitarArchivo() {
    estado.csvTexto = ""; estado.nombreArchivo = ""; estado.bytes = 0; estado.previa = null; estado.error = "";
    entrada.value = "";
    tarjetaArchivo.hidden = true; zona.hidden = false;
    pintarPrevia();
    alCambiar();
  }

  function pintarTarjeta() {
    vaciar(tarjetaArchivo);
    tarjetaArchivo.hidden = !estado.nombreArchivo;
    if (!estado.nombreArchivo) return;
    tarjetaArchivo.append(
      icono("archivo"),
      h("div", null, h("b", { class: "truncar" }, estado.nombreArchivo), h("span", { class: "pequeno texto-3" }, bytes(estado.bytes))),
      h("button", { type: "button", class: "boton boton--chico", on: { click: () => entrada.click() } }, "Cambiar"),
      h("button", { type: "button", class: "boton boton--chico boton--fantasma boton--icono", "aria-label": "Quitar archivo", on: { click: quitarArchivo } }, icono("x")));
  }

  function construirZona() {
    zona.append(
      h("div", { class: "zona-carga__icono" }, icono("subir")),
      h("strong", null, "Arrastra aquí tu archivo CSV"),
      h("p", null, "Necesita una columna con el teléfono y, si quieres, otra con el nombre. Los números sin código de país se completan con el de abajo. Máximo 3 MB."),
      h("div", { class: "zona-carga__botones" },
        h("button", { type: "button", class: "boton boton--primario", on: { click: () => entrada.click() } }, icono("archivo"), "Elegir archivo"),
        h("button", { type: "button", class: "boton boton--fantasma", on: { click: () => guardarArchivo("contactos_ejemplo.csv", `\uFEFF${EJEMPLO_CSV}`) } }, icono("descargas"), "Descargar formato de ejemplo")));
    ["dragenter", "dragover"].forEach((nombre) => zona.addEventListener(nombre, (ev) => { ev.preventDefault(); zona.classList.add("arrastrando"); }));
    ["dragleave", "drop"].forEach((nombre) => zona.addEventListener(nombre, (ev) => { ev.preventDefault(); zona.classList.remove("arrastrando"); }));
    zona.addEventListener("drop", (ev) => recibirArchivo(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]));
    entrada.addEventListener("change", () => { recibirArchivo(entrada.files && entrada.files[0]); entrada.value = ""; });
  }

  const avisarPegado = antirrebote(() => { estado.csvTexto = area.value; estado.previa = null; estado.error = ""; alCambiar(); }, 450);
  area.addEventListener("input", avisarPegado);
  campoPais.addEventListener("input", () => {
    const limpio = campoPais.value.replace(/\D/g, "").slice(0, 3);
    if (limpio !== campoPais.value) campoPais.value = limpio;
    estado.codigoPais = limpio || codigoPais;
    avisarPegado();
  });

  function dato(etiqueta, valor, clase = "") {
    return h("div", { class: `dato ${clase}`.trim() }, h("span", null, etiqueta), h("b", { class: "num" }, valor));
  }

  function pintarPrevia() {
    vaciar(zonaPrevia);
    if (estado.error) {
      zonaPrevia.append(h("div", { class: "aviso aviso--error", role: "alert" }, icono("error"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, "No se pudo usar ese archivo"), h("span", { class: "aviso__texto" }, estado.error))));
      return;
    }
    if (estado.cargando) {
      zonaPrevia.append(h("div", { class: "datos-fila" }, [0, 1, 2, 3].map(() => h("div", { class: "dato" }, h("div", { class: "esqueleto", style: { height: "14px", width: "60%" } }), h("div", { class: "esqueleto", style: { height: "26px", width: "40%", marginTop: "6px" } })))));
      return;
    }
    const p = estado.previa;
    if (!p) return;
    zonaPrevia.append(h("div", { class: "datos-fila surge" },
      dato(plural(p.validos, "Contacto válido", "Contactos válidos"), num(p.validos)),
      dato("Descartados", num(p.invalidos), p.invalidos ? "dato--alerta" : ""),
      dato("Repetidos", num(p.duplicados), p.duplicados ? "dato--aviso" : ""),
      dato("Con nombre", num(p.conNombre)),
      dato("Sin nombre", num(p.sinNombre))));
    if (p.excedeLimite) {
      zonaPrevia.append(h("div", { class: "aviso aviso--error", role: "alert" }, icono("error"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, "Hay demasiados contactos"), h("span", { class: "aviso__texto" }, `Una campaña admite hasta ${num(p.limite)} contactos y el archivo trae ${num(p.validos)}. Divídelo en partes.`))));
    }
    if (!p.validos) {
      zonaPrevia.append(h("div", { class: "aviso aviso--aviso" }, icono("alerta"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, "No encontré ningún teléfono válido"), h("span", { class: "aviso__texto" }, "Revisa que el archivo tenga una columna con los números y que el código de país sea el correcto."))));
    }
    if (p.muestra && p.muestra.length) {
      zonaPrevia.append(h("div", { class: "tabla-wrap" }, h("table", { class: "tabla" },
        h("thead", null, h("tr", null, h("th", null, "Número"), h("th", null, "Nombre"))),
        h("tbody", null, p.muestra.map((m) => h("tr", null, h("td", { class: "num" }, telefono(m.numero)), h("td", null, m.nombre || h("span", { class: "texto-3" }, "Sin nombre"))))))));
    }
    const motivos = Object.entries(p.motivos || {});
    if (p.invalidos) {
      const lista = (p.ejemplosInvalidos || []).slice(0, 30);
      zonaPrevia.append(h("div", { class: "problemas" },
        h("details", null,
          h("summary", null, icono("alerta", { clase: "texto-3" }), `${num(p.invalidos)} ${plural(p.invalidos, "fila descartada", "filas descartadas")}: ver por qué`),
          h("ul", null,
            motivos.map(([motivo, cantidad]) => h("li", null, h("span", null, motivo), h("b", null, num(cantidad)))),
            lista.length ? h("li", { class: "texto-3" }, h("span", null, "Ejemplos (fila del archivo)")) : null,
            lista.map((x) => h("li", null, h("code", null, `Fila ${x.fila}: ${x.original || "(vacía)"}`), h("span", null, x.motivo)))))));
    }
  }

  construirZona();
  const campoPaisCaja = h("div", { class: "campo" },
    h("label", { for: "campo-pais" }, "Código de país"),
    h("div", { class: "cinta" }, h("span", { class: "texto-2" }, "+"), campoPais),
    h("p", { class: "campo__ayuda", id: "ayuda-pais" }, "Se agrega a los números que no empiezan con +. México es 52."));

  const el = h("div", { class: "seccion" },
    h("div", { class: "cinta" }, h("div", { class: "segmentado", role: "group", "aria-label": "Cómo cargar los contactos" }, botonArchivo, botonPegar)),
    zona, tarjetaArchivo, cajaPegar, entrada, campoPaisCaja, zonaPrevia);

  return {
    el,
    estado,
    mostrarPrevia(previa) { estado.previa = previa; estado.cargando = false; estado.error = ""; pintarPrevia(); },
    mostrarError(mensaje) { estado.error = mensaje; estado.cargando = false; pintarPrevia(); },
    cargando(si) { estado.cargando = si; if (si) pintarPrevia(); },
    usarTexto(csv, etiqueta) {
      cambiarModo("pegar");
      area.value = csv;
      estado.csvTexto = csv;
      if (etiqueta) { cajaPegar.querySelector(".campo__ayuda").textContent = etiqueta; }
      alCambiar();
    },
    tieneContactos: () => (estado.modo === "pegar" ? Boolean(area.value.trim()) : Boolean(estado.csvTexto.trim())),
    cuerpoContactos() {
      if (estado.modo !== "pegar") return { csvTexto: estado.csvTexto };
      const lineas = area.value.split(/\r?\n/);
      const primera = lineas.findIndex((l) => l.trim());
      if (primera >= 0 && lineas[primera].replace(/\D/g, "").length < 7) lineas.splice(primera, 1);
      return { texto: lineas.join("\n") };
    },
    codigoPais: () => estado.codigoPais,
    limpiar() { area.value = ""; quitarArchivo(); },
  };
}
