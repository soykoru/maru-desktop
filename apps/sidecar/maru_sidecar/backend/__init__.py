"""Backend del sidecar — adapters por dominio que envuelven `core/` original.

Cada submódulo expone una clase `*Service` con métodos que el `MethodRegistry`
mapea 1:1 a métodos JSON-RPC del contrato `@maru/shared`.
"""
