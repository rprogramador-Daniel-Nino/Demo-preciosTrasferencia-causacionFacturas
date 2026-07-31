import * as XLSX from 'xlsx';

/**
 * Módulo de lectura e ingesta del Excel de Operaciones con Vinculados
 * (Basado en la lógica del método pt36AnalizarOperaciones de index.html)
 */
export async function parseExcelOperations(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });

    const sheetsToScan = [
      { n: 'Op. Vinculados Economicos', regimen: 'VINCULADOS' },
      { n: 'Op. Prestamos Vinculados Econom', regimen: 'VINCULADOS' },
      { n: 'Op. Paraisos Fiscales', regimen: 'PARAISOS' },
      { n: 'Op. Prestamos Paraisos Fiscales', regimen: 'PARAISOS' }
    ];

    const rowsParsed = [];
    let mainVinculado = '';
    let mainVinculadoId = '';
    let mainPais = '';

    sheetsToScan.forEach(hj => {
      const sh = wb.Sheets[hj.n];
      if (!sh) return;

      const d = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
      if (!d || d.length < 10) return;

      // Buscar fila de encabezados entre las primeras 15 filas
      let encIdx = 9; // por defecto fila 10
      for (let i = 0; i < Math.min(d.length, 25); i++) {
        const rowStr = (d[i] || []).join(' ').toLowerCase();
        if (rowStr.includes('vinculado') || rowStr.includes('identificaci')) {
          encIdx = i;
          break;
        }
      }

      const enc = d[encIdx] || [];
      const iNom = enc.findIndex(x => String(x).toLowerCase().includes('vinculado') || String(x).toLowerCase().includes('razón social'));
      const iNit = enc.findIndex(x => String(x).toLowerCase().includes('identificaci'));
      const iPais = enc.findIndex(x => { const s = String(x).toLowerCase(); return s.includes('país') || s.includes('pais'); });
      const iTipo = enc.findIndex(x => String(x).toLowerCase().includes('tipo de operaci'));
      const iMonto = enc.findIndex(x => String(x).toLowerCase().includes('monto'));

      let currentTipo = '';

      for (let i = encIdx + 1; i < Math.min(d.length, 3000); i++) {
        const f = d[i] || [];
        const a = String(f[0] || '').trim();
        if (/tipos de operacion/i.test(a)) break; // Fin de datos / Catálogo

        const nom = String(iNom > -1 ? f[iNom] : '').trim();
        if (!nom || nom.toLowerCase().includes('vinculado')) continue;

        const tRaw = String(iTipo > -1 ? f[iTipo] : '').trim();
        if (tRaw) currentTipo = tRaw;

        const nit = String(iNit > -1 ? f[iNit] : '').replace(/[^0-9]/g, '');
        const monto = parseFloat(String(iMonto > -1 ? f[iMonto] : '').replace(/[^0-9.\-]/g, '')) || 0;
        const pais = String(iPais > -1 ? f[iPais] : '').trim();

        if (nom && !mainVinculado) mainVinculado = nom;
        if (nit && !mainVinculadoId) mainVinculadoId = nit;
        if (pais && !mainPais) mainPais = pais;

        if (monto > 0) {
          rowsParsed.push({
            vinculado: nom,
            nit,
            pais,
            tipo: currentTipo || 'Otros servicios (07)',
            monto
          });
        }
      }
    });

    // Calcular el monto total y el tipo de operación principal
    const totalMonto = rowsParsed.reduce((acc, curr) => acc + curr.monto, 0);
    
    // Mapeo por tipo de operación
    const tipoMap = {};
    rowsParsed.forEach(r => {
      const k = r.tipo || 'Otros servicios (07)';
      tipoMap[k] = (tipoMap[k] || 0) + r.monto;
    });

    // Determinar el tipo de operación dominante por monto
    let mainTipo = 'Otros servicios (07)';
    let maxMontoTipo = 0;
    Object.keys(tipoMap).forEach(k => {
      if (tipoMap[k] > maxMontoTipo) {
        maxMontoTipo = tipoMap[k];
        mainTipo = k;
      }
    });

    // Traducir código país de la DIAN si es numérico (ej: 249 -> ESTADOS UNIDOS)
    let paisNombre = mainPais;
    if (mainPais === '249') paisNombre = 'ESTADOS UNIDOS';

    return {
      vinc: mainVinculado || null,
      vinc_id: mainVinculadoId || null,
      pais_vinc: paisNombre || null,
      vinc_tipo: mainTipo || 'Otros servicios (07)',
      t_s: totalMonto || null,
      rows: rowsParsed
    };
  } catch (err) {
    console.error("Error parsing Excel operations file:", err);
    throw err;
  }
}
