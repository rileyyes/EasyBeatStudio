export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

let idCounter = 0;
/** Short unique id. Uses crypto.randomUUID when available. */
export function uid(prefix = 'id'): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}_${c.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Deterministic pseudo-random generator (mulberry32) so generated music is reproducible. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/** Round to the nearest multiple of `grid` (tolerates float noise). */
export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(Math.round(value / grid) * grid * 1e6) / 1e6;
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Strip control characters and trim user-provided names. */
export function sanitizeName(input: unknown, fallback: string, maxLength = 60): string {
  if (typeof input !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : fallback;
}
