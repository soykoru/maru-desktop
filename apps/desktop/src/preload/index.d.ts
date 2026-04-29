import type { MaruApi } from './index.js';

declare global {
  interface Window {
    maruApi: MaruApi;
  }
}

export {};
