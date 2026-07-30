#!/usr/bin/env node
'use strict';

/* Escaneo determinista de las ramas de los compañeros.
   Solo lee: no muta el repo, no escribe en disco. Toda integración la decide y
   ejecuta la skill revisar-ramas-equipo a partir de este JSON. */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  extraerAnclas,
  parsearHunks,
  etiquetasDeHunks,
  interseccion,
  ordenarPorSolapamiento,
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
    companeros: [],
  };

  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
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
  const sinCommitear = lineas(git(['diff', '--name-only', 'HEAD']));
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

  if (misArchivos.has('index.html') && fs.existsSync('index.html')) {
    const anclasMias = extraerAnclas(fs.readFileSync('index.html', 'utf8'));
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

  /* --- ramas de compañeros --- */
  const remotas = lineas(
    gitOpcional(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) || ''
  )
    /* Exigir el prefijo "origin/" descarta el symref HEAD, que git abrevia a
       "origin" a secas desde la 2.52 y a "origin/HEAD" en versiones anteriores.
       Filtrar por el literal no es portable entre versiones; el prefijo sí. */
    .filter(
      (r) => r.startsWith('origin/') && r !== PRINCIPAL && r !== 'origin/HEAD' && r !== 'origin/' + yo
    );

  for (const remota of remotas) {
    const compa = {
      rama: remota,
      ultimo: null,
      commits_que_me_faltan: [],
      archivos_tocados: [],
      solapamiento: [],
      bloques_en_conflicto_potencial: [],
      nota: null,
    };

    const base = gitOpcional(['merge-base', yo, remota]);
    if (!base) {
      compa.nota = 'Sin ancestro común con ' + yo + '; no se propone integrarla.';
      resultado.companeros.push(compa);
      continue;
    }
    const desde = base.trim();

    const ultimo = gitOpcional(['log', '-1', '--format=%an%x1f%ad%x1f%s', '--date=short', remota]);
    if (ultimo) {
      const [autor, fecha, asunto] = ultimo.trim().split('\x1f');
      compa.ultimo = { autor, fecha, asunto };
    }

    const log = gitOpcional(['log', '--format=%h%x1f%an%x1f%s', desde + '..' + remota]) || '';
    compa.commits_que_me_faltan = lineas(log).map((l) => {
      const [sha, autor, asunto] = l.split('\x1f');
      return { sha, autor, asunto };
    });

    compa.archivos_tocados = lineas(
      gitOpcional(['diff', '--name-only', desde, remota]) || ''
    );
    compa.solapamiento = interseccion(compa.archivos_tocados, [...misArchivos]);

    /* Bloques solo si ambos tocamos index.html: si no, no hay nada que cruzar. */
    if (compa.solapamiento.includes('index.html')) {
      const contenido = gitOpcional(['show', remota + ':index.html']);
      if (contenido === null) {
        compa.nota = 'index.html no existe en ' + remota + '; se omite el mapeo de bloques.';
      } else {
        const suyos = etiquetasDeHunks(
          parsearHunks(gitOpcional(['diff', '-U0', desde, remota, '--', 'index.html']) || ''),
          extraerAnclas(contenido)
        );
        compa.bloques_en_conflicto_potencial = interseccion(suyos, resultado.mis_bloques_tocados);
      }
    }

    resultado.companeros.push(compa);
  }

  resultado.companeros = ordenarPorSolapamiento(resultado.companeros);
  process.stdout.write(JSON.stringify(resultado, null, 2) + '\n');
}

main();
