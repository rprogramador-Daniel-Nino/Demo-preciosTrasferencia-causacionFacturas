import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import DatosContribuyente from './components/DatosContribuyente';
import IngestaOperaciones from './components/IngestaOperaciones';
import IngestaCifras from './components/IngestaCifras';
import MotorComparables from './components/MotorComparables';
import AuditoriaNorma from './components/AuditoriaNorma';
import ReporteGenerador from './components/ReporteGenerador';
import { guardarJSON } from './services/persistenciaLocal';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeStudyId, setActiveStudyId] = useState(null);
  const [study, setStudy] = useState({});

  // Auto-save study detail when it changes
  useEffect(() => {
    if (activeStudyId && study && Object.keys(study).length > 0) {
      guardarJSON(`pt:study:${activeStudyId}`, study);

      // Update study index details
      const idxKey = 'pt:study:index';
      const raw = localStorage.getItem(idxKey);
      const ix = raw ? JSON.parse(raw) : {};

      ix[activeStudyId] = {
        ent: study.ent || 'Sin Razón Social',
        nit: study.nit || '—',
        anio: study.anio || '—',
        updated: Date.now()
      };
      guardarJSON(idxKey, ix);
    }
  }, [study, activeStudyId]);

  // Load a study from localStorage
  const selectStudy = (id) => {
    setActiveStudyId(id);
    const detailRaw = localStorage.getItem(`pt:study:${id}`);
    if (detailRaw) {
      setStudy(JSON.parse(detailRaw));
    } else {
      setStudy({});
    }
    setActiveTab('contribuyente'); // Go to first step
  };

  // Create a blank new study
  const newStudy = () => {
    const newId = 'study_' + Date.now();
    const blank = {
      ent: 'Nueva Empresa S.A.S',
      nit: '',
      anio: new Date().getFullYear(),
      ciiu: '',
      objeto: '',
      representante: '',
      vinc: '',
      pais_vinc: '',
      vinc_id: '',
      vinc_tipo: '',
      t_s: '',
      t_c: '',
      t_op: '',
      t_ar: '',
      t_inv: '',
      t_ap: '',
      pli: 'MO',
      useadj: false,
      prime: '',
      comparables: [],
      cmode: 'all'
    };

    guardarJSON(`pt:study:${newId}`, blank);

    const idxKey = 'pt:study:index';
    const raw = localStorage.getItem(idxKey);
    const ix = raw ? JSON.parse(raw) : {};
    ix[newId] = {
      ent: blank.ent,
      nit: blank.nit,
      anio: blank.anio,
      updated: Date.now()
    };
    guardarJSON(idxKey, ix);

    selectStudy(newId);
  };

  // Delete a study
  const deleteStudy = (id) => {
    localStorage.removeItem(`pt:study:${id}`);

    const idxKey = 'pt:study:index';
    const raw = localStorage.getItem(idxKey);
    if (raw) {
      const ix = JSON.parse(raw);
      delete ix[id];
      guardarJSON(idxKey, ix);
    }

    if (activeStudyId === id) {
      setActiveStudyId(null);
      setStudy({});
      setActiveTab('dashboard');
    }
  };

  // Duplicate an existing study
  const duplicateStudy = (id) => {
    const detailRaw = localStorage.getItem(`pt:study:${id}`);
    if (detailRaw) {
      const original = JSON.parse(detailRaw);
      const newId = 'study_' + Date.now();
      const duplicate = {
        ...original,
        ent: original.ent + ' (Copia)',
        updated: Date.now()
      };
      
      guardarJSON(`pt:study:${newId}`, duplicate);

      const idxKey = 'pt:study:index';
      const raw = localStorage.getItem(idxKey);
      const ix = raw ? JSON.parse(raw) : {};
      ix[newId] = {
        ent: duplicate.ent,
        nit: duplicate.nit,
        anio: duplicate.anio,
        updated: Date.now()
      };
      guardarJSON(idxKey, ix);
    }
  };

  const updateStudy = (fields) => {
    setStudy(prev => ({ ...prev, ...fields }));
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === 'dashboard' && (
        <Dashboard 
          selectStudy={selectStudy} 
          newStudy={newStudy} 
          deleteStudy={deleteStudy}
          duplicateStudy={duplicateStudy}
        />
      )}

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
            <MotorComparables study={study} updateStudy={updateStudy} />
          )}

          {activeTab === 'auditoria' && (
            <AuditoriaNorma study={study} />
          )}

          {activeTab === 'informe' && (
            <ReporteGenerador study={study} estudioId={activeStudyId} />
          )}
        </>
      ) : (
        activeTab !== 'dashboard' && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-amber-800 dark:text-amber-300 p-4 rounded-lg text-sm text-center">
            Por favor, seleccione o cree un estudio en la pestaña de <strong>Inicio</strong> antes de continuar.
          </div>
        )
      )}
    </Layout>
  );
}
