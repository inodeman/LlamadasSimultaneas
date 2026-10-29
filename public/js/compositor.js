import { h, vaciar, icono, aviso, modal, antirrebote, agregar } from "./dom.js";
import { api } from "./api.js";
import { app, memoria, irA, cargarCampanas } from "./estado.js";
import { num, pct, durLarga, plural, telefono } from "./fmt.js";
import { crearCargadorContactos } from "./contactos.js";
import { crearSelectorVoces } from "./voces.js";
import { campoRango, interruptor, campoTexto, campoMensaje } from "./campos.js";

const renderMensaje = (plantilla, nombre) => String(plantilla || "")
  .replace(/\{nombre\}/gi, nombre || "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();

export function montarCompositor(contenedor, tipo) {
  const esLlamada = tipo === "llamadas";
  let iniciado = false;
  let enviando = false;
  let secuencia = 0;
  let previa = null;
  let cargador; let selector; let nombreCampo; let mensajeLlamada; let mensajeTexto; let sliderConc; let sliderCps; let sliderTimbrado; let swBuzon; let swPausa;
  let modoAudio = "voces";
  let archivoAudio = ""; let audioUrl = "";
  let origen = null;
  const refs = {};

  const cfg = () => app.config || { limites: { contactos: 5000, concurrencia: 30, voces: 20, textoVoz: 2500 }, valores: {} };
  const borrador = () => memoria.leer(`borrador:${tipo}`, {}) || {};
  const guardarBorrador = antirrebote(() => {
    memoria.guardar(`borrador:${tipo}`, {
      nombre: nombreCampo ? nombreCampo.valor() : "", modoAudio, mensaje: valorMensaje(), voces: selector ? selector.obtenerElegidas() : [],
      archivoAudio, audioUrl, concurrencia: sliderConc.valor(), cps: sliderCps.valor(),
      timbradoSeg: sliderTimbrado ? sliderTimbrado.valor() : undefined, detectarBuzon: swBuzon ? swBuzon.valor() : undefined, autoPausa: swPausa.valor(),
    });
  }, 500);

  const valorMensaje = () => (esLlamada && modoAudio === "voces" ? mensajeLlamada.valor() : mensajeTexto.valor());

  function minutosEstimados(total) {
    if (!total) return null;
    const conc = sliderConc.valor();
    const cps = sliderCps.valor();
    const porMin = esLlamada ? Math.min(cps * 60, (conc * 60) / 35) : Math.min(cps * 60, conc * 30);
    return Math.max(1, Math.ceil(total / Math.max(0.5, porMin)));
  }

  function requisitos() {
    const c = cfg();
    const lista = [];
    const validos = previa ? previa.validos : 0;
    lista.push({ ok: validos > 0 && !(previa && previa.excedeLimite), texto: previa ? (previa.excedeLimite ? `El archivo supera el límite de ${num(previa.limite)} contactos` : validos > 0 ? `${num(validos)} contactos válidos` : "Ningún número válido en el archivo") : "Carga un archivo o pega los números" });
    if (esLlamada) {
      if (modoAudio === "voces") {
        const m = mensajeLlamada.valor().trim();
        const voces = selector.obtenerElegidas().length;
        lista.push({ ok: m.length > 0 && m.length <= c.limites.textoVoz, texto: m.length > c.limites.textoVoz ? `El mensaje pasa de ${num(c.limites.textoVoz)} caracteres` : m ? "Mensaje escrito" : "Escribe el mensaje" });
        lista.push({ ok: voces > 0, texto: voces ? `${voces} ${plural(voces, "voz elegida", "voces elegidas")}` : "Elige al menos una voz" });
        lista.push({ ok: Boolean(c.elevenlabs) && selector.disponible(), texto: c.elevenlabs ? (selector.disponible() ? "ElevenLabs conectado" : "ElevenLabs no respondió") : "Falta la API key de ElevenLabs" });
      } else if (modoAudio === "mp3") {
        const ok = Boolean(archivoAudio) || /^https?:\/\/\S+/i.test(audioUrl.trim());
        lista.push({ ok, texto: ok ? "Audio elegido" : "Elige un audio o escribe su dirección" });
      } else {
        const m = mensajeTexto.valor().trim();
        lista.push({ ok: m.length > 0 && m.length <= 1500, texto: m ? "Mensaje escrito" : "Escribe el mensaje" });
      }
      lista.push({ ok: Boolean(c.twilioConfigurado) && Boolean(c.numeroOrigen), texto: !c.twilioConfigurado ? "Faltan las credenciales de Twilio" : !c.numeroOrigen ? "Falta el número desde el que se llama" : `Twilio listo, llama desde ${telefono(c.numeroOrigen)}` });
      if (modoAudio !== "tts") lista.push({ ok: !c.usaLocalhost, texto: c.usaLocalhost ? "La dirección pública del servidor es localhost; Twilio no puede descargar audios" : "Dirección pública configurada para los audios" });
    } else {
      const m = mensajeTexto.valor().trim();
      lista.push({ ok: m.length > 0 && m.length <= 1500, texto: m.length > 1500 ? "El mensaje pasa de 1,500 caracteres" : m ? "Mensaje escrito" : "Escribe el mensaje" });
      lista.push({ ok: Boolean(c.twilioConfigurado) && Boolean(c.whatsappDesde), texto: !c.twilioConfigurado ? "Faltan las credenciales de Twilio" : !c.whatsappDesde ? "Falta el número de WhatsApp (TWILIO_WHATSAPP_FROM)" : `WhatsApp listo, envía desde ${c.whatsappDesde.replace("whatsapp:", "")}` });
    }
    const activa = app.activas[tipo];
    lista.push({ ok: !activa, texto: activa ? "Ya hay una campaña en curso de este tipo" : "Ninguna otra campaña en curso" });
    return lista;
  }

  const pedirPrevia = antirrebote(async () => {
    if (!cargador.tieneContactos()) { previa = null; cargador.mostrarPrevia(null); pintarResumen(); return; }
    const mi = (secuencia += 1);
    cargador.cargando(true);
    try {
      const cuerpo = { ...cargador.cuerpoContactos(), codigoPais: cargador.codigoPais(), modoAudio: esLlamada ? modoAudio : "tts", mensaje: valorMensaje(), voces: esLlamada && selector ? selector.obtenerElegidas() : [] };
      const r = await api("/contactos/previsualizar", { metodo: "POST", cuerpo, silencioso: true });
      if (mi !== secuencia) return;
      previa = r;
      cargador.mostrarPrevia(r);
    } catch (err) {
      if (mi !== secuencia) return;
      previa = null;
      cargador.mostrarError(err.message);
    }
    pintarResumen();
  }, 500);

  function cambio({ recalcular = true } = {}) {
    guardarBorrador();
    if (recalcular) pedirPrevia();
    pintarResumen();
    pintarPasos();
  }

  function pintarPasos() {
    const reqs = requisitos();
    refs.paso1.classList.toggle("paso--hecho", reqs[0].ok);
    const mensajeOk = reqs.slice(1, esLlamada ? (modoAudio === "voces" ? 4 : 2) : 2).every((r) => r.ok);
    refs.paso2.classList.toggle("paso--hecho", mensajeOk);
    for (const [paso, hecho] of [[refs.paso1, reqs[0].ok], [refs.paso2, mensajeOk]]) {
      const n = paso.querySelector(".paso__numero");
      if (n) n.replaceChildren(hecho ? icono("check") : document.createTextNode(paso === refs.paso1 ? "1" : "2"));
    }
  }

  function pintarResumen() {
    const c = cfg();
    const reqs = requisitos();
    const total = previa ? previa.validos : 0;
    const listo = reqs.every((r) => r.ok);
    const minutos = minutosEstimados(total);
    vaciar(refs.datos);
    const fila = (k, v) => refs.datos.append(h("div", null, h("dt", null, k), h("dd", null, v)));
    fila("Contactos", total ? num(total) : "—");
    if (esLlamada) {
      fila("Audio", modoAudio === "voces" ? (selector.obtenerElegidas().length ? `${selector.obtenerElegidas().length} ${plural(selector.obtenerElegidas().length, "voz", "voces")} de ElevenLabs` : "Sin voz elegida") : modoAudio === "mp3" ? (archivoAudio || (audioUrl ? "Audio por dirección" : "Sin audio")) : "Voz de Twilio");
    } else fila("Mensaje", valorMensaje().trim() ? `${valorMensaje().trim().length} caracteres` : "—");
    fila("Ritmo", esLlamada ? `${sliderConc.valor()} a la vez` : `${sliderCps.valor()} por segundo`);
    fila("Tiempo estimado", minutos ? `unos ${durLarga(minutos * 60)}` : "—");

    vaciar(refs.estimacion);
    refs.estimacion.hidden = true;
    if (esLlamada && modoAudio === "voces" && previa && previa.audios) {
      const a = previa.audios;
      refs.estimacion.hidden = false;
      refs.estimacion.append(
        h("div", null, h("b", null, num(a.nuevos)), ` ${plural(a.nuevos, "audio nuevo", "audios nuevos")} por generar`, a.reutilizados ? `, ${num(a.reutilizados)} ya existen` : ""),
        h("div", null, `Gastarán unos `, h("b", null, num(a.caracteres)), " caracteres de ElevenLabs"));
      const s = previa.suscripcion;
      if (s && s.limite) {
        const restante = Math.max(0, s.limite - (s.usados || 0));
        const nivel = a.caracteres > restante ? "error" : a.caracteres > restante * 0.8 ? "aviso" : "";
        agregar(refs.estimacion, [
          h("div", { class: "medidor", "data-nivel": nivel, role: "img", "aria-label": `Has usado ${num(s.usados)} de ${num(s.limite)} caracteres` }, h("i", { style: { width: `${Math.min(100, ((s.usados || 0) / s.limite) * 100)}%` } })),
          h("div", null, `Te quedan `, h("b", null, num(restante)), ` de ${num(s.limite)} caracteres${s.plan ? ` (plan ${s.plan})` : ""}.`),
          nivel === "error" ? h("div", { style: { color: "var(--peligro-tinta)" } }, "No te alcanzan para esta campaña. Recarga créditos en ElevenLabs o reduce el mensaje.") : null]);
      }
    }

    vaciar(refs.requisitos);
    reqs.forEach((r) => refs.requisitos.append(h("li", { dataset: { ok: String(r.ok) } }, icono(r.ok ? "check" : "reloj"), h("span", null, r.texto))));
    refs.iniciar.disabled = !listo || enviando;
    refs.iniciar.setAttribute("aria-busy", enviando ? "true" : "false");
    refs.textoIniciar.textContent = enviando ? "Creando campaña…" : (total ? `Iniciar ${esLlamada ? "llamadas" : "envío"} a ${num(total)}` : `Iniciar ${esLlamada ? "campaña" : "envío"}`);

    vaciar(refs.avisoActiva);
    const activa = app.activas[tipo];
    if (activa) {
      refs.avisoActiva.append(h("div", { class: "aviso aviso--aviso" }, icono("alerta"),
        h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, `Hay una campaña de ${esLlamada ? "llamadas" : "WhatsApp"} en curso`), h("span", { class: "aviso__texto" }, "Solo puede haber una a la vez por tipo. Puedes preparar esta y lanzarla cuando la otra termine."),
          h("div", { class: "aviso__acciones" }, h("button", { type: "button", class: "boton boton--chico", on: { click: () => irA(`/en-vivo/${activa}`) } }, icono("envivo"), "Ver en vivo")))));
    }
    if (!c.twilioConfigurado) {
      refs.avisoActiva.append(h("div", { class: "aviso aviso--error" }, icono("error"),
        h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, "Twilio no está configurado"), h("span", { class: "aviso__texto" }, "Agrega TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en el archivo .env del servidor y reinícialo. Mientras tanto no se puede iniciar ninguna campaña."))));
    }
    refs.avisoActiva.hidden = !refs.avisoActiva.childElementCount;
  }

  function pintarModo() {
    const voces = modoAudio === "voces";
    refs.bloqueVoces.hidden = !voces;
    refs.bloqueMp3.hidden = modoAudio !== "mp3";
    refs.bloqueTts.hidden = modoAudio !== "tts";
    for (const [modo, boton] of Object.entries(refs.botonesModo)) boton.setAttribute("aria-pressed", String(modo === modoAudio));
    if (voces && selector && !selector.cargado) { selector.cargado = true; selector.cargar(); }
  }

  function cambiarModo(modo) {
    modoAudio = modo;
    pintarModo();
    cambio();
  }

  function construir() {
    const c = cfg();
    const b = borrador();
    const v = c.valores || {};
    modoAudio = esLlamada ? (b.modoAudio || "voces") : "tts";
    if (esLlamada && !c.elevenlabs && modoAudio === "voces") modoAudio = (c.audiosLocales || []).length ? "mp3" : "tts";
    archivoAudio = b.archivoAudio || ""; audioUrl = b.audioUrl || "";

    cargador = crearCargadorContactos({ codigoPais: c.codigoPais || "52", alCambiar: () => cambio(), tipo });
    nombreCampo = campoTexto({ etiqueta: "Nombre de la campaña (opcional)", placeholder: esLlamada ? "Ej. Informe de noviembre" : "Ej. Recordatorio de cita", maxlength: 80, valor: b.nombre || "", alCambiar: () => cambio({ recalcular: false }) });

    mensajeTexto = campoMensaje({
      etiqueta: esLlamada ? "Mensaje que leerá la voz de Twilio" : "Mensaje de WhatsApp", maximo: 1500, valor: b.mensaje && modoAudio !== "voces" ? b.mensaje : "",
      placeholder: esLlamada ? "Hola {nombre}, le llamamos para informarle…" : "Hola {nombre}, te escribimos para recordarte…",
      ayuda: "Escribe {nombre} donde quieras el nombre del contacto. Si un contacto no tiene nombre, esa parte se omite.",
      alCambiar: () => { pintarVistaMensaje(); cambio(); },
    });
    if (esLlamada) {
      mensajeLlamada = campoMensaje({
        etiqueta: "Mensaje que dirá la voz", maximo: c.limites.textoVoz, valor: b.mensaje && modoAudio === "voces" ? b.mensaje : "",
        placeholder: "Hola {nombre}, le saludamos de parte de… Le llamamos para compartirle…",
        ayuda: "Cada contacto escucha su propio audio generado con la voz elegida. Escribe {nombre} para personalizarlo.",
        alCambiar: () => { pintarVistaMensaje(); cambio(); },
      });
      selector = crearSelectorVoces({
        maxVoces: c.limites.voces, vocesIniciales: b.voces || [],
        alCambiar: () => cambio(),
        obtenerTextoMuestra: () => renderMensaje(mensajeLlamada.valor(), "María").slice(0, 300),
      });
    }

    sliderConc = campoRango({ etiqueta: esLlamada ? "Llamadas a la vez" : "Mensajes en paralelo", min: 1, max: c.limites.concurrencia, valor: Math.min(c.limites.concurrencia, b.concurrencia || (esLlamada ? v.concurrencia || 5 : 10)), formato: (x) => String(x),
      ayuda: esLlamada ? "Cuántas líneas se mantienen ocupadas al mismo tiempo. Cuando una termina, entra la siguiente." : "Cuántos mensajes se envían sin esperar confirmación.", alCambiar: () => cambio({ recalcular: false }) });
    sliderCps = campoRango({ etiqueta: "Arranques por segundo", min: 0.5, max: esLlamada ? 10 : 20, paso: 0.5, valor: b.cps || (esLlamada ? v.cps || 1 : 5), formato: (x) => x.toLocaleString("es-MX"),
      ayuda: "Twilio acepta alrededor de 1 llamada nueva por segundo en cuentas nuevas. Súbelo solo si tu cuenta lo permite.", alCambiar: () => cambio({ recalcular: false }) });
    if (esLlamada) {
      sliderTimbrado = campoRango({ etiqueta: "Segundos de timbrado", min: 10, max: 60, paso: 5, valor: b.timbradoSeg || v.timbradoSeg || 25, formato: (x) => `${x} s`,
        ayuda: "Si nadie contesta en este tiempo, la llamada se da por no contestada y se libera la línea.", alCambiar: () => cambio({ recalcular: false }) });
      swBuzon = interruptor({ titulo: "Detectar buzón y contestadoras", ayuda: "Twilio escucha al inicio para distinguir a una persona de una grabadora. Permite separarlos en los resultados.", marcado: b.detectarBuzon !== undefined ? b.detectarBuzon : v.detectarBuzon !== false, alCambiar: () => cambio({ recalcular: false }) });
    }
    swPausa = interruptor({ titulo: "Pausar si fallan muchas", ayuda: `Detiene la campaña sola si ${v.umbralAutoPausa || 60} % o más de las últimas llamadas fallan, para no gastar créditos mientras hay un problema.`, marcado: b.autoPausa !== undefined ? b.autoPausa : v.autoPausa !== false, alCambiar: () => cambio({ recalcular: false }) });

    refs.vistaMensaje = h("div", { class: "vista-mensaje", hidden: true });
    refs.botonesModo = {};
    const modos = [["voces", "voz", "Voces de ElevenLabs"], ["mp3", "play", "Audio ya grabado"], ["tts", "microfono", "Voz de Twilio"]];
    const segmentado = h("div", { class: "segmentado", role: "group", "aria-label": "Qué van a escuchar" },
      modos.map(([modo, ic, texto]) => { const bt = h("button", { type: "button", "aria-pressed": String(modo === modoAudio), disabled: modo === "voces" && !c.elevenlabs, title: modo === "voces" && !c.elevenlabs ? "Falta la API key de ElevenLabs" : null, on: { click: () => cambiarModo(modo) } }, icono(ic), texto); refs.botonesModo[modo] = bt; return bt; }));

    const locales = c.audiosLocales || [];
    const selectorMp3 = h("select", { class: "selector", id: "sel-mp3", "aria-label": "Audio de la carpeta del servidor" },
      h("option", { value: "" }, locales.length ? "Elige un audio del servidor…" : "No hay audios en public/audio"),
      locales.map((a) => h("option", { value: a.archivo, selected: a.archivo === archivoAudio }, a.archivo)));
    const reproductor = h("audio", { controls: true, preload: "none", hidden: !archivoAudio, src: archivoAudio ? `/audio/${encodeURIComponent(archivoAudio)}` : null, style: { width: "100%" } });
    selectorMp3.addEventListener("change", () => {
      archivoAudio = selectorMp3.value;
      reproductor.hidden = !archivoAudio;
      if (archivoAudio) reproductor.src = `/audio/${encodeURIComponent(archivoAudio)}`;
      cambio({ recalcular: false });
    });
    const urlCampo = campoTexto({ etiqueta: "O escribe la dirección de un mp3", placeholder: "https://…/mensaje.mp3", valor: audioUrl, ayuda: "Debe ser pública (que Twilio pueda descargarla). Si eliges un audio de la lista, esta dirección se ignora.", alCambiar: (x) => { audioUrl = x; cambio({ recalcular: false }); } });
    refs.bloqueMp3 = h("div", { class: "opcion-audio" }, h("div", { class: "campo" }, h("label", { for: "sel-mp3" }, "Audio del servidor"), selectorMp3, reproductor), urlCampo.el);
    refs.bloqueVoces = h("div", { class: "opcion-audio" }, mensajeLlamada ? mensajeLlamada.el : null, refs.vistaMensaje, selector ? selector.el : null);
    refs.bloqueTts = h("div", { class: "opcion-audio" }, mensajeTexto.el, h("div", { class: "aviso aviso--info" }, icono("info"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__texto" }, "La voz de Twilio es robótica y no se puede elegir otra. Sirve para pruebas rápidas; para campañas reales usa las voces de ElevenLabs."))));

    const paso = (numero, titulo, descripcion, ...cuerpo) => h("section", { class: "panel" },
      h("div", { class: "panel__cabeza" }, h("div", null, h("div", { class: "paso__titulo" }, h("span", { class: "paso__numero" }, String(numero)), h("h2", { class: "titulo-seccion" }, titulo)), descripcion ? h("p", null, descripcion) : null)), cuerpo);

    refs.paso1 = paso(1, "Contactos", "Un número por fila. Si agregas una columna con el nombre, el mensaje puede saludar a cada persona.", nombreCampo.el, cargador.el);
    refs.paso2 = esLlamada
      ? paso(2, "Qué van a escuchar", "Elige entre voces realistas de ElevenLabs, un audio que ya tengas o la voz básica de Twilio.", segmentado, refs.bloqueVoces, refs.bloqueMp3, refs.bloqueTts)
      : paso(2, "Mensaje", "El texto que recibirá cada contacto por WhatsApp.", mensajeTexto.el, refs.vistaMensaje, h("div", { class: "aviso aviso--info" }, icono("info"), h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__texto" }, `Se envía desde ${c.whatsappDesde ? c.whatsappDesde.replace("whatsapp:", "") : "el número de WhatsApp configurado"}. Con una cuenta de prueba (sandbox) cada contacto debe unirse primero; con una cuenta aprobada, los mensajes fuera de las 24 horas necesitan una plantilla aprobada por Meta.`))));
    refs.paso3 = paso(3, "Ritmo", esLlamada ? "Los valores por defecto funcionan bien. Puedes cambiar el ritmo también mientras la campaña está en curso." : "Ajusta qué tan rápido se envían los mensajes.",
      h("div", { class: "ritmo" }, sliderConc.el, sliderCps.el, sliderTimbrado ? sliderTimbrado.el : null),
      h("div", { class: "opciones-extra" }, swBuzon ? swBuzon.el : null, swPausa.el));

    refs.datos = h("dl");
    refs.estimacion = h("div", { class: "estimacion", hidden: true });
    refs.requisitos = h("ul", { class: "requisitos" });
    refs.avisoActiva = h("div", { class: "seccion" });
    refs.textoIniciar = h("span", null, "Iniciar campaña");
    refs.iniciar = h("button", { type: "button", class: "boton boton--primario boton--grande boton--bloque", on: { click: confirmarInicio } }, icono("rayo"), refs.textoIniciar);
    const resumen = h("aside", { class: "compositor__resumen", "aria-label": "Resumen de la campaña" },
      h("section", { class: "panel resumen-lateral" }, h("h2", null, "Resumen"), refs.datos, refs.estimacion, h("hr", { class: "separador" }), refs.requisitos, refs.iniciar,
        h("p", { class: "campo__ayuda" }, "Antes de empezar te pediré confirmar. Podrás pausar, ajustar el ritmo o detener la campaña cuando quieras.")));

    const intro = h("div", { class: "intro-vista" }, h("h2", { class: "titulo-pagina" }, esLlamada ? "Nueva campaña de llamadas" : "Nueva campaña de WhatsApp"),
      h("p", null, esLlamada ? "Sube tus contactos, elige qué van a escuchar y lánzala. Los resultados aparecen en vivo: quién contesta, quién no y por qué falla cada llamada." : "Sube tus contactos, escribe el mensaje y envíalo. Verás en vivo quién lo recibió y quién no."));
    const estructura = h("div", { class: "compositor" }, h("div", { class: "compositor__pasos" }, refs.avisoActiva, refs.paso1, refs.paso2, refs.paso3), resumen);
    contenedor.append(intro, estructura);
    pintarModo(); pintarVistaMensaje(); pintarResumen(); pintarPasos();
  }

  function pintarVistaMensaje() {
    const m = valorMensaje().trim();
    refs.vistaMensaje.hidden = !m || !/\{nombre\}/i.test(m);
    if (refs.vistaMensaje.hidden) return;
    const conNombre = previa && previa.muestra ? previa.muestra.find((x) => x.nombre) : null;
    vaciar(refs.vistaMensaje);
    refs.vistaMensaje.append(h("b", null, "Así lo recibirá"), h("div", null, `«${renderMensaje(m, conNombre ? conNombre.nombre : "María")}»`),
      h("div", { class: "texto-3", style: { marginTop: "6px" } }, `Si no tiene nombre: «${renderMensaje(m, "")}»`));
  }

  async function confirmarInicio() {
    const reqs = requisitos();
    if (!reqs.every((r) => r.ok) || enviando) return;
    const total = previa.validos;
    const minutos = minutosEstimados(total);
    const filas = [["Contactos", num(total)]];
    if (esLlamada) {
      filas.push(["Audio", modoAudio === "voces" ? `${selector.obtenerElegidas().length} ${plural(selector.obtenerElegidas().length, "voz", "voces")}: ${selector.nombresElegidas().slice(0, 3).join(", ")}${selector.obtenerElegidas().length > 3 ? "…" : ""}` : modoAudio === "mp3" ? (archivoAudio || "Audio por dirección") : "Voz de Twilio"]);
      filas.push(["Ritmo", `${sliderConc.valor()} a la vez, ${sliderCps.valor()} por segundo`]);
      if (previa.audios) filas.push(["Audios nuevos", `${num(previa.audios.nuevos)} (${num(previa.audios.caracteres)} caracteres)`]);
    } else filas.push(["Ritmo", `${sliderConc.valor()} en paralelo, ${sliderCps.valor()} por segundo`]);
    filas.push(["Tiempo estimado", minutos ? `unos ${durLarga(minutos * 60)}` : "—"]);
    const ok = await modal({
      titulo: `¿Iniciar ${esLlamada ? "las llamadas" : "el envío"} ahora?`,
      texto: esLlamada ? "Se empezará a llamar de inmediato y se gastarán créditos de Twilio. Podrás pausar o detener cuando quieras." : "Se empezarán a enviar los mensajes de inmediato.",
      resumen: filas, aceptar: esLlamada ? "Iniciar llamadas" : "Enviar mensajes",
    });
    if (!ok) return;
    enviando = true; pintarResumen();
    try {
      const cuerpo = {
        ...cargador.cuerpoContactos(), codigoPais: cargador.codigoPais(), nombre: nombreCampo.valor().trim(),
        mensaje: valorMensaje(), concurrencia: sliderConc.valor(), cps: sliderCps.valor(), autoPausa: swPausa.valor(), origen,
      };
      if (esLlamada) {
        Object.assign(cuerpo, { modoAudio, voces: modoAudio === "voces" ? selector.obtenerElegidas() : [], timbradoSeg: sliderTimbrado.valor(), detectarBuzon: swBuzon.valor() });
        if (modoAudio === "mp3") { if (archivoAudio) cuerpo.archivoAudio = archivoAudio; else cuerpo.audioUrl = audioUrl.trim(); cuerpo.mensaje = ""; }
      }
      const r = await api(`/campanas/${tipo}`, { metodo: "POST", cuerpo });
      aviso(`${num(r.total)} contactos en la cola. Empieza ahora.`, { tipo: "ok", titulo: "Campaña creada" });
      origen = null;
      await cargarCampanas().catch(() => {});
      irA(`/en-vivo/${r.id}`);
    } catch (err) {
      const activa = err.datos && err.datos.campanaId;
      aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo iniciar", acciones: activa ? [{ texto: "Ver la campaña en curso", fn: () => irA(`/en-vivo/${activa}`) }] : [] });
      if (activa) await cargarCampanas().catch(() => {});
    } finally {
      enviando = false; pintarResumen();
    }
  }

  function aplicarPlantilla() {
    const p = app.plantilla;
    if (!p || p.config.tipo !== tipo) return;
    app.plantilla = null;
    const k = p.config;
    origen = p.origen || null;
    nombreCampo.establecer(k.nombre || "");
    if (esLlamada) {
      modoAudio = k.modoAudio === "voces" && !cfg().elevenlabs ? "tts" : (k.modoAudio || "voces");
      if (modoAudio === "voces") { mensajeLlamada.establecer(k.mensaje || ""); selector.establecerElegidas(k.voces || []); }
      else if (modoAudio === "tts") mensajeTexto.establecer(k.mensaje || "");
      else { audioUrl = k.audioUrl || ""; archivoAudio = ""; }
      sliderTimbrado.establecer(k.timbradoSeg || 25); swBuzon.establecer(k.detectarBuzon !== false);
    } else mensajeTexto.establecer(k.mensaje || "");
    sliderConc.establecer(k.concurrencia || 5); sliderCps.establecer(k.cps || 1); swPausa.establecer(k.autoPausa !== false);
    pintarModo(); pintarVistaMensaje();
    cargador.usarTexto(p.csvTexto, p.etiqueta);
    aviso(`${num(p.cantidad)} contactos listos para reintentar. Revisa el mensaje y lanza la campaña.`, { tipo: "info", titulo: "Lista cargada" });
    guardarBorrador();
  }

  function mostrar() {
    if (!iniciado) { iniciado = true; construir(); }
    aplicarPlantilla();
    pintarResumen();
  }

  return {
    mostrar,
    refrescar() { if (iniciado) pintarResumen(); },
    ocultar() { if (selector) selector.detener(); },
    reiniciar() {
      if (!iniciado) return;
      if (selector) selector.detener();
      vaciar(contenedor);
      iniciado = false;
      previa = null;
      mostrar();
    },
  };
}
