import { test } from 'node:test';
import assert from 'node:assert';
import { hydrateExactWordTemplate, diagnosticarCobertura } from './exactTemplateMapper.js';
import {
  DATOS_MACRO,
  FUENTES_MACRO,
  generarApartadoSectorial,
  generarApartadoMundial,
  generarApartadoColombia,
  generarTablaPibMundial,
  generarTablaDesempleo,
  generarTablaTRM,
  tituloSectorial,
} from './analisisMercado.js';

/* Cliente que NO es End Game y NO es del sector de videojuegos: todo lo que salga
   con datos o con el sector de End Game es una fuga. */
const otroCliente = {
  ent: 'ACME AGROINDUSTRIAL S.A.S',
  nit: '800123456-7',
  anio: 2026,
  ciiu: '0111',
  objeto: 'Cultivo de cereales y producción de alimentos concentrados para animales',
};

/* ─── Hallazgo 1: las series históricas no se reasignan de año ─── */

test('una cifra macro histórica conserva su año, no el del estudio', () => {
  const html =
    '<p>En <strong>2023, la inflación global se situó en 6,8 %; en 2024 descendió a 5,9 %</strong>.</p>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(
    salida.includes('en 2024 descendió a 5,9 %'),
    'se reasignó a otro año un dato de 2024: la afirmación quedó falsa'
  );
  assert.ok(!salida.includes('2026 descendió'), 'el año del estudio suplantó al del dato');
});

test('el año del estudio sí se sustituye donde corresponde', () => {
  const html =
    '<p>El estudio de precios de transferencia para el año 2024 para ACME.</p>' +
    '<p>La composición accionaria a 31 de diciembre de 2024 es la siguiente:</p>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(!salida.includes('para el año 2024'), 'no se actualizó el año gravable del estudio');
  assert.ok(!salida.includes('diciembre de 2024'), 'no se actualizó la fecha de corte');
  assert.ok(salida.includes('2026'), 'no aparece el año del estudio en ninguna parte');
});

test('el encabezado de año de las tablas de EEFF queda parejo', () => {
  /* «A.V. 2024» se sustituía y «2.024» no, dejando dos años distintos en la misma
     cabecera. */
  const html =
    '<td>\n<p>\n<strong>                      2.024</strong>\n</p>\n</td>\n' +
    '<td>\n<p>\n<strong>A.V. 2024</strong>\n</p>\n</td>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(!salida.includes('2.024'), 'quedó el año con punto de miles sin actualizar');
  assert.ok(!/A\.V\. <span[^>]*>2024/.test(salida), 'quedó A.V. con el año viejo');
});

/* ─── Hallazgo 2: las URLs de las fuentes no se corrompen ─── */

test('el año dentro de una URL no se toca y no se inyecta <span> en el href', () => {
  const html =
    '<p>Fuente: <a href="https://caracol.com.co/2024/12/05/exportaciones-2024/">' +
    'https://caracol.com.co/2024/12/05/exportaciones-2024/</a></p>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(
    salida.includes('href="https://caracol.com.co/2024/12/05/exportaciones-2024/"'),
    'la URL del href se alteró: el enlace de la fuente queda muerto'
  );
  const hrefs = salida.match(/href="[^"]*"/g) || [];
  hrefs.forEach((h) => {
    assert.ok(!h.includes('<span'), 'se inyectó HTML dentro de un atributo href: ' + h);
  });
});

test('la razón social del índice sí se sustituye aunque esté dentro de un enlace', () => {
  /* La guarda de enlaces aparta solo la etiqueta de apertura. Si apartara el <a>
     completo, el nombre de End Game se quedaría en el índice de todos los
     informes. */
  const html =
    '<p><a href="#_Toc208930950">I.\tINFORMACIÓN GENERAL END GAME INTERACTIVE COLOMBIA S.A.S\t6</a></p>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(salida.includes('ACME AGROINDUSTRIAL S.A.S'), 'no se sustituyó la razón social en el índice');
  assert.ok(!salida.includes('END GAME'), 'quedó End Game en el índice');
  assert.ok(salida.includes('href="#_Toc208930950"'), 'se dañó el ancla del índice');
});

/* ─── Hallazgo 4: las ocho tablas se regeneran ─── */

test('las seis tablas que antes no se tocaban se regeneran con el año del estudio', () => {
  const tablas = [
    ['Tasas de Inflación Global (2022-2025)', 'Tasas de Inflación Global (2025-2027)'],
    ['Proyecciones de Crecimiento del PIB por Región/País (2025)', 'Proyecciones de Crecimiento del PIB por Región/País (2026)'],
    ['Inflación en Colombia (2024 vs. Meta 2025)', 'Inflación en Colombia (2026 vs. Meta 2027)'],
    ['Tasa Representativa del Mercado (TRM) Promedio (2023-2024)', 'Tasa Representativa del Mercado (TRM) Promedio (2025-2026)'],
    ['Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)', 'Tasa de Desempleo en Colombia (2026 vs. Proyección 2027)'],
  ];
  for (const [titulo, esperado] of tablas) {
    const html = '<p>\n<strong>' + titulo + '</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n9.7\n</p>\n</td>\n</tr>\n</table>';
    const salida = hydrateExactWordTemplate(html, otroCliente);
    assert.ok(salida.includes(esperado), 'no se regeneró la tabla «' + titulo + '» (esperaba «' + esperado + '»)');
  }
});

test('la tabla de tasa de intervención conserva la etiqueta original de cada observación', () => {
  /* El 13,25 % es de marzo de 2023, no del cierre del año: reetiquetarlo como
     «2023» daría por anual el máximo de un mes. */
  const html =
    '<p>\n<strong>Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n13.25\n</p>\n</td>\n</tr>\n</table>';
  const salida = hydrateExactWordTemplate(html, { ...otroCliente, anio: 2024 });
  assert.ok(salida.includes('Marzo 2023 (máximo del ciclo)'), 'se perdió la etiqueta real de la observación');
  assert.ok(salida.includes('Diciembre 2024'), 'falta la observación del año gravable');
});

test('un año sin datos deja un marcador que exige la fuente, no un guion mudo', () => {
  const salida = generarTablaTRM(null, 2031, (v) => String(v));
  assert.ok(salida.includes('[Completar con la TRM promedio de 2031'), 'no se marcó el dato ausente');
  assert.ok(salida.includes('Decreto 1625 de 2016'), 'el marcador no invoca la obligación de citar la fuente');
  assert.ok(!salida.includes('>—<'), 'quedó un guion mudo en lugar del marcador');
});

test('el desempleo del año siguiente sale como proyección y no repite el del año en curso', () => {
  const salida = generarTablaDesempleo(null, 2024, (v) => String(v));
  assert.ok(salida.includes('9.7'), 'falta el desempleo de 2024');
  assert.ok(salida.includes('9.0'), 'falta la proyección de 2025');
});

test('un año sin datos deja el marcador aunque se le pase datosMacro vacío', () => {
  const salida = generarTablaTRM({ series: {} }, 2031, (v) => String(v));
  assert.ok(salida.includes('[Completar con la TRM promedio de 2031'), 'no se marcó el dato ausente');
});

test('con datosMacro de Firestore, la tabla usa esas cifras y esa fuente, no el respaldo local', () => {
  const datosMacro = {
    series: {
      pib_mundial: { valores: { '2026': '9.9' }, fuente: 'Fuente de prueba', fuenteUrl: 'https://prueba.example' },
    },
  };
  const salida = generarTablaPibMundial(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.includes('9.9'), 'no usó la cifra de Firestore');
  assert.ok(!salida.includes('3.2'), 'usó la cifra del respaldo local en vez de la de Firestore');
  assert.ok(salida.includes('Fuente de prueba'), 'no citó la fuente de Firestore');
});

test('sin datosMacro (null), la tabla cae al respaldo DATOS_MACRO embebido', () => {
  const salida = generarTablaPibMundial(null, 2025, (v) => String(v));
  assert.ok(salida.includes('3.2'), 'no cayó al valor del respaldo local para 2025');
});

test('generarApartadoMundial usa la narrativa de Firestore cuando existe', () => {
  const datosMacro = { narrativa: { mundial: '<p>Texto redactado por IA sobre la economía mundial.</p>' } };
  const salida = generarApartadoMundial(datosMacro, 2026, (v) => String(v));
  assert.strictEqual(salida, '<p>Texto redactado por IA sobre la economía mundial.</p>');
});

test('generarApartadoMundial deja marcador si no hay narrativa todavía', () => {
  const salida = generarApartadoMundial(null, 2026, (v) => String(v));
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía mundial'));
  assert.ok(salida.includes('Decreto 1625 de 2016'));
});

test('generarApartadoColombia usa la narrativa de Firestore cuando existe', () => {
  const datosMacro = { narrativa: { colombia: '<p>Texto redactado por IA sobre Colombia.</p>' } };
  const salida = generarApartadoColombia(datosMacro, 2026, (v) => String(v));
  assert.strictEqual(salida, '<p>Texto redactado por IA sobre Colombia.</p>');
});

test('generarApartadoColombia deja marcador si no hay narrativa todavía', () => {
  const salida = generarApartadoColombia(undefined, 2025, (v) => String(v));
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía colombiana'));
});

/* ─── Hallazgos 5 y 6: el sector deja de ser el de End Game ─── */

test('el apartado sectorial no menciona videojuegos y sí la actividad del cliente', () => {
  const salida = generarApartadoSectorial(otroCliente, 2026, (v) => String(v));
  assert.ok(!/videojuego/i.test(salida), 'el apartado sigue hablando de videojuegos');
  assert.ok(!/software/i.test(salida), 'el apartado sigue hablando de software');
  assert.ok(salida.includes('ACME AGROINDUSTRIAL S.A.S'), 'falta la razón social del cliente');
  assert.ok(salida.includes('0111'), 'falta el CIIU del cliente');
  assert.ok(salida.includes('Cultivo de cereales'), 'falta la actividad declarada del cliente');
  assert.ok(salida.includes('año gravable 2026'), 'el apartado no se sitúa en el año del estudio');
});

test('el título de III.C se reemplaza en el cuerpo y en el índice', () => {
  const html =
    '<p><a href="#_Toc208930979">C.\tAnálisis del Sector de la industria del software y de los videojuegos\t20</a></p>' +
    '<ol>\n<li>\n<a id="_Toc208930979"></a><strong>Análisis del Sector de la industria del software y de los videojuegos</strong>\n</li>\n</ol>\n' +
    '<p>El sector tecnológico en Colombia, que abarca la industria del software.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930980"></a>ANÁLISIS ECONÓMICO\n</li>\n</ol>';
  const salida = hydrateExactWordTemplate(html, otroCliente);

  assert.ok(!/videojuegos/i.test(salida), 'quedó el sector de videojuegos en el documento');
  assert.ok(
    salida.includes('Análisis del Sector económico de la Compañía (actividad CIIU 0111)'),
    'no se reemplazó el título por el del sector del cliente'
  );
  assert.ok(salida.includes('id="_Toc208930979"'), 'se borró el ancla: el índice quedaría sin destino');
  assert.ok(salida.includes('ANÁLISIS ECONÓMICO'), 'el reemplazo se comió la sección siguiente');
});

test('sin CIIU el título usa el respaldo y el apartado no queda vacío', () => {
  const sinDatos = { ent: 'EMPRESA SIN FICHA S.A.S', anio: 2025 };
  assert.strictEqual(tituloSectorial(sinDatos), 'Análisis del Sector económico de la Compañía');
  const salida = generarApartadoSectorial(sinDatos, 2025, (v) => String(v));
  assert.ok(salida.includes('EMPRESA SIN FICHA S.A.S'), 'falta la razón social');
  assert.ok(salida.includes('Actualizar con los indicadores sectoriales'), 'falta el marcador de pendiente');
});

test('el objeto social con caracteres de HTML no rompe el documento', () => {
  const conHtml = { ent: 'X & Y S.A.S', anio: 2025, objeto: 'Comercio <mayorista> & minorista' };
  const salida = generarApartadoSectorial(conHtml, 2025, (v) => String(v));
  assert.ok(salida.includes('&amp;'), 'no se escapó el ampersand');
  assert.ok(!salida.includes('<mayorista>'), 'se inyectó una etiqueta desde el objeto social');
});

/* ─── El año como cadena (viene así del formulario) ─── */

test('el año en cadena no produce un encabezado como 20251', () => {
  const html = '<p>\n<strong>Crecimiento del PIB Mundial (2023-2025)</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n3.2\n</p>\n</td>\n</tr>\n</table>';
  const salida = hydrateExactWordTemplate(html, { anio: '2025' });
  assert.ok(salida.includes('Crecimiento del PIB Mundial (2024-2026)'), 'el año en cadena rompió el rango del título');
  assert.ok(!salida.includes('20251'), 'se concatenó el año en vez de sumarlo');
});

/* ─── Diagnóstico de cobertura ─── */

test('diagnosticarCobertura señala el apartado sectorial ausente y las series sin datos', () => {
  const sinAnclas = '<p>Una plantilla que el usuario subió, sin las anclas de Word.</p>';
  const d = diagnosticarCobertura(sinAnclas, { anio: 2031 });
  assert.strictEqual(d.sectorialCubierto, false, 'debió reportar que no hay apartado sectorial que reemplazar');
  assert.ok(d.seriesFaltantes.length >= 6, 'debió reportar las series sin datos para 2031');

  const conAncla = '<ol><li><a id="_Toc208930979"></a><strong>X</strong></li></ol>';
  const d2 = diagnosticarCobertura(conAncla, { anio: 2024 });
  assert.strictEqual(d2.sectorialCubierto, true, 'no reconoció el ancla del apartado sectorial');
});

test('las series macro declaran su fuente', () => {
  /* El Decreto 1625 de 2016 obliga a citar la fuente de cada cifra. Si una serie
     entra sin fuente, el informe la publica sin respaldo. */
  Object.keys(DATOS_MACRO)
    .filter((k) => k !== 'meta_inflacion_banrep')
    .forEach((serie) => {
      assert.ok(serie in FUENTES_MACRO, 'la serie ' + serie + ' no declara fuente');
    });
});
