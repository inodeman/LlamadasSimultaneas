const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const twilio = require("twilio");

const rawSid = process.env.TWILIO_ACCOUNT_SID || "";
const rawToken = process.env.TWILIO_AUTH_TOKEN || "";
const fromNumber = (process.env.TWILIO_PHONE_NUMBER || "").trim();
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");

const args = process.argv.slice(2);
const llamarIdx = args.indexOf("--llamar");
const destino = llamarIdx >= 0 ? (args[llamarIdx + 1] || "").trim() : null;

const problemas = [];
const avisos = [];

function linea(texto) {
  console.log(texto);
}

function describirError(err) {
  const partes = [];
  if (err && err.status) partes.push(`HTTP ${err.status}`);
  if (err && err.code) partes.push(`codigo Twilio ${err.code}`);
  partes.push(err && err.message ? err.message : String(err));
  if (err && err.moreInfo) partes.push(err.moreInfo);
  return partes.join(" | ");
}

function esErrorDeCredenciales(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  if (err.code === 20003 || err.code === 20005 || err.code === 10001) return true;
  const msg = String(err.message || "").toLowerCase();
  return msg.includes("authenticat") || msg.includes("not active") || msg.includes("suspended");
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function revisarFormato() {
  const sid = rawSid.trim();
  const token = rawToken.trim();

  linea("1. Variables de entorno");
  linea(`   Carpeta del script : ${__dirname}`);
  linea(`   Archivo .env       : ${path.join(__dirname, ".env")}`);
  linea(`   TWILIO_ACCOUNT_SID : ${sid || "(vacio)"}`);
  linea(`   TWILIO_AUTH_TOKEN  : ${token ? `${token.length} caracteres, termina en ...${token.slice(-4)}` : "(vacio)"}`);
  linea(`   TWILIO_PHONE_NUMBER: ${fromNumber || "(vacio)"}`);
  linea(`   PUBLIC_BASE_URL    : ${publicBaseUrl || "(vacio)"}`);

  if (!sid || !token) {
    problemas.push("Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en el archivo .env de esta carpeta.");
    return false;
  }
  if (rawSid !== sid || rawToken !== token) {
    problemas.push("El SID o el Auth Token tienen espacios al inicio o al final. Quitalos en el .env.");
  }
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
    problemas.push("El Account SID no tiene el formato correcto (debe empezar con AC y tener 34 caracteres).");
  }
  if (!/^[0-9a-fA-F]{32}$/.test(token)) {
    problemas.push("El Auth Token no tiene el formato correcto (deben ser 32 caracteres hexadecimales). Revisa que no tenga comillas ni caracteres extra.");
  }
  if (!/^\+[1-9][0-9]{7,14}$/.test(fromNumber)) {
    problemas.push("TWILIO_PHONE_NUMBER debe estar en formato internacional, por ejemplo +526567380528.");
  }
  if (!publicBaseUrl || /localhost|127\.0\.0\.1/.test(publicBaseUrl)) {
    avisos.push("PUBLIC_BASE_URL esta vacio o apunta a localhost. Twilio no podra enviar los estados de las llamadas y el panel de estatus no se actualizara. Debe ser la URL publica del servidor, por ejemplo http://147.182.177.22");
  }
  return true;
}

async function revisarCuenta(client, sid) {
  linea("");
  linea("2. Cuenta de Twilio");
  try {
    const cuenta = await client.api.v2010.accounts(sid).fetch();
    linea(`   Nombre : ${cuenta.friendlyName}`);
    linea(`   Estado : ${cuenta.status}`);
    linea(`   Tipo   : ${cuenta.type}`);
    if (cuenta.status !== "active") {
      problemas.push(`La cuenta esta en estado "${cuenta.status}". Twilio no permite llamadas con una cuenta que no esta activa.`);
    }
    if (cuenta.type === "Trial") {
      avisos.push("La cuenta es de prueba (Trial): solo puede llamar a numeros verificados y antepone un mensaje de prueba. Hay que actualizarla a cuenta de pago.");
    }
    return true;
  } catch (err) {
    linea(`   No se pudo leer la cuenta: ${describirError(err)}`);
    if (esErrorDeCredenciales(err)) {
      problemas.push("Twilio rechazo la autenticacion. Con el SID correcto esto significa que la cuenta esta suspendida, cerrada o inactiva, o que el Auth Token ya no es el vigente (fue regenerado).");
    } else {
      problemas.push("No se pudo contactar a la API de Twilio desde este servidor. Revisa la conexion a internet o el firewall.");
    }
    return false;
  }
}

async function revisarSaldo(client) {
  linea("");
  linea("3. Saldo");
  try {
    const saldo = await client.balance.fetch();
    linea(`   Saldo: ${saldo.balance} ${saldo.currency}`);
    if (Number(saldo.balance) <= 0) {
      problemas.push("El saldo de la cuenta es cero o negativo. Twilio suspende la cuenta cuando se agota el saldo. Hay que recargar en la consola de Twilio.");
    } else if (Number(saldo.balance) < 5) {
      avisos.push("El saldo es menor a 5 USD; una campana grande puede agotarlo.");
    }
  } catch (err) {
    linea(`   No se pudo leer el saldo: ${describirError(err)}`);
  }
}

async function revisarNumero(client) {
  linea("");
  linea("4. Numero emisor");
  try {
    const numeros = await client.incomingPhoneNumbers.list({ limit: 100 });
    if (!numeros.length) {
      linea("   La cuenta no tiene numeros comprados.");
      problemas.push("La cuenta no tiene ningun numero de Twilio. Sin un numero emisor valido no se pueden hacer llamadas.");
      return;
    }
    numeros.forEach((n) => linea(`   ${n.phoneNumber}  (${n.friendlyName})`));
    const encontrado = numeros.some((n) => n.phoneNumber === fromNumber);
    if (!encontrado) {
      problemas.push(`El numero ${fromNumber} del .env no pertenece a esta cuenta. Usa uno de los numeros listados arriba.`);
    } else {
      linea(`   El numero ${fromNumber} pertenece a esta cuenta.`);
    }
  } catch (err) {
    linea(`   No se pudieron leer los numeros: ${describirError(err)}`);
  }
}

async function revisarPermisosMexico(client) {
  linea("");
  linea("5. Permisos de llamadas a Mexico");
  try {
    const pais = await client.voice.v1.dialingPermissions.countries("MX").fetch();
    linea(`   Numeros de bajo riesgo habilitados: ${pais.lowRiskNumbersEnabled ? "si" : "no"}`);
    if (!pais.lowRiskNumbersEnabled) {
      problemas.push("Las llamadas a Mexico no estan habilitadas en Voice Geographic Permissions. Activalas en la consola de Twilio.");
    }
  } catch (err) {
    linea(`   No se pudieron leer los permisos: ${describirError(err)}`);
  }
}

async function llamadaDePrueba(client) {
  linea("");
  linea(`6. Llamada de prueba a ${destino}`);
  try {
    const llamada = await client.calls.create({
      to: destino,
      from: fromNumber,
      twiml: '<Response><Say language="es-MX" voice="Polly.Mia">Esta es una llamada de prueba. El sistema funciona correctamente.</Say></Response>'
    });
    linea(`   Llamada creada: ${llamada.sid}`);
    let estadoFinal = llamada.status;
    for (let i = 0; i < 12; i += 1) {
      await esperar(3000);
      const actual = await client.calls(llamada.sid).fetch();
      estadoFinal = actual.status;
      linea(`   Estado: ${estadoFinal}`);
      if (["completed", "busy", "failed", "no-answer", "canceled"].includes(estadoFinal)) break;
    }
    if (["failed", "busy", "no-answer", "canceled"].includes(estadoFinal)) {
      avisos.push(`La llamada de prueba termino con estado "${estadoFinal}".`);
    }
  } catch (err) {
    linea(`   Fallo la llamada: ${describirError(err)}`);
    problemas.push(`La llamada de prueba fallo: ${describirError(err)}`);
  }
}

function imprimirResultado() {
  linea("");
  linea("RESULTADO");
  linea("=========");
  if (!problemas.length) {
    linea("No se encontraron problemas con la cuenta ni con la configuracion.");
  } else {
    linea("Problemas encontrados:");
    problemas.forEach((p, i) => linea(`  ${i + 1}. ${p}`));
  }
  if (avisos.length) {
    linea("");
    linea("Avisos:");
    avisos.forEach((a, i) => linea(`  ${i + 1}. ${a}`));
  }
  if (problemas.some((p) => p.includes("rechazo la autenticacion"))) {
    linea("");
    linea("Que hacer:");
    linea("  1. Entra a https://console.twilio.com e inicia sesion con la cuenta duena del SID mostrado arriba.");
    linea("  2. Revisa si hay un aviso de cuenta suspendida o cerrada, o saldo en cero (Billing).");
    linea("  3. Si esta suspendida por saldo, recarga; la reactivacion tarda de 5 a 10 minutos.");
    linea("  4. Si el estado es Closed, esa cuenta no se puede reabrir: usa otra cuenta y cambia SID, Auth Token y numero en el .env del servidor.");
    linea("  5. Si la cuenta esta activa, copia de nuevo el Auth Token desde Account Info (puede haber sido regenerado) y actualiza el .env.");
    linea("  6. Despues de cambiar el .env en el servidor, reinicia la aplicacion para que lea los valores nuevos.");
  }
}

async function main() {
  linea("Verificacion de Twilio");
  linea("======================");
  linea("");

  const puedeContinuar = revisarFormato();
  if (!puedeContinuar) {
    imprimirResultado();
    process.exit(1);
  }

  const sid = rawSid.trim();
  const client = twilio(sid, rawToken.trim());

  const cuentaAccesible = await revisarCuenta(client, sid);
  if (cuentaAccesible) {
    await revisarSaldo(client);
    await revisarNumero(client);
    await revisarPermisosMexico(client);
    if (destino) {
      await llamadaDePrueba(client);
    }
  } else if (destino) {
    linea("");
    linea("6. Llamada de prueba omitida porque la cuenta no es accesible.");
  }

  imprimirResultado();
  process.exit(problemas.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Error inesperado:", err && err.message ? err.message : err);
  process.exit(1);
});
