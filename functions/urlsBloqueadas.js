/* Lista negra de URLs de fuente confirmadas rotas a mano. Existe porque el sistema
   decide, a propósito, no verificar por red que una `fuenteUrl` sigue respondiendo
   (ver el comentario sobre 757ff2a en analisisMercadoPrompts.js): sitios como el FMI o
   el Banco de la República bloquean peticiones automatizadas, así que un chequeo por
   fetch da falsos positivos. La única fuente de verdad de "esto está roto" es que un
   humano lo abrió en el navegador y lo confirmó — y sin esta lista esa confirmación se
   olvida: una corrida nueva de Gemini/Claude puede volver a citar la misma URL muerta,
   como pasó con swissinfo.ch (limpiada a mano el 2026-08-19 en 757ff2a, y reapareció en
   corridas posteriores porque nada recordaba que ya estaba descartada).

   Debe existir una copia idéntica en frontend/src/services/urlsBloqueadas.js — mismo
   motivo que el resto de los pares functions/frontend: no comparten código (ver
   CLAUDE.md). Agregar una URL nueva aquí no requiere tocar Firestore. */
const URLS_BLOQUEADAS = new Set([
  // Confirmadas 404 el 2026-08-19 al revisar el caso BEUMER GROUP COLOMBIA S.A.S.
  'https://www.swissinfo.ch/spa/el-fmi-reduce-al-2%2C3-%25-la-prevision-de-crecimiento-economico-de-colombia-para-2026/75704944',
  'https://www.infobae.com/colombia/2026/07/08/el-fmi-confirmo-que-espera-que-la-economia-colombiana-no-crezca-mucho-al-cierre-de-2026-estas-son-las-preocupantes-razones/',
  'https://www.larepublica.co/finanzas/a-pesar-de-las-caidas-los-analistas-no-prevean-que-el-dolar-llegue-a-2000-3949111',
  'https://www.larepublica.co/economia/dane-reporto-que-72-de-los-subsectores-de-servicios-tuvieron-mejores-ingresos-3881387',
  'https://www.dnp.gov.co/Paginas/Historico-Gobierno-nacional-destina-una-inversion-de-$6,54-billones-para-la-modernizacion-de-la-infraestructura-aeroportuaria-de-Colombia.aspx',
  'https://reportcolombia.com/que-pasa-con-el-manejo-del-equipaje-en-latinoamerica/',
  // Carga, pero el contenido no corresponde a lo citado (informe de cuidado del
  // cabello en vez del mercado de sistemas de manejo de equipaje aeroportuario).
  'https://www.fortunebusinessinsights.com/airport-baggage-handling-system-market-102555',
  // DANE y Banco de la República: confirmadas rotas a mano en navegador normal
  // (no es bloqueo de bot — el usuario tampoco pudo abrirlas). Todas usan patrones
  // de URL de antes de un rediseño de sitio (dane.gov.co/index.php/... , páginas
  // puntuales de comunicado de prensa del Banrep); el buscador de Google las sigue
  // indexando aunque el sitio ya se movió.
  'https://www.banrep.gov.co/es/estadisticas/tasa-intervencion-politica-monetaria',
  'https://www.banrep.gov.co/es/estadisticas/tasa-cambio-peso-colombiano-trm',
  'https://www.banrep.gov.co/es/junta-directiva-decidio-reducir-tasa-politica-monetaria-9-5',
  'https://www.banrep.gov.co/es/junta-directiva-decidio-mantener-tasa-politica-monetaria-9-25',
  'https://www.banrep.gov.co/es/junta-directiva-decidio-mantener-tasa-politica-monetaria-12-0',
  'https://www.aerocivil.gov.co/prensa/noticias/Paginas/Gobierno-Nacional-fortalece-la-infraestructura-del-Aeropuerto-Ernesto-Cortissoz-con-inversiones-historicas.aspx',
  'https://www.aerocivil.gov.co/prensa/noticias/Paginas/2024-Record-historico-en-pasajeros-y-carga-aerea-desde-y-hacia-El-Pais-de-la-Belleza.aspx',
  'https://www.dane.gov.co/index.php/estadisticas-por-tema/precios-y-costos/indice-de-precios-al-consumidor-ipc',
  'https://www.dane.gov.co/index.php/estadisticas-por-tema/cuentas-nacionales/cuentas-nacionales-anuales',
  'https://www.dane.gov.co/index.php/estadisticas-por-tema/mercado-laboral/empleo-y-desempleo',
]);

function esUrlBloqueada(url) {
  return !!url && URLS_BLOQUEADAS.has(url);
}

module.exports = { URLS_BLOQUEADAS, esUrlBloqueada };
