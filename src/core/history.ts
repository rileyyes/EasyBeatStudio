/**
 * Snapshot-based undo/redo. Consecutive edits that share a `coalesceKey` within
 * `coalesceMs` (e.g. dragging a fader or a note) collapse into one undo step.
 */
export interface HistoryState<T> {
  present: T;
  past: { value: T; label: string }[];
  future: { value: T; label: string }[];
  lastKey: string | null;
  lastTime: number;
  presentLabel: string;
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): HistoryState<T> {
  return { present, past: [], future: [], lastKey: null, lastTime: 0, presentLabel: '' };
}

export function pushHistory<T>(
  h: HistoryState<T>,
  next: T,
  label: string,
  coalesceKey: string | null = null,
  now = Date.now(),
  coalesceMs = 800,
): HistoryState<T> {
  if (coalesceKey && h.lastKey === coalesceKey && now - h.lastTime < coalesceMs) {
    return { ...h, present: next, future: [], lastTime: now };
  }
  const past = [...h.past, { value: h.present, label }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { present: next, past, future: [], lastKey: coalesceKey, lastTime: now, presentLabel: label };
}

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    present: prev.value,
    past: h.past.slice(0, -1),
    future: [{ value: h.present, label: prev.label }, ...h.future],
    lastKey: null,
    lastTime: 0,
    presentLabel: '',
  };
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  const next = h.future[0];
  if (!next) return h;
  return {
    present: next.value,
    past: [...h.past, { value: h.present, label: next.label }],
    future: h.future.slice(1),
    lastKey: null,
    lastTime: 0,
    presentLabel: next.label,
  };
}

export const canUndo = <T>(h: HistoryState<T>) => h.past.length > 0;
export const canRedo = <T>(h: HistoryState<T>) => h.future.length > 0;
export const undoLabel = <T>(h: HistoryState<T>) => h.past[h.past.length - 1]?.label ?? '';
export const redoLabel = <T>(h: HistoryState<T>) => h.future[0]?.label ?? '';
