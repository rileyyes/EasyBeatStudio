import { describe, expect, it } from 'vitest';
import {
  chordLabel,
  diatonicTriad,
  isInScale,
  midiToFrequency,
  midiToName,
  romanNumeral,
  scalePitchClasses,
  voiceLeadTriad,
} from '../src/core/music/theory';

describe('music theory', () => {
  it('builds major and minor scales', () => {
    expect(scalePitchClasses({ tonic: 'C', mode: 'major' })).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses({ tonic: 'A', mode: 'minor' })).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it('names MIDI notes and converts to frequency', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
  });

  it('gets diatonic chord qualities right in C major', () => {
    const key = { tonic: 'C', mode: 'major' } as const;
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => diatonicTriad(key, d).quality)).toEqual(['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']);
    expect([1, 5, 6, 4].map((d) => chordLabel(key, d))).toEqual(['C', 'G', 'Am', 'F']);
    expect(romanNumeral(key, 6)).toBe('vi');
    expect(romanNumeral(key, 7)).toBe('vii°');
  });

  it('labels chords in A minor', () => {
    const key = { tonic: 'A', mode: 'minor' } as const;
    expect([1, 6, 3, 7].map((d) => chordLabel(key, d))).toEqual(['Am', 'F', 'C', 'G']);
  });

  it('voice-leads chords smoothly inside the register', () => {
    const key = { tonic: 'C', mode: 'major' } as const;
    let prev: number[] | null = null;
    for (const d of [1, 5, 6, 4, 1]) {
      const v = voiceLeadTriad(diatonicTriad(key, d).pcs, prev);
      expect(v).toHaveLength(3);
      expect(v[0]).toBeGreaterThanOrEqual(50);
      expect(v[2]).toBeLessThanOrEqual(79);
      const pcs = new Set(v.map((p) => p % 12));
      expect(pcs).toEqual(new Set(diatonicTriad(key, d).pcs));
      if (prev) {
        const movement = v.reduce((sum, p, i) => sum + Math.abs(p - prev![i]), 0);
        expect(movement).toBeLessThanOrEqual(8);
      }
      prev = v;
    }
  });

  it('checks scale membership', () => {
    const key = { tonic: 'G', mode: 'major' } as const;
    expect(isInScale(66, key)).toBe(true); // F#
    expect(isInScale(65, key)).toBe(false); // F
  });
});
