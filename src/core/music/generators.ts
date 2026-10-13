import type {
  DrumPattern,
  DrumRow,
  DrumSound,
  Genre,
  Mode,
  Mood,
  MusicalKey,
  Note,
  NotePattern,
} from '../types';
import { DRUM_SOUNDS } from '../types';
import { clamp, createRng, pick, uid } from '../util';
import { chordLabel, diatonicTriad, pitchAtOrBelow, scalePitchesInRange, voiceLeadTriad } from './theory';

/* ------------------------------------------------------------------ */
/* Chord progressions                                                  */
/* ------------------------------------------------------------------ */

export interface ProgressionPreset {
  id: string;
  name: string;
  mode: Mode;
  degrees: number[];
  description: string;
}

/** Curated, beginner-friendly progressions, grouped by mood. */
export const PROGRESSIONS: Record<Mood, ProgressionPreset[]> = {
  happy: [
    { id: 'happy-1', name: 'Feel-good pop', mode: 'major', degrees: [1, 5, 6, 4], description: 'The most famous pop progression. Bright and familiar.' },
    { id: 'happy-2', name: 'Sunny drive', mode: 'major', degrees: [1, 4, 5, 4], description: 'Simple and upbeat, great for rock and pop.' },
    { id: 'happy-3', name: 'Doo-wop', mode: 'major', degrees: [1, 6, 4, 5], description: 'Classic, warm and nostalgic.' },
  ],
  emotional: [
    { id: 'emo-1', name: 'Heartfelt', mode: 'major', degrees: [6, 4, 1, 5], description: 'Starts on a minor chord, then lifts. Emotional but hopeful.' },
    { id: 'emo-2', name: 'Bittersweet', mode: 'minor', degrees: [1, 6, 3, 7], description: 'Minor key with a soaring lift.' },
    { id: 'emo-3', name: 'Reflective', mode: 'major', degrees: [1, 3, 6, 4], description: 'Gentle and thoughtful.' },
  ],
  dark: [
    { id: 'dark-1', name: 'Shadows', mode: 'minor', degrees: [1, 6, 7, 1], description: 'Brooding minor loop, common in hip-hop and trap.' },
    { id: 'dark-2', name: 'Tension', mode: 'minor', degrees: [1, 4, 6, 5], description: 'Builds tension, then resolves back home.' },
    { id: 'dark-3', name: 'Night drive', mode: 'minor', degrees: [1, 7, 6, 7], description: 'Hypnotic and moody.' },
  ],
  chill: [
    { id: 'chill-1', name: 'Lo-fi lounge', mode: 'major', degrees: [2, 5, 1, 6], description: 'Smooth, jazzy movement.' },
    { id: 'chill-2', name: 'Easy float', mode: 'major', degrees: [1, 4, 1, 5], description: 'Relaxed and simple.' },
    { id: 'chill-3', name: 'Mellow minor', mode: 'minor', degrees: [1, 4, 1, 6], description: 'Soft and laid-back.' },
  ],
  energetic: [
    { id: 'energy-1', name: 'Anthem', mode: 'major', degrees: [1, 5, 4, 5], description: 'Driving and powerful.' },
    { id: 'energy-2', name: 'Club minor', mode: 'minor', degrees: [1, 6, 3, 7], description: 'Big electronic energy.' },
    { id: 'energy-3', name: 'Rock power', mode: 'major', degrees: [1, 4, 5, 1], description: 'Straight-ahead rock.' },
  ],
  epic: [
    { id: 'epic-1', name: 'Cinematic', mode: 'minor', degrees: [1, 6, 3, 7], description: 'Wide and dramatic.' },
    { id: 'epic-2', name: 'Heroic', mode: 'major', degrees: [4, 5, 6, 1], description: 'Climbing towards a big moment.' },
    { id: 'epic-3', name: 'Rise', mode: 'minor', degrees: [6, 7, 1, 1], description: 'Builds up and lands home.' },
  ],
};

export const MOODS: Mood[] = ['happy', 'emotional', 'dark', 'chill', 'energetic', 'epic'];

export function findProgression(id: string): ProgressionPreset | undefined {
  for (const mood of MOODS) {
    const found = PROGRESSIONS[mood].find((p) => p.id === id);
    if (found) return found;
  }
  return undefined;
}

export function progressionLabels(key: MusicalKey, degrees: number[]): string[] {
  return degrees.map((d) => chordLabel(key, d));
}

export type ChordStyle = 'sustain' | 'stabs' | 'arpeggio';

export interface ChordGenOptions {
  key: MusicalKey;
  degrees: number[];
  beatsPerChord?: number;
  style?: ChordStyle;
  velocity?: number;
}

/** Voice-led chord pitches for each chord of a progression. */
export function progressionVoicings(key: MusicalKey, degrees: number[]): number[][] {
  const result: number[][] = [];
  let prev: number[] | null = null;
  for (const d of degrees) {
    const v = voiceLeadTriad(diatonicTriad(key, d).pcs, prev);
    result.push(v);
    prev = v;
  }
  return result;
}

export function generateChordNotes(opts: ChordGenOptions): Note[] {
  const { key, degrees, beatsPerChord = 4, style = 'sustain', velocity = 0.7 } = opts;
  const voicings = progressionVoicings(key, degrees);
  const notes: Note[] = [];
  voicings.forEach((chord, i) => {
    const t0 = i * beatsPerChord;
    if (style === 'sustain') {
      for (const p of chord) notes.push(note(p, t0, beatsPerChord, velocity));
    } else if (style === 'stabs') {
      const hits = [0, 1.5, 2.5, 3];
      for (const h of hits) {
        if (h >= beatsPerChord) continue;
        for (const p of chord) notes.push(note(p, t0 + h, 0.5, velocity * (h === 0 ? 1 : 0.8)));
      }
    } else {
      const order = [chord[0], chord[1], chord[2], chord[1] + 0, chord[0] + 12, chord[2], chord[1], chord[2]];
      for (let s = 0; s < beatsPerChord * 2; s++) {
        notes.push(note(order[s % order.length], t0 + s * 0.5, 0.5, velocity * (s % 2 === 0 ? 0.9 : 0.7)));
      }
    }
  });
  return notes;
}

/* ------------------------------------------------------------------ */
/* Bass                                                                */
/* ------------------------------------------------------------------ */

export type BassStyle = 'roots' | 'pulse' | 'octaves' | 'walking';
export const BASS_STYLES: { id: BassStyle; label: string; description: string }[] = [
  { id: 'roots', label: 'Long roots', description: 'One long note per chord. Simple and solid.' },
  { id: 'pulse', label: 'Driving 8ths', description: 'Steady eighth notes on the root. Great for pop and rock.' },
  { id: 'octaves', label: 'Octave bounce', description: 'Jumps between low and high root. Disco and electronic feel.' },
  { id: 'walking', label: 'Moving line', description: 'Walks through chord tones and leads into the next chord.' },
];

export function bassRoot(key: MusicalKey, degree: number): number {
  // root between E1 (28) and D#2 (39)
  const pc = diatonicTriad(key, degree).pcs[0];
  return pitchAtOrBelow(pc, 39);
}

export function generateBassNotes(
  key: MusicalKey,
  degrees: number[],
  style: BassStyle = 'roots',
  beatsPerChord = 4,
): Note[] {
  const notes: Note[] = [];
  degrees.forEach((d, i) => {
    const t0 = i * beatsPerChord;
    const root = bassRoot(key, d);
    const triad = diatonicTriad(key, d).pcs;
    const fifth = root + (((triad[2] - triad[0]) % 12) + 12) % 12;
    const third = root + (((triad[1] - triad[0]) % 12) + 12) % 12;
    if (style === 'roots') {
      notes.push(note(root, t0, beatsPerChord, 0.85));
    } else if (style === 'pulse') {
      for (let s = 0; s < beatsPerChord * 2; s++) notes.push(note(root, t0 + s * 0.5, 0.45, s % 2 === 0 ? 0.85 : 0.65));
    } else if (style === 'octaves') {
      for (let s = 0; s < beatsPerChord * 2; s++) notes.push(note(s % 2 === 0 ? root : root + 12, t0 + s * 0.5, 0.4, 0.8));
    } else {
      const next = bassRoot(key, degrees[(i + 1) % degrees.length]);
      const approach = next > root ? next - 1 : next + 1;
      const line = [root, third, fifth, approach];
      for (let b = 0; b < beatsPerChord; b++) notes.push(note(line[b % line.length], t0 + b, 0.9, b === 0 ? 0.9 : 0.7));
    }
  });
  return notes;
}

/* ------------------------------------------------------------------ */
/* Melody                                                              */
/* ------------------------------------------------------------------ */

export interface MelodyOptions {
  key: MusicalKey;
  degrees: number[];
  beatsPerChord?: number;
  seed?: number;
  /** 0 = sparse, 1 = busy */
  density?: number;
  low?: number;
  high?: number;
}

/** Rhythm cells (start offsets, durations) covering 2 beats each. */
const RHYTHM_CELLS: { sparse: number[][][]; busy: number[][][] } = {
  sparse: [
    [[0, 2]],
    [[0, 1], [1, 1]],
    [[0, 1.5], [1.5, 0.5]],
    [[0.5, 1.5]],
  ],
  busy: [
    [[0, 0.5], [0.5, 0.5], [1, 1]],
    [[0, 0.75], [0.75, 0.75], [1.5, 0.5]],
    [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5]],
    [[0, 1], [1, 0.5], [1.5, 0.5]],
  ],
};

/**
 * Generates a singable melody: chord tones on strong beats, mostly step-wise motion,
 * always inside the key's scale. Deterministic for a given seed.
 */
export function generateMelodyNotes(opts: MelodyOptions): Note[] {
  const { key, degrees, beatsPerChord = 4, seed = 1, density = 0.5, low = 64, high = 84 } = opts;
  const rng = createRng(seed);
  const scale = scalePitchesInRange(key, low, high);
  const notes: Note[] = [];
  let current = scale[Math.floor(scale.length / 2)];
  // Repeat a 2-chord motif to make it memorable
  const motifCells: number[][][] = [];

  degrees.forEach((degree, ci) => {
    const chordPcs = diatonicTriad(key, degree).pcs;
    const chordTones = scale.filter((p) => chordPcs.includes(p % 12));
    for (let half = 0; half < beatsPerChord / 2; half++) {
      const cellIndex = ci * (beatsPerChord / 2) + half;
      let cell: number[][];
      if (cellIndex >= 2 && motifCells.length >= 2 && rng() < 0.5) {
        cell = motifCells[cellIndex % 2];
      } else {
        const pool = rng() < density ? RHYTHM_CELLS.busy : RHYTHM_CELLS.sparse;
        cell = pick(rng, pool);
      }
      if (motifCells.length < 2) motifCells.push(cell);
      // Leave some breathing room at the end of every 2nd chord
      const rest = half === beatsPerChord / 2 - 1 && ci % 2 === 1 && rng() < 0.45;
      const cellToUse = rest ? cell.slice(0, Math.max(1, cell.length - 1)) : cell;

      for (const [offset, dur] of cellToUse) {
        const t = ci * beatsPerChord + half * 2 + offset;
        const strong = Number.isInteger(t) && t % 2 === 0;
        let pitch: number;
        if (strong) {
          pitch = nearest(chordTones, current, rng);
        } else {
          const idx = scale.indexOf(nearest(scale, current, rng));
          const step = pick(rng, [-2, -1, -1, 1, 1, 2, 0]);
          pitch = scale[clamp(idx + step, 0, scale.length - 1)];
        }
        current = pitch;
        notes.push(note(pitch, t, dur, strong ? 0.85 : 0.7));
      }
    }
  });
  return notes;
}

function nearest(pool: number[], target: number, rng: () => number): number {
  let best = pool[0];
  let bestD = Infinity;
  for (const p of pool) {
    const d = Math.abs(p - target) + rng() * 2.5;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Drums                                                               */
/* ------------------------------------------------------------------ */

type DrumStyle = Genre | 'trap' | 'fill' | 'intro';

const S = (pattern: string): number[] =>
  pattern
    .replace(/\s/g, '')
    .split('')
    .map((c) => (c === 'X' ? 1 : c === 'x' ? 0.6 : c === 'o' ? 0.35 : 0));

const DRUM_STYLES: Record<DrumStyle, Partial<Record<DrumSound, string>>> = {
  'hip-hop': {
    kick: 'X... .... ..X. .... X... ...x ..X. ....',
    snare: '.... X... .... X... .... X... .... X...',
    hatClosed: 'X.x. X.x. X.x. X.x. X.x. X.x. X.x. X.xx',
    perc: '.... .... .... ...o .... .... .... ....',
  },
  trap: {
    kick: 'X... .... ..X. .... X.X. .... .... ....',
    clap: '.... .... X... .... .... .... X... ....',
    hatClosed: 'XxXx XxXx Xxxx XxXx XxXx XxXx XxXX xXxX',
    hatOpen: '.... .... .... .... .... .... .... ..X.',
  },
  pop: {
    kick: 'X... .... X... .... X... .... X..x ....',
    snare: '.... X... .... X... .... X... .... X...',
    clap: '.... X... .... X... .... X... .... X...',
    hatClosed: 'x.x. x.x. x.x. x.x. x.x. x.x. x.x. x.x.',
  },
  rock: {
    kick: 'X... .... X.X. .... X... .... X.X. ....',
    snare: '.... X... .... X... .... X... .... X..x',
    hatClosed: 'X.x. X.x. X.x. X.x. X.x. X.x. X.x. X.x.',
  },
  electronic: {
    kick: 'X... X... X... X... X... X... X... X...',
    clap: '.... X... .... X... .... X... .... X...',
    hatClosed: '..x. ..x. ..x. ..x. ..x. ..x. ..x. ..x.',
    hatOpen: '..X. ..X. ..X. ..X. ..X. ..X. ..X. ..X.',
    perc: '.... ...o .... .... .... ...o .... .o..',
  },
  ambient: {
    kick: 'X... .... .... .... .... .... X... ....',
    perc: '.... .... o... .... .... .... .... o...',
    hatClosed: '.... o... .... o... .... o... .... o...',
  },
  fill: {
    kick: 'X... .... X... .... X... X... X.X. X.X.',
    snare: '.... X... .... X... .x.x .x.x XxXx XXXX',
    hatClosed: 'X.x. X.x. X.x. X.x. .... .... .... ....',
    hatOpen: '.... .... .... .... .... .... .... ...X',
  },
  intro: {
    hatClosed: 'x.x. x.x. x.x. x.x. x.x. x.x. x.x. x.x.',
    perc: '.... .... .... ...o .... .... .... ...o',
  },
};

export const DRUM_STYLE_LABELS: Record<DrumStyle, string> = {
  'hip-hop': 'Boom-bap hip-hop',
  trap: 'Trap (rolling hats)',
  pop: 'Pop groove',
  rock: 'Rock beat',
  electronic: 'Four-on-the-floor',
  ambient: 'Sparse ambient',
  fill: 'Drum fill (transition)',
  intro: 'Intro (hats only)',
};

export function drumStyles(): DrumStyle[] {
  return Object.keys(DRUM_STYLES) as DrumStyle[];
}

export function emptyDrumRows(lengthSteps: number): DrumRow[] {
  return DRUM_SOUNDS.map((sound) => ({ sound, steps: new Array(lengthSteps).fill(0) }));
}

export function generateDrumPattern(style: DrumStyle, name?: string): DrumPattern {
  const def = DRUM_STYLES[style] ?? DRUM_STYLES.pop;
  const lengthSteps = 32;
  const rows = emptyDrumRows(lengthSteps).map((row) => {
    const src = def[row.sound];
    if (!src) return row;
    const steps = S(src);
    return { sound: row.sound, steps: Array.from({ length: lengthSteps }, (_, i) => steps[i] ?? 0) };
  });
  return { id: uid('pat'), name: name ?? DRUM_STYLE_LABELS[style] ?? 'Beat', type: 'drum', lengthSteps, rows };
}

/**
 * Creates a variation of a drum pattern: adds ghost notes, shifts a kick,
 * toggles a few hats. Never removes the backbeat (snare/clap on 2 and 4).
 */
export function varyDrumPattern(pattern: DrumPattern, seed = 7): DrumPattern {
  const rng = createRng(seed);
  const rows = pattern.rows.map((row) => {
    const steps = [...row.steps];
    if (row.sound === 'hatClosed') {
      for (let i = 0; i < steps.length; i++) if (rng() < 0.18) steps[i] = steps[i] > 0 ? 0 : 0.45;
    } else if (row.sound === 'kick') {
      const empties = steps.map((v, i) => (v === 0 && i % 4 !== 0 ? i : -1)).filter((i) => i >= 0);
      if (empties.length) steps[pick(rng, empties)] = 0.7;
    } else if (row.sound === 'snare') {
      const ghosts = steps.map((v, i) => (v === 0 && i % 2 === 1 ? i : -1)).filter((i) => i >= 0);
      if (ghosts.length && rng() < 0.8) steps[pick(rng, ghosts)] = 0.3;
    } else if (row.sound === 'perc') {
      if (rng() < 0.6) steps[steps.length - 1] = steps[steps.length - 1] > 0 ? 0 : 0.5;
    }
    return { sound: row.sound, steps };
  });
  return { ...pattern, id: uid('pat'), name: `${pattern.name} (variation)`, rows };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function note(pitch: number, start: number, duration: number, velocity: number): Note {
  return {
    id: uid('n'),
    pitch: clamp(Math.round(pitch), 0, 127),
    start: Math.round(start * 1e6) / 1e6,
    duration: Math.max(0.0625, Math.round(duration * 1e6) / 1e6),
    velocity: clamp(velocity, 0.05, 1),
  };
}

export function notePattern(name: string, lengthBeats: number, notes: Note[]): NotePattern {
  return { id: uid('pat'), name, type: 'notes', lengthBeats, notes };
}

/** Shift all notes by semitones (e.g. +12 for an octave), clamped to MIDI range. */
export function transposeNotes(notes: Note[], semitones: number): Note[] {
  return notes.map((n) => ({ ...n, id: uid('n'), pitch: clamp(n.pitch + semitones, 0, 127) }));
}

export function quantizeNotes(notes: Note[], grid: number, quantizeLength = true): Note[] {
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, Math.round(n.start / grid) * grid),
    duration: quantizeLength ? Math.max(grid, Math.round(n.duration / grid) * grid) : n.duration,
  }));
}
