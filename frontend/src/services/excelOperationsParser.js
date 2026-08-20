import XLSX from 'xlsx-js-style';
import { PAIS_DIAN } from '../utils/calculations.js';

/* El concepto que el informe declara es «nombre (código)» —«Otros servicios (07)»—. El
   nombre viene de la columna «Tipo de operación», que admite texto libre, y el código de la
   columna «Cod», que es OPCIONAL. Cuando el código está, se pega al nombre para que el
   estudio lo guarde en un solo campo y `conceptoDeOperacion` lo lea del paréntesis.

   Cuando no está, el tipo se devuelve tal cual y el código queda sin resolver. Antes se
   rellenaba con «Otros servicios (07)» —el concepto de END GAME 2024— y ese código viajaba
   al informe de cualquier contribuyente que dejara la columna en blanco, que es lo normal
   en este formato. */
const tipoConCodigo = (tipo, cod) => {
  const t = String(tipo || '').trim();
  const c = String(cod || '').replace(/\D/g, '');
  if (!t || !c) return t;
  if (/\(\d+\)\s*$/.test(t)) return t; // el nombre ya traía su código escrito
  return t + ' (' + c.padStart(2, '0') + ')';
};

/**
 * Dónde está cada dato en una fila de encabezados del formato.
 *
 * Vive aparte porque el formato trae CUATRO secciones y no todas tienen las mismas
 * columnas: las de ingreso y egreso llevan «Formato | Concepto | Monto operación», y las de
 * «3. Otras operaciones» y «4. Información adicional» llevan «Movimiento Débito | Movimiento
 * crédito | Saldo | Monto operación». Leer la sección 4 con los índices de la sección 1
 * publicaría el saldo donde va el monto, que en un documento que se radica ante la DIAN es
 * peor que no leerla. Cada sección calcula los suyos con su propio encabezado.
 *
 * @param {Array} enc  la fila de encabezados.
 * @returns {{iNom:number, iNit:number, iPais:number, iTipo:number, iMonto:number, iCod:number}}
 */
function indicesDeEncabezado(enc) {
  const fila = enc || [];
  return {
    iNom: fila.findIndex(x => String(x).toLowerCase().includes('vinculado') || String(x).toLowerCase().includes('razón social')),
    iNit: fila.findIndex(x => String(x).toLowerCase().includes('identificaci')),
    // Excluye la columna de identificación: su encabezado ("Número de
    // Identificación fiscal del país de origen") también contiene 'país',
    // y sin este filtro ganaba por estar antes que "País de origen".
    iPais: fila.findIndex(x => {
      const s = String(x).toLowerCase();
      return (s.includes('país') || s.includes('pais')) && !s.includes('identificaci');
    }),
    iTipo: fila.findIndex(x => String(x).toLowerCase().includes('tipo de operaci')),
    /* «Monto operación» y no «Movimiento débito/crédito» ni «Saldo»: ninguno de esos tres
       contiene «monto», así que el mismo criterio sirve para las cuatro secciones. */
    iMonto: fila.findIndex(x => String(x).toLowerCase().includes('monto')),
    // Columna 'Cod' (código de operación DIAN). Cuando existe, solo cuentan
    // como operación real las filas que la tengan diligenciada: filas sin
    // código son renglones auxiliares del mismo formato/concepto (ej.
    // retención, IVA) que no son la operación de ingreso en sí.
    iCod: fila.findIndex(x => String(x).trim().toLowerCase() === 'cod'),
  };
}

/** ¿Esta fila es un encabezado de columnas y no una fila de datos? */
const esFilaDeEncabezado = (f) => {
  const s = (f || []).join(' ').toLowerCase();
  return s.includes('identificaci') && s.includes('tipo de operaci');
};

/**
 * Módulo de lectura e ingesta del Excel de Operaciones con Vinculados
 * (Basado en la lógica del método pt36AnalizarOperaciones de index.html)
 */
export async function parseExcelOperations(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });

    /* El nombre EXACTO de la hoja («Op. Vinculados Economicos») es el del formato de
       referencia, pero cada contribuyente titula sus pestañas a su manera —«OPERACIONES
       CON VINCULADOS»— aunque el contenido sea el mismo formato DIAN por dentro. Exigir
       el literal dejaba la hoja entera sin leer, sin ningún aviso de por qué. Se reconoce
       por palabra clave sobre el nombre sin tildes y en mayúsculas: 'VINC' cubre tanto
       «VINCULADOS» como su truncado por el límite de 31 caracteres de Excel («...CON
       VINC»), y 'PARAISO' las de paraísos fiscales, con o sin préstamos. */
    const normalizarNombreHoja = (s) => String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const hojasAEscanear = (wb.SheetNames || []).filter((nombre) => {
      const n = normalizarNombreHoja(nombre);
      return n.includes('VINC') || n.includes('PARAISO');
    });

    const rowsParsedIngreso = [];
    const rowsParsedEgreso = [];
    let mainVinculado = '';
    let mainVinculadoId = '';
    let mainPais = '';

    /* Identificaciones vistas por razón social, en TODAS las secciones y hojas (no solo en
       las filas que terminan sumando). El archivo de referencia trae «END GAME INTERACTIVE
       INC» con 444444001 en ingresos y 444444031 en egresos: como el estudio guarda un solo
       `vinc_id` y el parser solo mira ingresos, el informe se iba con un Tax ID sin que nadie
       lo notara. Aquí no se puede elegir cuál es el bueno —eso lo sabe el contribuyente—,
       pero sí se puede decir que hay más de uno. */
    const identificacionesPorRazon = new Map();
    /* Los egresos se descartan a propósito (pertenecen al formato 1001, no al 1007), pero
       hoy se descartan en silencio: quien carga el archivo no tiene forma de saber que había
       operaciones y plata que el informe no está mirando. */
    let egresosFilas = 0;
    let egresosMonto = 0;
    /* Las operaciones de «4. Información adicional» de todas las hojas. Se leen siempre; que
       lleguen o no al informe lo decide el umbral, y eso es criterio del dominio, no del
       lector del archivo. */
    const filasAdicionales = [];

    hojasAEscanear.forEach(nombreHoja => {
      const sh = wb.Sheets[nombreHoja];
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
      const { iNom, iNit, iPais, iTipo, iMonto, iCod } = indicesDeEncabezado(enc);

      /* Las operaciones de la hoja se acumulan aquí y no en `rowsParsed`, porque para
         decidir si la columna 'Cod' sirve de filtro hay que haberlas visto todas. */
      const candidatasIngreso = [];
      const candidatasEgreso = [];
      /* Las de «4. Información adicional» van aparte y sin el filtro de 'Cod': ese filtro se
         calibra con las filas de ingreso de la hoja y aplicarlo aquí escondería operaciones
         que el contribuyente sí declaró. */
      const candidatasAdicional = [];
      let idxAdicional = null;

      let currentTipo = '';
      // Las hojas 'Op. Vinculados Economicos' y 'Op. Paraisos Fiscales' listan
      // primero "1. OPERACIONES DE INGRESO" and luego "2. OPERACIONES DE
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
        // La sección «3. OTRAS OPERACIONES» venía arrastrando el 'EGRESO' de la sección
        // anterior. No cambiaba el monto (solo se suma INGRESO), pero sí inflaría el aviso
        // de egresos descartados con filas que no son egresos.
        if (rowJoined.includes('OTRAS OPERACIONES')) { currentSeccion = 'OTRAS'; continue; }
        /* «4. Información adicional»: préstamos, reintegros y operaciones a nombre de
           vinculados (códigos DIAN 61 a 63). No afectan el estado de resultados, así que
           no entran en el monto de la operación analizada ni en el rango — por eso se
           acumulan aparte y no tocan `candidatasIngreso`. */
        if (/INFORMACI[ÓO]N\s+ADICIONAL/.test(rowJoined)) { currentSeccion = 'ADICIONAL'; continue; }

        /* Cada sección trae su propio encabezado y sus propias columnas. El de la primera
           ya se resolvió arriba; los de las siguientes se recalculan al pasar por ellos. */
        if (esFilaDeEncabezado(f)) {
          if (currentSeccion === 'ADICIONAL') idxAdicional = indicesDeEncabezado(f);
          continue;
        }

        if (currentSeccion === 'ADICIONAL') {
          /* Sin el encabezado de la sección no se sabe qué columna es el monto, y adivinarlo
             con el de otra sección publicaría el saldo en su lugar. */
          if (!idxAdicional) continue;
          const ad = idxAdicional;
          const nomAd = String(ad.iNom > -1 ? f[ad.iNom] : '').trim();
          if (!nomAd || nomAd.startsWith('*')) continue;
          const montoAd = parseFloat(String(ad.iMonto > -1 ? f[ad.iMonto] : '').replace(/[^0-9.-]/g, '')) || 0;
          if (montoAd <= 0) continue;
          const codAd = String(ad.iCod > -1 ? f[ad.iCod] : '').trim();
          candidatasAdicional.push({
            vinculado: nomAd,
            nit: String(ad.iNit > -1 ? f[ad.iNit] : '').replace(/[^0-9]/g, ''),
            pais: String(ad.iPais > -1 ? f[ad.iPais] : '').trim(),
            tipo: tipoConCodigo(String(ad.iTipo > -1 ? f[ad.iTipo] : '').trim(), codAd),
            monto: montoAd,
          });
          continue;
        }

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

        if (nom && nit) {
          // Se agrupa por razón social normalizada: el mismo vinculado se escribe con
          // espacios o mayúsculas distintas entre secciones y si no, no se cruzaría.
          const clave = nom.toUpperCase().replace(/\s+/g, ' ');
          if (!identificacionesPorRazon.has(clave)) {
            identificacionesPorRazon.set(clave, { vinculado: nom, ids: new Set() });
          }
          identificacionesPorRazon.get(clave).ids.add(nit);
        }

        /* Los egresos se cuentan sin pasar por el filtro de 'Cod': ese filtro se calibra con
           las filas de ingreso de la hoja y aplicarlo aquí escondería egresos, que es justo
           lo contrario de lo que el aviso busca. Prefiere sobre-informar. */
        if (monto > 0 && currentSeccion === 'EGRESO') {
          egresosFilas++;
          egresosMonto += monto;
          candidatasEgreso.push({
            vinculado: nom,
            nit,
            pais,
            tipo: tipoConCodigo(currentTipo, cod),
            monto,
            cod
          });
        }

        if (monto > 0 && currentSeccion === 'INGRESO') {
          candidatasIngreso.push({
            vinculado: nom,
            nit,
            pais,
            tipo: tipoConCodigo(currentTipo, cod),
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
      const codEnUsoIngreso = candidatasIngreso.some(c => c.cod !== '');
      candidatasIngreso.forEach(({ cod, ...operacion }) => {
        if (!codEnUsoIngreso || cod !== '') rowsParsedIngreso.push(operacion);
      });

      const codEnUsoEgreso = candidatasEgreso.some(c => c.cod !== '');
      candidatasEgreso.forEach(({ cod, ...operacion }) => {
        if (!codEnUsoEgreso || cod !== '') rowsParsedEgreso.push(operacion);
      });

      filasAdicionales.push(...candidatasAdicional);
    });

    let rowsParsed = [];
    let esEgreso = false;

    if (rowsParsedIngreso.length > 0) {
      rowsParsed = rowsParsedIngreso;
      esEgreso = false;
    } else if (rowsParsedEgreso.length > 0) {
      rowsParsed = rowsParsedEgreso;
      esEgreso = true;
      // Ya que los egresos se ingieren como operaciones del estudio, no se consideran descartados
      egresosFilas = 0;
      egresosMonto = 0;
    }

    // Calcular el monto total y el tipo de operación principal
    const totalMonto = rowsParsed.reduce((acc, curr) => acc + curr.monto, 0);
    
    // Mapeo por tipo de operación
    const tipoMap = {};
    rowsParsed.forEach(r => {
      /* Las filas sin tipo no aportan concepto. Agruparlas bajo un nombre inventado hacía
         que ese nombre ganara por monto y se declarara como el concepto del estudio. */
      if (!r.tipo) return;
      tipoMap[r.tipo] = (tipoMap[r.tipo] || 0) + r.monto;
    });

    // Determinar el tipo de operación dominante por monto
    let mainTipo = null;
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

    /* Razones sociales con más de una identificación. Es una lista y no un contador porque
       el aviso tiene que nombrar cuál es el vinculado y cuáles los números en conflicto:
       decir «hay una divergencia» sin decir dónde no le sirve a quien tiene que corregirla. */
    const idsDivergentes = [...identificacionesPorRazon.values()]
      .filter(v => v.ids.size > 1)
      .map(v => ({ vinculado: v.vinculado, ids: [...v.ids] }));

    return {
      vinc: mainVinculado || null,
      vinc_id: mainVinculadoId || null,
      pais_vinc: paisNombre || null,
      vinc_tipo: mainTipo || null,
      monto: totalMonto || null,
      monto_operacion: totalMonto || null,
      t_s: totalMonto || null,
      contrapartes: contrapartes.size,
      idsDivergentes,
      egresosDescartados: { filas: egresosFilas, monto: egresosMonto },
      /* `null` y no un objeto vacío cuando el formato no trae la sección: es lo que
         distingue «este archivo no declaró información adicional» de «la declaró en cero», y
         de eso depende que el informe publique o no una tabla más. */
      operacionAdicional: filasAdicionales.length
        ? {
          filas: filasAdicionales,
          monto: filasAdicionales.reduce((acc, r) => acc + r.monto, 0),
        }
        : null,
      rows: rowsParsed,
      egreso: esEgreso
    };
  } catch (err) {
    console.error("Error parsing Excel operations file:", err);
    throw err;
  }
}
