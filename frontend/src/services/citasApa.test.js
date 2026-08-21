import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citaApa, citasApa, fechaDeCita, partirMedioYTitulo } from './citasApa.js';

test('«Entidad, Publicación» se parte en autor y título, como en las notas de la plantilla', () => {
  assert.deepStrictEqual(
    partirMedioYTitulo('Departamento Administrativo Nacional de Estadística (DANE), Índice de Precios al Consumidor (IPC)'),
    {
      medio: 'Departamento Administrativo Nacional de Estadística (DANE)',
      titulo: 'Índice de Precios al Consumidor (IPC)',
    });
  assert.deepStrictEqual(partirMedioYTitulo('DANE, GEIH'), { medio: 'DANE', titulo: 'GEIH' });
});

test('se corta solo por la primera coma: el título lleva comas dentro', () => {
  assert.deepStrictEqual(
    partirMedioYTitulo('Fondo Monetario Internacional, World Economic Outlook, octubre de 2025'),
    { medio: 'Fondo Monetario Internacional', titulo: 'World Economic Outlook, octubre de 2025' });
});

test('sin coma todo es el autor y el título lo pone quien cita', () => {
  assert.deepStrictEqual(partirMedioYTitulo('Acoplásticos / BluRadio'),
    { medio: 'Acoplásticos / BluRadio', titulo: '' });
  assert.deepStrictEqual(partirMedioYTitulo('DANE,'), { medio: 'DANE', titulo: '' });
  assert.deepStrictEqual(partirMedioYTitulo(''), { medio: '', titulo: '' });
  assert.deepStrictEqual(partirMedioYTitulo(null), { medio: '', titulo: '' });
});

test('la cita sale con el formato de las notas de la plantilla', () => {
  /* Medida sobre una nota real del informe de END GAME. */
  const cita = citaApa({
    medio: 'La República',
    fecha: '2025-02-19',
    titulo: 'Economía de Colombia creció 1,7% en 2024 y revirtió la fuerte desaceleración de 2023',
    url: 'https://www.larepublica.co/economia/economia-de-colombia-crecio-17-en-2024',
  });

  assert.strictEqual(cita,
    'La República. (2025, febrero 19). Economía de Colombia creció 1,7% en 2024 y revirtió la '
    + 'fuerte desaceleración de 2023. Recuperado de '
    + 'https://www.larepublica.co/economia/economia-de-colombia-crecio-17-en-2024');
});

test('sin fecha de publicación se cita «(s.f.)», como hace la plantilla con el DANE', () => {
  const cita = citaApa({
    medio: 'DANE',
    titulo: 'Resultados Producción industrial - Encuesta Mensual de Industria - EMIM',
    url: 'https://www.dane.gov.co/index.php/estadisticas-por-tema/industria',
  });

  assert.match(cita, /^DANE\. \(s\.f\.\)\. Resultados Producción industrial/);
  assert.ok(!/\(\)/.test(cita), 'nunca queda un paréntesis vacío');
});

test('sin título propio se usa el nombre de lo que la fuente respalda', () => {
  /* No se inventa un título: se dice qué serie sostiene esa fuente, que es un dato del sistema. */
  const cita = citaApa({
    medio: 'Banco de la República',
    tituloRespaldo: 'Inflación en Colombia',
    url: 'https://www.banrep.gov.co/es/estadisticas/inflacion',
  });

  assert.strictEqual(cita, 'Banco de la República. (s.f.). Inflación en Colombia. '
    + 'Recuperado de https://www.banrep.gov.co/es/estadisticas/inflacion');
});

test('el título propio manda sobre el de respaldo', () => {
  const cita = citaApa({
    medio: 'DANE', titulo: 'Encuesta Mensual Manufacturera', tituloRespaldo: 'Producción industrial',
  });
  assert.match(cita, /Encuesta Mensual Manufacturera\./);
  assert.ok(!cita.includes('Producción industrial'));
});

test('sin URL la cita se sostiene con autor, fecha y título', () => {
  const cita = citaApa({ medio: 'DANE', fecha: 2025, tituloRespaldo: 'PIB trimestral' });
  assert.strictEqual(cita, 'DANE. (2025). PIB trimestral.');
  assert.ok(!/Recuperado/.test(cita), 'sin URL no se anuncia una recuperación que no hubo');
});

test('la fecha de consulta se cita en la forma que la reconoce', () => {
  const cita = citaApa({
    medio: 'Acoplásticos', tituloRespaldo: 'Datos clave del sector',
    url: 'https://acoplasticos.org/informe', fechaConsulta: '19 de agosto de 2026',
  });
  assert.match(cita, /Recuperado el 19 de agosto de 2026, de https:\/\/acoplasticos\.org\/informe$/);
});

test('sin medio no se publica una nota hueca', () => {
  assert.strictEqual(citaApa({ titulo: 'Algo', url: 'https://x.com' }), '');
  assert.strictEqual(citaApa({}), '');
  assert.strictEqual(citaApa(), '');
});

test('el punto final no se duplica', () => {
  const cita = citaApa({ medio: 'DANE.', titulo: 'Producción industrial.', fecha: 2025 });
  assert.ok(!/\.\./.test(cita), `no debe haber dos puntos seguidos: ${cita}`);
});

test('fechaDeCita entiende lo que puede y no adivina el resto', () => {
  assert.strictEqual(fechaDeCita('2025-02-19'), '(2025, febrero 19)');
  assert.strictEqual(fechaDeCita('2025-02'), '(2025, febrero)');
  assert.strictEqual(fechaDeCita('2025'), '(2025)');
  assert.strictEqual(fechaDeCita(2025), '(2025)');
  assert.strictEqual(fechaDeCita(new Date(2026, 7, 19)), '(2026, agosto 19)');
  /* Ya escrita por el modelo: se respeta. */
  assert.strictEqual(fechaDeCita('2025, febrero 19'), '(2025, febrero 19)');
  assert.strictEqual(fechaDeCita('(2025, febrero 19)'), '(2025, febrero 19)');
  /* Lo que no se puede leer con seguridad no se inventa. */
  assert.strictEqual(fechaDeCita(''), '(s.f.)');
  assert.strictEqual(fechaDeCita(null), '(s.f.)');
  assert.strictEqual(fechaDeCita('próximamente'), '(próximamente)');
  assert.strictEqual(fechaDeCita('12345'), '(s.f.)');
});

test('las citas repetidas no se publican dos veces', () => {
  /* La misma corrida cita la misma fuente en varias filas de la tabla. */
  const lista = citasApa([
    { medio: 'Acoplásticos', url: 'https://a.co/x', tituloRespaldo: 'Producción' },
    { medio: 'Acoplásticos', url: 'https://a.co/x', tituloRespaldo: 'Exportaciones' },
    { medio: 'BluRadio', url: 'https://b.co/y', tituloRespaldo: 'Exportaciones' },
    { medio: 'Sin fuente útil' },
  ]);

  assert.strictEqual(lista.length, 3, 'la repetida por URL se descarta');
  assert.deepStrictEqual(lista.map((x) => x.url), ['https://a.co/x', 'https://b.co/y', '']);
});

test('sin URL la deduplicación mira el medio y el título', () => {
  const lista = citasApa([
    { medio: 'DANE', tituloRespaldo: 'PIB' },
    { medio: 'DANE', tituloRespaldo: 'PIB' },
    { medio: 'DANE', tituloRespaldo: 'Inflación' },
  ]);
  assert.strictEqual(lista.length, 2);
});

test('una lista vacía o ausente no rompe', () => {
  assert.deepStrictEqual(citasApa([]), []);
  assert.deepStrictEqual(citasApa(null), []);
  assert.deepStrictEqual(citasApa(), []);
});
