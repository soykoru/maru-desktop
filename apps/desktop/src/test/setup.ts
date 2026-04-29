import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import React from 'react';

// MaruImage usa el scheme `maru://` que no existe en jsdom — lo
// reemplazamos por un <img> simple que respeta los props.
vi.mock('@maru/ui', async () => {
  const actual = await vi.importActual<typeof import('@maru/ui')>('@maru/ui');
  return {
    ...actual,
    MaruImage: ({ alt, size }: { alt?: string; size?: number }) =>
      React.createElement('img', { alt, width: size, height: size }),
  };
});

