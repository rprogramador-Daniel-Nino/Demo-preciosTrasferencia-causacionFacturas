/* Smoke del Motor de Comparables: carga el componente REAL con Vite (SSR) y lo renderiza con
   el universo REAL de Capital IQ. Es lo más cerca del navegador sin driver: ejecuta la ruta de
   render completa, donde vive el riesgo que ni el build ni las pruebas de servicio atrapan.

   Correr:  node frontend/smoke_panel.mjs      (desde frontend/, o con la ruta completa) */
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.FileReader = class {
  readAsArrayBuffer(f) { f.arrayBuffer().then((b) => this.onload({ target: { result: b } })); }
};

const RUTA_IQ = 'G:/.shortcut-targets-by-id/1AhE4eqM8c6mfTdaitS_hpQkb28vUXOO8/PRECIOS TRANSFERENCIA/AÑO 2025/Makita/CAPITAL IQ MAKITA COLOMBIA 2025.xls';

const limpio = (t) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let fallos = 0;
const comprobar = (etq, cond) => {
  if (!cond) fallos += 1;
  console.log(`  ${cond ? '✓' : '✗'} ${etq}`);
};

const vite = await createServer({
  root: import.meta.dirname,
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
});

try {
  const { importCapitalIQExcel } = await vite.ssrLoadModule('/src/services/comparablesEngine.js');
  const { default: MotorComparables } = await vite.ssrLoadModule('/src/components/MotorComparables.jsx');

  /* El cribado real si está a mano; si no, uno sintético del mismo tamaño, para que el arnés
     corra en cualquier máquina del equipo sin depender de Google Drive. */
  let universo;
  try {
    const buf = await readFile(RUTA_IQ);
    const imp = await importCapitalIQExcel({
      name: 'CAPITAL IQ MAKITA.xls',
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });
    universo = imp.rows;
    console.log(`universo REAL de Capital IQ: ${universo.length} compañías`);
  } catch {
    universo = Array.from({ length: 1632 }, (_, i) => ({
      id: 'C' + i, name: (i % 12 === 0 ? 'Sintetica Holding ' : 'Sintetica ') + i,
      s: 1000, c: 600, op: 100, desc: 'services', country: 'Colombia',
    }));
    console.log(`sin acceso al cribado de Drive; universo sintético de ${universo.length}`);
  }

  const pintar = (study, id) => renderToStaticMarkup(
    React.createElement(MotorComparables, {
      study, updateStudy: () => {}, estudioId: id, usuario: { uid: 'u1' },
    }),
  );

  /* ── 1. El paso 2, antes de correr nada ── */
  const study = {
    ent: 'MAKITA COLOMBIA S.A.S.', anio: 2025, pli: 'MO',
    t_s: 1000, t_c: 800, t_op: -13.56,
    universo, actividad: 'herramientas electricas',
    motorConfig: {
      nTarget: 12, perdidaOp: 'excluir', holding: 'excluir', saldoNegativo: 'excluir',
      control: 'excluir', umbralControl: 50, negativasObjetivo: 0, geo: 'ninguna',
      justificacionPerdida: '',
    },
  };
  const html = pintar(study, 'smoke');
  console.log(`\n═══ PASO 2 · render OK, ${html.length} caracteres ═══\n`);

  comprobar('bloque «Decisiones de método»', /Decisiones de método/.test(html));
  comprobar('pliegue «Afinaciones»', /Afinaciones/.test(html));
  comprobar('afinaciones CERRADAS por defecto', !/Prioridad Geográfica/.test(html));
  comprobar('el costo del pliegue se ve aun cerrado', /sacan/.test(html));
  comprobar('universo con separador de miles', /1\.632/.test(html));
  comprobar('el costo se pega a cada control activo', /saca\s*<b/.test(html));
  comprobar('el selector «Rigor Funcional» ya no existe', !/Rigor Funcional/.test(html));

  console.log('\n  costos pegados a cada control:');
  (html.match(/saca\s*<b[^>]*>[^<]*<\/b>\s*de\s*[\d.]+/g) || []).forEach((c) => console.log('   ·', limpio(c)));

  const cierre = html.match(/Universo\s*<b[^>]*>[\s\S]{0,400}?en reserva/);
  if (cierre) console.log('\n  el cierre:\n   ·', limpio(cierre[0]));
  const pago = html.match(/Al ejecutar el paso 3[\s\S]{0,320}?<\/span>/);
  if (pago) console.log('   ·', limpio(pago[0]));

  console.log('\n  avisos:');
  (html.match(/(El contribuyente está en|Tras los filtros quedan|Las pérdidas están admitidas)[^<]{0,320}/g) || [])
    .forEach((a) => console.log('   ·', limpio(a)));

  /* ── 2. El paso 2 con las pérdidas admitidas: el aviso debe cambiar de contenido ── */
  const html1b = pintar({
    ...study,
    motorConfig: { ...study.motorConfig, perdidaOp: 'incluir', negativasObjetivo: 4 },
  }, 'smoke1b');
  console.log('\n═══ PASO 2 · con pérdidas admitidas y cuota 4 ═══\n');
  comprobar('aparece el campo de justificación', /Justificación de admitir pérdidas/.test(html1b));
  comprobar('avisa que falta y que va al informe', /falta, y va al informe/.test(html1b));
  (html1b.match(/(Se piden \d+ comparable|El contribuyente está en)[^<]{0,260}/g) || [])
    .forEach((a) => console.log('   ·', limpio(a)));

  /* ── 3. Después de correr el motor: tarjeta del paso 3 y de cumplimiento ── */
  const comp = (n, pct) => ({ name: n, id: n, s: 1000, c: 600, op: (pct / 100) * 1000, amb: 'Int', desc: 'x' });
  const muestra = [5.1, 5.4, 5.9, 6.2, 6.4, 6.8, 7.3, 7.6, 8.0, 8.4, 8.8, 9.1]
    .map((m, i) => comp('Comparable ' + i, m));

  const html2 = pintar({
    ...study,
    comparables: muestra, cmode: 'all', useadj: false,
    embudoSeleccion: {
      evaluadas: 1632, rechazadasFiltros: 382, curadas: 1250, reutilizadas: 0,
      rechazadasIA: 205, rechazadasRigor: 1163, validas: 12, seleccionadas: 12,
      objetivo: 12, ampliadas: 0,
    },
  }, 'smoke2');
  console.log(`\n═══ PASO 3 y CUMPLIMIENTO · render OK, ${html2.length} caracteres ═══\n`);

  comprobar('embudo: «Diferencias funcionales»', /Diferencias funcionales/.test(html2));
  comprobar('ya no dice «Rechazadas por el rigor»', !/Rechazadas por el rigor/.test(html2));
  comprobar('no muestra el valor del selector retirado', !/\(estandar\)/.test(html2));
  comprobar('cita el Art. 260-4', /Art\. 260-4/.test(html2));
  comprobar('tarjeta de cumplimiento con veredicto', /NO CUMPLE|CUMPLE \(Dentro/.test(html2));
  comprobar('la brecha hasta el cuartil', /Faltan/.test(html2));
  comprobar('dice cuál de los dos rangos decide', /Decide el rango/.test(html2));

  const emb = html2.match(/Diferencias funcionales[\s\S]{0,240}?260-4\)/);
  if (emb) console.log('\n  embudo del paso 3:\n   ·', limpio(emb[0]));
  const brecha = html2.match(/Faltan[\s\S]{0,260}?<\/p>/);
  if (brecha) console.log('\n  tarjeta de cumplimiento:\n   ·', limpio(brecha[0]));
  const decide = html2.match(/Decide el rango[\s\S]{0,200}?<\/p>/);
  if (decide) console.log('   ·', limpio(decide[0]));
  const vias = html2.match(/(vía\(s\) que sí cambian el veredicto|Se probaron la política)[\s\S]{0,300}?<\/(li|span)>/);
  if (vias) console.log('\n  vías:\n   ·', limpio(vias[0]).slice(0, 260));

  /* ── 4. La ingesta de EEFF: que el paso 3 pinte los hallazgos de Llantas Emotion ── */
  const { default: IngestaCifras } = await vite.ssrLoadModule('/src/components/IngestaCifras.jsx');
  const html3 = renderToStaticMarkup(React.createElement(IngestaCifras, {
    study: {
      anio: 2025, pli: 'MO',
      t_s: 35850121412, t_c: 33136894215, t_gastos: 9457526064, t_op: -6744298867,
      t_ar: 4003623665, t_inv: 21381500956, t_ap: 53708962262,
      t_act_curr: 39814259760, t_act_tot: 45170661307, t_ppe: 571386211,
      /* La corrección real que la verificación por columna aplicó sobre ese documento. */
      t_correcciones: [{
        campo: 't_ap', etiqueta: 'Cuentas por pagar comerciales',
        valorLeido: 53708962282, valorAplicado: 53708962262,
        motivo: 'La lectura atribuyó 53.708.962.282 a «Cuentas comerciales por pagar», pero en el '
          + 'documento esa fila dice 53.708.962.262 en la columna del 2025.',
      }],
      t_lecturaEeff: { verificadoContraTexto: true, advertencias: [], correcciones: [{ campo: 't_ap' }], respaldoOcr: null },
      t_camposAMano: [],
    },
    updateStudy: () => {},
  }));
  console.log(`
═══ INGESTA DE EEFF (Llantas Emotion) · render OK, ${html3.length} caracteres ═══
`);
  comprobar('pinta las cifras del estado de resultados', /35\.850\.121\.412/.test(html3));
  comprobar('y el costo de ventas que antes se descartaba', /33\.136\.894\.215/.test(html3));
  comprobar('la cuenta por pagar CORRIENTE, no la no corriente', /53\.708\.962\.262/.test(html3));
  comprobar('no cuela la no corriente (59.805.002)', !/59\.805\.002/.test(html3));
  const margen = html3.match(/-?[\d.,]+\s*%/);
  if (margen) console.log('   · margen que muestra la tarjeta:', margen[0]);

  console.log(fallos === 0
    ? '\n→ todas las comprobaciones pasaron'
    : `\n→ ${fallos} comprobación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
} finally {
  await vite.close();
}
