import XLSX from 'xlsx-js-style';
import { PAIS_DIAN } from '../utils/calculations.js';

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

      // Buscar fila de encabezados entre las primeras 25 filas. Se prioriza
      // 'identificaci' porque el título de la hoja ("Operaciones con
      // Vinculados") también contiene 'vinculado' y, al buscar por ese solo
      // término, ganaba el título en vez de la fila real de encabezados de
      // columna, dejando iNit/iPais/iTipo/iMonto en -1 y el monto en 0.
      let encIdx = 9; // por defecto fila 10
      let encFound = false;
      for (let i = 0; i < Math.min(d.length, 25); i++) {
        const rowStr = (d[i] || []).join(' ').toLowerCase();
        if (rowStr.includes('identificaci')) {
          encIdx = i;
          encFound = true;
          break;
        }
      }
      if (!encFound) {
        for (let i = 0; i < Math.min(d.length, 25); i++) {
          const rowStr = (d[i] || []).join(' ').toLowerCase();
          if (rowStr.includes('vinculado')) {
            encIdx = i;
            break;
          }
        }
      }

      const enc = d[encIdx] || [];
      const iNom = enc.findIndex(x => String(x).toLowerCase().includes('vinculado') || String(x).toLowerCase().includes('razón social'));
      const iNit = enc.findIndex(x => String(x).toLowerCase().includes('identificaci'));
      // Excluye la columna de identificación: su encabezado ("Número de
      // Identificación fiscal del país de origen") también contiene 'país',
      // y sin este filtro ganaba por estar antes que "País de origen".
      const iPais = enc.findIndex(x => {
        const s = String(x).toLowerCase();
        return (s.includes('país') || s.includes('pais')) && !s.includes('identificaci');
      });
      const iTipo = enc.findIndex(x => String(x).toLowerCase().includes('tipo de operaci'));
      const iMonto = enc.findIndex(x => String(x).toLowerCase().includes('monto'));
      // Columna 'Cod' (código de operación DIAN). Cuando existe, solo cuentan
      // como operación real las filas que la tengan diligenciada: filas sin
      // código son renglones auxiliares del mismo formato/concepto (ej.
      // retención, IVA) que no son la operación de ingreso en sí.
      const iCod = enc.findIndex(x => String(x).trim().toLowerCase() === 'cod');

      /* Las operaciones de la hoja se acumulan aquí y no en `rowsParsed`, porque para
         decidir si la columna 'Cod' sirve de filtro hay que haberlas visto todas. */
      const candidatas = [];

      let currentTipo = '';
      // Las hojas 'Op. Vinculados Economicos' y 'Op. Paraisos Fiscales' listan
      // primero "1. OPERACIONES DE INGRESO" y luego "2. OPERACIONES DE
      // EGRESO" en la misma hoja. Solo las operaciones de ingreso deben
      // sumarse al monto de la Tabla 3 (Transacciones Inter compañía); las de
      // egreso pertenecen a otro formato y se colaban en el total porque el
      // parser no distinguía la sección.
      let currentSeccion = 'INGRESO';

      for (let i = encIdx + 1; i < Math.min(d.length, 3000); i++) {
        const f = d[i] || [];
        const a = String(f[0] || '').trim();
        if (/tipos de operacion/i.test(a)) break; // Fin de datos / Catálogo

        const rowJoined = f.join(' ').toUpperCase();
        if (rowJoined.includes('OPERACIONES DE EGRESO')) { currentSeccion = 'EGRESO'; continue; }
        if (rowJoined.includes('OPERACIONES DE INGRESO')) { currentSeccion = 'INGRESO'; continue; }

        const nom = String(iNom > -1 ? f[iNom] : '').trim();
        // Las notas al pie ("* Ver lista de tipo de operaciones según DIAN")
        // a veces caen justo en la columna del monto y se colaban como fila
        // de operación real, duplicando el total.
        if (!nom || nom.toLowerCase().includes('vinculado') || nom.startsWith('*')) continue;

        const tRaw = String(iTipo > -1 ? f[iTipo] : '').trim();
        if (tRaw) currentTipo = tRaw;

        const nit = String(iNit > -1 ? f[iNit] : '').replace(/[^0-9]/g, '');
        const monto = parseFloat(String(iMonto > -1 ? f[iMonto] : '').replace(/[^0-9.\-]/g, '')) || 0;
        const pais = String(iPais > -1 ? f[iPais] : '').trim();
        const cod = String(iCod > -1 ? f[iCod] : '').trim();

        if (nom && !mainVinculado) mainVinculado = nom;
        if (nit && !mainVinculadoId) mainVinculadoId = nit;
        if (pais && !mainPais) mainPais = pais;

        if (monto > 0 && currentSeccion === 'INGRESO') {
          candidatas.push({
            vinculado: nom,
            nit,
            pais,
            tipo: currentTipo || 'Otros servicios (07)',
            monto,
            cod
          });
        }
      }

      /* El filtro por 'Cod' solo se aplica si la columna está diligenciada en alguna
         fila de esta hoja. Sirve para separar la operación real de los renglones
         auxiliares del mismo formato —en el archivo de referencia, el concepto 4001
         lleva código y el 4002 no—, pero es una columna opcional del formato: quien
         escribe el tipo de operación en texto y no pone el código la deja vacía en
         todas las filas.
         Exigirla siempre descartaba la hoja entera de esos contribuyentes y el monto
         salía vacío sin ninguna señal de por qué. Si nadie la diligenció no distingue
         nada, así que no puede filtrar. */
      const codEnUso = candidatas.some(c => c.cod !== '');
      candidatas.forEach(({ cod, ...operacion }) => {
        if (!codEnUso || cod !== '') rowsParsed.push(operacion);
      });
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

    /* El país puede venir como nombre («Estados unidos») o como código numérico. Se
       traduce con la tabla que ya usa el resto del sistema, no con un caso único: antes
       solo se reconocía el 249 —el código que traía el archivo de referencia— y cualquier
       otro contribuyente veía el número crudo en su informe («484» en vez de MÉXICO).

       El 249 se conserva aparte porque no está en esa tabla y es el que trae el formato
       de operaciones. OJO: la tabla dice que Estados Unidos es 840, así que las dos
       codificaciones no son la misma y hay que decidir cuál exige la DIAN antes de
       radicar —ver la nota al usuario en el commit. */
    const nombrePorCodigo = Object.fromEntries(
      Object.entries(PAIS_DIAN).map(([nombre, codigo]) => [codigo, nombre])
    );
    const codigo = String(mainPais || '').trim();
    let paisNombre = mainPais;
    if (/^\d+$/.test(codigo)) {
      paisNombre = nombrePorCodigo[codigo] || nombrePorCodigo[codigo.padStart(3, '0')] ||
        (codigo === '249' ? 'ESTADOS UNIDOS' : mainPais);
    }

    /* Contrapartes distintas del archivo. El estudio guarda un solo vinculado, así que
       cuando hay varias el monto que se ingresa es la suma de todas y el informe las
       atribuye a la primera. No se puede resolver aquí —el modelo del estudio tiene un
       campo, no una lista—, pero quien carga el archivo tiene que enterarse: si no, el
       documento declara ante la DIAN una operación con una contraparte que no es la
       única. Se agrupa por NIT y se cae al nombre cuando el NIT falta. */
    const contrapartes = new Set(
      rowsParsed.map(r => (r.nit || r.vinculado || '').trim().toUpperCase()).filter(Boolean)
    );

    return {
      vinc: mainVinculado || null,
      vinc_id: mainVinculadoId || null,
      pais_vinc: paisNombre || null,
      vinc_tipo: mainTipo || 'Otros servicios (07)',
      monto: totalMonto || null,
      monto_operacion: totalMonto || null,
      t_s: totalMonto || null,
      contrapartes: contrapartes.size,
      rows: rowsParsed
    };
  } catch (err) {
    console.error("Error parsing Excel operations file:", err);
    throw err;
  }
}
