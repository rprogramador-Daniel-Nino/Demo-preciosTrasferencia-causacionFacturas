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
  listarEstudiosCompartidosConmigo, leerEstudioCompartido,
} from './services/firestoreRepo';
import { separarEstudio } from './services/firestoreModelo';
import { guardarAnexoEeff, leerAnexoEeff, borrarRecursosDelEstudio } from './services/plantillaStore';

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
    try {
      setIndice(await listarEstudios(usuario));
    } catch (err) {
      console.error('[estudios] no se pudo leer el índice', err);
      setAvisoSesion('No se pudo leer la lista de estudios: ' + (err && err.message ? err.message : 'error desconocido'));
    }
    try {
      setCompartidos(await listarEstudiosCompartidosConmigo(usuario));
    } catch (err) {
      console.error('[compartidos] no se pudieron leer', err);
    }
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
    /* Un estudio ajeno se consulta, no se edita: intentar guardarlo daría un error de
       permisos por cada tecla. La barra ya avisa de que es de solo lectura. */
    if (estudioAjeno) return;

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
        await guardarEstudio(activeStudyId, study, usuario);
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

  const selectStudy = async (id) => {
    try {
      const datos = await leerEstudio(id, usuario);
      cargando.current = true;
      setEstudioAjeno(null);
      setActiveStudyId(id);
      /* El veredicto de la curación se reincorpora desde el navegador: no viaja a la
         nube, así que el estudio llega sin él y hay que volver a pegarlo aquí. */
      const crudo = localStorage.getItem(claveIaMatch(id));
      const iaMatch = crudo ? JSON.parse(crudo) : null;
      /* Y las páginas del ANEXO A desde IndexedDB: sin esto el informe saldría sin los
         estados financieros adjuntos, que es lo que consume exactTemplateMapper. */
      let eeffImages = [];
      try {
        eeffImages = await leerAnexoEeff(id);
      } catch (err) {
        console.error('[anexo EEFF] no se pudieron leer las páginas guardadas', err);
      }
      setStudy({
        ...(datos || {}),
        ...(iaMatch ? { iaMatch } : {}),
        ...(eeffImages && eeffImages.length ? { eeffImages } : {}),
      });
      setActiveTab('contribuyente');
    } catch (err) {
      console.error('[estudios] no se pudo abrir', err);
      setAvisoSesion('No se pudo abrir el estudio: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  };

  /* Abre un estudio que otra persona compartió. Se carga en solo lectura y sin tocar
     los recursos locales: las imágenes de su ANEXO A están en el navegador del dueño,
     así que aquí no hay nada que leer de IndexedDB. */
  const abrirCompartido = async (compartido) => {
    try {
      const datos = await leerEstudioCompartido(compartido.duenoUid, compartido.id);
      if (!datos) {
        setAvisoSesion('Ese estudio ya no está disponible: puede que su dueño le haya retirado el acceso.');
        return;
      }
      cargando.current = true;
      setEstudioAjeno({ duenoUid: compartido.duenoUid, duenoNombre: compartido.duenoNombre || 'otro consultor' });
      setActiveStudyId(compartido.id);
      setStudy(datos);
      setActiveTab('contribuyente');
    } catch (err) {
      console.error('[compartidos] no se pudo abrir', err);
      setAvisoSesion('No se pudo abrir el estudio compartido: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  };

  /* Campos con los que nace un estudio. Se extrajo a función porque ahora hay dos
     puntos de creación: en blanco y a partir de un cliente del catálogo. */
  const estudioEnBlanco = () => ({
    ent: 'Nueva Empresa S.A.S', nit: '', anio: new Date().getFullYear(),
    ciiu: '', objeto: '', representante: '', vinc: '', pais_vinc: '', vinc_id: '',
    vinc_tipo: '', t_s: '', t_c: '', t_op: '', t_ar: '', t_inv: '', t_ap: '',
    pli: 'MO', useadj: false, prime: '', comparables: [], cmode: 'all',
  });

  const crearEstudio = async (datos) => {
    const newId = 'study_' + Date.now();
    try {
      await guardarEstudio(newId, datos, usuario);
      cargando.current = true;
      setEstudioAjeno(null);
      setActiveStudyId(newId);
      setStudy(datos);
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

        {activeStudyId && estudioAjeno ? (
          <span className="text-amber-600 dark:text-amber-400 font-semibold">
            solo lectura · compartido por {estudioAjeno.duenoNombre}
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

      {activeTab === 'dashboard' && (
        <Dashboard
          indice={indice}
          compartidos={compartidos}
          abrirCompartido={abrirCompartido}
          selectStudy={selectStudy}
          newStudy={newStudy}
          deleteStudy={deleteStudy}
          duplicateStudy={duplicateStudy}
        />
      )}

      {/* Vistas de la base compartida: no dependen de tener un estudio abierto. */}
      {activeTab === 'clientes' && (
        <Clientes usuario={usuario} nuevoEstudioDesdeCliente={nuevoEstudioDesdeCliente} selectStudy={selectStudy} />
      )}

      {activeTab === 'catalogo' && <CatalogoHistorico usuario={usuario} />}

      {activeStudyId ? (
        <>
          {activeTab === 'contribuyente' && (
            <DatosContribuyente study={study} updateStudy={updateStudy} />
          )}

          {(activeTab === 'operaciones' || activeTab === 'Operaciones') && (
            <IngestaOperaciones study={study} updateStudy={updateStudy} />
          )}

          {(activeTab === 'eeff' || activeTab === 'Estados financieros' || activeTab === 'cifras') && (
            <IngestaCifras study={study} updateStudy={updateStudy} />
          )}

          {activeTab === 'comparables' && (
            <MotorComparables study={study} updateStudy={updateStudy} estudioId={activeStudyId} usuario={usuario} />
          )}

          {activeTab === 'auditoria' && (
            <AuditoriaNorma study={study} />
          )}

          {activeTab === 'informe' && (
            <ReporteGenerador study={study} estudioId={activeStudyId} />
          )}
        </>
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
