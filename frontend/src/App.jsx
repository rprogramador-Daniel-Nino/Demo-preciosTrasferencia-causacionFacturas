import React, { useState, useEffect, useRef, useCallback } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import DatosContribuyente from './components/DatosContribuyente';
import IngestaOperaciones from './components/IngestaOperaciones';
import IngestaCifras from './components/IngestaCifras';
import MotorComparables from './components/MotorComparables';
import AuditoriaNorma from './components/AuditoriaNorma';
import ReporteGenerador from './components/ReporteGenerador';
import Acceso from './components/Acceso';
import Clientes from './components/Clientes';
import CatalogoHistorico from './components/CatalogoHistorico';
import { guardarJSON } from './services/persistenciaLocal';
import { observarSesion, cerrarSesion } from './services/sesion';
import CompartirEstudio from './components/CompartirEstudio';
import {
  usuarioDeSesion, guardarEstudio, leerEstudio, listarEstudios, borrarEstudio,
  guardarCliente, migrarDesdeLocalStorage, migrarDesdeRaiz,
  listarEstudiosCompartidosConmigo, leerEstudioCompartido, guardarEstudioCompartido,
} from './services/firestoreRepo';
import { separarEstudio, SELLO_ESTUDIO, ROL_EDITOR } from './services/firestoreModelo';
import {
  guardarAnexoEeff, leerAnexoEeff, guardarAnexoBImagenes,
  borrarRecursosDelEstudio,
} from './services/plantillaStore';
/* Lee las imágenes del ANEXO B y, de paso, recorta las que se guardaron como hoja
   completa antes de que existiera el recorte. Ver `recorteEeff.js`. */
import { recortarImagenesGuardadas } from './services/recorteEeff';
import {
  leerSesionUi, guardarSesionUi, limpiarSesionUi, acumularVistaMontada, tabCanonica,
  accionSobreElRecuerdo,
} from './services/sesionUi';
/* Rescata las cifras del EEFF que se guardaron con el separador de miles como punto
   decimal, antes de que `valorDeRubro` lo corrigiera en la lectura. Ver `eeffParser.js`. */
import { repararCifrasDelEstudio } from './services/eeffParser';

/* Retardo del autoguardado. El estudio cambia con cada tecla y cada escritura en
   Firestore se factura y cuenta contra el límite de escrituras por documento, así que
   se espera a que la mano se detenga. Con localStorage esto no importaba. */
const RETARDO_GUARDADO = 1500;

/* Clave del veredicto de la curación con IA. Se queda en el navegador por decisión
   del usuario, y además es lo más pesado del estudio: un dictamen por candidata sobre
   más de mil empresas no cabe cómodo en un documento de Firestore. */
const claveIaMatch = (id) => `pt:iaMatch:${id}`;

/* Pestañas que no necesitan un estudio abierto: el tablero y las dos vistas de la
   base compartida. */
const VISTAS_SIN_ESTUDIO = ['dashboard', 'clientes', 'catalogo'];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeStudyId, setActiveStudyId] = useState(null);
  const [study, setStudy] = useState({});
  /* Pantallas del estudio que se mantienen montadas: { estudioId, tabs }. Cambiar de
     pestaña las desmontaba, y con ellas se iba su estado —el registro de la importación,
     el avance de una lectura de documentos, una curación a medias—. Ver
     `acumularVistaMontada`. */
  const [vistasMontadas, setVistasMontadas] = useState({ estudioId: null, tabs: [] });
  /* Restauración de la sesión anterior en curso, para no enseñar el tablero un instante
     antes de abrir el estudio que el usuario ya tenía abierto. */
  const [restaurandoSesion, setRestaurandoSesion] = useState(false);
  /* Si ya se intentó recuperar dónde estaba el usuario. Mientras sea `false`, nadie escribe
     ni borra ese recuerdo: en el primer render no hay estudio abierto todavía y el guardado
     lo interpretaba como «cerró el estudio», borrándolo antes de poder leerlo. */
  const [restauracionIntentada, setRestauracionIntentada] = useState(false);

  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [avisoSesion, setAvisoSesion] = useState('');

  const [indice, setIndice] = useState([]);
  /* Estudios que otros compartieron conmigo: se abren en solo lectura. */
  const [compartidos, setCompartidos] = useState([]);
  /* Cuando el estudio abierto es de otra persona: { duenoUid, duenoNombre }. Mientras
     esté puesto, el autoguardado no escribe —las reglas lo rechazarían— y la barra lo
     advierte. */
  const [estudioAjeno, setEstudioAjeno] = useState(null);
  const [migracion, setMigracion] = useState(null);
  /* 'guardado' | 'guardando' | 'error': con la base remota una escritura puede
     fallar, y el problema que traíamos era justamente perder cambios sin avisar. */
  const [estadoGuardado, setEstadoGuardado] = useState('guardado');
  /* Identificador recién copiado, para confirmarlo en el botón un instante. */
  const [idCopiado, setIdCopiado] = useState(null);

  const temporizador = useRef(null);
  const cargando = useRef(false);

  /* ── sesión ── */
  useEffect(() => {
    return observarSesion((user, error) => {
      setUsuario(usuarioDeSesion(user));
      setAvisoSesion(error ? error.message : '');
      setCargandoSesion(false);
    });
  }, []);

  const refrescarIndice = useCallback(async () => {
    if (!usuario) return;

    /* Los dos avisos se acumulan y se publican juntos. Antes cada `catch` escribía en
       el mismo estado y el segundo pisaba al primero, así que cuando fallaban las dos
       consultas —lo que pasa si la sesión no está lista o las reglas niegan todo— solo
       se veía «Estudios compartidos…» y parecía un problema del compartir, cuando el
       propio índice también había fallado. El aviso mandaba a arreglar la pieza
       equivocada. */
    const problemas = [];

    try {
      setIndice(await listarEstudios(usuario));
    } catch (err) {
      console.error('[estudios] no se pudo leer el índice', err);
      problemas.push('No se pudo leer la lista de estudios: ' +
        (err && err.message ? err.message : 'error desconocido'));
    }
    try {
      setCompartidos(await listarEstudiosCompartidosConmigo(usuario));
    } catch (err) {
      console.error('[compartidos] no se pudieron leer', err);
      /* A la vista y con el motivo: los dos fallos posibles —reglas o índice— se
         arreglan con despliegues distintos, y en consola nadie los ve. */
      problemas.push('Estudios compartidos: ' +
        (err && err.message ? err.message : 'no se pudieron leer.'));
    }

    /* Si fallan las dos, decirlo: es la señal de que el problema no está en ninguna de
       las dos consultas sino en la sesión, y ahorra buscar en el sitio equivocado. */
    if (problemas.length > 1) {
      problemas.push('Fallaron las dos consultas, así que lo más probable es que el ' +
        'problema esté en la sesión y no en el compartir: vuelve a entrar.');
    }
    setAvisoSesion(problemas.join(' · '));
  }, [usuario]);

  /* ── al entrar: recuperar lo propio y leer el índice ──
     Dos migraciones, ambas idempotentes: la del navegador sube lo que quedó en
     localStorage, y la de la raíz recoge lo que este consultor creó cuando las
     colecciones eran comunes al equipo. Ninguna toca lo de otra persona. */
  useEffect(() => {
    if (!usuario) return;
    let vigente = true;
    (async () => {
      try {
        const resultado = await migrarDesdeLocalStorage(usuario, {
          guardarLocales: async (id, local) => {
            if (local.eeffImages && local.eeffImages.length) await guardarAnexoEeff(id, local.eeffImages);
            if (local.eeffImagenesComparables && Object.keys(local.eeffImagenesComparables).length) {
              await guardarAnexoBImagenes(id, local.eeffImagenesComparables);
            }
          },
        });
        if (vigente && !resultado.yaHecha && resultado.total) setMigracion(resultado);
      } catch (err) {
        console.error('[migración] falló', err);
      }
      try {
        const privada = await migrarDesdeRaiz(usuario);
        if (vigente && privada.movidos) {
          setMigracion(prev => ({ ...(prev || {}), movidosARaizPrivada: privada.movidos }));
        }
      } catch (err) {
        console.error('[migración privada] falló', err);
      }
      if (vigente) await refrescarIndice();
    })();
    return () => { vigente = false; };
  }, [usuario, refrescarIndice]);

  /* ── autoguardado con retardo ── */
  useEffect(() => {
    if (!usuario || !activeStudyId || !study || Object.keys(study).length === 0) return;
    /* No guardar lo que se acaba de leer: abrir un estudio no es modificarlo. */
    if (cargando.current) { cargando.current = false; return; }
    /* Un estudio ajeno compartido para consultar no se guarda: intentarlo daría un error
       de permisos por cada tecla. La barra ya avisa de que es de solo lectura. Si el
       dueño concedió edición sí se guarda, pero en SU espacio y por el camino que
       comprueba que nadie más se adelantó. */
    if (estudioAjeno && estudioAjeno.rol !== ROL_EDITOR) return;

    /* Los datos en memoria tienen que ser los del estudio activo. Sin esta comprobación
       un estudio acabó con los datos de otro —dos documentos, misma razón social, mismo
       NIT y mismo monto—: cada pantalla guarda su propio estado y lo escribe en «el
       estudio activo» sin comprobar de dónde salió, y `setDoc` sin `merge` reemplaza el
       documento entero.

       Ante la duda no se guarda. Perder el último cambio se nota y se repite; escribir
       los datos de un contribuyente en el estudio de otro no se nota hasta que ya se
       radicó. El aviso es visible a propósito: un guardado que se salta en silencio es
       lo mismo que un fallo silencioso. */
    if (study[SELLO_ESTUDIO] !== activeStudyId) {
      console.error(
        '[estudios] guardado bloqueado: los datos en memoria son del estudio ' +
        study[SELLO_ESTUDIO] + ' y el activo es ' + activeStudyId
      );
      setEstadoGuardado('error');
      setAvisoSesion(
        'No se guardó: los datos en pantalla no corresponden al estudio abierto. ' +
        'Recargue la página (F5) y vuelva a abrirlo antes de seguir editando.'
      );
      return;
    }

    setEstadoGuardado('guardando');
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(async () => {
      try {
        const { local } = separarEstudio(study);
        if (local.iaMatch) guardarJSON(claveIaMatch(activeStudyId), local.iaMatch);
        /* Las páginas del PDF de estados financieros van a IndexedDB: son data URLs de
           varias páginas y no caben ni en el documento de Firestore ni en localStorage. */
        if (local.eeffImages && local.eeffImages.length) {
          await guardarAnexoEeff(activeStudyId, local.eeffImages);
        }
        /* Mismo motivo, pero por comparable: ver CAMPOS_SOLO_LOCALES. */
        if (local.eeffImagenesComparables && Object.keys(local.eeffImagenesComparables).length) {
          await guardarAnexoBImagenes(activeStudyId, local.eeffImagenesComparables);
        }
        const resultado = estudioAjeno
          ? await guardarEstudioCompartido(estudioAjeno.duenoUid, activeStudyId, study, usuario)
          : await guardarEstudio(activeStudyId, study, usuario);

        /* Otra persona escribió el estudio entre lo que se abrió aquí y este guardado.
           No se pisa: se avisa y se deja el trabajo en pantalla, que es lo único que
           permite decidir qué conservar. Guardar encima borraría lo suyo sin rastro. */
        if (resultado && resultado.conflicto) {
          setEstadoGuardado('error');
          setAvisoSesion(
            `No se guardó: ${resultado.quien} modificó este estudio mientras usted trabajaba. ` +
            'Copie aparte lo que acaba de cambiar y recargue la página (F5) antes de seguir, ' +
            'o se perdería el trabajo de uno de los dos.'
          );
          return;
        }
        if (resultado && resultado.error) {
          setEstadoGuardado('error');
          setAvisoSesion(resultado.error);
          return;
        }

        await guardarCliente(study, usuario);
        setEstadoGuardado('guardado');
        setAvisoSesion('');
        setIndice(prev => prev.map(e => e.id === activeStudyId
          ? { ...e, ent: study.ent || e.ent, nit: study.nit || e.nit, anio: study.anio || e.anio, updated: Date.now() }
          : e));
      } catch (err) {
        console.error('[estudios] no se pudo guardar', err);
        setEstadoGuardado('error');
        /* El motivo va a la vista: un fallo de guardado que solo aparece en la consola
           es lo mismo que un fallo silencioso, y ese era el problema de partida. */
        setAvisoSesion((err && err.message) || 'No se pudo guardar el estudio en la nube.');
      }
    }, RETARDO_GUARDADO);

    return () => { if (temporizador.current) clearTimeout(temporizador.current); };
  }, [study, activeStudyId, usuario, estudioAjeno]);

  /* `tabInicial` existe para la restauración al arrancar: abrir un estudio a mano empieza
     por el primer paso, pero volver tras una recarga tiene que dejar al usuario en el paso
     donde estaba. */
  /* Completa lo que llega de la nube con lo que vive en este navegador: el veredicto de
     la curación (localStorage) y las imágenes de los anexos A y B (IndexedDB). Nada de
     eso cabe en el documento de Firestore —ver CAMPOS_SOLO_LOCALES—, así que el estudio
     llega sin ello y hay que volver a pegarlo aquí.

     Es la misma función para un estudio propio y para uno compartido, y esa es la
     corrección: cuando abrir un compartido era un camino aparte que no leía nada de
     esto, la pantalla de estados financieros abría vacía aunque el editor ya hubiera
     cargado el PDF, y al cargar un formato nuevo `updates.eeffImages` reemplazaba la
     lista entera —dejando solo lo nuevo y perdiendo lo que ni siquiera se había leído. */
  const conRecursosLocales = async (id, datos) => {
    const crudo = localStorage.getItem(claveIaMatch(id));
    const iaMatch = crudo ? JSON.parse(crudo) : null;
    /* Las páginas del ANEXO A: sin esto el informe saldría sin los estados financieros
       adjuntos, que es lo que inserta docxRelleno.js. */
    let eeffImages = [];
    try {
      eeffImages = await leerAnexoEeff(id);
    } catch (err) {
      console.error('[anexo EEFF] no se pudieron leer las páginas guardadas', err);
    }
    /* Mismo motivo, pero las imágenes del EEFF de cada comparable para el ANEXO B.
       La lectura recorta y vuelve a guardar las que quedaron como hoja completa: no
       se deja al autoguardado porque abrir un estudio no lo dispara
       (`cargando.current`), y el informe se generaría con la página en blanco. */
    const eeffImagenesComparables = await recortarImagenesGuardadas(id);
    return {
      /* Antes que nada, las cifras: un estudio guardado antes del arreglo trae el detalle
         de activos y los rubros del balance con el punto de miles leído como decimal, y
         publicaría la Tabla 10 con «4» donde el documento imprime 4.064.393. */
      ...repararCifrasDelEstudio(datos || {}),
      ...(iaMatch ? { iaMatch } : {}),
      ...(eeffImages && eeffImages.length ? { eeffImages } : {}),
      ...(eeffImagenesComparables && Object.keys(eeffImagenesComparables).length ? { eeffImagenesComparables } : {}),
      /* Sello del estudio del que salieron estos datos: el autoguardado no escribe si
         no coincide con el estudio activo. Ver SELLO_ESTUDIO. */
      [SELLO_ESTUDIO]: id,
    };
  };

  const selectStudy = async (id, { tabInicial = 'contribuyente' } = {}) => {
    try {
      const datos = await leerEstudio(id, usuario);
      cargando.current = true;
      setEstudioAjeno(null);
      setActiveStudyId(id);
      setStudy(await conRecursosLocales(id, datos));
      setActiveTab(tabCanonica(tabInicial));
      return true;
    } catch (err) {
      console.error('[estudios] no se pudo abrir', err);
      setAvisoSesion('No se pudo abrir el estudio: ' + (err && err.message ? err.message : 'error desconocido'));
      return false;
    }
  };

  /* ── volver donde estaba ──
     Recargar la página devolvía al tablero con el estudio cerrado, y había que buscarlo y
     abrirlo otra vez. Y no hace falta recargar a mano: basta que el navegador descarte la
     pestaña o que se despliegue una versión nueva. Corre una sola vez, cuando la sesión ya
     está resuelta: sin usuario las reglas rechazan la lectura.

     Si el estudio guardado ya no se puede abrir —borrado, o de otra cuenta— se olvida, para
     no reintentarlo en cada arranque. */
  const sesionRestaurada = useRef(false);
  useEffect(() => {
    if (cargandoSesion || !usuario || sesionRestaurada.current) return;
    sesionRestaurada.current = true;
    const anterior = leerSesionUi();
    /* Se marca como intentada en todos los caminos, incluido «no había nada guardado»:
       hasta que esto ocurre, el efecto de abajo no puede tocar el recuerdo. */
    if (!anterior) { setRestauracionIntentada(true); return; }
    setRestaurandoSesion(true);
    (async () => {
      /* Un estudio de otra persona se reabre por la ruta de su dueño. Es lo que hace
         que recargar no eche del estudio a quien tiene permiso de edición. */
      const abierto = anterior.duenoUid
        ? await abrirCompartido(
          { duenoUid: anterior.duenoUid, id: anterior.estudioId },
          { tabInicial: anterior.tab }
        )
        : await selectStudy(anterior.estudioId, { tabInicial: anterior.tab });
      if (!abierto) limpiarSesionUi();
      setRestaurandoSesion(false);
      setRestauracionIntentada(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoSesion, usuario]);

  /* Anota dónde está el usuario, para el arranque siguiente. Solo con estudio abierto:
     sin él no hay nada que restaurar y el tablero ya es el punto de partida.

     `restauracionIntentada` es lo que hace que esto funcione, y su ausencia era el fallo:
     en el primer render `activeStudyId` vale null —todavía no se ha resuelto la sesión de
     Google, así que el efecto de arriba aún no ha podido abrir nada— y este efecto borraba
     el recuerdo antes de que hubiera ocasión de usarlo. El resultado era exactamente lo que
     este arreglo venía a evitar: recargar devolvía al tablero con el estudio cerrado. Hasta
     que la restauración se haya intentado, aquí no se escribe ni se borra nada.

     Los estudios que otro compartió se recuerdan junto al uid de su dueño, que es lo que
     `leerEstudioCompartido` necesita para reabrirlos. Antes quedaban fuera —restaurarlos
     con `leerEstudio` fallaba contra las reglas—, y eso echaba del estudio a quien tenía
     permiso de edición cada vez que recargaba. */
  useEffect(() => {
    const accion = accionSobreElRecuerdo({ restauracionIntentada, estudioId: activeStudyId });
    if (accion === 'guardar') {
      guardarSesionUi({
        estudioId: activeStudyId,
        tab: activeTab,
        duenoUid: estudioAjeno ? estudioAjeno.duenoUid : '',
      });
    } else if (accion === 'limpiar') limpiarSesionUi();
  }, [activeStudyId, activeTab, estudioAjeno, restauracionIntentada]);

  /* Qué pantallas del estudio quedan montadas. Se acumulan a medida que se visitan y no
     se retiran al cambiar de pestaña, que es lo que conserva lo que esté en marcha. */
  useEffect(() => {
    setVistasMontadas(prev => acumularVistaMontada(prev, { estudioId: activeStudyId, tab: activeTab }));
  }, [activeStudyId, activeTab]);

  /* Abre un estudio que otra persona compartió, con el nivel que su dueño concedió y con
     los mismos recursos locales que uno propio: quien tiene permiso de edición trabaja
     ahí de verdad, y abrirlo a medias hacía que el trabajo se perdiera al recargar.

     Lo que sigue sin poder traerse son los anexos que cargó el DUEÑO: viven en la
     IndexedDB de su navegador y no viajan a ninguna parte. Los que cargue el editor sí
     quedan aquí y se recuperan al reabrir.

     El rol se toma de la lectura y no de la fila del tablero: esa puede llevar minutos
     en memoria y el acceso haber cambiado entretanto. */
  const abrirCompartido = async (compartido, { tabInicial = 'contribuyente' } = {}) => {
    try {
      const leido = await leerEstudioCompartido(compartido.duenoUid, compartido.id, usuario);
      if (!leido) {
        setAvisoSesion('Ese estudio ya no está disponible: puede que su dueño le haya retirado el acceso.');
        return false;
      }
      cargando.current = true;
      setEstudioAjeno({
        duenoUid: compartido.duenoUid,
        duenoNombre: compartido.duenoNombre || leido.duenoNombre || 'otro consultor',
        rol: leido.rol,
      });
      setActiveStudyId(compartido.id);
      setStudy(await conRecursosLocales(compartido.id, leido.datos));
      setActiveTab(tabCanonica(tabInicial));
      return true;
    } catch (err) {
      console.error('[compartidos] no se pudo abrir', err);
      setAvisoSesion('No se pudo abrir el estudio compartido: ' + (err && err.message ? err.message : 'error desconocido'));
      return false;
    }
  };

  /* Campos con los que nace un estudio. Se extrajo a función porque ahora hay dos
     puntos de creación: en blanco y a partir de un cliente del catálogo. */
  const estudioEnBlanco = () => ({
    /* Razón social vacía y no «Nueva Empresa S.A.S»: ese texto se veía como un dato ya
       diligenciado y llegaba al informe si nadie lo cambiaba. Vacío, el tablero muestra
       «Sin razón social» y las guardas del generador lo cuentan como campo sin dato. */
    ent: '', nit: '', anio: 2025,
    ciiu: '', objeto: '', representante: '', vinc: '', pais_vinc: '', vinc_id: '',
    vinc_tipo: '',
    /* Los quince rubros de la parte examinada, los mismos y en el mismo orden que
       `RUBROS_EXAMINADA` del libro. Los ocho del balance —efectivo, inversiones
       asociadas, impuestos corrientes, los dos subtotales, el total, intangibles y
       diferidos— no estaban declarados aquí ni tenían casilla en el formulario: existían
       solo si la lectura del documento acertaba, y si no, la única forma de corregirlos
       era editar el Excel a mano. */
    t_s: '', t_c: '', t_op: '',
    t_cash: '', t_inv_assoc: '', t_ar: '', t_inv: '', t_tax: '', t_act_curr: '',
    t_ppe: '', t_intang: '', t_dif: '', t_act_nocurr: '', t_act_tot: '', t_ap: '',
    /* El detalle completo de la sección ACTIVOS, tal como la ingesta la transcribe del
       EEFF (ver eeffParser.js): alimenta la Tabla 10 sin depender de una lista fija de
       campos con nombre que no cubre cualquier estructura de balance. */
    t_activos_detalle: [],
    /* `prime` arranca en 7,37: el promedio anual 2025 de la Bank Prime Loan Rate
       (Reserva Federal, H.15 · serie FRED RIFSPBLPNA). Es editable como cualquier otro
       campo, y hay que cambiarlo si el año gravable no es 2025. Antes arrancaba vacío,
       y un estudio con el ajuste activado y la tasa sin diligenciar producía un ajuste
       idénticamente cero sin avisar de nada. */
    pli: 'MO', useadj: false, prime: '7.37', comparables: [], cmode: 'all',
  });

  const crearEstudio = async (datos) => {
    const newId = 'study_' + Date.now();
    try {
      await guardarEstudio(newId, datos, usuario);
      cargando.current = true;
      setEstudioAjeno(null);
      setActiveStudyId(newId);
      setStudy({ ...datos, [SELLO_ESTUDIO]: newId });
      setActiveTab('contribuyente');
      await refrescarIndice();
    } catch (err) {
      console.error('[estudios] no se pudo crear', err);
      setAvisoSesion('No se pudo crear el estudio: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  };

  const newStudy = () => crearEstudio(estudioEnBlanco());

  /* Estudio nuevo con los datos del contribuyente ya diligenciados. El año arranca en
     el actual: lo habitual es que el estudio que falta sea el del año siguiente al
     último que se hizo, y de todas formas se edita en el paso 1. */
  const nuevoEstudioDesdeCliente = (cliente) => crearEstudio({
    ...estudioEnBlanco(),
    ent: cliente.razonSocial || '',
    nit: cliente.nit || '',
    ciiu: cliente.ciiu || '',
    objeto: cliente.objeto || '',
    representante: cliente.representante || '',
    actividad_especifica: cliente.actividadEspecifica || '',
  });

  const deleteStudy = async (id) => {
    try {
      await borrarEstudio(id, usuario);
      localStorage.removeItem(claveIaMatch(id));
      /* Los recursos locales del estudio se van con él: las imágenes de su plantilla,
         las páginas de su ANEXO A y su vínculo con la plantilla. Si no, quedan
         megabytes en IndexedDB sin dueño y sin forma de llegar a ellos —un PDF de
         referencia ronda los 5 MB en base64. La plantilla compartida no se toca. */
      try { await borrarRecursosDelEstudio(id); } catch { /* el estudio ya se borró: no bloquea */ }
      if (activeStudyId === id) {
        setActiveStudyId(null);
        setStudy({});
        setActiveTab('dashboard');
      }
      await refrescarIndice();
    } catch (err) {
      console.error('[estudios] no se pudo borrar', err);
      setAvisoSesion('No se pudo borrar el estudio: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  };

  const duplicateStudy = async (id) => {
    try {
      const original = await leerEstudio(id, usuario);
      if (!original) return;
      const newId = 'study_' + Date.now();
      await guardarEstudio(newId, { ...original, ent: (original.ent || '') + ' (Copia)' }, usuario);
      await refrescarIndice();
    } catch (err) {
      console.error('[estudios] no se pudo duplicar', err);
      setAvisoSesion('No se pudo duplicar el estudio: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  };

  const updateStudy = (fields) => {
    setStudy(prev => ({ ...prev, ...fields }));
  };

  /* Copia el identificador al portapapeles. `navigator.clipboard` no existe en
     contextos sin HTTPS ni con el permiso denegado, y ahí se deja el texto
     seleccionable en lugar de romper: el botón muestra el id de todas formas. */
  const copiarId = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
      setIdCopiado(id);
      setTimeout(() => setIdCopiado(null), 1500);
    } catch (err) {
      console.warn('[estudios] no se pudo copiar el identificador', err);
    }
  };

  if (cargandoSesion) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b]">
        <span className="text-xs text-zinc-500">Comprobando la sesión…</span>
      </div>
    );
  }

  if (!usuario) return <Acceso />;

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {/* Barra de estado de la sesión y del guardado. Con la base compartida importa
          saber con qué cuenta se está trabajando y si lo último quedó guardado. */}
      <div className="flex items-center gap-3 mb-4 text-[11px] text-zinc-500">
        <span>
          {usuario.nombre || usuario.correo}
          {usuario.nombre ? <span className="text-zinc-400"> · {usuario.correo}</span> : null}
        </span>
        {/* Identificador del estudio abierto. Los mensajes de error de la base lo
            nombran —«no se pudo guardar … estudios/study_1785772970844»— y hasta ahora
            no aparecía en ninguna pantalla, así que no había manera de saber a qué
            estudio se referían. Un clic lo copia, para pegarlo en la consola de
            Firestore o al reportar un problema. */}
        {activeStudyId && (
          <button
            onClick={() => copiarId(activeStudyId)}
            className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            title="Identificador del estudio en la base de datos · clic para copiarlo"
          >
            {idCopiado === activeStudyId ? '✓ copiado' : activeStudyId}
          </button>
        )}

        {/* Acceso del estudio: privado por omisión, compartible uno a uno. Solo del
            propio: en uno ajeno no hay nada que gestionar. */}
        {activeStudyId && !estudioAjeno && (
          <CompartirEstudio estudioId={activeStudyId} usuario={usuario} />
        )}

        {/* En un estudio ajeno con edición interesa lo mismo que en el propio —si lo
            último quedó guardado—, más de quién es. Con solo lectura no hay estado de
            guardado que mostrar, porque no se guarda nada. */}
        {activeStudyId && estudioAjeno ? (
          <span className={estudioAjeno.rol === ROL_EDITOR
            ? 'text-zinc-500'
            : 'text-amber-600 dark:text-amber-400 font-semibold'}>
            {estudioAjeno.rol === ROL_EDITOR ? (
              <>
                <span className={
                  estadoGuardado === 'error' ? 'text-amber-600 dark:text-amber-400 font-semibold'
                    : estadoGuardado === 'guardando' ? 'text-zinc-400' : 'text-emerald-600 dark:text-emerald-500'
                }>
                  {estadoGuardado === 'error' ? '⚠ no se pudo guardar en la nube'
                    : estadoGuardado === 'guardando' ? 'guardando…' : 'guardado'}
                </span>
                {' · puede editar · de '}{estudioAjeno.duenoNombre}
              </>
            ) : `solo lectura · compartido por ${estudioAjeno.duenoNombre}`}
          </span>
        ) : activeStudyId && (
          <span className={
            estadoGuardado === 'error' ? 'text-amber-600 dark:text-amber-400 font-semibold'
              : estadoGuardado === 'guardando' ? 'text-zinc-400' : 'text-emerald-600 dark:text-emerald-500'
          }>
            {estadoGuardado === 'error' ? '⚠ no se pudo guardar en la nube'
              : estadoGuardado === 'guardando' ? 'guardando…' : 'guardado'}
          </span>
        )}
        <button
          onClick={() => cerrarSesion()}
          className="ml-auto px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Salir
        </button>
      </div>

      {avisoSesion && (
        <div className="mb-4 text-[11px] bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded-lg p-2.5">
          {avisoSesion}
        </div>
      )}

      {migracion && (
        <div className="mb-4 text-[11px] bg-[#0FA3A1]/5 border border-[#0FA3A1]/30 text-zinc-700 dark:text-zinc-200 rounded-lg p-2.5">
          Se subieron a la base compartida {migracion.subidos} de {migracion.total} estudios que estaban
          guardados en este navegador
          {migracion.fallidos ? `; ${migracion.fallidos} no se pudieron subir y se volverá a intentar al abrir la aplicación` : ''}.
          Lo local no se borró.
          <button onClick={() => setMigracion(null)} className="ml-2 underline">entendido</button>
        </div>
      )}

      {activeTab === 'dashboard' && (restaurandoSesion ? (
        /* Sin esto se ve el tablero un instante y salta al estudio, que parece un fallo. */
        <div className="text-center text-xs text-zinc-500 py-10">
          Volviendo al estudio que tenía abierto…
        </div>
      ) : (
        <Dashboard
          indice={indice}
          compartidos={compartidos}
          abrirCompartido={abrirCompartido}
          selectStudy={selectStudy}
          newStudy={newStudy}
          deleteStudy={deleteStudy}
          duplicateStudy={duplicateStudy}
        />
      ))}

      {/* Vistas de la base compartida: no dependen de tener un estudio abierto. */}
      {activeTab === 'clientes' && (
        <Clientes usuario={usuario} nuevoEstudioDesdeCliente={nuevoEstudioDesdeCliente} selectStudy={selectStudy} />
      )}

      {activeTab === 'catalogo' && <CatalogoHistorico usuario={usuario} />}

      {activeStudyId ? (
        /* `key` con el id del estudio: al cambiar de estudio React destruye estas
           pantallas y las crea de nuevo, así que ningún estado local sobrevive de un
           estudio al siguiente. El motor de comparables guarda en estado local las
           comparables, el ámbito, la configuración, el embudo y la curación, y lo
           inicializa una sola vez al montarse; sin remontar, ese estado se escribía en el
           estudio que estuviera activo después. */
        /* Las pantallas visitadas se quedan montadas y solo se ocultan. Antes se
           renderizaba `activeTab === 'x' && <Pantalla/>`, así que cambiar de pestaña
           desmontaba la anterior y se perdía todo su estado local: el registro de la
           importación de Capital IQ, el avance de una lectura de documentos, una curación
           por IA a medias —con sus consultas ya pagadas—. Oculta pero montada, lo que está
           en marcha sigue en marcha y al volver todo está donde estaba.

           Se ocultan con `display:none` y no con la clase `hidden` de Tailwind porque
           cualquier utilidad de layout en el componente la sobreescribiría.

           `key` con el identificador del estudio se conserva: al cambiar de estudio estas
           pantallas se destruyen y se crean de nuevo, y ese remonte es lo que impide que el
           estado local de un estudio acabe escrito en el siguiente. */
        <React.Fragment key={activeStudyId}>
          {vistasMontadas.estudioId === activeStudyId && vistasMontadas.tabs.map(tab => (
            <div key={tab} style={{ display: tab === tabCanonica(activeTab) ? undefined : 'none' }}>
              {tab === 'contribuyente' && (
                <DatosContribuyente study={study} updateStudy={updateStudy} />
              )}
              {tab === 'Operaciones' && (
                <IngestaOperaciones study={study} updateStudy={updateStudy} />
              )}
              {tab === 'Estados financieros' && (
                <IngestaCifras study={study} updateStudy={updateStudy} />
              )}
              {tab === 'comparables' && (
                <MotorComparables study={study} updateStudy={updateStudy} estudioId={activeStudyId} usuario={usuario} />
              )}
              {tab === 'auditoria' && (
                <AuditoriaNorma study={study} />
              )}
              {tab === 'informe' && (
                /* `usuario` hace falta para guardar la plantilla del informe en la nube:
                   la ruta de Storage cuelga de su uid. */
                <ReporteGenerador study={study} updateStudy={updateStudy} estudioId={activeStudyId} usuario={usuario} />
              )}
            </div>
          ))}
        </React.Fragment>
      ) : (
        /* El aviso solo vale para los pasos del estudio: el tablero, los clientes y el
           catálogo se consultan sin tener ninguno abierto. */
        !VISTAS_SIN_ESTUDIO.includes(activeTab) && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-amber-800 dark:text-amber-300 p-4 rounded-lg text-sm text-center">
            Por favor, seleccione o cree un estudio en la pestaña de <strong>Inicio</strong> antes de continuar.
          </div>
        )
      )}
    </Layout>
  );
}
