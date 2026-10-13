import type { Clip, Genre, InstrumentId, Mood, MusicalKey, Project, Section, SectionKind } from '../types';
import { createEmptyProject } from '../project/schema';
import { uid } from '../util';
import {
  type BassStyle,
  type ChordStyle,
  generateBassNotes,
  generateChordNotes,
  generateDrumPattern,
  generateMelodyNotes,
  notePattern,
  PROGRESSIONS,
  progressionLabels,
  varyDrumPattern,
} from './generators';

export interface GenreTemplate {
  genre: Genre;
  label: string;
  tagline: string;
  bpm: number;
  key: MusicalKey;
  mood: Mood;
  progressionId: string;
  chordStyle: ChordStyle;
  bassStyle: BassStyle;
  drumStyle: Parameters<typeof generateDrumPattern>[0];
  swing: number;
  instruments: { chords: InstrumentId; melody: InstrumentId };
}

export const TEMPLATES: GenreTemplate[] = [
  {
    genre: 'hip-hop', label: 'Hip-Hop', tagline: 'Dusty boom-bap drums, moody keys, deep bass.',
    bpm: 88, key: { tonic: 'A', mode: 'minor' }, mood: 'dark', progressionId: 'dark-1',
    chordStyle: 'sustain', bassStyle: 'roots', drumStyle: 'hip-hop', swing: 0.25,
    instruments: { chords: 'keys', melody: 'bell' },
  },
  {
    genre: 'pop', label: 'Pop', tagline: 'Bright chords, catchy lead and a punchy groove.',
    bpm: 112, key: { tonic: 'C', mode: 'major' }, mood: 'happy', progressionId: 'happy-1',
    chordStyle: 'stabs', bassStyle: 'pulse', drumStyle: 'pop', swing: 0,
    instruments: { chords: 'keys', melody: 'pluck' },
  },
  {
    genre: 'rock', label: 'Rock', tagline: 'Driving drums, steady bass and power chords.',
    bpm: 124, key: { tonic: 'E', mode: 'major' }, mood: 'energetic', progressionId: 'energy-3',
    chordStyle: 'stabs', bassStyle: 'pulse', drumStyle: 'rock', swing: 0,
    instruments: { chords: 'pluck', melody: 'lead' },
  },
  {
    genre: 'electronic', label: 'Electronic', tagline: 'Four-on-the-floor kick, bouncing bass, big pads.',
    bpm: 124, key: { tonic: 'F', mode: 'minor' }, mood: 'energetic', progressionId: 'energy-2',
    chordStyle: 'sustain', bassStyle: 'octaves', drumStyle: 'electronic', swing: 0,
    instruments: { chords: 'pad', melody: 'pluck' },
  },
  {
    genre: 'ambient', label: 'Ambient', tagline: 'Slow, spacious pads and gentle bells.',
    bpm: 72, key: { tonic: 'D', mode: 'major' }, mood: 'chill', progressionId: 'chill-2',
    chordStyle: 'sustain', bassStyle: 'roots', drumStyle: 'ambient', swing: 0,
    instruments: { chords: 'pad', melody: 'bell' },
  },
];

export function getTemplate(genre: Genre): GenreTemplate {
  return TEMPLATES.find((t) => t.genre === genre) ?? TEMPLATES[1];
}

const SONG_FORM: { kind: SectionKind; bars: number }[] = [
  { kind: 'intro', bars: 4 },
  { kind: 'verse', bars: 8 },
  { kind: 'chorus', bars: 8 },
  { kind: 'verse', bars: 8 },
  { kind: 'chorus', bars: 8 },
  { kind: 'outro', bars: 4 },
];

/**
 * Builds a complete, playable starter song for a genre: drums, bass, chords, melody,
 * arranged into intro / verse / chorus / outro. Everything stays editable.
 */
export function createProjectFromTemplate(genre: Genre, name?: string, seed = 42): Project {
  const t = getTemplate(genre);
  const preset = PROGRESSIONS[t.mood].find((p) => p.id === t.progressionId) ?? PROGRESSIONS[t.mood][0];
  const key: MusicalKey = { tonic: t.key.tonic, mode: preset.mode };
  const project = createEmptyProject({ name: name ?? `My ${t.label} Song`, genre, mood: t.mood, bpm: t.bpm, key });
  project.swing = t.swing;

  const [drums, bass, chords, melody] = project.tracks;
  chords.instrument = t.instruments.chords;
  melody.instrument = t.instruments.melody;

  const degrees = preset.degrees;
  const progLength = degrees.length * 4; // beats (one bar per chord)
  project.progression = { degrees, mood: t.mood, labels: progressionLabels(key, degrees) };

  const mainBeat = generateDrumPattern(t.drumStyle, 'Main beat');
  const chorusBeat = varyDrumPattern(mainBeat, seed);
  chorusBeat.name = 'Chorus beat';
  const introBeat = generateDrumPattern(genre === 'ambient' ? 'ambient' : 'intro', 'Intro beat');
  const fill = generateDrumPattern('fill', 'Fill');

  const chordPat = notePattern('Chords', progLength, generateChordNotes({ key, degrees, style: t.chordStyle }));
  const padPat = notePattern('Chords (long)', progLength, generateChordNotes({ key, degrees, style: 'sustain', velocity: 0.55 }));
  const bassPat = notePattern('Bassline', progLength, generateBassNotes(key, degrees, t.bassStyle));
  const melodyPat = notePattern('Chorus melody', progLength, generateMelodyNotes({ key, degrees, seed, density: genre === 'ambient' ? 0.2 : 0.55 }));

  project.patterns.push(mainBeat, chorusBeat, introBeat, fill, chordPat, padPat, bassPat, melodyPat);

  const clips: Clip[] = [];
  const sections: Section[] = [];
  const add = (trackId: string, patternId: string, startBar: number, lengthBars: number) =>
    clips.push({ id: uid('clp'), trackId, patternId, startBar, lengthBars });

  let bar = 0;
  for (const part of SONG_FORM) {
    sections.push({ id: uid('sec'), kind: part.kind, name: part.kind[0].toUpperCase() + part.kind.slice(1), startBar: bar, lengthBars: part.bars });
    switch (part.kind) {
      case 'intro':
        add(drums.id, introBeat.id, bar, part.bars);
        add(chords.id, padPat.id, bar, part.bars);
        break;
      case 'verse':
        add(drums.id, mainBeat.id, bar, part.bars - 1);
        add(drums.id, fill.id, bar + part.bars - 1, 1);
        add(bass.id, bassPat.id, bar, part.bars);
        add(chords.id, chordPat.id, bar, part.bars);
        break;
      case 'chorus':
        add(drums.id, chorusBeat.id, bar, part.bars);
        add(bass.id, bassPat.id, bar, part.bars);
        add(chords.id, chordPat.id, bar, part.bars);
        add(melody.id, melodyPat.id, bar, part.bars);
        break;
      case 'outro':
        add(chords.id, padPat.id, bar, part.bars);
        add(drums.id, introBeat.id, bar, 2);
        break;
      default:
        break;
    }
    bar += part.bars;
  }
  project.clips = clips;
  project.sections = sections;
  project.loop = { enabled: false, startBar: 4, endBar: 12 };
  return project;
}
