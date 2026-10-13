import { describe, expect, it } from 'vitest';
import {
  bassRoot,
  generateBassNotes,
  generateChordNotes,
  generateDrumPattern,
  generateMelodyNotes,
  MOODS,
  PROGRESSIONS,
  quantizeNotes,
  varyDrumPattern,
} from '../src/core/music/generators';
import { diatonicTriad, isInScale } from '../src/core/music/theory';
import type { MusicalKey } from '../src/core/types';

const C: MusicalKey = { tonic: 'C', mode: 'major' };
const Am: MusicalKey = { tonic: 'A', mode: 'minor' };

describe('chord generation', () => {
  it('produces in-key chords for every preset in every mood', () => {
    for (const mood of MOODS) {
      for (const preset of PROGRESSIONS[mood]) {
        const key = preset.mode === 'major' ? C : Am;
        for (const style of ['sustain', 'stabs', 'arpeggio'] as const) {
          const notes = generateChordNotes({ key, degrees: preset.degrees, style });
          expect(notes.length).toBeGreaterThan(0);
          for (const n of notes) {
            expect(isInScale(n.pitch, key)).toBe(true);
            expect(n.start).toBeGreaterThanOrEqual(0);
            expect(n.start + n.duration).toBeLessThanOrEqual(preset.degrees.length * 4 + 1e-9);
          }
        }
      }
    }
  });

  it('sustain style plays 3 notes per chord, one bar each', () => {
    const notes = generateChordNotes({ key: C, degrees: [1, 5, 6, 4] });
    expect(notes).toHaveLength(12);
    expect(new Set(notes.map((n) => n.start))).toEqual(new Set([0, 4, 8, 12]));
  });
});

describe('bassline generation', () => {
  it('starts each chord on its root note, in the bass register', () => {
    const degrees = [6, 4, 1, 5];
    for (const style of ['roots', 'pulse', 'octaves', 'walking'] as const) {
      const notes = generateBassNotes(C, degrees, style);
      degrees.forEach((d, i) => {
        const first = notes.find((n) => n.start === i * 4);
        expect(first).toBeDefined();
        expect(first!.pitch % 12).toBe(diatonicTriad(C, d).pcs[0]);
        expect(first!.pitch).toBe(bassRoot(C, d));
      });
      for (const n of notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(28);
        expect(n.pitch).toBeLessThanOrEqual(52);
      }
    }
  });
});

describe('melody generation', () => {
  it('stays in key, uses chord tones on strong beats and is deterministic', () => {
    const degrees = [1, 6, 3, 7];
    const a = generateMelodyNotes({ key: Am, degrees, seed: 5 });
    const b = generateMelodyNotes({ key: Am, degrees, seed: 5 });
    const c = generateMelodyNotes({ key: Am, degrees, seed: 6 });
    expect(a.map((n) => [n.pitch, n.start])).toEqual(b.map((n) => [n.pitch, n.start]));
    expect(a.map((n) => [n.pitch, n.start])).not.toEqual(c.map((n) => [n.pitch, n.start]));
    expect(a.length).toBeGreaterThan(8);
    for (const n of a) {
      expect(isInScale(n.pitch, Am)).toBe(true);
      if (Number.isInteger(n.start) && n.start % 2 === 0) {
        const chord = diatonicTriad(Am, degrees[Math.floor(n.start / 4)]).pcs;
        expect(chord).toContain(n.pitch % 12);
      }
    }
    // no overlapping notes in a monophonic melody
    const sorted = [...a].sort((x, y) => x.start - y.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].start + sorted[i - 1].duration - 1e-9);
  });
});

describe('drum patterns', () => {
  it('generates 2-bar patterns with all six drum rows', () => {
    for (const style of ['hip-hop', 'trap', 'pop', 'rock', 'electronic', 'ambient', 'fill', 'intro'] as const) {
      const p = generateDrumPattern(style);
      expect(p.lengthSteps).toBe(32);
      expect(p.rows).toHaveLength(6);
      for (const r of p.rows) expect(r.steps).toHaveLength(32);
      expect(p.rows.some((r) => r.steps.some((v) => v > 0))).toBe(true);
    }
  });

  it('variations keep the backbeat and are a new pattern', () => {
    const base = generateDrumPattern('pop');
    const v = varyDrumPattern(base, 3);
    expect(v.id).not.toBe(base.id);
    const snare = v.rows.find((r) => r.sound === 'snare')!;
    for (const step of [4, 12, 20, 28]) expect(snare.steps[step]).toBe(1);
    const kick = v.rows.find((r) => r.sound === 'kick')!;
    expect(kick.steps[0]).toBe(1);
  });
});

describe('quantize', () => {
  it('snaps starts and lengths to the grid', () => {
    const q = quantizeNotes([{ id: 'a', pitch: 60, start: 0.27, duration: 0.4, velocity: 1 }], 0.25);
    expect(q[0].start).toBe(0.25);
    expect(q[0].duration).toBe(0.5);
  });
});
