import { h, vaciar, icono, aviso, antirrebote } from "./dom.js";
import { api } from "./api.js";
import { num, plural } from "./fmt.js";

const GENERO = { female: "Mujer", male: "Hombre", neutral: "Neutral" };
const EDAD = { young: "joven", middle_aged: "adulta", "middle-aged": "adulta", old: "mayor" };
const ACENTO = {
  american: "estadounidense", british: "británico", mexican: "mexicano", spanish: "español", "latin american": "latinoamericano",
  australian: "australiano", irish: "irlandés", swedish: "sueco", "american-southern": "sureño de EE. UU.", "british-essex": "británico", transatlantic: "transatlántico",
  argentinian: "argentino", colombian: "colombiano", chilean: "chileno", peruvian: "peruano", castilian: "castellano",
};
const ESTILO = {
  warm: "cálida", calm: "tranquila", confident: "segura", deep: "grave", friendly: "amable", professional: "profesional", upbeat: "animada",
  casual: "casual", narrative: "narrativa", intense: "intensa", soft: "suave", clear: "clara", natural: "natural", conversational: "conversacional",
  "social media": "redes sociales", narration: "narración", news: "noticias", characters: "personajes", "video games": "videojuegos", "informative_educational": "educativa", "conversational": "conversacional",
};

function descripcionVoz(v) {
  const partes = [];
  if (v.genero) partes.push(GENERO[String(v.genero).toLowerCase()] || v.genero);
  if (v.acento) partes.push(ACENTO[String(v.acento).toLowerCase()] || String(v.acento).toLowerCase());
  if (v.edad) partes.push(EDAD[String(v.edad).toLowerCase()] || String(v.edad).toLowerCase());
  if (v.estilo) partes.push(ESTILO[String(v.estilo).toLowerCase()] || String(v.estilo).toLowerCase());
  return partes.join(", ");
}

export function crearSelectorVoces({ maxVoces = 20, alCambiar = () => {}, obtenerTextoMuestra = () => "", vocesIniciales = [] }) {
  const st = {
    cargando: true, disponible: true, voces: [], recomendadas: [], cargandoRec: false, avisoCuenta: null, avisoRec: null,
    elegidas: new Set(vocesIniciales), predeterminada: "", busqueda: "", agregando: new Set(), muestra: null, generando: false, vozMuestra: "",
  };
  const audio = new Audio();
  audio.preload = "none";
  let botonSonando = null;

  function detener() {
    audio.pause();
    if (botonSonando) { botonSonando.setAttribute("aria-pressed", "false"); botonSonando.replaceChildren(icono("play")); botonSonando = null; }
  }
  audio.addEventListener("ended", detener);
  audio.addEventListener("error", () => { if (botonSonando) { detener(); aviso("No se pudo reproducir esa muestra.", { tipo: "aviso" }); } });

  function reproducir(url, boton) {
    if (botonSonando === boton) { detener(); return; }
    detener();
    audio.src = url;
    botonSonando = boton;
    boton.setAttribute("aria-pressed", "true");
    boton.replaceChildren(icono("pausa"));
    audio.play().catch(() => { detener(); aviso("No se pudo reproducir esa muestra.", { tipo: "aviso" }); });
  }

  function botonOir(v) {
    const b = h("button", { type: "button", class: "voz__oir", "aria-pressed": "false", "aria-label": `Escuchar muestra de ${v.nombre}`, title: v.previewUrl ? "Escuchar muestra" : "Esta voz no tiene muestra", disabled: !v.previewUrl }, icono("play"));
    b.addEventListener("click", () => reproducir(v.previewUrl, b));
    return b;
  }

  function alternar(id) {
    if (st.elegidas.has(id)) st.elegidas.delete(id);
    else if (st.elegidas.size >= maxVoces) { aviso(`Puedes elegir hasta ${maxVoces} voces por campaña.`, { tipo: "aviso" }); return false; }
    else st.elegidas.add(id);
    pintarMuestra();
    alCambiar();
    return true;
  }

  function tarjetaCuenta(v) {
    const elegida = st.elegidas.has(v.id);
    const entrada = h("input", { type: "checkbox", checked: elegida, class: "solo-lectores" });
    const tarjeta = h("div", { class: "voz", dataset: { elegida: String(elegida) } },
      h("label", { class: "voz__elegir" }, entrada,
        h("span", { class: "voz__marca" }, icono("check")),
        h("span", { class: "voz__texto" },
          h("b", { title: v.nombre }, v.nombre),
          h("span", null, descripcionVoz(v) || "Sin descripción"),
          v.id === st.predeterminada ? h("span", { class: "voz__etiqueta" }, "Predeterminada") : null)),
      h("div", { class: "voz__acciones" }, botonOir(v)));
    entrada.addEventListener("change", () => {
      if (!alternar(v.id)) { entrada.checked = false; return; }
      tarjeta.dataset.elegida = String(entrada.checked);
    });
    return tarjeta;
  }

  function tarjetaBiblioteca(v) {
    const ocupada = st.agregando.has(v.id);
    return h("div", { class: "voz voz--biblioteca" },
      h("div", { class: "voz__fila" },
        h("div", { class: "voz__elegir", style: { cursor: "default" } },
          h("span", { class: "voz__texto" },
            h("b", { title: v.nombre }, v.nombre),
            h("span", null, descripcionVoz(v) || "Voz de la biblioteca"),
            v.usos ? h("span", { class: "voz__etiqueta" }, `${num(Math.round(v.usos / 1000))} mil usos`) : null)),
        h("div", { class: "voz__acciones" }, botonOir(v))),
      h("button", { type: "button", class: "boton boton--chico boton--tonal voz__agregar", disabled: ocupada, "aria-busy": ocupada ? "true" : null, on: { click: () => agregarVoz(v) } },
        ocupada ? h("span", { class: "cargando" }) : null, icono("mas"), "Agregar a mi cuenta y usar"));
  }

  async function agregarVoz(v) {
    st.agregando.add(v.id);
    pintarRecomendadas();
    try {
      const r = await api("/voces/agregar", { metodo: "POST", cuerpo: { publicOwnerId: v.publicOwnerId, vozId: v.id, nombre: v.nombre } });
      aviso(`«${v.nombre}» ya está en tu cuenta de ElevenLabs y quedó elegida.`, { tipo: "ok" });
      await cargarCuenta(true);
      const idNuevo = (r && r.vozId) || v.id;
      if (st.elegidas.size < maxVoces) st.elegidas.add(idNuevo);
      st.recomendadas = st.recomendadas.filter((x) => x.id !== v.id);
      pintarCuenta();
      alCambiar();
    } catch (err) {
      aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo agregar la voz" });
    } finally {
      st.agregando.delete(v.id);
      pintarRecomendadas();
    }
  }

  const buscador = h("input", { class: "entrada", type: "search", placeholder: "Buscar por nombre, acento o estilo", "aria-label": "Buscar voz", style: { maxWidth: "340px" } });
  buscador.addEventListener("input", antirrebote(() => { st.busqueda = buscador.value.trim().toLowerCase(); pintarCuenta(); }, 150));
  const contadorElegidas = h("span", { class: "chip chip--info", "aria-live": "polite" });
  const botonLimpiar = h("button", { type: "button", class: "boton boton--chico boton--fantasma", on: { click: () => { st.elegidas.clear(); pintarCuenta(); pintarMuestra(); alCambiar(); } } }, "Quitar selección");
  const botonRecargar = h("button", { type: "button", class: "boton boton--chico", on: { click: async () => { await cargarCuenta(true); pintarCuenta(); alCambiar(); } } }, icono("actualizar"), "Actualizar lista");
  const cajaAviso = h("div", null);
  const rejillaCuenta = h("div", { class: "voces__rejilla" });
  const tituloCuenta = h("h3", null, "Tus voces");
  const notaCuenta = h("p", null);
  const cajaRec = h("div", { class: "voces__grupo" });
  const rejillaRec = h("div", { class: "voces__rejilla" });
  const cajaAvisoRec = h("div", null);
  const cajaMuestra = h("div", { class: "muestra", hidden: true });

  function pintarAviso(contenedor, a, nivel = "aviso") {
    vaciar(contenedor);
    if (!a) return;
    const tipo = a.codigo === "sin_voces" || a.codigo === "pocas" ? "info" : nivel;
    contenedor.append(h("div", { class: `aviso aviso--${tipo === "info" ? "info" : tipo}`, role: "status" }, icono(tipo === "error" ? "error" : "info"),
      h("div", { class: "aviso__cuerpo" }, h("span", { class: "aviso__titulo" }, a.titulo || "Aviso de ElevenLabs"), h("span", { class: "aviso__texto" }, a.detalle || ""), a.accion ? h("span", { class: "aviso__texto" }, a.accion) : null)));
  }

  function pintarCuenta() {
    vaciar(rejillaCuenta);
    contadorElegidas.textContent = st.elegidas.size ? `${st.elegidas.size} ${plural(st.elegidas.size, "voz elegida", "voces elegidas")}` : "Ninguna voz elegida";
    botonLimpiar.hidden = st.elegidas.size === 0;
    buscador.hidden = st.voces.length <= 8;
    if (st.cargando) {
      for (let i = 0; i < 6; i += 1) rejillaCuenta.append(h("div", { class: "esqueleto", style: { height: "72px", borderRadius: "14px" } }));
      return;
    }
    let lista = st.voces;
    if (st.busqueda) lista = lista.filter((v) => `${v.nombre} ${descripcionVoz(v)}`.toLowerCase().includes(st.busqueda));
    tituloCuenta.textContent = `Tus voces (${st.voces.length})`;
    if (!lista.length) {
      rejillaCuenta.append(h("div", { class: "lineas__vacio", style: { gridColumn: "1 / -1" } }, st.busqueda ? "Ninguna voz coincide con la búsqueda." : "Tu cuenta todavía no tiene voces."));
      return;
    }
    lista.forEach((v) => rejillaCuenta.append(tarjetaCuenta(v)));
  }

  function pintarRecomendadas() {
    vaciar(rejillaRec);
    if (st.cargandoRec) {
      for (let i = 0; i < 6; i += 1) rejillaRec.append(h("div", { class: "esqueleto", style: { height: "108px", borderRadius: "14px" } }));
      return;
    }
    st.recomendadas.forEach((v) => rejillaRec.append(tarjetaBiblioteca(v)));
    cajaRec.hidden = !st.recomendadas.length && !st.avisoRec;
  }

  function pintarMuestra() {
    const elegidas = [...st.elegidas].map((id) => st.voces.find((v) => v.id === id)).filter(Boolean);
    cajaMuestra.hidden = !elegidas.length;
    vaciar(cajaMuestra);
    if (!elegidas.length) return;
    if (!elegidas.some((v) => v.id === st.vozMuestra)) st.vozMuestra = elegidas[0].id;
    const selector = h("select", { class: "selector", "aria-label": "Voz para la prueba", style: { maxWidth: "240px", minHeight: "36px", paddingBlock: "5px" } }, elegidas.map((v) => h("option", { value: v.id, selected: v.id === st.vozMuestra }, v.nombre)));
    selector.addEventListener("change", () => { st.vozMuestra = selector.value; });
    const generar = h("button", { type: "button", class: "boton boton--chico boton--tonal", disabled: st.generando, "aria-busy": st.generando ? "true" : null, on: { click: probarMensaje } },
      st.generando ? h("span", { class: "cargando" }) : null, icono("auriculares"), "Escuchar mi mensaje con esta voz");
    cajaMuestra.append(selector, generar);
    if (st.muestra) {
      cajaMuestra.append(h("audio", { controls: true, src: st.muestra.url, preload: "metadata" }));
      cajaMuestra.append(h("p", null, st.muestra.nuevo
        ? `Audio de ${Math.round(st.muestra.segundos)} s generado con ${num(st.muestra.caracteres)} caracteres de tu plan de ElevenLabs.`
        : `Audio de ${Math.round(st.muestra.segundos)} s. Ya estaba generado, no gastó caracteres.`));
    } else {
      cajaMuestra.append(h("p", null, "Genera una muestra con tu texto real antes de lanzar la campaña. Usa los primeros 300 caracteres del mensaje."));
    }
  }

  async function probarMensaje() {
    const texto = obtenerTextoMuestra();
    if (!texto) { aviso("Escribe primero el mensaje que van a escuchar los contactos.", { tipo: "aviso" }); return; }
    st.generando = true; pintarMuestra();
    try {
      st.muestra = await api("/voces/muestra", { metodo: "POST", cuerpo: { vozId: st.vozMuestra, texto } });
    } catch (err) {
      aviso(`${err.message}${err.accion ? ` ${err.accion}` : ""}`, { tipo: "error", titulo: err.titulo || "No se pudo generar la muestra" });
    } finally {
      st.generando = false; pintarMuestra();
    }
  }

  async function cargarCuenta(forzar = false) {
    try {
      const d = await api(`/voces${forzar ? "?forzar=1" : ""}`);
      st.disponible = d.disponible !== false;
      st.voces = d.voces || [];
      st.predeterminada = d.predeterminada || "";
      st.avisoCuenta = d.aviso || (st.disponible ? null : { titulo: "ElevenLabs no está configurado", detalle: "Falta la API key de ElevenLabs en el archivo .env.", accion: "" });
      for (const id of [...st.elegidas]) if (!st.voces.some((v) => v.id === id)) st.elegidas.delete(id);
      if (!st.elegidas.size && st.voces.length) {
        const pre = st.voces.find((v) => v.id === st.predeterminada) || st.voces[0];
        st.elegidas.add(pre.id);
      }
    } catch (err) {
      st.avisoCuenta = { titulo: "No se pudieron cargar las voces", detalle: err.message, accion: err.accion || "Revisa el estado del sistema (arriba a la derecha) y vuelve a intentar.", codigo: "red" };
      st.voces = [];
    } finally {
      st.cargando = false;
      pintarAviso(cajaAviso, st.avisoCuenta, st.voces.length ? "aviso" : "error");
    }
  }

  async function cargarRecomendadas(forzar = false) {
    if (!st.disponible) return;
    st.cargandoRec = true; pintarRecomendadas();
    try {
      const d = await api(`/voces/recomendadas?n=15${forzar ? "&forzar=1" : ""}`);
      st.recomendadas = (d.voces || []).filter((v) => !st.voces.some((x) => x.id === v.id));
      st.avisoRec = d.aviso || null;
    } catch (err) {
      st.recomendadas = [];
      st.avisoRec = { titulo: "No se pudo cargar la biblioteca de voces", detalle: err.message, accion: err.accion || "" };
    } finally {
      st.cargandoRec = false;
      pintarAviso(cajaAvisoRec, st.avisoRec, "aviso");
      pintarRecomendadas();
    }
  }

  async function cargar() {
    st.cargando = true; pintarCuenta();
    await cargarCuenta(false);
    pintarCuenta(); pintarMuestra();
    alCambiar();
    cargarRecomendadas(false);
  }

  const el = h("div", { class: "voces" },
    h("div", { class: "voces__cabeza" }, buscador, contadorElegidas, botonLimpiar, h("span", { style: { flex: "1" } }), botonRecargar),
    cajaAviso,
    h("div", { class: "voces__grupo" }, h("header", null, tituloCuenta, notaCuenta), rejillaCuenta),
    cajaMuestra,
    cajaRec);
  cajaRec.append(
    h("header", null, h("h3", null, "15 voces recomendadas en español"), h("p", null, "De la biblioteca pública de ElevenLabs. Escúchalas y agrega las que te gusten; así quedan en tu cuenta.")),
    cajaAvisoRec, rejillaRec);
  cajaRec.hidden = true;

  return {
    el,
    cargar,
    obtenerElegidas: () => [...st.elegidas],
    establecerElegidas(ids) { st.elegidas = new Set(ids.filter((id) => !st.voces.length || st.voces.some((v) => v.id === id))); pintarCuenta(); pintarMuestra(); },
    disponible: () => st.disponible,
    nombresElegidas: () => [...st.elegidas].map((id) => (st.voces.find((v) => v.id === id) || {}).nombre || id),
    detener,
  };
}
