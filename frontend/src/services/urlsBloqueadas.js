/* Copia idéntica de functions/urlsBloqueadas.js — no comparten código (ver CLAUDE.md).
   Lista negra de URLs de fuente confirmadas rotas a mano, para que la redacción en vivo
   por estudio (analisisMercadoRedaccion.js) no vuelva a citar una URL que ya se
   confirmó muerta en una corrida anterior. Agregar una URL nueva aquí no requiere tocar
   Firestore. */
export const URLS_BLOQUEADAS = new Set([
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

export function esUrlBloqueada(url) {
  return !!url && URLS_BLOQUEADAS.has(url);
}
