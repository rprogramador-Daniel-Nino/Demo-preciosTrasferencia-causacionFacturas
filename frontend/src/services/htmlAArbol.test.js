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

test('un < suelto es texto y no se traga lo que viene detrás', () => {
  /* Un informe de precios de transferencia compara cifras con < y > de forma natural.
     Un < que no abre una etiqueta es texto, no una orden de tragar. */
  assert.equal(textoDe(htmlAArbol('<p>2 < 3 y 5 > 4</p>')), '2 < 3 y 5 > 4');
  assert.equal(textoDe(htmlAArbol('<p>margen < 5% y > 2%</p>')), 'margen < 5% y > 2%');
});

test('el contenido de un CDATA es texto y no se pierde', () => {
  /* CDATA es un mecanismo XML para incrustar contenido literal. Su contenido debe
     aparecer como texto, no descartarse. */
  assert.equal(textoDe(htmlAArbol('<p><![CDATA[a < b]]>texto</p>')), 'a < btexto');
});

test('el CSS y el JavaScript se descartan, pero no se llevan lo que sigue', () => {
  /* El contenido de script y style es código, no contenido del informe, y se descarta.
     Pero ese descarte no debe tragarse etiquetas posteriores ni el cierre incorrecto
     debe dejar pendiente la etiqueta en la pila. */
  const r1 = htmlAArbol('<style>.x { color: red; } /* a < b */</style><p>hola</p>');
  assert.equal(textoDe(r1), 'hola');
  assert.equal(r1.hijos.length, 2);
  assert.equal(r1.hijos[0].etiqueta, 'style');
  assert.equal(r1.hijos[1].etiqueta, 'p');

  const r2 = htmlAArbol('<script>if (a < b) { x("<div>"); }</script><p>hola</p>');
  assert.equal(textoDe(r2), 'hola');
  assert.equal(r2.hijos.length, 2);
  assert.equal(r2.hijos[0].etiqueta, 'script');
  assert.equal(r2.hijos[1].etiqueta, 'p');
});

test('una declaración no es contenido', () => {
  /* DOCTYPE, comentarios HTML de declaración, etc. son marcas de control, no contenido. */
  assert.equal(textoDe(htmlAArbol('<!DOCTYPE html><p>a</p>')), 'a');
  const r = htmlAArbol('<!DOCTYPE html><p>a</p>');
  assert.equal(r.hijos.length, 1);
  assert.equal(r.hijos[0].etiqueta, 'p');
});

test('un CDATA sin cerrar no se lleva lo que viene detrás', () => {
  /* Cuando un CDATA no cierra con ]]>, la alternativa falla y el < del siguiente
     elemento no debe ser consumido por otra alternativa: debe aparecer como texto.
     Ante HTML mal formado, basura visible es mejor que pérdida silenciosa. */
  const r = htmlAArbol('<p><![CDATA[a sin cerrar<p>b</p>');
  assert(textoDe(r).includes('a sin cerrar'), 'Debe contener "a sin cerrar"');
  assert(textoDe(r).includes('b'), 'Debe contener "b"');
});

test('una instrucción de proceso sin cerrar no se lleva lo que viene detrás', () => {
  /* Una instrucción PHP o similar sin cierre con ?> no debe tragarse el siguiente
     <. El contenido del HTML va después del <. */
  const r = htmlAArbol('<p><?php echo 1<p>b</p>');
  assert(textoDe(r).includes('1'), 'Debe contener "1"');
  assert(textoDe(r).includes('b'), 'Debe contener "b"');
});

test('un comentario sin cerrar no se lleva el resto del documento', () => {
  /* Un comentario sin cierre con --> no debe comerse el HTML posterior: el < del
     siguiente elemento debe dejar de ser consumido y caer como texto. */
  const r = htmlAArbol('<p>a<!-- sin cerrar<p>b</p>');
  assert(textoDe(r).includes('a'), 'Debe contener "a"');
  assert(textoDe(r).includes('b'), 'Debe contener "b"');
});

test('ninguna alternativa de la expresión regular consume un <', () => {
  /* Este test existe porque el mismo fallo entró dos veces por dos alternativas
     distintas: primero por |<[^>]*>, luego por <![^>]*>. La regla que cierra la
     puerta es: ninguna alternativa puede consumir un <. Un < siempre empieza algo
     nuevo, o es texto. Nunca es relleno. Aquí chequeamos que el texto de contenido
     (no el de atributos) se preserva. */
  const casos = [
    '<p>a<',
    '<p>2 < 3<p>b</p>',
    '<style>.x{',
    '<!DOCTYPE',
    '<p><![CDATA[a sin cerrar<p>b</p>',
    '<p><?php echo 1<p>b</p>',
    '<p>a<!-- sin cerrar<p>b</p>',
  ];

  const contenidoEsperado = ['a', 'b', 'c', '3', '1'];

  for (const entrada of casos) {
    const texto = textoDe(htmlAArbol(entrada));
    for (const car of contenidoEsperado) {
      if (entrada.includes(car)) {
        assert(texto.includes(car),
          `Entrada "${entrada}" debe preservar "${car}", pero el resultado es "${texto}"`);
      }
    }
  }
});

test('una etiqueta de apertura cierra la anterior del mismo tipo', () => {
  /* Esta es la regla de HTML5: <p>a<p>b produce dos p hermanos, no anidados.
     Es lo que hace mammoth y el contentEditable cuando se edita sin cerrar. */
  const r = htmlAArbol('<p>a<p>b');
  assert.equal(r.hijos.length, 2);
  assert.equal(r.hijos[0].etiqueta, 'p');
  assert.equal(r.hijos[1].etiqueta, 'p');
  assert.equal(textoDe(r), 'ab');
});

test('los <li> se cierran implícitamente entre sí', () => {
  const r = htmlAArbol('<ul><li>a<li>b</ul>');
  assert.equal(r.hijos[0].etiqueta, 'ul');
  assert.equal(r.hijos[0].hijos.length, 2);
  assert.equal(r.hijos[0].hijos[0].etiqueta, 'li');
  assert.equal(r.hijos[0].hijos[1].etiqueta, 'li');
  assert.equal(textoDe(r), 'ab');
});

test('los <td> se cierran implícitamente entre sí', () => {
  const r = htmlAArbol('<tr><td>a<td>b</tr>');
  assert.equal(r.hijos[0].etiqueta, 'tr');
  assert.equal(r.hijos[0].hijos.length, 2);
  assert.equal(r.hijos[0].hijos[0].etiqueta, 'td');
  assert.equal(r.hijos[0].hijos[1].etiqueta, 'td');
  assert.equal(textoDe(r), 'ab');
});
