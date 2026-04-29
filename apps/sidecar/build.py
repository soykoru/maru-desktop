"""Build del sidecar PyInstaller — invocado por `pnpm --filter @maru/sidecar build`.

Pasos:
  1. Verifica que PyInstaller esté instalado.
  2. Limpia `build/` y `dist/sidecar/`.
  3. Corre `pyinstaller sidecar.spec --noconfirm`.
  4. Verifica que `dist/sidecar/sidecar(.exe)` exista y sea ejecutable.
  5. Reporta tamaño total del bundle.
  6. Smoke-test: arranca el binario con `--rpc-port 0 --ready-stdout`,
     espera la línea `MARU_SIDECAR_READY <port>`, lo cierra.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = ROOT / "sidecar.spec"
DIST = ROOT / "dist" / "sidecar"
BUILD = ROOT / "build"


def step(msg: str) -> None:
    print(f"\n› {msg}")


def fail(msg: str) -> None:
    print(f"\n✗ {msg}", file=sys.stderr)
    sys.exit(1)


def check_pyinstaller() -> None:
    try:
        import PyInstaller  # type: ignore  # noqa: F401
    except ImportError:
        fail(
            "PyInstaller no está instalado. Instalalo con:\n"
            "    python -m pip install pyinstaller\n"
        )


def clean() -> None:
    for p in (DIST.parent, BUILD):
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)


def run_pyinstaller() -> None:
    if not SPEC.exists():
        fail(f"sidecar.spec no encontrado en {SPEC}")
    cmd = [sys.executable, "-m", "PyInstaller", str(SPEC), "--noconfirm", "--clean"]
    print(f"  $ {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=ROOT)
    if res.returncode != 0:
        fail(f"PyInstaller falló (exit {res.returncode})")


def find_binary() -> Path:
    name = "sidecar.exe" if sys.platform == "win32" else "sidecar"
    target = DIST / name
    if not target.exists():
        fail(f"binario esperado no encontrado: {target}")
    return target


def folder_size_mb(p: Path) -> float:
    total = 0
    for f in p.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except OSError:
                pass
    return total / (1024 * 1024)


def smoke_test(binary: Path) -> None:
    step("Smoke test: arrancando el binario y esperando handshake…")
    proc = subprocess.Popen(
        [str(binary), "--rpc-port", "0", "--ready-stdout", "--log-level", "WARNING"],
        cwd=binary.parent,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    deadline = time.time() + 15.0
    ready = False
    try:
        assert proc.stdout is not None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                continue
            print(f"  [stdout] {line.rstrip()}")
            if line.startswith("MARU_SIDECAR_READY"):
                ready = True
                break
        if not ready:
            err = proc.stderr.read() if proc.stderr else ""
            fail(f"el binario no emitió MARU_SIDECAR_READY a tiempo. stderr:\n{err}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    step("Build del sidecar PyInstaller")
    check_pyinstaller()

    step("Limpiando build anterior")
    clean()

    step("Ejecutando PyInstaller (puede tardar 30-90s)")
    run_pyinstaller()

    step("Verificando output")
    binary = find_binary()
    size = folder_size_mb(DIST)
    print(f"  ✓ Binario: {binary}")
    print(f"  ✓ Tamaño total del bundle: {size:.1f} MB")

    smoke_test(binary)

    print(f"\n✓ Sidecar listo en {DIST}")
    print(f"  Electron-builder lo empaquetará en resources/sidecar/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
