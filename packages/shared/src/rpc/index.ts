/**
 * Contrato JSON-RPC entre Electron (renderer/main) y sidecar Python.
 *
 * Source of truth: cualquier método o push event se define primero aquí (TS) y
 * luego se implementa en `apps/sidecar/maru_sidecar/`.
 */

export * from './methods.js';
export * from './events.js';

import type { RpcMethodMap as MethodMap } from './methods.js';
import type { RpcPushEventMap as EventMap } from './events.js';

export type RpcMethodName = keyof MethodMap;
export type RpcParams<M extends RpcMethodName> = MethodMap[M]['params'];
export type RpcResult<M extends RpcMethodName> = MethodMap[M]['result'];

export interface RpcRequest<M extends RpcMethodName = RpcMethodName> {
  jsonrpc: '2.0';
  id: number | string;
  method: M;
  params: RpcParams<M>;
}

export interface RpcResponseOk<M extends RpcMethodName = RpcMethodName> {
  jsonrpc: '2.0';
  id: number | string;
  result: RpcResult<M>;
}

export interface RpcResponseErr {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type RpcResponse<M extends RpcMethodName = RpcMethodName> =
  | RpcResponseOk<M>
  | RpcResponseErr;

export interface RpcNotification<E extends keyof EventMap = keyof EventMap> {
  jsonrpc: '2.0';
  method: E;
  params: EventMap[E];
}

export const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SIDECAR_DISCONNECTED: -32000,
  TIKTOK_NOT_CONNECTED: -32001,
  GAME_NOT_CONFIGURED: -32002,
  BACKUP_NOT_FOUND: -32003,
} as const;
