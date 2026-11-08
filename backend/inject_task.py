#!/usr/bin/env python3
"""
inject_task.py
--------------
Script CLI para inyectar la tarea de procesamiento de un volcán específico
(por ejemplo, San Miguel 2024) directamente en Celery sin detener el software
ni recalcular los demás volcanes.

Uso:
    python inject_task.py --volcano san_miguel --year 2024 [--check-only] [--force]
"""

import argparse
import logging
import os
import sys
from pathlib import Path

# Asegurar que el directorio backend esté en sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("inject_task")

from utils.timeseries_parquet import VOLCANOES, parquet_path
from utils.shared_storage import get_shared_dir
from tasks.automated_pipeline import (
    is_download_lock_active,
    _pipeline_lock_key,
    _get_redis,
    _release_lock,
    launch_process_only,
)
from tasks.orchestrator import _download_task_id, _is_download_running
from celery_app import celery_app
from celery import chain


def check_status(volcano: str, year: int) -> dict:
    config = VOLCANOES[volcano]
    track = config["track"]
    frame = config["frame"]

    # 1. Verificar ZIPs en shared/
    shared_dir = get_shared_dir(track, frame, year)
    shared_exists = shared_dir.exists()
    zips = list(shared_dir.glob("*.zip")) if shared_exists else []
    total_zips_mb = round(sum(z.stat().st_size for z in zips) / (1024 ** 2), 2) if zips else 0

    # 2. Verificar Parquet
    p_path = parquet_path(volcano, year)
    p_exists = p_path.exists()
    p_size_kb = round(p_path.stat().st_size / 1024, 2) if p_exists else 0
    p_rows = 0
    p_nonzero = 0
    p_flat_zeros = True

    if p_exists:
        try:
            import pandas as pd
            df = pd.read_parquet(p_path)
            p_rows = len(df)
            if "deformation" in df.columns:
                p_nonzero = int((df["deformation"] != 0.0).sum())
                p_flat_zeros = (p_nonzero == 0)
        except Exception as e:
            logger.warning("No se pudo inspeccionar Parquet: %s", e)

    # 3. Verificar Bloqueo en Redis
    has_lock = is_download_lock_active(track, frame, year)
    lock_val = None
    if has_lock:
        try:
            lock_val = _get_redis().get(_pipeline_lock_key(track, frame, year))
        except Exception:
            pass

    is_running = _is_download_running(track, frame, year)

    return {
        "volcano": volcano,
        "name": config["name"],
        "track": track,
        "frame": frame,
        "year": year,
        "shared_dir": str(shared_dir),
        "shared_exists": shared_exists,
        "zips_count": len(zips),
        "zips_size_mb": total_zips_mb,
        "parquet_path": str(p_path),
        "parquet_exists": p_exists,
        "parquet_size_kb": p_size_kb,
        "parquet_rows": p_rows,
        "parquet_nonzero": p_nonzero,
        "parquet_flat_zeros": p_flat_zeros,
        "has_redis_lock": has_lock,
        "lock_val": lock_val,
        "is_celery_running": is_running,
    }


def print_status(info: dict):
    print("=" * 70)
    print(f" DIAGNÓSTICO DE ESTADO: {info['name']} (Año {info['year']})")
    print("=" * 70)
    print(f" Track / Frame          : Track {info['track']}, Frame {info['frame']}")
    print(f" Directorio Compartido  : {info['shared_dir']}")
    print(f" Carpeta Existe         : {'SÍ' if info['shared_exists'] else 'NO'}")
    print(f" Archivos ZIP en Disco  : {info['zips_count']} archivos ({info['zips_size_mb']} MB)")
    print("-" * 70)
    print(f" Archivo Parquet        : {info['parquet_path']}")
    print(f" Parquet Existe         : {'SÍ' if info['parquet_exists'] else 'NO'}")
    if info['parquet_exists']:
        print(f" Tamaño Parquet         : {info['parquet_size_kb']} KB")
        print(f" Total de Registros     : {info['parquet_rows']:,}")
        print(f" Puntos con Deformación : {info['parquet_nonzero']:,}")
        if info['parquet_flat_zeros']:
            print("  [!] ADVERTENCIA: El archivo actual contiene SOLO CEROS (0.0 mm).")
        else:
            print("  [✓] El archivo actual contiene variaciones de deformación reales.")
    print("-" * 70)
    print(f" Lock activo en Redis   : {'SÍ (' + str(info['lock_val']) + ')' if info['has_redis_lock'] else 'NO'}")
    print(f" Tarea Celery corriendo : {'SÍ' if info['is_celery_running'] else 'NO'}")
    print("=" * 70)


def inject(volcano: str, year: int, force: bool = False):
    info = check_status(volcano, year)
    print_status(info)

    track = info["track"]
    frame = info["frame"]

    if force:
        print("\n[!] Bandera --force activada: Liberando lock previo en Redis...")
        _release_lock(track, frame, year)
        info["has_redis_lock"] = False
        info["is_celery_running"] = False

    if info["is_celery_running"]:
        print("\n[ERROR] Ya hay una tarea de descarga/procesamiento activa para este track/frame/año.")
        print("Si estás seguro de que es una tarea zombie previa, usa el flag --force para forzar la inyección.")
        sys.exit(1)

    print("\nIniciando inyección de tarea...")

    # CASO 1: Los ZIPs ya están presentes en shared/
    if info["zips_count"] > 0:
        print(f"-> Se encontraron {info['zips_count']} archivos ZIP en shared/.")
        print(f"-> Encolando directamente procesamiento MintPy para '{volcano}' año {year}...")
        try:
            task_id = launch_process_only(volcano, year)
            print(f"\n[ÉXITO] Tarea de procesamiento MintPy inyectada en Celery:")
            print(f"   Task ID : {task_id}")
            print(f"   Cola    : geodesk_heavy")
            print(f"\nEl worker de Celery ya comenzó o comenzará a procesar San Miguel 2024.")
            print(f"Al finalizar, sobreescribirá el Parquet con los datos calculados.")
        except Exception as exc:
            print(f"\n[ERROR] Error al encolar en Celery: {exc}")
            sys.exit(1)

    # CASO 2: Los ZIPs NO están presentes en shared/ (fueron limpiados previamente)
    else:
        print("-> No hay archivos ZIP en el directorio compartido.")
        print(f"-> Encolando descarga en HyP3 + callback para procesar ÚNICAMENTE '{volcano}'...")

        start_iso = f"{year}-01-01T00:00:00Z"
        end_iso   = f"{year}-12-31T23:59:59Z"

        celery_app.set_current()

        s_submit = celery_app.signature(
            "tasks.automated_pipeline.pipeline_submit_hyp3",
            args=[track, frame, year, start_iso, end_iso],
        )
        s_wait = celery_app.signature(
            "tasks.automated_pipeline.pipeline_wait_and_download",
        )
        s_proc = celery_app.signature(
            "tasks.orchestrator._enqueue_volcano_processing",
            kwargs={"volcanoes": [volcano]},
        )

        workflow = chain(s_submit, s_wait, s_proc)
        task_id = _download_task_id(track, frame, year)

        try:
            workflow.apply_async(queue="geodesk_heavy", task_id=task_id)
            print(f"\n[ÉXITO] Cadena de descarga e inyección enviada a Celery:")
            print(f"   Task ID  : {task_id}")
            print(f"   Periodo  : {start_iso} → {end_iso}")
            print(f"   Callback : Procesar únicamente '{volcano}'")
            print(f"\nHyP3 verificará/descargará los pares y luego Celery correrá MintPy solo para San Miguel.")
        except Exception as exc:
            print(f"\n[ERROR] Error al encolar cadena en Celery: {exc}")
            sys.exit(1)

    print("\nPara ver el avance en tiempo real sin detener nada:")
    print("   docker logs -f --tail=50 mintpy-analysis-geodesk-jiq1qs-celery-worker-1\n")


def main():
    parser = argparse.ArgumentParser(
        description="Inyectar tarea de procesamiento específica para un volcán y año en Celery."
    )
    parser.add_argument(
        "--volcano",
        type=str,
        default="san_miguel",
        choices=list(VOLCANOES.keys()),
        help="Identificador del volcán (por defecto: san_miguel)",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=2024,
        help="Año a procesar (por defecto: 2024)",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Solo muestra el estado actual de los ZIPs, Parquet y Redis sin encolar ninguna tarea.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Fuerza la liberación de cualquier bloqueo (lock) previo en Redis antes de encolar.",
    )

    args = parser.parse_args()

    if args.check_only:
        info = check_status(args.volcano, args.year)
        print_status(info)
    else:
        inject(args.volcano, args.year, force=args.force)


if __name__ == "__main__":
    main()
