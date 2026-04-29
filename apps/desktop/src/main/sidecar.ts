/**
 * Lifecycle del sidecar Python desde Electron Main.
 *
 * Responsabilidades:
 *  - Spawn `python -m maru_sidecar --rpc-port <port> --ready-stdout`
 *  - Esperar la línea `MARU_SIDECAR_READY <port>` por stdout
 *  - Restart automático con backoff (max 3 intentos en 30s)
 *  - Shutdown limpio: SIGTERM, esperar 3s, SIGKILL si no responde
 *  - Re-emitir stdout/stderr a la consola de Electron
 *
 * En F7 (empaquetado), el binario reemplaza `python -m maru_sidecar` por
 * `resources/sidecar/sidecar.exe` (PyInstaller --onedir).
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { RUNTIME_CONFIG } from './runtime-config.js';

export interface SidecarOptions {
  rpcPort?: number;
  logLevel?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
}

export interface SidecarReadyInfo {
  rpcPort: number;
  pid: number;
}

const READY_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_WINDOW_MS = 30_000;

export class SidecarManager extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readyPort: number | null = null;
  private restartAttempts: number[] = [];
  private shuttingDown = false;
  private readonly readyMarker = RUNTIME_CONFIG.sidecarReadyMarker;
  private readonly opts: Required<SidecarOptions>;

  constructor(opts: SidecarOptions = {}) {
    super();
    this.opts = {
      rpcPort: opts.rpcPort ?? RUNTIME_CONFIG.defaultRpcPort,
      logLevel: opts.logLevel ?? 'INFO',
    };
  }

  async start(): Promise<SidecarReadyInfo> {
    if (this.proc) {
      throw new Error('sidecar already running');
    }
    const { command, args, cwd } = this.resolveLaunch();
    console.log(`[sidecar] spawn ${command} ${args.join(' ')} (cwd=${cwd})`);

    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });
    this.proc = proc;

    return new Promise<SidecarReadyInfo>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(new Error('sidecar ready timeout'));
        this.kill();
      }, READY_TIMEOUT_MS);

      const onStdout = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          console.log(`[sidecar] ${line}`);
          const m = line.match(new RegExp(`${this.readyMarker}\\s+(\\d+)`));
          if (m && m[1]) {
            this.readyPort = Number(m[1]);
            clearTimeout(timeout);
            proc.stdout.off('data', onStdout);
            const info: SidecarReadyInfo = { rpcPort: this.readyPort, pid: proc.pid ?? -1 };
            this.emit('ready', info);
            resolveReady(info);
          }
        }
      };
      proc.stdout.on('data', onStdout);
      proc.stderr.on('data', (c: Buffer) => console.error(`[sidecar:err] ${c.toString('utf8').trimEnd()}`));

      proc.on('exit', (code, signal) => {
        console.log(`[sidecar] exit code=${code} signal=${signal}`);
        this.proc = null;
        this.readyPort = null;
        this.emit('exit', { code, signal });
        if (!this.shuttingDown) this.maybeRestart();
      });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        rejectReady(err);
      });
    });
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (!this.proc) return;
    const proc = this.proc;
    const pid = proc.pid;

    // Windows: `proc.kill('SIGTERM')` solo mata al PADRE (es un alias de
    // TerminateProcess). El sidecar Python tiene threads daemon (pygame
    // mixer, websocket server, TikTokWorker) y subprocesos opcionales
    // que NO se matan automaticamente — quedan zombies reproduciendo
    // sonido. Usamos `taskkill /F /T /PID` con flag /T para matar el
    // arbol entero (proceso + descendientes).
    if (process.platform === 'win32' && pid && pid > 0) {
      try {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          windowsHide: true,
          timeout: 3000,
        });
      } catch (err) {
        console.warn('[sidecar] taskkill fallo, fallback a proc.kill:', err);
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
    } else {
      // Unix: SIGTERM → espera → SIGKILL si tarda. Los procesos hijos
      // se manejan via process group si se spawneo con detached:false.
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }

    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        if (!proc.killed) {
          if (process.platform === 'win32' && pid) {
            try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }); } catch { /* */ }
          } else {
            try { proc.kill('SIGKILL'); } catch { /* */ }
          }
        }
        res();
      }, SHUTDOWN_TIMEOUT_MS);
      proc.once('exit', () => {
        clearTimeout(t);
        res();
      });
    });
  }

  kill(): void {
    if (!this.proc || this.proc.killed) return;
    const pid = this.proc.pid;
    if (process.platform === 'win32' && pid && pid > 0) {
      try {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          windowsHide: true,
          timeout: 2000,
        });
        return;
      } catch { /* fallthrough */ }
    }
    try { this.proc.kill('SIGKILL'); } catch { /* ignore */ }
  }

  get rpcPort(): number | null {
    return this.readyPort;
  }

  private maybeRestart(): void {
    const now = Date.now();
    this.restartAttempts = this.restartAttempts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartAttempts.length >= MAX_RESTART_ATTEMPTS) {
      this.emit('crashed', new Error('sidecar exceeded restart budget'));
      return;
    }
    this.restartAttempts.push(now);
    const delay = Math.min(500 * 2 ** this.restartAttempts.length, 5000);
    console.warn(`[sidecar] restart in ${delay}ms (attempt ${this.restartAttempts.length})`);
    setTimeout(() => {
      this.start().catch((e) => console.error('[sidecar] restart failed', e));
    }, delay);
  }

  private resolveLaunch(): { command: string; args: string[]; cwd: string } {
    const port = String(this.opts.rpcPort);
    const log = this.opts.logLevel;

    if (RUNTIME_CONFIG.isDev) {
      const sidecarRoot = RUNTIME_CONFIG.sidecarDevRoot;
      if (!existsSync(sidecarRoot)) {
        throw new Error(`sidecar root not found: ${sidecarRoot}`);
      }
      const python = process.env['MARU_PYTHON'] || (process.platform === 'win32' ? 'python' : 'python3');
      return {
        command: python,
        args: ['-m', 'maru_sidecar', '--rpc-port', port, '--log-level', log, '--ready-stdout'],
        cwd: sidecarRoot,
      };
    }

    // Producción (F7): binario empaquetado en resources/sidecar/
    const binDir = resolve(process.resourcesPath, 'sidecar');
    const binName = process.platform === 'win32' ? 'sidecar.exe' : 'sidecar';
    return {
      command: resolve(binDir, binName),
      args: ['--rpc-port', port, '--log-level', log, '--ready-stdout'],
      cwd: binDir,
    };
  }
}
