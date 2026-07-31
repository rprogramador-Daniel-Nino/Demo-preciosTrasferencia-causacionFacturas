#!/usr/bin/env node
'use strict';

/* Escaneo determinista de las ramas del equipo: main y las de los compañeros.
   Solo lee: no muta el repo, no escribe en disco. Toda integración la decide y
   ejecuta la skill revisar-ramas-equipo a partir de este JSON.

   main se analiza con el MISMO detalle que una rama de compañero —commits que
   faltan, archivos tocados, solapamiento y bloques de index.html— porque
   quedarse atrás del tronco ensucia la siguiente integración tanto como
   quedarse atrás de un compañero. Antes solo se contaba en `atras_de_main`, que
   decía cuánto faltaba pero no qué. */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  extraerAnclas,
  parsearHunks,
  etiquetasDeHunks,
  interseccion,
  ordenarPorSolapamiento,
  ordenIntegracion,
} = require('./lib/analisis-ramas');

const PRINCIPAL = 'origin/main';

/* Corre git y devuelve stdout. Lanza si git falla. */
function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* Igual, pero devuelve `null` en vez de lanzar. Para consultas que legítimamente
   pueden fallar, como merge-base entre historias no relacionadas. */
function gitOpcional(args) {
  try {
    return git(args);
  } catch (e) {
    return null;
  }
}

const lineas = (salida) =>
  String(salida || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/* Google Drive File Stream recrea desktop.ini dentro de .git/ cada vez que
   sincroniza. Git los lee como refs corruptas y fetch falla. No se puede
   prevenir con .gitignore, así que se detecta para dar un mensaje accionable. */
function desktopIniEnGit(dirGit) {
  const encontrados = [];
  const recorrer = (dir) => {
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entrada of entradas) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (entrada.name.toLowerCase() === 'desktop.ini') encontrados.push(completo);
    }
  };
  recorrer(dirGit);
  return encontrados;
}

function main() {
  let dirGit;
  try {
    dirGit = git(['rev-parse', '--absolute-git-dir']).trim();
  } catch (e) {
    process.stderr.write('No es un repositorio git: ' + e.message + '\n');
    process.exit(1);
  }

  const resultado = {
    rama_actual: null,
    fetch_ok: false,
    error_fetch: null,
    arbol_limpio: true,
    mis_archivos_sin_commitear: [],
    mis_bloques_tocados: [],
    atras_de_main: 0,
    /* main con el mismo detalle que un compañero. atras_de_main se conserva
       porque es el número que el reporte cita, pero el análisis vive aquí. */
    principal: null,
    companeros: [],
    /* main primero, después los compañeros de menor a mayor solapamiento. */
    orden_integracion: [],
  };

  /* rev-parse --abbrev-ref HEAD lanza en un repo sin ningún commit (HEAD no
     resuelve todavía). Se degrada a null y se sigue con "HEAD" como referencia
     de trabajo, igual que cuando hay commits pero HEAD está desprendido. */
  const ramaCruda = gitOpcional(['rev-parse', '--abbrev-ref', 'HEAD']);
  const rama = ramaCruda === null ? 'HEAD' : ramaCruda.trim();
  resultado.rama_actual = rama === 'HEAD' ? null : rama;
  const yo = resultado.rama_actual || 'HEAD';

  /* --- fetch --- */
  try {
    git(['fetch', '--prune']);
    resultado.fetch_ok = true;
  } catch (e) {
    const sucios = desktopIniEnGit(dirGit);
    resultado.error_fetch =
      String(e.stderr || e.message).trim() +
      (sucios.length
        ? '\n\nCausa probable: hay ' +
          sucios.length +
          ' archivo(s) desktop.ini dentro de .git/, creados por Google Drive. ' +
          'Git los lee como refs corruptas. Limpiar con:\n' +
          "  find .git -name desktop.ini -delete"
        : '');
    /* Se sigue con los datos locales que haya: es mejor un reporte parcial y
       marcado que ninguno. La skill decide si continuar. */
  }

  /* --- estado del árbol propio --- */
  /* diff --name-only HEAD también lanza sin ningún commit (HEAD no resuelve);
     se degrada a "sin cambios sobre HEAD" en vez de reventar. */
  const sinCommitear = lineas(gitOpcional(['diff', '--name-only', 'HEAD']) || '');
  const noTrackeados = lineas(git(['ls-files', '--others', '--exclude-standard']));
  resultado.mis_archivos_sin_commitear = [...new Set([...sinCommitear, ...noTrackeados])];
  resultado.arbol_limpio = resultado.mis_archivos_sin_commitear.length === 0;

  /* --- cuánto me falta de main --- */
  const cuenta = gitOpcional(['rev-list', '--count', yo + '..' + PRINCIPAL]);
  resultado.atras_de_main = cuenta === null ? 0 : parseInt(cuenta.trim(), 10) || 0;

  /* --- mis propios cambios: archivos y bloques --- */
  const baseMain = gitOpcional(['merge-base', yo, PRINCIPAL]);
  const misArchivos = new Set(resultado.mis_archivos_sin_commitear);
  if (baseMain) {
    for (const f of lineas(git(['diff', '--name-only', baseMain.trim(), yo]))) {
      misArchivos.add(f);
    }
  }

  /* Las rutas que devuelve git (index.html, etc.) son relativas a la raíz del
     repo, no al cwd desde donde se invoque este script. dirGit es la ruta
     absoluta de .git; la raíz es su padre. Resolver contra ella, no contra
     dirGit, para que corra igual desde cualquier subdirectorio. */
  const raizRepo = path.join(dirGit, '..');
  const rutaIndex = path.join(raizRepo, 'index.html');
  if (misArchivos.has('index.html') && fs.existsSync(rutaIndex)) {
    const anclasMias = extraerAnclas(fs.readFileSync(rutaIndex, 'utf8'));
    const partes = [];
    if (baseMain) {
      partes.push(gitOpcional(['diff', '-U0', baseMain.trim(), yo, '--', 'index.html']) || '');
    }
    partes.push(gitOpcional(['diff', '-U0', 'HEAD', '--', 'index.html']) || '');
    resultado.mis_bloques_tocados = etiquetasDeHunks(
      parsearHunks(partes.join('\n')),
      anclasMias
    );
  }

  /* Analiza una rama remota contra la mía. Se usa igual para main y para las
     ramas de compañeros: el tronco no merece menos detalle que un compañero. */
  function analizarRama(remota) {
    const info = {
      rama: remota,
      ultimo: null,
      commits_que_me_faltan: [],
      archivos_tocados: [],
      solapamiento: [],
      bloques_en_conflicto_potencial: [],
      integrable: false,
      nota: null,
    };

    const base = gitOpcional(['merge-base', yo, remota]);
    if (!base) {
      info.nota = 'Sin ancestro común con ' + yo + '; no se propone integrarla.';
      return info;
    }
    const desde = base.trim();
    /* Hay ancestro común: el merge es planteable. Que además haya algo que traer
       lo dice commits_que_me_faltan, no este campo. */
    info.integrable = true;

    const ultimo = gitOpcional(['log', '-1', '--format=%an%x1f%ad%x1f%s', '--date=short', remota]);
    if (ultimo) {
      const [autor, fecha, asunto] = ultimo.trim().split('\x1f');
      info.ultimo = { autor, fecha, asunto };
    }

    const log =
      gitOpcional([
        'log',
        '--format=%h%x1f%an%x1f%ad%x1f%s',
        '--date=short',
        desde + '..' + remota,
      ]) || '';
    info.commits_que_me_faltan = lineas(log).map((l) => {
      const [sha, autor, fecha, asunto] = l.split('\x1f');
      return { sha, autor, fecha, asunto };
    });

    info.archivos_tocados = lineas(gitOpcional(['diff', '--name-only', desde, remota]) || '');
    info.solapamiento = interseccion(info.archivos_tocados, [...misArchivos]);

    /* Bloques solo si ambos tocamos index.html: si no, no hay nada que cruzar. */
    if (info.solapamiento.includes('index.html')) {
      const contenido = gitOpcional(['show', remota + ':index.html']);
      if (contenido === null) {
        info.nota = 'index.html no existe en ' + remota + '; se omite el mapeo de bloques.';
      } else {
        const suyos = etiquetasDeHunks(
          parsearHunks(gitOpcional(['diff', '-U0', desde, remota, '--', 'index.html']) || ''),
          extraerAnclas(contenido)
        );
        info.bloques_en_conflicto_potencial = interseccion(suyos, resultado.mis_bloques_tocados);
      }
    }

    return info;
  }

  /* --- main, como un objetivo de integración más --- */
  /* Si la rama de trabajo ES main, no se integra sobre sí misma. Se compara por
     el nombre corto y por la referencia completa, porque `yo` puede llegar como
     'main' o como 'HEAD' desprendido. */
  if (PRINCIPAL === 'origin/' + yo || yo === 'main') {
    resultado.principal = {
      rama: PRINCIPAL,
      ultimo: null,
      commits_que_me_faltan: [],
      archivos_tocados: [],
      solapamiento: [],
      bloques_en_conflicto_potencial: [],
      integrable: false,
      nota: 'La rama de trabajo es ' + yo + ': no se integra sobre sí misma.',
    };
  } else {
    resultado.principal = analizarRama(PRINCIPAL);
  }

  /* --- ramas de compañeros --- */
  const remotas = lineas(
    gitOpcional(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) || ''
  )
    /* Exigir el prefijo "origin/" descarta el symref HEAD, que git abrevia a
       "origin" a secas desde la 2.52 y a "origin/HEAD" en versiones anteriores.
       Filtrar por el literal no es portable entre versiones; el prefijo sí.
       main queda fuera de esta lista porque ya se analizó aparte, como tronco. */
    .filter(
      (r) => r.startsWith('origin/') && r !== PRINCIPAL && r !== 'origin/HEAD' && r !== 'origin/' + yo
    );

  for (const remota of remotas) {
    resultado.companeros.push(analizarRama(remota));
  }

  resultado.companeros = ordenarPorSolapamiento(resultado.companeros);

  /* La regla de qué se integra y en qué orden vive en lib/, donde npm test la
     cubre: es una decisión, no un detalle de plomería. */
  resultado.orden_integracion = ordenIntegracion(resultado.principal, resultado.companeros);

  process.stdout.write(JSON.stringify(resultado, null, 2) + '\n');
}

main();
