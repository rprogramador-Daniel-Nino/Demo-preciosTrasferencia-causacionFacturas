"""
Genera un .txt con la ruta y el contenido de cada archivo de este directorio
(frontend/), excluyendo las carpetas indicadas.

Uso:
    python export_code_to_txt.py [ruta_salida.txt]

Si no se indica ruta de salida, se genera "frontend_code_export.txt" en esta
misma carpeta.
"""

import os
import sys

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# Carpetas a excluir, relativas a ROOT_DIR (frontend/).
EXCLUDE_DIRS = {
    os.path.normcase(os.path.join(ROOT_DIR, "Archivos Prueba")),
    os.path.normcase(os.path.join(ROOT_DIR, "dist")),
    os.path.normcase(os.path.join(ROOT_DIR, "node_modules")),
    os.path.normcase(os.path.join(ROOT_DIR, "public")),
    os.path.normcase(os.path.join(ROOT_DIR, "src", "assets")),
}

DEFAULT_OUTPUT = os.path.join(ROOT_DIR, "frontend_code_export.txt")

SEPARATOR = "=" * 100


def es_carpeta_excluida(ruta_carpeta):
    return os.path.normcase(os.path.abspath(ruta_carpeta)) in EXCLUDE_DIRS


def leer_texto(ruta_archivo):
    """Intenta leer el archivo como texto. Devuelve None si parece binario."""
    try:
        with open(ruta_archivo, "rb") as f:
            crudo = f.read()
    except OSError as e:
        return None, f"[No se pudo abrir: {e}]"

    if b"\x00" in crudo:
        return None, "[Archivo binario, omitido]"

    for codificacion in ("utf-8", "latin-1"):
        try:
            return crudo.decode(codificacion), None
        except UnicodeDecodeError:
            continue

    return None, "[No se pudo decodificar, omitido]"


def main():
    ruta_salida = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    ruta_salida_abs = os.path.abspath(ruta_salida)
    script_path = os.path.abspath(__file__)

    archivos_procesados = 0
    archivos_omitidos = 0

    with open(ruta_salida, "w", encoding="utf-8") as salida:
        for carpeta_actual, subcarpetas, archivos in os.walk(ROOT_DIR):
            subcarpetas[:] = [
                d for d in subcarpetas
                if not es_carpeta_excluida(os.path.join(carpeta_actual, d))
            ]

            for nombre_archivo in sorted(archivos):
                ruta_completa = os.path.join(carpeta_actual, nombre_archivo)
                ruta_abs = os.path.abspath(ruta_completa)

                if ruta_abs in (ruta_salida_abs, script_path):
                    continue

                ruta_relativa = os.path.relpath(ruta_completa, ROOT_DIR)
                contenido, motivo_omision = leer_texto(ruta_completa)

                salida.write(f"{SEPARATOR}\n")
                salida.write(f"ARCHIVO: {ruta_relativa}\n")
                salida.write(f"{SEPARATOR}\n")

                if contenido is None:
                    salida.write(f"{motivo_omision}\n\n")
                    archivos_omitidos += 1
                else:
                    salida.write(contenido)
                    if not contenido.endswith("\n"):
                        salida.write("\n")
                    salida.write("\n")
                    archivos_procesados += 1

    print(f"Listo. Salida: {ruta_salida_abs}")
    print(f"Archivos incluidos: {archivos_procesados}")
    print(f"Archivos omitidos (binarios/ilegibles): {archivos_omitidos}")


if __name__ == "__main__":
    main()
