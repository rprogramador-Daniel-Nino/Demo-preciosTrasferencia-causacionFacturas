'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   limitadorTasa.js — Tope de peticiones por IP para /api/claude y /api/gemini.

   POR QUÉ EXISTE. Son funciones HTTP públicas (ver origenesPermitidos.js): sin
   esto, una sola IP puede repetir la petición sin límite y agotar la cuota de
   Anthropic/Gemini en minutos. Ventana deslizante simple, en memoria: no hace
   falta Firestore/Redis para esto, y una instancia de Cloud Functions vive lo
   bastante para que la ventana de un minuto tenga sentido.

   POR QUÉ EN MEMORIA Y NO COMPARTIDO. Con varias instancias concurrentes
   (`concurrency`/autoscaling) cada una lleva su propio conteo, así que el tope
   real es "N por IP por instancia", no un tope global exacto. Sigue acotando el
   caso que importa —un cliente insistiendo en bucle contra una misma
   instancia— sin añadir una dependencia nueva por un límite que no necesita ser
   exacto.

   `ahora` es inyectable para poder probar la ventana sin `setTimeout` real. */
function crearLimitadorPorIp({ maxPorMinuto = 20, ventanaMs = 60_000, ahora = Date.now } = {}) {
  const peticionesPorIp = new Map();

  function permitir(ip) {
    const clave = ip || 'desconocida';
    const corte = ahora() - ventanaMs;
    const previas = (peticionesPorIp.get(clave) || []).filter((t) => t > corte);
    if (previas.length >= maxPorMinuto) {
      peticionesPorIp.set(clave, previas);
      return false;
    }
    previas.push(ahora());
    peticionesPorIp.set(clave, previas);
    return true;
  }

  return { permitir };
}

/** IP real del cliente detrás del proxy de Cloud Functions/Cloud Run. Sin esto,
 *  `req.ip` puede resolver a la IP del balanceador y todo el tráfico compartiría
 *  un solo cupo. */
function ipDeLaPeticion(req) {
  const adelante = req.get ? req.get('x-forwarded-for') : (req.headers && req.headers['x-forwarded-for']);
  if (adelante) return String(adelante).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

module.exports = { crearLimitadorPorIp, ipDeLaPeticion };
