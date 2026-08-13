/* Sección III del Informe Local — TENDENCIAS DE LA ECONOMÍA.
   Datos macroeconómicos, generadores de sus ocho tablas y el apartado sectorial.

   Por qué existe este módulo: esas doce páginas venían como texto fijo del informe
   de End Game Interactive 2024 (sector videojuegos) y solo dos de sus ocho tablas
   se actualizaban. Para cualquier otro cliente el informe salía con datos macro
   atribuidos a años que no les corresponden y con el análisis sectorial de una
   empresa de videojuegos.

   El monolito ya había corregido este mismo defecto en su Bloque 4
   (index.html, «ANÁLISIS MUNDIAL, COLOMBIANO Y DEL SECTOR») cuando el texto
   precargado estaba redactado para una compañía agroquímica. Se porta su criterio:
   macro neutro respecto del sector, apartado sectorial construido con la actividad
   real del contribuyente, y ninguna cifra afirmada sin respaldo.

   Sobre la fecha de consulta: el numeral 4 del artículo 1.2.2.2.1.5 del Decreto
   1625 de 2016 exige indicar la fuente y la fecha de consulta de cada cifra. Aquí
   se anota la publicación de la que sale cada serie (FUENTES_MACRO), pero NO una
   fecha de consulta: nadie registró cuándo se consultaron estos valores, y
   fabricar esa fecha sería precisamente el vicio que la norma quiere evitar. Quien
   radique debe verificar cada cifra contra su fuente. */

/* ─────────────────────────────────────────────────────────────────────────────
   1. SERIES MACRO
   Un mapa año → valor por serie. Los años ausentes NO se rellenan: producen un
   marcador visible (ver marcadorPendiente) en lugar de una cifra de otro año.
   ───────────────────────────────────────────────────────────────────────────── */

export const DATOS_MACRO = {
  pib_mundial: {
    2022: '3.5',
    2023: '3.2',
    2024: '3.3',
    2025: '3.2',
    2026: '3.2',
    2027: '3.1',
  },

  pib_colombia: {
    2022: '7.3',
    2023: '0.6',
    2024: '1.7',
    2025: '2.6',
    2026: '3.0',
    2027: '3.2',
  },

  inflacion_global: {
    2022: '10.7',
    2023: '6.8',
    2024: '5.9',
    2025: '4.5',
    2026: '3.8',
  },

  inflacion_colombia: {
    2024: '5.2',
    2025: '5.1',
    2026: '3.8',
  },

  /* Meta puntual de inflación del Banco de la República. Es una meta de política,
     no una serie observada: no cambia con el año gravable. */
  meta_inflacion_banrep: '3.0',

  /* Tasa de intervención del Banco de la República. A diferencia de las demás,
     estas son observaciones puntuales y no promedios anuales, así que cada una
     conserva su etiqueta original: reetiquetar «marzo de 2023» como «2023» daría
     por anual un máximo que fue de un mes.

     2026 verificado el 2026-08-04: la Junta Directiva la mantuvo en 12,00% para
     agosto (decisión del 31 de julio de 2026, El Tiempo). Reemplaza un valor
     anterior de 6,75% etiquetado «Diciembre 2026» que databa una decisión de un
     mes todavía futuro en ese momento — no podía ser un dato observado. Este
     valor de agosto también quedará desactualizado en cuanto la Junta vuelva a
     reunirse (próxima reunión, previsiblemente en septiembre); quien radique
     debe volver a verificarlo contra la fuente. */
  tasa_intervencion: {
    2023: { etiqueta: 'Marzo 2023 (máximo del ciclo)', valor: '13.25' },
    2024: { etiqueta: 'Diciembre 2024', valor: '9.50' },
    2025: { etiqueta: 'Diciembre 2025', valor: '8.50' },
    2026: { etiqueta: 'Agosto 2026', valor: '12.00' },
  },

  trm_promedio: {
    2023: '4325',
    2024: '4062',
    2025: '4120',
    2026: '4180',
  },

  desempleo_colombia: {
    2024: '9.7',
    2025: '9.0',
    2026: '8.8',
  },

  /* Proyecciones por región para un año dado. No es una serie temporal: cada año
     trae su propio corte de regiones.

     Arreglo de objetos planos y no de pares [region, valor]: Firestore prohíbe
     que un elemento de un arreglo sea a su vez un arreglo, y esta misma forma
     viaja desde functions/ (analisisMercadoActualizar.js la escribe en
     analisisMercado/actual). Con pares anidados, el set() del cron fallaba y —
     por ser una escritura atómica— se perdía el mes entero, no solo esta serie. */
  crecimiento_por_region: {
    2025: [
      { region: 'Mundial', valor: '2.8' },
      { region: 'Estados Unidos', valor: '1.8' },
      { region: 'China', valor: '4.0' },
      { region: 'América Latina', valor: '2.3' },
      { region: 'Colombia (OCDE)', valor: '2.8' },
    ],
    2026: [
      { region: 'Mundial', valor: '3.0' },
      { region: 'Estados Unidos', valor: '2.0' },
      { region: 'China', valor: '4.6' },
      { region: 'América Latina', valor: '2.3' },
      { region: 'Colombia (OCDE)', valor: '2.4' },
    ],
  },
};

export const FUENTES_MACRO = {
  pib_mundial: 'Fondo Monetario Internacional (FMI), Informe de Perspectivas de la Economía Mundial (World Economic Outlook - WEO)',
  pib_colombia: 'Departamento Administrativo Nacional de Estadística (DANE), Dirección de Síntesis y Cuentas Nacionales',
  inflacion_global: 'Organización para la Cooperación y el Desarrollo Económicos (OCDE) / Fondo Monetario Internacional (FMI)',
  inflacion_colombia: 'Departamento Administrativo Nacional de Estadística (DANE), Índice de Precios al Consumidor (IPC)',
  tasa_intervencion: 'Banco de la República de Colombia, Junta Directiva - Informes de Política Monetaria',
  trm_promedio: 'Banco de la República de Colombia, Serie de Tasa Representativa del Mercado (TRM)',
  desempleo_colombia: 'Departamento Administrativo Nacional de Estadística (DANE), Gran Encuesta Integrada de Hogares (GEIH)',
  crecimiento_por_region: 'Fondo Monetario Internacional (FMI), WEO / OCDE Economic Outlook',
};

/* ─────────────────────────────────────────────────────────────────────────────
   2. MARCADOR DE DATO PENDIENTE
   ───────────────────────────────────────────────────────────────────────────── */

/** Texto que ocupa el lugar de una cifra que no tenemos, en vez de un guion mudo
 *  o —peor— el valor de otro año. */
export function marcadorPendiente(anio, concepto) {
  return (
    '[Completar con ' + concepto + ' de ' + anio + ' e indicar fuente y fecha de consulta, ' +
    'conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016]'
  );
}

/** La fuente de un valor suelto, entre paréntesis y con la URL a la vista. Texto plano y no
 *  un `<a>`: la misma celda se emite en HTML, en OOXML y en la ruta de PDF, y una URL
 *  escrita se puede copiar y verificar en las tres. */
function fuenteDelValor(v) {
  const partes = [String(v.fuente || '').trim(), String(v.fuenteUrl || '').trim()].filter(Boolean);
  return partes.length ? ' (' + partes.join(' — ') + ')' : '';
}

/**
 * Valor de una serie para un año, o el marcador si no está.
 *
 * Un año puede venir como cifra suelta o como `{ valor, fuente, fuenteUrl }`. La segunda
 * forma es la del año de PROYECCIÓN: quien publica el dato realizado no suele publicar el
 * pronóstico —el desempleo lo publica el DANE, pero quien lo proyecta es el FMI—, así que
 * esa cifra no la respalda la fuente del pie de la tabla y su enlace tiene que ir en la
 * propia celda, donde se pueda verificar sin salir del documento.
 *
 * Los arreglos (`crecimiento_por_region`, que guarda una lista de regiones por año) se
 * devuelven tal cual: no son un valor con fuente propia y su tabla los recorre ella misma.
 */
export function valorODisponible(serie, anio, concepto) {
  const v = serie && serie[anio];
  if (v === undefined || v === null || v === '') return marcadorPendiente(anio, concepto);
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') {
    const cifra = String(v.valor === undefined || v.valor === null ? '' : v.valor).trim();
    /* Un objeto sin cifra es una respuesta a medias: se marca pendiente en vez de publicar
       «[object Object]» o una fuente sin dato al que respaldar. */
    return cifra ? cifra + fuenteDelValor(v) : marcadorPendiente(anio, concepto);
  }
  return v;
}

/* ─────────────────────────────────────────────────────────────────────────────
   2b. PROYECCIÓN PROPIA, CUANDO NADIE LA PUBLICÓ

   Para el año siguiente al gravable el informe necesita un pronóstico, y no siempre
   existe uno publicado: el DANE publica el desempleo ocurrido, no el esperado, y a veces
   ni el FMI ni Fedesarrollo lo traen para Colombia. Hasta ahora esa casilla salía con
   «[Completar...]», es decir, con trabajo pendiente para quien radica el informe.

   La alternativa NO es que la IA se invente una cifra. Es calcularla aquí: una regresión
   lineal por mínimos cuadrados sobre los años ya observados de la propia serie —los
   mismos que el informe publica dos filas más arriba, con su fuente al pie—, y publicar
   junto al resultado el método, los puntos sobre los que se ajustó y el R² del ajuste.
   Determinista, reproducible y auditable: quien lo lea puede rehacer la cuenta.

   Va rotulada como estimación propia y con el aviso de que no es una cifra publicada.
   Esa distinción es el punto: una estimación propia declarada es defendible ante la DIAN;
   una estimación propia disfrazada de dato del FMI, no.
   ───────────────────────────────────────────────────────────────────────────── */

/** Cuántas observaciones exige la regresión. Con dos puntos la «tendencia» es la recta que
 *  los une: no hay ajuste que medir ni evidencia que enseñar, solo una extrapolación
 *  disfrazada de método. */
const MIN_OBSERVACIONES_TENDENCIA = 3;

/** Cuántos decimales usa la serie observada, para no delatar el cálculo con un
 *  «4052.8600000001» donde la fuente publica dos. */
function decimalesDe(valores) {
  return valores.reduce((max, v) => {
    const punto = String(v).indexOf('.');
    return Math.max(max, punto < 0 ? 0 : String(v).length - punto - 1);
  }, 0);
}

/**
 * Recta de mínimos cuadrados sobre los años observados de una serie, evaluada en `anio`.
 *
 * Solo se usan los años ANTERIORES al que se proyecta y cuyo valor sea una cifra: un año
 * posterior ya conocido no es historia sobre la que extrapolar, y un «N.D.» no es un dato.
 *
 * @returns {{valor:string, pendiente:number, r2:number, puntos:Array<[number,number]>}|null}
 *          `null` si no hay observaciones suficientes o si todos los años son el mismo.
 */
export function proyectarPorTendencia(serie, anio, opciones = {}) {
  const objetivo = Number(anio);
  /* Por defecto solo se mira hacia atrás (extrapolación, que es el caso del año que se
     proyecta). Con `soloAnteriores: false` entran también los años posteriores, y entonces
     un hueco intermedio se INTERPOLA entre los datos que lo rodean — un ajuste mucho más
     firme que extrapolar, porque el valor queda acotado por observaciones reales a los dos
     lados. */
  const soloAnteriores = opciones.soloAnteriores !== false;
  const puntos = Object.keys(serie || {})
    .map((k) => [Number(k), Number(serie[k])])
    .filter(([a, v]) => Number.isFinite(a) && Number.isFinite(v)
      && (soloAnteriores ? a < objetivo : a !== objetivo))
    .sort((p, q) => p[0] - q[0]);
  if (puntos.length < MIN_OBSERVACIONES_TENDENCIA) return null;

  const n = puntos.length;
  const mediaX = puntos.reduce((s, p) => s + p[0], 0) / n;
  const mediaY = puntos.reduce((s, p) => s + p[1], 0) / n;
  const sxx = puntos.reduce((s, p) => s + (p[0] - mediaX) ** 2, 0);
  /* Todos los años iguales: la recta sería vertical y no hay nada que proyectar. No puede
     pasar con años distintos, pero un `serie` con claves repetidas tras Number() sí. */
  if (sxx === 0) return null;
  const sxy = puntos.reduce((s, p) => s + (p[0] - mediaX) * (p[1] - mediaY), 0);
  const pendiente = sxy / sxx;
  const intercepto = mediaY - pendiente * mediaX;

  /* R² = 1 − SSres/SStot. Con SStot 0 (serie plana) el ajuste es exacto por definición. */
  const ssTot = puntos.reduce((s, p) => s + (p[1] - mediaY) ** 2, 0);
  const ssRes = puntos.reduce((s, p) => s + (p[1] - (intercepto + pendiente * p[0])) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  const decimales = decimalesDe(puntos.map((p) => serie[p[0]]));
  return {
    valor: (intercepto + pendiente * objetivo).toFixed(decimales),
    pendiente: Number(pendiente.toFixed(6)),
    r2: Number(r2.toFixed(4)),
    puntos,
    /* Fuera del rango observado es extrapolación; dentro, interpolación. Se dice cuál,
       porque no merecen la misma confianza. */
    extrapolacion: objetivo > puntos[puntos.length - 1][0] || objetivo < puntos[0][0],
  };
}

/** Cómo se llegó a la cifra y sobre qué datos, para poder rehacer la cuenta. */
function evidenciaDeTendencia(t) {
  const serie = t.puntos.map(([a, v]) => a + ': ' + v).join('; ');
  const sentido = t.pendiente === 0 ? 'sin variación' :
    (t.pendiente > 0 ? '+' : '') + t.pendiente.toFixed(2) + ' por año';
  return ' (estimación propia por ' + (t.extrapolacion ? 'extrapolación' : 'interpolación') +
    ' de tendencia lineal —mínimos cuadrados— sobre ' +
    t.puntos[0][0] + '-' + t.puntos[t.puntos.length - 1][0] + ' [' + serie + '], ' +
    sentido + ', R²=' + t.r2.toFixed(2) + '. No es una cifra publicada: verifíquela antes ' +
    'de radicar)';
}

/**
 * La cifra de un año de la Sección III, por orden de preferencia:
 *
 *   1. el valor publicado que trajo la corrida, con su fuente y su enlace si trae los suyos;
 *   2. si falta, una estimación propia calculada sobre los demás años de la serie, con su
 *      método, los datos que la sustentan y el R² del ajuste a la vista;
 *   3. y solo si no hay ni tres observaciones con las que estimar, el marcador de pendiente.
 *
 * El paso 2 existe porque la Sección III no puede radicarse con casillas «[Completar...]»:
 * eso no es una salvaguarda, es trabajo que queda para quien firma el informe. Una
 * estimación propia DECLARADA como tal, con su método y sus datos, es defendible; lo que no
 * lo es —y esta función tampoco hace— es pasarla por una cifra publicada.
 *
 * Un hueco intermedio se interpola entre los años que lo rodean; el año que se proyecta se
 * extrapola. `evidenciaDeTendencia` dice cuál de las dos fue.
 */
export function cifraODisponible(serie, anio, concepto) {
  const v = serie && serie[anio];
  if (!(v === undefined || v === null || v === '')) return valorODisponible(serie, anio, concepto);

  const tendencia = proyectarPorTendencia(serie, anio, { soloAnteriores: false });
  return tendencia
    ? tendencia.valor + evidenciaDeTendencia(tendencia)
    : marcadorPendiente(anio, concepto);
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. CONSTRUCCIÓN DE TABLAS
   El formato replica el que Word produjo en la plantilla original (una etiqueta
   por línea, cada celda con su <p> interno). Mantenerlo importa: el HTML se
   exporta como .doc y Word es sensible a esa anidación.
   ───────────────────────────────────────────────────────────────────────────── */

function celda(contenido, negrita) {
  const cuerpo = negrita ? '<strong>' + contenido + '</strong>' : String(contenido);
  return '<td>\n<p>\n' + cuerpo + '\n</p>\n</td>\n';
}

function fila(celdas) {
  return '<tr>\n' + celdas.join('') + '</tr>\n';
}

/** Tabla con título en negrita, una fila de encabezados, n filas de datos y pie de fuente ordenada. */
export function tablaHTML(titulo, encabezados, filas, fuente) {
  const pieFuente = fuente ? '\n<p>\n<strong>FUENTE:</strong> ' + fuente + '.\n</p>' : '';
  return (
    '<p>\n<strong>' + titulo + '</strong>\n</p>\n<table>\n' +
    fila(encabezados.map((h) => celda(h, true))) +
    filas.map((f) => fila(f.map((c) => celda(c, false)))).join('') +
    '</table>' + pieFuente
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. LOS OCHO GENERADORES
   Firma común (year, wrap): `wrap` resalta en el editor lo que se sustituyó, y
   lo inyecta el llamador para que este módulo no dependa de los estilos de la UI.
   La ventana es deslizante —año anterior, año gravable, proyección del siguiente—
   igual que hacían los dos generadores originales.
   ───────────────────────────────────────────────────────────────────────────── */

/** Fecha de consulta legible, o cadena vacía si no hay ninguna o no se puede
 *  interpretar. Acepta un Timestamp de Firestore (tiene .toDate()), un Date, o
 *  un valor serializable a fecha. */
function formatearFechaConsulta(fechaConsulta) {
  if (!fechaConsulta) return '';
  const fecha = typeof fechaConsulta.toDate === 'function' ? fechaConsulta.toDate() : new Date(fechaConsulta);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Serie y fuente para una clave: prioriza datosMacro (de Firestore) sobre el
 *  respaldo local embebido en el código. La fecha de consulta se anota junto a
 *  la fuente solo cuando la serie viene de Firestore: ahí sí se registró cuándo
 *  se consultó, y el numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de
 *  2016 la exige. Para el respaldo local no existe esa fecha y no se fabrica. */
export function resolverSerie(datosMacro, clave) {
  const remota = datosMacro && datosMacro.series && datosMacro.series[clave];
  if (remota && remota.valores) {
    let fuenteTexto = remota.fuente || FUENTES_MACRO[clave];
    if (remota.fuenteUrl) fuenteTexto += ' (' + remota.fuenteUrl + ')';
    const fecha = formatearFechaConsulta(remota.fechaConsulta);
    if (fecha) fuenteTexto += ', consultado el ' + fecha;
    return { valores: remota.valores, fuente: fuenteTexto };
  }
  return { valores: DATOS_MACRO[clave], fuente: FUENTES_MACRO[clave] };
}

export function generarTablaPibMundial(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_mundial');
  return tablaHTML(
    'Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')',
    ['Año', 'Crecimiento Mundial (%)'],
    [
      [wrap(y1), wrap(cifraODisponible(S, y1, 'el crecimiento del PIB mundial'))],
      [wrap(y2), wrap(cifraODisponible(S, y2, 'el crecimiento del PIB mundial'))],
      [wrap(y3) + ' (Proyección)', wrap(cifraODisponible(S, y3, 'la proyección de crecimiento del PIB mundial'))],
    ],
    fuente
  );
}

export function generarTablaPibColombia(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_colombia');
  return tablaHTML(
    'Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')',
    ['Año', 'Crecimiento del PIB (%)'],
    [
      [wrap(y1), wrap(cifraODisponible(S, y1, 'el crecimiento del PIB de Colombia'))],
      [wrap(y2), wrap(cifraODisponible(S, y2, 'el crecimiento del PIB de Colombia'))],
      [wrap(y3) + ' (Proyección OCDE)', wrap(cifraODisponible(S, y3, 'la proyección de crecimiento del PIB de Colombia'))],
    ],
    fuente
  );
}

export function generarTablaInflacionGlobal(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_global');
  return tablaHTML(
    'Tasas de Inflación Global (' + y1 + '-' + y3 + ')',
    ['Año', 'Tasa de Inflación (%)'],
    [
      [wrap(y1), wrap(cifraODisponible(S, y1, 'la inflación global'))],
      [wrap(y2), wrap(cifraODisponible(S, y2, 'la inflación global'))],
      [wrap(y3) + ' (Proyección)', wrap(cifraODisponible(S, y3, 'la proyección de inflación global'))],
    ],
    fuente
  );
}

/* `crecimiento_por_region` no es una serie temporal sino un corte de regiones por año, así
   que para estimar hay que darle la vuelta: sacar la lista de regiones vistas en cualquier
   año, y de cada una su serie año→valor. */

const REGIONES_POR_DEFECTO = ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'];

function regionesDeLaSerie(porAnio) {
  const vistas = [];
  Object.keys(porAnio || {}).sort().forEach((anio) => {
    (porAnio[anio] || []).forEach((r) => {
      if (r && r.region && !vistas.includes(r.region)) vistas.push(r.region);
    });
  });
  return vistas.length ? vistas : REGIONES_POR_DEFECTO;
}

function serieDeRegion(porAnio, region) {
  const serie = {};
  Object.keys(porAnio || {}).forEach((anio) => {
    const fila = (porAnio[anio] || []).find((r) => r && r.region === region);
    if (fila && fila.valor !== undefined && fila.valor !== null && fila.valor !== '') {
      serie[anio] = fila.valor;
    }
  });
  return serie;
}

export function generarTablaCrecimientoPorRegion(datosMacro, year, wrap) {
  const { valores: porAnio, fuente } = resolverSerie(datosMacro, 'crecimiento_por_region');
  const porRegion = porAnio[year];
  const titulo = 'Proyecciones de Crecimiento del PIB por Región/País (' + year + ')';
  if (!porRegion || !porRegion.length) {
    /* Sin corte del año NO se reutiliza el de otro —eso publicaría la proyección de un año
       ajeno como si fuera la de este—, pero tampoco se deja la tabla por completar: cada
       región se estima con SU propia serie a lo largo de los años que sí hay, por el mismo
       método y con la misma evidencia que `cifraODisponible`. Solo las regiones sin tres
       cortes conservan el marcador. */
    const regiones = regionesDeLaSerie(porAnio);
    return tablaHTML(titulo, ['Región/País', 'Crecimiento Proyectado (%)'],
      regiones.map((r) => [r, wrap(cifraODisponible(serieDeRegion(porAnio, r), year,
        'la proyección de crecimiento de ' + r))]),
      fuente);
  }
  return tablaHTML(titulo, ['Región/País', 'Crecimiento Proyectado (%)'],
    porRegion.map(({ region, valor }) => [region, wrap(valor)]),
    fuente);
}

export function generarTablaInflacionColombia(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_colombia');
  return tablaHTML(
    'Inflación en Colombia (' + year + ' vs. Meta ' + (year + 1) + ')',
    ['Indicador', 'Valor (%)'],
    [
      ['Inflación ' + wrap(year), wrap(cifraODisponible(S, year, 'la inflación de Colombia'))],
      ['Meta Inflación ' + wrap(year + 1), wrap(DATOS_MACRO.meta_inflacion_banrep)],
    ],
    fuente
  );
}

export function generarTablaTasaIntervencion(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'tasa_intervencion');
  const y1 = year - 1, y2 = year;
  /* Se toman las observaciones de los dos años de la ventana con su etiqueta
     original; si falta alguna, esa fila lleva el marcador. */
  const filas = [y1, y2].map((y) => {
    const obs = S[y];
    return obs
      ? [obs.etiqueta, wrap(obs.valor)]
      : ['Diciembre ' + y, wrap(marcadorPendiente(y, 'la tasa de intervención del Banco de la República'))];
  });
  const etiquetas = filas.map((f) => f[0]);
  return tablaHTML(
    'Tasa de Intervención del Banco de la República (' + etiquetas[0] + ' - ' + etiquetas[1] + ')',
    ['Fecha', 'Tasa de Intervención (%)'],
    filas,
    fuente
  );
}

export function generarTablaTRM(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'trm_promedio');
  return tablaHTML(
    'Tasa Representativa del Mercado (TRM) Promedio (' + y1 + '-' + y2 + ')',
    ['Año', 'TRM Promedio ($)'],
    [
      [wrap(y1), wrap(cifraODisponible(S, y1, 'la TRM promedio'))],
      [wrap(y2), wrap(cifraODisponible(S, y2, 'la TRM promedio'))],
    ],
    fuente
  );
}

export function generarTablaDesempleo(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'desempleo_colombia');
  return tablaHTML(
    'Tasa de Desempleo en Colombia (' + year + ' vs. Proyección ' + (year + 1) + ')',
    ['Indicador', 'Valor (%)'],
    [
      ['Desempleo ' + wrap(year), wrap(cifraODisponible(S, year, 'la tasa de desempleo'))],
      ['Desempleo Proyectado ' + wrap(year + 1), wrap(cifraODisponible(S, year + 1, 'la proyección de desempleo'))],
    ],
    fuente
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. APARTADO SECTORIAL (III.C)
   Variable por la actividad real del contribuyente (study.actividad_especifica),
   redactado por functions/analisisSectorActualizar.js (Gemini busca, Claude
   redacta) la primera vez que esa actividad aparece — ver
   frontend/src/components/ReporteGenerador.jsx. Se reutiliza entre todos los
   estudios que compartan la misma actividad: no vuelve a consumir IA para cada
   cliente nuevo del mismo sector. Sin esa corrida todavía, cae al respaldo
   genérico con marcador (comportamiento previo a esta funcionalidad).
   ───────────────────────────────────────────────────────────────────────────── */

/* El objeto social y la actividad vienen de OCR y pueden traer caracteres que
   rompen el HTML del informe.

   La comilla doble se escapa además de &, < y >: esta misma función escapa las
   URLs de narrativa.fuentesCitadas, que van dentro de un href="…" (ver
   generarApartadoColombia). Sin ella, una URL con comilla —viene de la IA, no la
   controlamos— se sale del atributo y puede inyectar HTML. En texto normal
   &quot; se muestra igual que la comilla, así que no cambia nada visible. */
function escaparHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Clave de reutilización entre estudios ──
   Copia idéntica de la que usa functions/analisisSectorPrompts.js: frontend
   decide qué leer/pedir, backend decide dónde escribir, y tienen que coincidir
   en la misma clave. No comparten código porque son entornos y formatos de
   módulo distintos (ESM vs. CommonJS). */

export function normalizarActividad(actividad) {
  return String(actividad || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash FNV-1a de 32 bits, en base36 — ver el comentario gemelo en
 *  functions/analisisSectorPrompts.js para el porqué de la forma. */
export function claveActividad(actividadNormalizada) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < actividadNormalizada.length; i++) {
    hash ^= actividadNormalizada.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'act_' + (hash >>> 0).toString(36);
}

/** La entrada de porAnio para el año pedido, o undefined si Firestore no
 *  tiene todavía una corrida para esta actividad+año. */
function entradaSector(analisisSector, year) {
  return analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)];
}

/** Título de III.C. Con corrida disponible, nombra la industria real
 *  (redactada por Claude, ver tituloSector); sin ella, cae al respaldo neutro
 *  anterior a esta funcionalidad. */
export function tituloSectorial(study, analisisSector, year) {
  const entrada = entradaSector(analisisSector, year);
  if (entrada && entrada.tituloSector) {
    return escaparHtml(titulosSectorial(entrada.tituloSector, year).apartado);
  }
  const ciiu = escaparHtml((study && study.ciiu) || '').trim();
  return ciiu
    ? 'Análisis del Sector económico de la Compañía (actividad CIIU ' + ciiu + ')'
    : 'Análisis del Sector económico de la Compañía';
}

/* ─────────────────────────────────────────────────────────────────────────────
   La tabla «Datos Clave del Sector» de III.C, en un solo sitio.

   La consumen las TRES rutas del informe: esta (que arma el apartado entero cuando la
   plantilla no lo trae), `actualizarApartadoSectorialOoxml` en `docxRelleno.js` y
   `actualizarApartadoSectorialHtml` en `tablasHtmlInforme.js`. Las dos últimas la
   regeneran sobre la tabla de la plantilla, y hasta el 2026-08-13 solo la .docx lo
   hacía: la ruta HTML dejaba intacta la tabla del informe de referencia, así que el
   documento se radicaba con las cifras del contribuyente anterior —«250.000 empleos
   (+13,69% vs 2022)»— bajo un encabezado que decía «2023 | 2024» mientras Firestore
   tenía las cinco filas verificadas del año en curso.

   Devuelven texto EN CRUDO, sin escapar: cada ruta escapa con lo suyo (`escaparHtml`
   aquí y en la de HTML, `escaparXml` en la de OOXML) y hacerlo aquí lo escaparía dos
   veces en unas y con las entidades equivocadas en otras.
   ───────────────────────────────────────────────────────────────────────────── */

/** Las filas de la tabla, en el orden de columnas que fija `cabecerasDatosClaveSector`.
 *  Un `valorAnterior` ausente sale como hueco visible y NUNCA como el valor de al lado:
 *  el año anterior sin dato es un dato en sí en un informe que se radica. */
export function filasDatosClaveSector(datosClaveTabla) {
  return (datosClaveTabla || []).map((f) => [
    String(f.indicador || ''),
    f.valorAnterior ? String(f.valorAnterior) : '—',
    String(f.valorActual || ''),
  ]);
}

/** Los años van en el encabezado, no en las filas: son el eje de comparación. */
export function cabecerasDatosClaveSector(year) {
  return ['Indicador Clave', String(year - 1), String(year)];
}

/** El rótulo lleva la industria redactada por Claude y los dos años comparados. Es la
 *  parte que la plantilla del informe anterior trae con SUS años («…(2023 vs. 2024)»). */
export function tituloDatosClaveSector(tituloSector, year) {
  return 'Datos Clave del Sector de la Industria ' + (tituloSector || '') +
    ' en Colombia (' + (year - 1) + ' vs. ' + year + ')';
}

/**
 * La línea «FUENTE:» de esa tabla, a partir de las fuentes que Gemini verificó para sus
 * filas, con el mismo formato que `resolverSerie` da a las series macro.
 *
 * Hace falta porque regenerar solo las filas deja debajo las notas al pie del informe de
 * referencia —medido sobre la plantilla de END GAME: «Canal Trece (2024)», «Forbes (2024)»,
 * «DANE, PIB Trimestral 2023-2024»—, y unas cifras de 2025 citando fuentes de 2024 es una
 * atribución falsa, no un descuido de formato. La fecha de consulta sale de
 * `actualizadoEn`, que es cuando la corrida buscó de verdad; si no está, no se fabrica,
 * igual que hace `resolverSerie` con el respaldo local.
 *
 * @returns {string} vacío si la corrida no dejó ninguna fuente, para que el llamador
 *          sepa que no hay nada real que poner y no escriba una línea hueca.
 */
export function fuenteDatosClaveSector(entrada) {
  const vistas = new Set();
  const partes = [];
  for (const f of (entrada && entrada.datosClaveTabla) || []) {
    const nombre = String((f && f.fuente) || '').trim();
    if (!nombre || vistas.has(nombre)) continue;
    vistas.add(nombre);
    partes.push(f.fuenteUrl ? nombre + ' (' + f.fuenteUrl + ')' : nombre);
  }
  if (!partes.length) return '';
  const fecha = formatearFechaConsulta(entrada && entrada.actualizadoEn);
  return partes.join('; ') + (fecha ? ', consultado el ' + fecha : '');
}

/**
 * Los encabezados de III.C con la industria y los años de ESTE estudio.
 *
 * Los usan las tres rutas: `generarApartadoSectorial` los emite al armar el apartado desde
 * cero, y las dos que parchean una plantilla (`actualizarApartadoSectorialOoxml` y
 * `actualizarApartadoSectorialHtml`) los escriben encima de los del informe de referencia.
 * Hasta el 2026-08-13 esas dos no los tocaban —reemplazaban solo el hueco ENTRE
 * encabezados— y el informe se radicaba con «…en 2024 y Comparación con 2023» y «(2023 vs.
 * 2024)» sobre prosa y cifras de 2025, que es lo que hacía parecer que III.C no se había
 * actualizado.
 *
 * `proyeccion` va con `year + 1` a propósito: ese apartado es la expectativa del año
 * siguiente, no del gravable.
 *
 * Devuelve texto EN CRUDO, como el resto de los ayudantes de III.C: cada ruta escapa con lo
 * suyo.
 */
export function titulosSectorial(tituloSector, year) {
  const s = tituloSector || '';
  return {
    apartado: 'Análisis del Sector de la industria ' + s,
    comportamiento: 'Comportamiento del Sector de la Industria ' + s
      + ' en ' + year + ' y Comparación con ' + (year - 1),
    datosClave: tituloDatosClaveSector(s, year),
    comercioExterior: 'Importaciones y exportaciones del sector de la industria ' + s,
    proyeccion: '¿Qué se proyecta para el sector de la industria ' + s + ' en ' + (year + 1) + '?',
    /* Sin industria ni años: nada que actualizar, y reescribirlo solo arriesga perder el
       formato del encabezado de la plantilla. */
    conclusiones: 'Conclusiones y Perspectivas',
  };
}

/**
 * ¿A la corrida guardada le falta algo que el informe de hoy sí coloca?
 *
 * `narrativa.introduccion` se añadió el 2026-08-13 y las corridas anteriores no la traen.
 * Como la clave de caché es solo actividad+año (`claveActividad`), esas entradas se
 * reutilizan tal cual: el hueco de entrada de III.C se radica con el marcador de pendiente
 * para siempre y nada explica por qué. Lo consume `ReporteGenerador` para ofrecer regenerar
 * a mano — no se regenera sola, porque cuesta una cadena de llamadas a Gemini y Claude.
 *
 * @param {object|null} entrada  una entrada de `porAnio`, no el documento completo.
 */
export function corridaSectorIncompleta(entrada) {
  if (!entrada) return false;
  return !(entrada.narrativa && entrada.narrativa.introduccion);
}

export function generarApartadoSectorial(study, year, wrap, analisisSector) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const entrada = entradaSector(analisisSector, year);

  if (entrada) {
    const filas = filasDatosClaveSector(entrada.datosClaveTabla).map((f) => f.map(escaparHtml));
    const tabla = filas.length
      ? tablaHTML(
          tituloDatosClaveSector(entrada.tituloSector, year),
          cabecerasDatosClaveSector(year),
          filas
        )
      : '';
    const fuentes = ((entrada.narrativa && entrada.narrativa.fuentesCitadas) || []).filter((f) => f && f.titulo && f.url);
    const listaFuentes = fuentes.length
      ? '<p>\n<strong>Fuentes consultadas:</strong> ' +
        fuentes.map((f) => '<a href="' + escaparHtml(f.url) + '">' + escaparHtml(f.titulo) + '</a>').join(', ') +
        '\n</p>\n'
      : '';

    const titulos = titulosSectorial(entrada.tituloSector, year);
    const encabezado = (texto) => '<p>\n<strong>' + escaparHtml(texto) + '</strong>\n</p>\n';

    return (
      encabezado(titulos.comportamiento) +
      entrada.narrativa.comportamiento +
      tabla +
      encabezado(titulos.comercioExterior) +
      entrada.narrativa.comercioExterior +
      encabezado(titulos.proyeccion) +
      entrada.narrativa.proyeccion +
      encabezado(titulos.conclusiones) +
      entrada.narrativa.conclusiones +
      listaFuentes
    );
  }

  // Respaldo: todavía no hay una corrida guardada para esta actividad+año.
  const ent = escaparHtml((study && study.ent) || '').trim();
  const ciiu = escaparHtml((study && study.ciiu) || '').trim();
  const actividad = escaparHtml(
    ((study && (study.actividad_especifica || study.objeto)) || '').replace(/\s+/g, ' ').trim()
  );

  let html =
    '<p>\nEl sector en el que opera ' + (ent ? marca(ent) : 'la Compañía') +
    (ciiu ? ' (actividad CIIU ' + marca(ciiu) + ')' : '') +
    ' se describe a continuación para el año gravable ' + marca(year) + '.\n</p>\n';

  if (actividad) {
    html +=
      '<p>\nConforme a la información aportada por el contribuyente, su actividad corresponde a: ' +
      marca(actividad.slice(0, 900)) + '\n</p>\n';
  }

  html +=
    '<p>\nSe analizan la estructura de la industria, la dinámica de la demanda, el comportamiento ' +
    'de los precios y las condiciones de competencia del período, por ser los factores que explican ' +
    'el margen obtenido por la parte examinada y su comparabilidad con las compañías seleccionadas.\n</p>\n';

  html +=
    '<p>\n[Actualizar con los indicadores sectoriales del año gravable ' + year +
    ' e indicar expresamente la fuente y la fecha de consulta de cada cifra y gráfico, conforme al ' +
    'numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]\n</p>\n';

  return html;
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. APARTADOS III.A Y III.B
   Narrativa ya redactada por functions/analisisMercadoActualizar.js (Gemini busca,
   Claude redacta), o un marcador de pendiente si Firestore todavía no tiene una
   corrida guardada. A diferencia del apartado sectorial, el título de estos dos
   no depende del cliente, así que no hace falta una función de título aparte.
   ───────────────────────────────────────────────────────────────────────────── */

/** Agrega `html` solo si `narrativaTexto` no ya trae esa tabla incrustada
 *  (detectado por el prefijo literal de su título, estable entre años porque
 *  el rango entre paréntesis es lo único que cambia). Cubre los dos casos:
 *  la narrativa que redacta Claude hoy no incrusta tablas (el prompt se lo
 *  prohíbe explícitamente), así que esta función se las agrega; una
 *  narrativa preparada a mano que ya las incrusta junto a su tema no las
 *  recibe por segunda vez. */
function tablaSiFalta(narrativaTexto, prefijoTitulo, html) {
  return narrativaTexto.includes(prefijoTitulo) ? '' : html;
}

/** Tablas de III.A que la narrativa (de Claude o preparada a mano) todavía no
 *  incruste junto a su tema. */
function tablasMundial(datosMacro, year, wrap, narrativaTexto) {
  const n = narrativaTexto || '';
  return (
    tablaSiFalta(n, 'Crecimiento del PIB Mundial (', generarTablaPibMundial(datosMacro, year, wrap)) +
    tablaSiFalta(n, 'Tasas de Inflación Global (', generarTablaInflacionGlobal(datosMacro, year, wrap)) +
    tablaSiFalta(n, 'Proyecciones de Crecimiento del PIB por Región/País (', generarTablaCrecimientoPorRegion(datosMacro, year, wrap))
  );
}

export function generarApartadoMundial(datosMacro, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial;
  if (narrativa) return narrativa + tablasMundial(datosMacro, year, wrap, narrativa);
  return '<p>\n' + marca(
    '[Actualizar con el análisis del panorama de la economía mundial del año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]'
  ) + '\n</p>\n' + tablasMundial(datosMacro, year, wrap, '');
}

/** Tablas de III.B que la narrativa todavía no incruste junto a su tema.
 *  Mismo papel que tablasMundial — ver su comentario. */
function tablasColombia(datosMacro, year, wrap, narrativaTexto) {
  const n = narrativaTexto || '';
  return (
    tablaSiFalta(n, 'Crecimiento del PIB en Colombia (', generarTablaPibColombia(datosMacro, year, wrap)) +
    tablaSiFalta(n, 'Inflación en Colombia (', generarTablaInflacionColombia(datosMacro, year, wrap)) +
    tablaSiFalta(n, 'Tasa de Intervención del Banco de la República (', generarTablaTasaIntervencion(datosMacro, year, wrap)) +
    tablaSiFalta(n, 'Tasa Representativa del Mercado (TRM) Promedio (', generarTablaTRM(datosMacro, year, wrap)) +
    tablaSiFalta(n, 'Tasa de Desempleo en Colombia (', generarTablaDesempleo(datosMacro, year, wrap))
  );
}

/** III.B. Además de la narrativa, cierra con las fuentes que la IA declaró haber
 *  usado (narrativa.fuentesCitadas): el numeral 4 del artículo 1.2.2.2.1.5 del
 *  Decreto 1625 de 2016 exige fuente y fecha de consulta, y la lista va aquí —al
 *  final del segundo apartado— y no repetida en los dos. */
export function generarApartadoColombia(datosMacro, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.colombia;
  if (narrativa) {
    /* escaparHtml aunque el título y la URL vengan de la IA vía Firestore: es
       texto que no controlamos y termina dentro de un href y de un enlace. */
    const fuentes = (datosMacro.narrativa.fuentesCitadas || []).filter((f) => f && f.titulo && f.url);
    const listaFuentes = fuentes.length
      ? '<p>\n<strong>Fuentes consultadas:</strong> ' +
        fuentes.map((f) => '<a href="' + escaparHtml(f.url) + '">' + escaparHtml(f.titulo) + '</a>').join(', ') +
        '\n</p>\n'
      : '';
    return narrativa + tablasColombia(datosMacro, year, wrap, narrativa) + listaFuentes;
  }
  return '<p>\n' + marca(
    '[Actualizar con el análisis del panorama de la economía colombiana del año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]'
  ) + '\n</p>\n' + tablasColombia(datosMacro, year, wrap, '');
}
