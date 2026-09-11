#!/usr/bin/env python3
"""
scripts/migrate_to_shared.py
-----------------------------
Migra los ZIPs existentes en alaska_descargas/auto_pipeline/ al nuevo
directorio compartido alaska_descargas/shared/track{track}_frame{frame}/{year}/.

Los ZIPs de distintos volcanes con el mismo par de fechas son IDÉNTICOS en
contenido (mismos granules → mismo interferograma HyP3). Este script conserva
solo UNA copia por par y elimina las duplicadas, ahorrando ~80% del espacio.

Uso:
    # Ver qué haría sin ejecutar nada
    python scripts/migrate_to_shared.py --dry-run

    # Ejecutar la migración
    python scripts/migrate_to_shared.py

    # Usar rutas personalizadas (útil para pruebas)
    python scripts/migrate_to_shared.py \
        --source /app/alaska_descargas/auto_pipeline \
        --dest   /app/alaska_descargas/shared

IMPORTANTE: Detener el worker de Celery antes de ejecutar este script.
    docker compose stop celery-worker
    python scripts/migrate_to_shared.py
    docker compose start celery-worker
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

# Regex para extraer pair_key y year del nombre de archivo HyP3
# Ejemplo: S1AA_20240903T114646_20240915T114646_VVP012_INT80_G_ueF_4836.zip
_PAIR_KEY_RE = re.compile(r"S1[AB]+_(\d{8}T\d{6})_(\d{8}T\d{6})_")
_YEAR_RE = re.compile(r"(\d{4})\d{4}T")

# Track y frame predeterminados para El Salvador (todos los volcanes actuales)
DEFAULT_TRACK = 128
DEFAULT_FRAME = 547


def extract_pair_key(filename: str):
    m = _PAIR_KEY_RE.search(filename)
    if not m:
        return None
    return f"{m.group(1)}_{m.group(2)}"


def extract_year_from_pair_key(pair_key: str) -> int:
    """Extrae el año de la primera fecha en la pair_key."""
    m = _YEAR_RE.match(pair_key)
    if m:
        return int(m.group(1))
    return 0


def collect_zips(source_base: Path) -> dict:
    """Escanea source_base/ y agrupa todos los ZIPs por pair_key.

    Retorna:
        {pair_key: [Path, Path, ...]}   (lista de todas las copias encontradas)
    """
    groups = defaultdict(list)
    unrecognized = []

    for zip_path in sorted(source_base.rglob("*.zip")):
        key = extract_pair_key(zip_path.name)
        if key:
            groups[key].append(zip_path)
        else:
            unrecognized.append(zip_path)

    return dict(groups), unrecognized


def migrate(
    source_base: Path,
    dest_base: Path,
    track: int,
    frame: int,
    dry_run: bool,
) -> None:
    print(f"\n{'[DRY-RUN] ' if dry_run else ''}Migración iniciada")
    print(f"  Origen : {source_base}")
    print(f"  Destino: {dest_base}/track{track}_frame{frame}/{{year}}/")
    print()

    if not source_base.exists():
        print(f"ERROR: El directorio origen no existe: {source_base}")
        sys.exit(1)

    groups, unrecognized = collect_zips(source_base)

    total_zips     = sum(len(v) for v in groups.values())
    unique_pairs   = len(groups)
    total_size_mb  = sum(p.stat().st_size for paths in groups.values() for p in paths) / 1024**2
    kept_size_mb   = sum(paths[0].stat().st_size for paths in groups.values()) / 1024**2
    savings_mb     = total_size_mb - kept_size_mb

    print(f"ZIPs encontrados     : {total_zips}")
    print(f"Pares únicos         : {unique_pairs}")
    print(f"Tamaño total         : {total_size_mb:,.0f} MB ({total_size_mb/1024:.1f} GB)")
    print(f"Tamaño tras migración: {kept_size_mb:,.0f} MB ({kept_size_mb/1024:.1f} GB)")
    print(f"Ahorro estimado      : {savings_mb:,.0f} MB ({savings_mb/1024:.1f} GB)")
    if unrecognized:
        print(f"ZIPs no reconocidos  : {len(unrecognized)} (se ignorarán)")
    print()

    moved    = 0
    deleted  = 0
    skipped  = 0
    errors   = 0

    for pair_key, zip_paths in sorted(groups.items()):
        year = extract_year_from_pair_key(pair_key)
        if not year:
            print(f"  WARN: No se pudo extraer año de pair_key={pair_key}. Omitiendo.")
            continue

        dest_dir = dest_base / f"track{track}_frame{frame}" / str(year)
        # El nombre de destino usa el primer archivo encontrado (cualquiera vale,
        # el contenido es idéntico entre volcanes)
        keeper = zip_paths[0]
        dest_path = dest_dir / keeper.name

        # --- MOVER el keeper al destino ---
        if dest_path.exists():
            print(f"  SKIP (ya existe): {dest_path.name}")
            skipped += 1
            # Borrar las copias duplicadas de origen si el destino ya existe
            for dup in zip_paths:
                if not dry_run:
                    dup.unlink(missing_ok=True)
                deleted += 1
        else:
            print(f"  MOVE → {dest_dir.name}/{dest_path.name}")
            if not dry_run:
                dest_dir.mkdir(parents=True, exist_ok=True)
                keeper.rename(dest_path)
            moved += 1

            # --- BORRAR las copias duplicadas de los demás volcanes ---
            for dup in zip_paths[1:]:
                size_mb = dup.stat().st_size / 1024**2
                print(f"       DEL  {dup.parent.name}/{dup.name} ({size_mb:.0f} MB)")
                if not dry_run:
                    dup.unlink(missing_ok=True)
                deleted += 1

    print()
    print("=" * 50)
    print(f"{'[DRY-RUN] ' if dry_run else ''}Resumen:")
    print(f"  Movidos al shared/     : {moved}")
    print(f"  Duplicados eliminados  : {deleted}")
    print(f"  Ya existían en destino : {skipped}")
    print(f"  Errores                : {errors}")
    print(f"  Ahorro real            : ~{savings_mb:,.0f} MB (~{savings_mb/1024:.1f} GB)")
    if dry_run:
        print()
        print("  (Ningún archivo fue modificado — ejecuta sin --dry-run para aplicar)")
    print()

    # Verificar que los directorios de volcanes quedaron vacíos
    if not dry_run:
        for volcano_dir in source_base.iterdir():
            if not volcano_dir.is_dir():
                continue
            remaining = list(volcano_dir.rglob("*.zip"))
            if remaining:
                print(f"  WARN: {volcano_dir.name} aún tiene {len(remaining)} ZIPs.")
            else:
                print(f"  OK  : {volcano_dir.name} vacío.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Migra ZIPs de auto_pipeline/ al nuevo shared/ y elimina duplicados."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("/app/alaska_descargas/auto_pipeline"),
        help="Directorio origen con los volcán_año/ actuales.",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path("/app/alaska_descargas/shared"),
        help="Directorio destino del shared/.",
    )
    parser.add_argument(
        "--track", type=int, default=DEFAULT_TRACK,
        help=f"Relative orbit track (default: {DEFAULT_TRACK})",
    )
    parser.add_argument(
        "--frame", type=int, default=DEFAULT_FRAME,
        help=f"Frame number (default: {DEFAULT_FRAME})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Muestra qué haría sin mover ni borrar nada.",
    )
    args = parser.parse_args()

    migrate(
        source_base=args.source,
        dest_base=args.dest,
        track=args.track,
        frame=args.frame,
        dry_run=args.dry_run,
    )
