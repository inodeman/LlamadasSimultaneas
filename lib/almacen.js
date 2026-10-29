"use strict";
const fs = require("fs");
const path = require("path");

class Almacen {
  constructor(directorio, opciones = {}) {
    this.dir = directorio;
    this.dirCampanas = path.join(directorio, "campanas");
    this.retardoMs = opciones.retardoMs === undefined ? 2500 : opciones.retardoMs;
    this.sucias = new Map();
    this.escribiendo = new Set();
    this.eliminadas = new Set();
    this.cerrado = false;
    this.disponible = false;
  }

  iniciar() {
    try {
      fs.mkdirSync(this.dirCampanas, { recursive: true });
      this.disponible = true;
    } catch (err) {
      console.error(`No se pudo crear la carpeta de datos ${this.dirCampanas}: ${err.message}. Las campañas no se guardarán en disco.`);
      this.disponible = false;
    }
    return this.disponible;
  }

  rutaCampana(id) {
    return path.join(this.dirCampanas, `${String(id).replace(/[^A-Za-z0-9_-]/g, "")}.json`);
  }

  cargarTodas() {
    if (!this.disponible) return [];
    const campanas = [];
    let archivos = [];
    try {
      archivos = fs.readdirSync(this.dirCampanas).filter((f) => f.endsWith(".json"));
    } catch (err) {
      return [];
    }
    archivos.forEach((archivo) => {
      const ruta = path.join(this.dirCampanas, archivo);
      try {
        const campana = JSON.parse(fs.readFileSync(ruta, "utf8"));
        if (campana && campana.id && Array.isArray(campana.resultados)) campanas.push(campana);
      } catch (err) {
        console.error(`Archivo de campaña dañado (${archivo}): ${err.message}. Se conserva como .corrupto`);
        try { fs.renameSync(ruta, `${ruta}.corrupto`); } catch (e) { }
      }
    });
    campanas.sort((a, b) => String(a.creada).localeCompare(String(b.creada)));
    return campanas;
  }

  guardar(campana, inmediato = false) {
    if (!this.disponible || !campana || this.cerrado || this.eliminadas.has(campana.id)) return;
    const previo = this.sucias.get(campana.id);
    if (previo && !inmediato) {
      previo.campana = campana;
      return;
    }
    if (previo) clearTimeout(previo.temporizador);
    const entrada = { campana, temporizador: null };
    this.sucias.set(campana.id, entrada);
    entrada.temporizador = setTimeout(() => {
      this.sucias.delete(campana.id);
      this.escribir(entrada.campana).catch((err) => console.error(`No se pudo guardar ${campana.id}: ${err.message}`));
    }, inmediato ? 0 : this.retardoMs);
    if (entrada.temporizador.unref) entrada.temporizador.unref();
  }

  async escribir(campana) {
    if (this.escribiendo.has(campana.id)) {
      this.guardar(campana);
      return;
    }
    this.escribiendo.add(campana.id);
    try {
      const ruta = this.rutaCampana(campana.id);
      const temporal = `${ruta}.${process.pid}.tmp`;
      await fs.promises.writeFile(temporal, JSON.stringify(campana));
      if (this.eliminadas.has(campana.id)) {
        await fs.promises.unlink(temporal).catch(() => {});
        return;
      }
      await fs.promises.rename(temporal, ruta);
    } finally {
      this.escribiendo.delete(campana.id);
    }
  }

  escribirSync(campana) {
    if (!this.disponible || !campana) return;
    try {
      const ruta = this.rutaCampana(campana.id);
      const temporal = `${ruta}.${process.pid}.sync.tmp`;
      fs.writeFileSync(temporal, JSON.stringify(campana));
      fs.renameSync(temporal, ruta);
    } catch (err) {
      console.error(`No se pudo guardar ${campana.id}: ${err.message}`);
    }
  }

  vaciarSync() {
    for (const [id, entrada] of this.sucias.entries()) {
      clearTimeout(entrada.temporizador);
      this.escribirSync(entrada.campana);
      this.sucias.delete(id);
    }
    this.cerrado = true;
  }

  eliminar(id) {
    this.eliminadas.add(id);
    const entrada = this.sucias.get(id);
    if (entrada) {
      clearTimeout(entrada.temporizador);
      this.sucias.delete(id);
    }
    try { fs.unlinkSync(this.rutaCampana(id)); } catch (err) { }
  }

  leerJson(nombre, defecto) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, nombre), "utf8"));
    } catch (err) {
      return defecto;
    }
  }

  escribirJson(nombre, datos) {
    if (!this.disponible) return false;
    try {
      const ruta = path.join(this.dir, nombre);
      const temporal = `${ruta}.${process.pid}.tmp`;
      fs.writeFileSync(temporal, JSON.stringify(datos, null, 2));
      fs.renameSync(temporal, ruta);
      return true;
    } catch (err) {
      console.error(`No se pudo guardar ${nombre}: ${err.message}`);
      return false;
    }
  }
}

module.exports = { Almacen };
