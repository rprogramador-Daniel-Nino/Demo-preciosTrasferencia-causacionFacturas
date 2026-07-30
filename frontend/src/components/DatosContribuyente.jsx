import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import axios from 'axios';

export default function DatosContribuyente({ study, updateStudy }) {
  const [loadingRut, setLoadingRut] = useState(false);
  const [loadingCamara, setLoadingCamara] = useState(false);
  const [extractionMsg, setExtractionMsg] = useState('');

  const handleFieldChange = (key, value) => {
    updateStudy({ [key]: value });
  };

  const processFile = (file, apiEndpoint, loadingSetter) => {
    loadingSetter(true);
    setExtractionMsg('Analizando documento con Inteligencia Artificial...');
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        const response = await axios.post(apiEndpoint, {
          archivo_base64: base64Data,
          tipo: file.type
        });

        const data = response.data;
        if (data) {
          const updates = {};
          if (apiEndpoint.includes('rut')) {
            if (data.razon_social) updates.ent = data.razon_social;
            if (data.nit) updates.nit = data.nit;
            if (data.ciiu) updates.ciiu = data.ciiu;
            if (data.direccion) updates.direccion = data.direccion;
            if (data.representante_legal) updates.representante = data.representante_legal;
            setExtractionMsg('✅ RUT extraído con éxito.');
          } else {
            if (data.razon_social) updates.ent = data.razon_social;
            if (data.nit) updates.nit = data.nit;
            if (data.objeto_social) updates.objeto = data.objeto_social;
            if (data.representante_legal) updates.representante = data.representante_legal;
            setExtractionMsg('✅ Cámara de Comercio extraída con éxito.');
          }
          updateStudy(updates);
        }
      } catch (err) {
        console.error("Error extracting document:", err);
        setExtractionMsg('⚠ Error al procesar el archivo. Por favor ingrese los datos manualmente.');
      } finally {
        loadingSetter(false);
      }
    };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Columna Izquierda: Formulario Contribuyente */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Datos del Contribuyente Principal
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Razón Social</label>
              <input
                type="text"
                value={study.ent || ''}
                onChange={(e) => handleFieldChange('ent', e.target.value)}
                placeholder="Razón Social Completa"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">NIT (con dígito de verificación)</label>
              <input
                type="text"
                value={study.nit || ''}
                onChange={(e) => handleFieldChange('nit', e.target.value)}
                placeholder="Ej: 900.123.456-7"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Año Gravable</label>
              <input
                type="number"
                value={study.anio || ''}
                onChange={(e) => handleFieldChange('anio', e.target.value)}
                placeholder="Ej: 2024"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Actividad Económica (CIIU)</label>
              <input
                type="text"
                value={study.ciiu || ''}
                onChange={(e) => handleFieldChange('ciiu', e.target.value)}
                placeholder="Código CIIU"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-zinc-500 mb-1.5">Representante Legal</label>
            <input
              type="text"
              value={study.representante || ''}
              onChange={(e) => handleFieldChange('representante', e.target.value)}
              placeholder="Nombre del Representante Legal"
              className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-zinc-500 mb-1.5">Objeto Social / Actividad de la Compañía</label>
            <textarea
              rows={3}
              value={study.objeto || ''}
              onChange={(e) => handleFieldChange('objeto', e.target.value)}
              placeholder="Describa el objeto social principal de la empresa..."
              className="w-full bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Datos Vinculado */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Datos de la Parte Vinculada (Sujeta a Estudio)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Nombre del Vinculado</label>
              <input
                type="text"
                value={study.vinc || ''}
                onChange={(e) => handleFieldChange('vinc', e.target.value)}
                placeholder="Razón Social Vinculado"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">País del Vinculado</label>
              <input
                type="text"
                value={study.pais_vinc || ''}
                onChange={(e) => handleFieldChange('pais_vinc', e.target.value)}
                placeholder="Ej: ESTADOS UNIDOS"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Identificación Fiscal Vinculada</label>
              <input
                type="text"
                value={study.vinc_id || ''}
                onChange={(e) => handleFieldChange('vinc_id', e.target.value)}
                placeholder="Ej: Tax ID / RIF"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Criterio de Vinculación</label>
              <select
                value={study.vinc_tipo || ''}
                onChange={(e) => handleFieldChange('vinc_tipo', e.target.value)}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              >
                <option value="">Seleccione un tipo</option>
                <option value="Art 260-1 E-T Inciso 1">Subordinación (Filial/Subsidiaria)</option>
                <option value="Art 260-1 E-T Inciso 2">Control Común (Matrices/Consorcios)</option>
                <option value="Jurisdicciones no cooperantes">Jurisdicción No Cooperante / Paraíso Fiscal</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Columna Derecha: Carga de Archivos e IA */}
      <div className="space-y-6">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Ingesta Inteligente de Documentos (OCR)
          </h3>
          <p className="text-xs text-zinc-500">Suba el RUT o Cámara de Comercio para extraer la información automáticamente con Gemini Vision.</p>

          {/* Carga de RUT */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Cargar RUT (PDF/Imagen)</span>
            <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer">
              <input
                type="file"
                accept="application/pdf,image/*"
                disabled={loadingRut}
                onChange={(e) => {
                  if (e.target.files[0]) {
                    processFile(e.target.files[0], '/api/extraer-rut', setLoadingRut);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {loadingRut ? (
                <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin" />
              ) : (
                <Upload className="w-8 h-8 text-zinc-400 mb-2" />
              )}
              <span className="text-xs text-zinc-500 font-medium">Arrastre o seleccione un archivo</span>
            </div>
          </div>

          {/* Carga de Cámara de Comercio */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Cargar Cámara de Comercio (PDF/Imagen)</span>
            <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer">
              <input
                type="file"
                accept="application/pdf,image/*"
                disabled={loadingCamara}
                onChange={(e) => {
                  if (e.target.files[0]) {
                    processFile(e.target.files[0], '/api/extraer-camara', setLoadingCamara);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {loadingCamara ? (
                <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin" />
              ) : (
                <Upload className="w-8 h-8 text-zinc-400 mb-2" />
              )}
              <span className="text-xs text-zinc-500 font-medium">Arrastre o seleccione un archivo</span>
            </div>
          </div>

          {/* Mensajes de Estado del Procesamiento */}
          {extractionMsg && (
            <div className={`p-3 rounded-lg text-xs flex gap-2 items-center ${
              extractionMsg.includes('✅') 
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-emerald-800 dark:text-emerald-300'
                : extractionMsg.includes('⚠')
                  ? 'bg-rose-50 dark:bg-rose-950/20 border border-rose-200 text-rose-800 dark:text-rose-300'
                  : 'bg-blue-50 dark:bg-blue-950/20 border border-blue-200 text-blue-800 dark:text-blue-300'
            }`}>
              {extractionMsg.includes('✅') ? (
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              ) : extractionMsg.includes('⚠') ? (
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              ) : (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              )}
              <span>{extractionMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
