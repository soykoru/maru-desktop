# MARU Original — gui/controllers/ (1 controller, 17 líneas)

> Mucho menos código del que sugiere el nombre. Solo 1 worker pequeño.

---

## `connection.py` · `ConnectionWorker(QThread)`

Único contenido del módulo:

```python
class ConnectionWorker(QThread):
    """Worker para probar conexión en segundo plano"""
    finished = pyqtSignal(bool, str)

    def __init__(self, game):
        super().__init__()
        self.game = game

    def run(self):
        try:
            ok, msg = self.game.test_connection()
            self.finished.emit(ok, msg)
        except Exception as e:
            self.finished.emit(False, f"❌ Error: {str(e)}")
```

### Uso en MainWindow

```python
self._conn_worker = ConnectionWorker(g)
self._conn_worker.finished.connect(self._on_main_connection_result)
self._conn_worker.start()
```

### Uso en `EditPredefinedDialog` (manage_games)

Mismo patrón con auto-test debounce 800ms.

---

## Notas para el port

- En Electron: equivalente es un `async function testConnection(game)`
  en el sidecar Python que retorna `[ok, msg]` por JSON-RPC.
- No bloquea el renderer porque la llamada IPC es async by default.
- No hay otros controllers — los demás "controllers" están dispersos en
  los mixins (`gui/views/*.py`) o en el MainWindow directamente.
