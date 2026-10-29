"use strict";

class Eventos {
  constructor() {
    this.clientes = new Set();
    this.latido = setInterval(() => this.enviarLatido(), 15000);
    if (this.latido.unref) this.latido.unref();
  }

  agregar(req, res, campanaId) {
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write("retry: 3000\n\n");
    const cliente = { res, campanaId: campanaId || null };
    this.clientes.add(cliente);
    const quitar = () => this.clientes.delete(cliente);
    req.on("close", quitar);
    res.on("error", quitar);
    return cliente;
  }

  escribir(cliente, texto) {
    try {
      if (cliente.res.writableLength > 2 * 1024 * 1024) {
        this.clientes.delete(cliente);
        cliente.res.end();
        return;
      }
      cliente.res.write(texto);
    } catch (err) {
      this.clientes.delete(cliente);
    }
  }

  enviar(cliente, tipo, datos) {
    this.escribir(cliente, `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`);
  }

  emitir(tipo, datos, campanaId) {
    if (!this.clientes.size) return;
    const texto = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
    for (const cliente of this.clientes) {
      if (campanaId && cliente.campanaId !== campanaId) continue;
      this.escribir(cliente, texto);
    }
  }

  enviarLatido() {
    for (const cliente of this.clientes) this.escribir(cliente, `: latido ${Date.now()}\n\n`);
  }

  cantidad() {
    return this.clientes.size;
  }

  cerrarTodos() {
    clearInterval(this.latido);
    for (const cliente of this.clientes) {
      try { cliente.res.end(); } catch (err) { }
    }
    this.clientes.clear();
  }
}

module.exports = { Eventos };
