import { h, vaciar, lampara, sinMovimiento } from "./dom.js";
import { infoFila, telefono, dur } from "./fmt.js";

const TAU = Math.PI * 2;
export const FORMA = { PEND: 0, COLA: 1, TIMBRE: 2, LLAMADA: 3, SI: 4, NO: 5, ERROR: 6, SIN: 7 };
const GRUPO_DE_FORMA = ["pendiente", "curso", "curso", "curso", "si", "no", "error", "pendiente"];

export function formaDe(fila) {
  if (!fila) return FORMA.PEND;
  switch (fila.cat) {
    case "contesto": return FORMA.SI;
    case "buzon": case "no_contesto": case "ocupado": return FORMA.NO;
    case "fallida": case "error": return FORMA.ERROR;
    case "cancelada": case "omitido": return FORMA.SIN;
    case "en_curso":
      if (fila.estadoLlamada === "ringing") return FORMA.TIMBRE;
      if (fila.estadoLlamada === "in-progress" || fila.estadoLlamada === "answered") return FORMA.LLAMADA;
      return FORMA.COLA;
    default: return FORMA.PEND;
  }
}

const salidaConRebote = (p) => { const c = 1.9; const q = p - 1; return 1 + (c + 1) * q * q * q + c * q * q; };
const ruido = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

export class Tablero {
  constructor(lienzo, tip, { alElegir = () => {}, obtenerFila = () => null, tipo = "llamadas" } = {}) {
    this.lienzo = lienzo;
    this.contenedor = lienzo.parentElement;
    this.tip = tip;
    this.ctx = lienzo.getContext("2d");
    this.alElegir = alElegir;
    this.obtenerFila = obtenerFila;
    this.tipo = tipo;
    this.n = 0;
    this.formas = new Uint8Array(0);
    this.destellos = new Float64Array(0);
    this.paso = 16; this.cols = 1; this.filasVisibles = 1; this.x0 = 0; this.ancho = 0; this.alto = 0; this.dpr = 1;
    this.grupo = null;
    this.hover = -1;
    this.foco = -1;
    this.inicioPrueba = 0;
    this.ultimoCuadro = 0;
    this.raf = 0;
    this.visible = true;
    this.destruido = false;
    this.colores = this.leerColores();

    this.alMover = (ev) => this.moverPuntero(ev);
    this.alSalir = () => { this.hover = -1; this.ocultarTip(); this.lienzo.classList.remove("sobre-lampara"); this.programar(); };
    this.alClic = (ev) => { const i = this.indiceEn(ev); if (i >= 0) this.alElegir(i); };
    this.alTeclado = (ev) => this.teclado(ev);
    this.alEnfocar = () => { if (this.foco < 0 && this.n) { this.foco = 0; this.mostrarTip(0); this.programar(); } };
    this.alDesenfocar = () => { this.foco = -1; this.ocultarTip(); this.programar(); };
    this.alVisibilidad = () => { if (!document.hidden) this.programar(); };
    lienzo.addEventListener("pointermove", this.alMover);
    lienzo.addEventListener("pointerleave", this.alSalir);
    lienzo.addEventListener("click", this.alClic);
    lienzo.addEventListener("keydown", this.alTeclado);
    lienzo.addEventListener("focus", this.alEnfocar);
    lienzo.addEventListener("blur", this.alDesenfocar);
    document.addEventListener("visibilitychange", this.alVisibilidad);
    this.observadorTamano = new ResizeObserver(() => this.redimensionar());
    this.observadorTamano.observe(this.contenedor);
    this.observadorVista = new IntersectionObserver((entradas) => {
      this.visible = entradas.some((e) => e.isIntersecting);
      if (this.visible) { this.redimensionar(); this.programar(); }
    });
    this.observadorVista.observe(lienzo);
  }

  leerColores() {
    const cs = getComputedStyle(this.lienzo);
    const c = (nombre, defecto) => cs.getPropertyValue(nombre).trim() || defecto;
    return {
      curso: c("--t-curso", "#3987e5"), si: c("--t-si", "#199e70"), no: c("--t-no", "#c98500"),
      error: c("--t-error", "#d03b3b"), neutro: c("--t-neutro", "#5b6785"), tinta: c("--tablero-tinta", "#e8ecf7"),
    };
  }

  destruir() {
    this.destruido = true;
    cancelAnimationFrame(this.raf);
    this.lienzo.removeEventListener("pointermove", this.alMover);
    this.lienzo.removeEventListener("pointerleave", this.alSalir);
    this.lienzo.removeEventListener("click", this.alClic);
    this.lienzo.removeEventListener("keydown", this.alTeclado);
    this.lienzo.removeEventListener("focus", this.alEnfocar);
    this.lienzo.removeEventListener("blur", this.alDesenfocar);
    document.removeEventListener("visibilitychange", this.alVisibilidad);
    this.observadorTamano.disconnect();
    this.observadorVista.disconnect();
  }

  establecer(filas) {
    this.n = filas.length;
    this.formas = new Uint8Array(this.n);
    this.destellos = new Float64Array(this.n);
    for (let i = 0; i < this.n; i += 1) this.formas[i] = formaDe(filas[i]);
    this.hover = -1;
    this.foco = -1;
    this.redimensionar(true);
  }

  cambiar(i, fila, silencioso = false) {
    if (i < 0 || i >= this.n) return false;
    const nueva = formaDe(fila);
    if (nueva === this.formas[i]) return false;
    this.formas[i] = nueva;
    if (!silencioso && !sinMovimiento()) this.destellos[i] = performance.now();
    this.programar();
    return true;
  }

  filtrarGrupo(grupo) {
    this.grupo = grupo || null;
    this.programar();
  }

  prueba() {
    if (sinMovimiento() || !this.n) { this.programar(); return; }
    this.inicioPrueba = performance.now();
    this.programar();
  }

  medir(ancho) {
    const n = Math.max(1, this.n);
    const altoMax = ancho < 520 ? 340 : 460;
    let paso = n <= 40 ? 34 : 30;
    for (; paso > 9; paso -= 1) {
      const cols = Math.max(1, Math.floor(ancho / paso));
      if (Math.ceil(n / cols) * paso <= altoMax) break;
    }
    const cols = Math.max(1, Math.min(n, Math.floor(ancho / paso)));
    return { paso, cols, filas: Math.ceil(n / cols) };
  }

  redimensionar(forzar = false) {
    if (this.destruido) return;
    const ancho = Math.floor(this.contenedor.clientWidth);
    if (!ancho) return;
    const { paso, cols, filas } = this.medir(ancho);
    const alto = Math.max(filas * paso, 60);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!forzar && ancho === this.ancho && alto === this.alto && paso === this.paso && cols === this.cols && dpr === this.dpr) return;
    this.paso = paso; this.cols = cols; this.filasVisibles = filas; this.ancho = ancho; this.alto = alto; this.dpr = dpr;
    this.x0 = Math.floor((ancho - cols * paso) / 2);
    this.lienzo.width = Math.round(ancho * dpr);
    this.lienzo.height = Math.round(alto * dpr);
    this.lienzo.style.height = `${alto}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.programar();
  }

  programar() {
    if (this.raf || this.destruido) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      if (this.destruido) return;
      if (t - this.ultimoCuadro < 30 && this.hover < 0) { this.programar(); return; }
      this.ultimoCuadro = t;
      const sigue = this.dibujar(performance.now());
      if (sigue && this.visible && !document.hidden) this.programar();
    });
  }

  retraso(i) {
    const col = i % this.cols;
    const fila = Math.floor(i / this.cols);
    return (fila / Math.max(1, this.filasVisibles)) * 520 + (col / Math.max(1, this.cols)) * 260 + ruido(i) * 70;
  }

  dibujar(ahora) {
    const { ctx, n, paso, cols, x0, formas, destellos, colores } = this;
    ctx.clearRect(0, 0, this.ancho, this.alto);
    const r = paso * 0.34;
    const quieto = sinMovimiento();
    let anima = false;
    for (let i = 0; i < n; i += 1) {
      const cx = x0 + (i % cols) * paso + paso / 2;
      const cy = Math.floor(i / cols) * paso + paso / 2;
      const forma = formas[i];
      let alfa = 1;
      let esc = 1;

      if (this.inicioPrueba) {
        const t = ahora - this.inicioPrueba - this.retraso(i);
        if (t < 0) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = colores.neutro;
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.2, r * 0.22), 0, TAU); ctx.fill();
          anima = true;
          continue;
        }
        if (t < 340) { const p = t / 340; esc = salidaConRebote(p); alfa = Math.min(1, p * 2.2); anima = true; }
      }
      if (this.grupo && GRUPO_DE_FORMA[forma] !== this.grupo) alfa *= 0.14;

      const dt = ahora - destellos[i];
      if (destellos[i] && dt < 1000) {
        anima = true;
        const p = dt / 1000;
        esc *= 1 + 0.5 * Math.max(0, 1 - dt / 320);
        const color = forma === FORMA.SI ? colores.si : forma === FORMA.ERROR ? colores.error : forma === FORMA.NO ? colores.no : colores.curso;
        ctx.globalAlpha = alfa * (1 - p) * 0.9;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, r * (1.1 + 1.5 * p), 0, TAU); ctx.stroke();
      }

      ctx.globalAlpha = alfa;
      switch (forma) {
        case FORMA.PEND:
          ctx.globalAlpha = alfa * 0.55; ctx.fillStyle = colores.neutro;
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.4, r * 0.3), 0, TAU); ctx.fill();
          break;
        case FORMA.SIN: {
          const lado = r * 1.3 * esc;
          ctx.globalAlpha = alfa * 0.8; ctx.strokeStyle = colores.neutro; ctx.lineWidth = 1.5;
          ctx.strokeRect(cx - lado / 2, cy - lado / 2, lado, lado);
          break;
        }
        case FORMA.COLA:
          ctx.strokeStyle = colores.curso; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.85 * esc, 0, TAU); ctx.stroke();
          break;
        case FORMA.TIMBRE: {
          const p = (ahora % 1500) / 1500;
          if (!quieto) {
            anima = true;
            ctx.globalAlpha = alfa * (1 - p) * 0.85; ctx.strokeStyle = colores.curso; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.arc(cx, cy, r * (0.9 + 0.9 * p), 0, TAU); ctx.stroke();
            esc *= 1 + 0.07 * Math.sin(p * TAU);
          } else {
            ctx.globalAlpha = alfa * 0.45; ctx.strokeStyle = colores.curso; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.arc(cx, cy, r * 1.35, 0, TAU); ctx.stroke();
          }
          ctx.globalAlpha = alfa; ctx.fillStyle = colores.curso;
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.8 * esc, 0, TAU); ctx.fill();
          break;
        }
        case FORMA.LLAMADA: {
          if (!quieto) {
            anima = true;
            const p = (ahora % 2600) / 2600;
            ctx.globalAlpha = alfa * (1 - p) * 0.5; ctx.strokeStyle = colores.curso; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.arc(cx, cy, r * (1 + 0.8 * p), 0, TAU); ctx.stroke();
          }
          ctx.globalAlpha = alfa; ctx.fillStyle = colores.curso;
          ctx.beginPath(); ctx.arc(cx, cy, r * esc, 0, TAU); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.3 * esc, 0, TAU); ctx.fill();
          break;
        }
        case FORMA.SI:
          ctx.fillStyle = colores.si;
          ctx.beginPath(); ctx.arc(cx, cy, r * esc, 0, TAU); ctx.fill();
          break;
        case FORMA.NO:
          ctx.strokeStyle = colores.no; ctx.lineWidth = Math.max(1.8, r * 0.34);
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.88 * esc, 0, TAU); ctx.stroke();
          break;
        case FORMA.ERROR: {
          const d = r * 1.18 * esc;
          ctx.fillStyle = colores.error;
          ctx.beginPath(); ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy); ctx.closePath(); ctx.fill();
          break;
        }
        default: break;
      }
    }
    const marcada = this.hover >= 0 ? this.hover : this.foco;
    if (marcada >= 0 && marcada < n) {
      const cx = x0 + (marcada % cols) * paso + paso / 2;
      const cy = Math.floor(marcada / cols) * paso + paso / 2;
      ctx.globalAlpha = 0.95; ctx.strokeStyle = colores.tinta; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r + 4.5, 0, TAU); ctx.stroke();
    }
    if (this.inicioPrueba && ahora - this.inicioPrueba > 1700) this.inicioPrueba = 0;
    ctx.globalAlpha = 1;
    return anima;
  }

  indiceEn(ev) {
    const caja = this.lienzo.getBoundingClientRect();
    const x = ev.clientX - caja.left - this.x0;
    const y = ev.clientY - caja.top;
    if (x < 0 || y < 0) return -1;
    const col = Math.floor(x / this.paso);
    const fila = Math.floor(y / this.paso);
    if (col >= this.cols) return -1;
    const i = fila * this.cols + col;
    return i >= 0 && i < this.n ? i : -1;
  }

  moverPuntero(ev) {
    const i = this.indiceEn(ev);
    this.lienzo.classList.toggle("sobre-lampara", i >= 0);
    if (i === this.hover) return;
    this.hover = i;
    if (i >= 0) this.mostrarTip(i); else this.ocultarTip();
    this.programar();
  }

  teclado(ev) {
    if (!this.n) return;
    const mover = (d) => {
      const base = this.foco >= 0 ? this.foco : 0;
      this.foco = Math.min(this.n - 1, Math.max(0, base + d));
      this.hover = -1;
      this.mostrarTip(this.foco);
      this.programar();
      ev.preventDefault();
    };
    switch (ev.key) {
      case "ArrowRight": mover(1); break;
      case "ArrowLeft": mover(-1); break;
      case "ArrowDown": mover(this.cols); break;
      case "ArrowUp": mover(-this.cols); break;
      case "Home": mover(-this.n); break;
      case "End": mover(this.n); break;
      case "Enter": case " ": if (this.foco >= 0) { this.alElegir(this.foco); ev.preventDefault(); } break;
      default: break;
    }
  }

  mostrarTip(i) {
    const fila = this.obtenerFila(i);
    vaciar(this.tip);
    if (!fila) {
      this.tip.appendChild(h("b", null, `Contacto ${i + 1}`));
      this.tip.appendChild(h("span", null, "Sin datos todavía"));
    } else {
      const info = infoFila(fila, this.tipo);
      const titulo = fila.nombre || telefono(fila.numero);
      this.tip.appendChild(h("b", null, titulo));
      if (fila.nombre) this.tip.appendChild(h("span", null, telefono(fila.numero)));
      this.tip.appendChild(h("span", { class: "resultado" }, lampara(info.forma, info.tono, info.fase), info.etiqueta));
      if (fila.duracion) this.tip.appendChild(h("span", null, `Duración ${dur(fila.duracion)}`));
      if (fila.voz) this.tip.appendChild(h("span", null, `Voz ${fila.voz}`));
      if (fila.inc && fila.inc.titulo) this.tip.appendChild(h("span", null, fila.inc.titulo));
    }
    const cx = this.x0 + (i % this.cols) * this.paso + this.paso / 2;
    const cy = Math.floor(i / this.cols) * this.paso + this.paso / 2;
    this.tip.classList.add("visible");
    const ancho = this.tip.offsetWidth;
    const alto = this.tip.offsetHeight;
    let izq = cx + this.paso * 0.7;
    if (izq + ancho > this.ancho) izq = cx - ancho - this.paso * 0.7;
    let arriba = cy + this.paso * 0.7;
    if (arriba + alto > this.alto + 40) arriba = cy - alto - this.paso * 0.7;
    this.tip.style.left = `${Math.max(0, izq)}px`;
    this.tip.style.top = `${Math.max(0, arriba)}px`;
  }

  ocultarTip() {
    this.tip.classList.remove("visible");
  }
}
