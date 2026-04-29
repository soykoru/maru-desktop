import type { StateCreator } from 'zustand';
import type { ConnectionStatus } from '@maru/shared';

export interface ConnectionSlice {
  sidecarStatus: ConnectionStatus;
  rpcStatus: ConnectionStatus;
  lastPingMs: number | null;
  setSidecarStatus: (s: ConnectionStatus) => void;
  setRpcStatus: (s: ConnectionStatus) => void;
  setLastPing: (ms: number) => void;
}

export const createConnectionSlice: StateCreator<ConnectionSlice, [], [], ConnectionSlice> = (set) => ({
  sidecarStatus: 'connecting',
  rpcStatus: 'disconnected',
  lastPingMs: null,
  setSidecarStatus: (s) => set({ sidecarStatus: s }),
  setRpcStatus: (s) => set({ rpcStatus: s }),
  setLastPing: (ms) => set({ lastPingMs: ms }),
});
