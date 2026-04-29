/**
 * Cliente JSON-RPC sobre WebSocket hacia el sidecar Python.
 *
 * - Maneja request/response correlacionados por id.
 * - Emite push events (notifications) por EventEmitter.
 * - Reconecta automáticamente si el sidecar se reinicia.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type {
  RpcMethodName,
  RpcParams,
  RpcResult,
  RpcResponse,
  RpcNotification,
  RpcPushEventName,
  RpcPushEventMap,
} from '@maru/shared';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const CALL_TIMEOUT_MS = 10_000;

export class RpcClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private url: string | null = null;
  private connected = false;

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(port: number, host = '127.0.0.1'): Promise<void> {
    if (this.ws) await this.disconnect();
    const url = `ws://${host}:${port}`;
    this.url = url;
    return new Promise((resolveConn, rejectConn) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const onOpen = () => {
        this.connected = true;
        ws.off('error', onErr);
        this.emit('connected');
        resolveConn();
      };
      const onErr = (err: Error) => {
        ws.off('open', onOpen);
        rejectConn(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onErr);
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', () => {
        this.connected = false;
        this.failAllPending(new Error('rpc connection closed'));
        this.emit('disconnected');
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    return new Promise((res) => {
      ws.once('close', () => res());
      ws.close();
    });
  }

  call<M extends RpcMethodName>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    if (!this.ws || !this.connected) {
      return Promise.reject(new Error('rpc not connected'));
    }
    const id = this.nextId++;
    const request = { jsonrpc: '2.0' as const, id, method, params };
    return new Promise<RpcResult<M>>((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`rpc call timeout: ${method}`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => res(v as RpcResult<M>),
        reject: rej,
        timer,
      });
      this.ws!.send(JSON.stringify(request));
    });
  }

  override on<E extends RpcPushEventName>(event: E, listener: (payload: RpcPushEventMap[E]) => void): this;
  override on(event: 'connected' | 'disconnected', listener: () => void): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  private onMessage(raw: string): void {
    let msg: RpcResponse | RpcNotification;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[rpc] invalid JSON:', raw);
      return;
    }

    if ('id' in msg && msg.id !== null && this.pending.has(Number(msg.id))) {
      const id = Number(msg.id);
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if ('error' in msg) {
        pending.reject(new Error(`rpc error ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if ('method' in msg && !('id' in msg)) {
      this.emit(msg.method, msg.params);
    }
  }

  private failAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}
