# @maru/sidecar

Sidecar Python de MARU Live. Expone toda la lógica de TikTok/juegos/IA/TTS/Spotify
al cliente Electron mediante JSON-RPC sobre WebSocket.

## Fase 0 (estado actual)

- Paquete `maru_sidecar` con CLI `python -m maru_sidecar`.
- Servidor JSON-RPC mínimo (`ping`).
- Handshake `MARU_SIDECAR_READY <port>` por stdout que Electron parsea.

## Fases siguientes

- **F1**: importar `core/` del repo original (`tiktok_client`, `rule_engine`, `games`,
  `tts_engine`, `ia_engine`, `social_system`, `spotify_client`, `overlays`) y exponerlos
  vía registry RPC. Cero cambios en la lógica → la conexión con TikTok y los juegos
  queda intacta.
- **F7**: empaquetar con PyInstaller `--onedir` para que Electron lo lance como
  binario en producción.

## Comandos

```bash
# desde apps/sidecar/
python -m pip install -e .[dev]
python -m maru_sidecar --rpc-port 8770 --ready-stdout
python -m pytest -q
```
