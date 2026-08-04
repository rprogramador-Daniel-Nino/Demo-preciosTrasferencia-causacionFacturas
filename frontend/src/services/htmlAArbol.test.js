import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlAArbol, textoDe } from './htmlAArbol.js';

test('lee elementos, atributos y texto', () => {
  const r = htmlAArbol('<p class="x">hola <strong>mundo</strong></p>');
  assert.equal(r.hijos.length, 1);
  const p = r.hijos[0];
  assert.equal(p.etiqueta, 'p');
  assert.equal(p.atributos.class, 'x');
  assert.equal(p.hijos[0].texto, 'hola ');
  assert.equal(p.hijos[1].etiqueta, 'strong');
  assert.equal(textoDe(p), 'hola mundo');
});

test('las etiquetas vacías no se tragan lo que viene detrás', () => {
  /* `<img>` y `<br>` no cierran. Tratarlas como abiertas dejaba todo el resto del documento
     colgando dentro de la imagen. */
  const r = htmlAArbol('<p><img data-recurso="a" style="width:1cm;height:2cm" />después</p>');
  const p = r.hijos[0];
  assert.equal(p.hijos[0].etiqueta, 'img');
  assert.equal(p.hijos[0].atributos['data-recurso'], 'a');
  assert.equal(p.hijos[0].atributos.style, 'width:1cm;height:2cm');
  assert.equal(p.hijos[0].hijos.length, 0);
  assert.equal(p.hijos[1].texto, 'después');
});

test('desanida bien varios niveles', () => {
  const r = htmlAArbol('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
  const tabla = r.hijos[0];
  assert.equal(tabla.etiqueta, 'table');
  assert.equal(tabla.hijos[0].etiqueta, 'tr');
  assert.equal(tabla.hijos[0].hijos.length, 2);
  assert.equal(textoDe(tabla), 'ab');
});

test('una etiqueta desconocida se vuelve transparente y no pierde su contenido', () => {
  /* El previo es contentEditable: el navegador mete `<font>`, `<b>`, `<div>` al editar. Que
     una etiqueta que no conocemos borre el texto que lleva dentro sería perder contenido de un
     documento que se radica. */
  const r = htmlAArbol('<p>a<font color="red">b</font>c</p>');
  assert.equal(textoDe(r), 'abc');
});

test('una etiqueta sin cerrar no rompe el árbol', () => {
  /* Cierra sola al terminar el HTML en vez de lanzar. Un HTML editado a mano puede llegar
     mal formado, y un throw aquí dejaría al usuario sin documento y sin explicación. */
  const r = htmlAArbol('<p>a<strong>b');
  assert.equal(textoDe(r), 'ab');
});

test('los comentarios y las entidades no se cuelan como texto', () => {
  const r = htmlAArbol('<p><!--FIG:1:0-->a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>');
  assert.equal(textoDe(r), 'a & b <c> "d" \'e\'');
});

test('cierra las etiquetas mal anidadas sin perder texto', () => {
  const r = htmlAArbol('<p><strong>a</p><p>b</p>');
  assert.equal(textoDe(r), 'ab');
  assert.equal(r.hijos.length, 2);
});
