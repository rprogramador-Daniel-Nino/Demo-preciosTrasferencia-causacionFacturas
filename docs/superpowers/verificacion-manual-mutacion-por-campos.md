# Verificación manual — mutación por campos con nombre

Lo que las pruebas automáticas no cubren y hay que comprobar en el navegador
(`npm start` y `http://localhost:3000/gestor-reportes/`).

El plan y el diseño de este trabajo están en `plans/2026-08-01-mutacion-por-campos-con-nombre.md`
y `specs/2026-07-31-plantilla-marcada-e-imagenes-design.md`.


En este orden, con `npm start` levantado y `http://localhost:3000/gestor-reportes/` abierto:

1. Crear/abrir un estudio cuyo NIT **no** sea `901.337.576-6` (el NIT del PDF
   de referencia `Cpanel/public_html/demo-precios-transferencia/Archivos
   Prueba/estudio pasado.pdf`).
2. Subir ese PDF como plantilla desde "Subir Otra Plantilla Word". Confirmar
   que aparece el panel `RevisorDeMarcas` con marcas propuestas (puede tardar:
   son varias llamadas a `/api/gemini`, una por trozo de ~12000 caracteres).
3. En el revisor: cambiar el campo asignado a alguna marca (verificar que el
   `<select>` no pierde el foco al elegir) y eliminar otra con el ícono de
   basura.
4. Pulsar "Confirmar y guardar plantilla". Verificar:
   - Si alguna marca se descartó por solape (normal: el modelo propuso una
     marca sobre texto que otra marca ya cubría), el `alert` debe decir
     "...se descartaron por solaparse con una marca ya aplicada, lo cual es
     normal y no es señal de un problema" — en línea aparte, sin alarmar.
   - Si alguna marca se descartó porque su fragmento no aparece literalmente
     (señal de que el modelo reescribió el texto), el `alert` debe decir
     "...revisa si el modelo reescribió ese fragmento" — en su propia línea,
     con su propia cuenta.
   - Si hay descartes de ambos motivos a la vez, deben verse como dos líneas
     separadas, cada una con su cuenta, no mezcladas en un solo mensaje.
   - La vista previa se actualiza con los datos del estudio activo (razón
     social, NIT, año, cifras EEFF si el estudio las tiene cargadas).
5. **Buscar `901.337.576` en el documento generado (Ctrl+F en el navegador
   sobre el HTML renderizado): no debe aparecer en ningún lado.** Es el
   criterio central del spec.
6. Si el estudio activo no tiene NIT o difiere del NIT `901337576-6` del PDF
   de referencia, debe aparecer el banner ámbar con el aviso "El informe de
   referencia es del NIT... y el estudio activo es del NIT...". Confirmar que
   el texto compara correctamente (base + dígito de verificación, tolerando
   puntos/guión).
7. Si el estudio no trae dato para algún campo marcado (p. ej. `ciiu` u
   `objeto` vacíos), debe verse el hueco "—" en el documento y el banner debe
   listar esos campos en "Hay N campo(s) marcados sin dato...".
8. Recargar la página completa (F5) con el mismo estudio abierto. Verificar:
   - La plantilla marcada se recupera de IndexedDB sin volver a llamar a la
     IA (no debería haber tráfico nuevo a `/api/gemini` en las devtools).
   - El documento sigue mostrando los datos del estudio activo, no un
     flash con los datos del PDF de referencia.
   - Las imágenes (logo, gráficos incrustados) siguen apareciendo.
9. Cambiar a otro estudio sin plantilla vinculada y verificar que el banner de
   avisos desaparece (no debe arrastrar avisos del estudio anterior) y que la
   plantilla maestra (End Game 2024) se carga normalmente.
10. Descargar el Word (.doc) desde el estudio con plantilla marcada y abrir el
    archivo: confirmar que no queda ningún resaltado verde/turquesa visible
    (el fondo `#F0FDF4`, el subrayado punteado `#0FA3A1` y el color de texto
    `#0B7C7A` deben haber desaparecido; solo puede quedar el texto en
    negrita).
11. Subir el **mismo PDF** de nuevo (mismo hash) en otro estudio distinto:
    confirmar que esta vez **no** aparece el revisor —el marcado se reutiliza
    directamente— y el documento se renderiza de una vez con los datos del
    nuevo estudio.
12. Con un estudio que ya muestre el banner ámbar de avisos (p. ej. porque su
    plantilla marcada tiene campos vacíos o el NIT no coincide), subir un
    `.docx` desde "Subir Otra Plantilla Word": el banner de avisos debe
    desaparecer de inmediato, no seguir mostrando los avisos de la plantilla
    marcada anterior.
13. Con ese mismo estudio (banner ámbar visible), subir un PDF **nuevo**
    (que no se haya marcado antes): en cuanto aparece el panel
    `RevisorDeMarcas`, el banner ámbar debe haber desaparecido — no debe
    quedar visible mientras se revisan las marcas nuevas, que todavía no
    tienen render del que calcular avisos propios.

## Pendiente de cierre (fuera del alcance de esta tarea, ya señalado en el brief)

- Correr `/revisar-ramas-equipo` antes del merge (toca `ReporteGenerador.jsx`,
  que Daniel y Pablo también tocan).
- Avisar al equipo de que `exactTemplateMapper.js` deja de ser la ruta
  principal para PDFs (sigue siendo la ruta de respaldo para `.docx` y para
  PDFs sin marcar). Daniel extendió ese archivo el 2026-07-30 con el bloque de
  composición accionaria; esa lógica queda absorbida por los campos
  `accionista.*` del vocabulario cuando la plantilla está marcada.
- El calco en `.docx` (plan siguiente derivado de
  `docs/superpowers/specs/2026-08-01-calco-docx-desde-pdf-design.md`) no se
  tocó aquí.

---

## Arreglo — Feedback de revisión

La revisión aprobó la integración (una sola llamada a la IA por plantilla,
ninguna de las cuatro rutas deja al usuario mirando el informe del cliente
anterior, nada se guarda en IndexedDB si el usuario cancela, y los tres
estilos de resaltado coinciden carácter a carácter con `handleDownload`) y
confirmó como correctas las dos desviaciones señaladas en el informe original
(mover `hydrateExactWordTemplate` fuera del flujo compartido, y centralizar
`renderizar`/`revisarAntesDeGenerar` en `renderizarYAvisar`). Quedaron dos
hallazgos **Important** y una nota.

### Important 1: El aviso de marcas descartadas siempre decía lo mismo, y a veces mentía

**Problema:** `aplicarMarcas` distingue dos motivos —`'el fragmento no
aparece en el documento'` y `'se solapa con una marca ya aplicada'`— pero
`confirmarMarcas` los ignoraba y siempre alertaba con el texto genérico de
"no aparece literalmente en el documento". Un solape es benigno (el modelo
marcó de más sobre texto que una marca anterior ya cubría); que el fragmento
no aparezca sí es señal de que el modelo reescribió el texto al proponerlo.
Tratar ambos igual alarma de más en el primer caso y esconde la señal real en
el segundo.

**Solución:** se agregó `resumirDescartes(descartadas)` en
`ReporteGenerador.jsx`, que agrupa las descartadas por `motivo` en un `Map`,
cuenta cada grupo y genera una línea de texto distinta para cada uno de los
dos motivos conocidos (con las cuentas respectivas), más una línea genérica
de respaldo para cualquier motivo que `aplicarMarcas` pudiera agregar en el
futuro. `confirmarMarcas` ahora llama a `alert('Se aplicaron ' + aplicadas +
' marcas.\n' + resumirDescartes(descartadas))`.

### Important 2: El banner de avisos quedaba obsoleto en dos rutas

**Problema:** al subir un `.docx` (rama sin marcado de `handleTemplateUpload`)
los avisos no se limpiaban: si el estudio traía una plantilla marcada con
avisos visibles, el banner ámbar seguía mostrando avisos que ya no
correspondían a nada tras la subida. Y en la rama de un PDF sin marcado
previo, mientras se muestra `RevisorDeMarcas`, los avisos de la plantilla
anterior seguían visibles sin corresponder al documento en revisión.

**Solución:** se agregó `setAvisos([])` en ambos puntos:
- Justo antes de mostrar el revisor (`if (!marcadoPrevio) { setAvisos([]); ... }`),
  porque mientras se revisan las marcas nuevas no hay todavía un render del
  que calcularlos.
- Al inicio de la rama `.docx`, porque esa ruta no usa marcado y por tanto no
  hay de dónde recalcular avisos —los que hubiera de antes ya no aplican.

### Nota: `marcasPropuestas` / `plantillaPendiente` no se reseteaban al cambiar `estudioId`

No se puede provocar hoy porque `App.jsx` desmonta `ReporteGenerador` al
cambiar de estudio (cambia de pestaña), pero el invariante vivía fuera del
componente. Se agregó un reset defensivo al principio del efecto de
rehidratación (`if (vivo) { setMarcasPropuestas(null); setPlantillaPendiente(null); }`,
antes del `if (!estudioId) return;`), con un comentario que explica por qué
es defensivo y no una corrección de un bug observado.

### Comandos y salida real del arreglo

```
npm test
```
```
ℹ tests 187
ℹ pass 187
ℹ fail 0
```

```
npm run lint --prefix frontend
```
45 warnings en total — mismo conteo que antes del arreglo. Ninguno nuevo en
`ReporteGenerador.jsx` (mismas líneas preexistentes que ya se documentaron
arriba).

```
npm run build --prefix frontend
```
```
✓ 2147 modules transformed.
../public/gestor-reportes/index.html                          0.51 kB
../public/gestor-reportes/assets/pdf.worker-ByF8NTMy.mjs  2,346.45 kB
../public/gestor-reportes/assets/index-B_aYekuF.css          36.87 kB │ gzip:   7.45 kB
../public/gestor-reportes/assets/index-WCviUEzq.js        1,867.72 kB │ gzip: 530.92 kB
✓ built in 4.75s
```

### SHA del commit del arreglo
`ece5f98` — fix: distinguir motivos de descarte de marcas y limpiar avisos obsoletos
