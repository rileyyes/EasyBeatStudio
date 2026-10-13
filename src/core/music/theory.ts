import type { Mode, MusicalKey, PitchClassName } from '../types';

export const NOTE_NAMES: PitchClassName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALE_INTERVALS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function pitchClassOf(name: PitchClassName): number {
  return NOTE_NAMES.indexOf(name);
}

/** "C4" style name for a MIDI pitch (middle C = C4 = 60). */
export function midiToName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${octave}`;
}

export function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function keyLabel(key: MusicalKey): string {
  return `${key.tonic} ${key.mode}`;
}

/** Pitch classes (0..11) of the key's scale, starting at the tonic. */
export function scalePitchClasses(key: MusicalKey): number[] {
  const root = pitchClassOf(key.tonic);
  return SCALE_INTERVALS[key.mode].map((i) => (root + i) % 12);
}

export function isInScale(pitch: number, key: MusicalKey): boolean {
  return scalePitchClasses(key).includes(((pitch % 12) + 12) % 12);
}

/** All MIDI pitches of the scale within [low, high]. */
export function scalePitchesInRange(key: MusicalKey, low: number, high: number): number[] {
  const pcs = scalePitchClasses(key);
  const out: number[] = [];
  for (let p = low; p <= high; p++) if (pcs.includes(p % 12)) out.push(p);
  return out;
}

export type ChordQuality = 'maj' | 'min' | 'dim';

/** Diatonic triad on a 1-based scale degree. Returns pitch classes [root, third, fifth]. */
export function diatonicTriad(key: MusicalKey, degree: number): { pcs: number[]; quality: ChordQuality } {
  const pcs = scalePitchClasses(key);
  const d = (((degree - 1) % 7) + 7) % 7;
  const root = pcs[d];
  const third = pcs[(d + 2) % 7];
  const fifth = pcs[(d + 4) % 7];
  const i3 = (third - root + 12) % 12;
  const i5 = (fifth - root + 12) % 12;
  const quality: ChordQuality = i3 === 4 ? 'maj' : i5 === 6 ? 'dim' : 'min';
  return { pcs: [root, third, fifth], quality };
}

export function chordLabel(key: MusicalKey, degree: number): string {
  const { pcs, quality } = diatonicTriad(key, degree);
  const name = NOTE_NAMES[pcs[0]];
  return quality === 'maj' ? name : quality === 'min' ? `${name}m` : `${name}dim`;
}

export function romanNumeral(key: MusicalKey, degree: number): string {
  const { quality } = diatonicTriad(key, degree);
  const r = ROMAN[(((degree - 1) % 7) + 7) % 7];
  return quality === 'maj' ? r : quality === 'min' ? r.toLowerCase() : `${r.toLowerCase()}°`;
}

/** MIDI pitch of a pitch class nearest to (but not above) `ceiling`. */
export function pitchAtOrBelow(pc: number, ceiling: number): number {
  let p = ceiling - (((ceiling - pc) % 12) + 12) % 12;
  if (p > ceiling) p -= 12;
  return p;
}

/** All inversions of a triad, rooted around a center pitch. */
function triadVoicings(pcs: number[], center: number): number[][] {
  const voicings: number[][] = [];
  for (let inversion = 0; inversion < 3; inversion++) {
    const order = [pcs[inversion % 3], pcs[(inversion + 1) % 3], pcs[(inversion + 2) % 3]];
    for (const octaveShift of [-12, 0, 12]) {
      let prev = pitchAtOrBelow(order[0], center + octaveShift);
      const v = [prev];
      for (let i = 1; i < 3; i++) {
        let p = prev + ((order[i] - prev) % 12 + 12) % 12;
        if (p === prev) p += 12;
        v.push(p);
        prev = p;
      }
      voicings.push(v);
    }
  }
  return voicings;
}

/**
 * Voice-led chord pitches: chooses the inversion closest to the previous chord,
 * keeping the voicing between `low` and `high`.
 */
export function voiceLeadTriad(
  pcs: number[],
  previous: number[] | null,
  center = 62,
  low = 50,
  high = 79,
): number[] {
  const candidates = triadVoicings(pcs, center).filter((v) => v[0] >= low && v[2] <= high);
  const pool = candidates.length > 0 ? candidates : triadVoicings(pcs, center);
  const target = previous ?? [center - 4, center, center + 4];
  let best = pool[0];
  let bestCost = Infinity;
  for (const v of pool) {
    let cost = 0;
    for (let i = 0; i < 3; i++) cost += Math.abs(v[i] - target[i]);
    // prefer staying near the register center
    cost += Math.abs(v[1] - center) * 0.15;
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return [...best].sort((a, b) => a - b);
}

/** Interval-based explanation of a key, for the "Learn" panel. */
export function describeKey(key: MusicalKey): string {
  const notes = scalePitchClasses(key).map((pc) => NOTE_NAMES[pc]).join(' ');
  const feel = key.mode === 'major' ? 'bright and uplifting' : 'darker and more emotional';
  return `${keyLabel(key)} uses the notes ${notes}. ${key.mode === 'major' ? 'Major' : 'Minor'} keys usually sound ${feel}.`;
}
