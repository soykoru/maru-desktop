export function assertNever(value: never, message = 'Unhandled variant'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
