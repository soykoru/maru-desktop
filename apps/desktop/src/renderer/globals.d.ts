/// <reference types="vite/client" />
import type { MaruApi } from '../preload/index.js';

declare global {
  interface Window {
    maruApi: MaruApi;
  }
}

export {};
