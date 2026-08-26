import React, { useRef } from 'react';

/* Reduce cualquier entrada (tecleada o pegada) a "dígitos + signo menos opcional al inicio",
   con la misma regla de paréntesis/signo que usa `num()` en utils/calculations.js —
   "(21.850.187.494)" es negativo igual que "-21.850.187.494". Es solo para que la máscara
   reaccione bien al pegar texto copiado de un estado financiero; `num()` sigue siendo el
   parser real en el momento del cálculo. No soporta decimales: las cifras de EEFF en este
   dominio son pesos enteros (`fmt()` ya hace Math.round). */
function soloDigitosConSigno(texto) {
  let s = String(texto ?? '');
  let negativo = false;

  const enParentesis = /^\s*\((.*)\)\s*$/.exec(s);
  if (enParentesis) { negativo = true; s = enParentesis[1]; }
  if (/^\s*-/.test(s)) negativo = true;

  const digitos = s.replace(/[^\d]/g, '');
  if (!digitos) return negativo ? '-' : '';
  return (negativo ? '-' : '') + digitos;
}

function formatear(raw) {
  if (!raw || raw === '-') return raw || '';
  const negativo = raw.startsWith('-');
  const digitos = negativo ? raw.slice(1) : raw;
  const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negativo ? '-' : '') + conPuntos;
}

function contarDigitos(texto, hastaIndice) {
  let n = 0;
  for (let i = 0; i < hastaIndice && i < texto.length; i++) {
    if (/\d/.test(texto[i])) n++;
  }
  return n;
}

function indicePorDigitos(texto, cantidadDigitos) {
  if (cantidadDigitos <= 0) return texto.startsWith('-') ? 1 : 0;
  let n = 0;
  for (let i = 0; i < texto.length; i++) {
    if (/\d/.test(texto[i])) {
      n += 1;
      if (n === cantidadDigitos) return i + 1;
    }
  }
  return texto.length;
}

/* Input de cifras en COP con puntos de miles en vivo (estilo es-CO). El valor que entra y el
   que sale por `onChange` es siempre un string plano sin puntuación —p. ej. "-21850187494"—
   para que `handleFieldChange`/`handleRowChange`, `num()`, `egreso()` y
   `utilidadOperacionalDe` sigan funcionando sin cambios. */
export default function CampoMoneda({ value, onChange, placeholder, className, disabled }) {
  const inputRef = useRef(null);

  const rawValue = soloDigitosConSigno(value);
  const displayValue = formatear(rawValue);

  const handleChange = (e) => {
    const input = e.target;
    const cursorAntes = input.selectionStart ?? input.value.length;
    const digitosAntes = contarDigitos(input.value, cursorAntes);

    const nuevoRaw = soloDigitosConSigno(input.value);
    const nuevoDisplay = formatear(nuevoRaw);

    onChange(nuevoRaw);

    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const nuevaPos = indicePorDigitos(nuevoDisplay, digitosAntes);
      inputRef.current.setSelectionRange(nuevaPos, nuevaPos);
    });
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  );
}
