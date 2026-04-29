import type { RpcMethodName, RpcParams, RpcResult } from '@maru/shared';

export function rpcCall<M extends RpcMethodName>(
  method: M,
  params: RpcParams<M>,
): Promise<RpcResult<M>> {
  return window.maruApi.rpc.call(method, params);
}
