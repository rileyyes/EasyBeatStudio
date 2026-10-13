import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';

/** Current playback position in beats (null when stopped), refreshed every animation frame. */
export function usePlayhead(engine: AudioEngine, active = true): number | null {
  const [beat, setBeat] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last: number | null = -1;
    const loop = () => {
      const b = engine.positionBeats();
      if (b === null ? last !== null : last === null || Math.abs(b - last) > 0.02) {
        last = b;
        setBeat(b);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, active]);
  return beat;
}

/** Audio levels for meters, refreshed ~20x per second. */
export function useLevels(engine: AudioEngine, active = true): { master: number; tracks: Record<string, number> } {
  const [levels, setLevels] = useState<{ master: number; tracks: Record<string, number> }>({ master: 0, tracks: {} });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setLevels(engine.levels()), 50);
    return () => clearInterval(id);
  }, [engine, active]);
  return levels;
}

/** Drag helper: calls onMove with pixel deltas from the pointer-down point; onEnd once released. */
export function useDrag() {
  const state = useRef<{ x: number; y: number; onMove: (dx: number, dy: number) => void; onEnd?: () => void } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (state.current) state.current.onMove(e.clientX - state.current.x, e.clientY - state.current.y);
    };
    const up = () => {
      const s = state.current;
      state.current = null;
      s?.onEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  return (e: { clientX: number; clientY: number }, onMove: (dx: number, dy: number) => void, onEnd?: () => void) => {
    state.current = { x: e.clientX, y: e.clientY, onMove, onEnd };
  };
}

export function downloadBytes(bytes: Uint8Array | string, fileName: string, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatPosition(beat: number, beatsPerBar: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const b = Math.floor(beat % beatsPerBar) + 1;
  return `${bar}.${b}`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return ['text', 'number', 'search', 'email', 'password', 'url'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
