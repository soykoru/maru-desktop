"""MARU Live sidecar package.

Expone la lógica de TikTok/juegos/IA al cliente Electron mediante JSON-RPC
sobre WebSocket. Estructura:

  maru_sidecar/
    __init__.py
    __main__.py        # entry CLI
    server.py          # WebSocket + dispatch JSON-RPC
    logger.py          # logger central (sin print en core)
    rpc/
      __init__.py
      registry.py      # MethodRegistry, decoradores, tipos de error
      methods.py       # métodos expuestos (Fase 0: solo `ping`)
    backend/           # adapters reales (Fase 1+: importan `core/` original)
"""

__version__ = "1.0.0"
