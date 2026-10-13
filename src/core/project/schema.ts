import type {
  Clip,
  DrumPattern,
  DrumRow,
  Genre,
  InstrumentId,
  Mood,
  MusicalKey,
  Note,
  NotePattern,
  Pattern,
  Project,
  SampleRef,
  Section,
  SectionKind,
  Track,
  TrackEffects,
  TrackKind,
} from '../types';
import { DRUM_SOUNDS, SECTION_KINDS } from '../types';
import { NOTE_NAMES } from '../music/theory';
import { clamp, sanitizeName, uid } from '../util';

/**
 * Version of the saved project format. Bump this and add a migration in
 * MIGRATIONS whenever the shape of saved projects changes.
 */
export const PROJECT_FORMAT_VERSION = 1;

export const LIMITS = {
  bpmMin: 40,
  bpmMax: 240,
  maxTracks: 32,
  maxBars: 512,
  maxNotesPerPattern: 4096,
  maxPatterns: 256,
  maxClips: 2048,
} as const;

export const TRACK_COLORS = ['#ff7a59', '#ffb347', '#7c6cff', '#3fd0c9', '#ff5fa2', '#9be15d', '#5ab0ff', '#f2d45c'];

export const INSTRUMENTS: { id: InstrumentId; label: string; description: string; forKinds: TrackKind[] }[] = [
  { id: 'drumkit', label: 'Drum Kit', description: 'Synthesized kick, snare, clap, hats and percussion.', forKinds: ['drums'] },
  { id: 'keys', label: 'Soft Keys', description: 'Warm electric-piano style keys. Great for chords.', forKinds: ['chords', 'melody', 'instrument'] },
  { id: 'pad', label: 'Dream Pad', description: 'Slow, wide, atmospheric pad for background chords.', forKinds: ['chords', 'instrument'] },
  { id: 'lead', label: 'Bright Lead', description: 'Cutting synth lead for melodies.', forKinds: ['melody', 'instrument'] },
  { id: 'pluck', label: 'Pluck', description: 'Short, bouncy pluck for melodies and arpeggios.', forKinds: ['melody', 'chords', 'instrument'] },
  { id: 'bell', label: 'Glass Bell', description: 'Shimmering bell tone for melodies.', forKinds: ['melody', 'instrument'] },
  { id: 'bass', label: 'Deep Bass', description: 'Round sub bass with a little grit.', forKinds: ['bass'] },
  { id: 'sampler', label: 'Audio Clips', description: 'Plays imported or recorded audio.', forKinds: ['vocals'] },
];

export const DEFAULT_EFFECTS: TrackEffects = { reverb: 0.1, delay: 0, eqLow: 0, eqMid: 0, eqHigh: 0 };

export function defaultInstrumentFor(kind: TrackKind): InstrumentId {
  switch (kind) {
    case 'drums':
      return 'drumkit';
    case 'bass':
      return 'bass';
    case 'chords':
      return 'keys';
    case 'melody':
      return 'lead';
    case 'vocals':
      return 'sampler';
    default:
      return 'pluck';
  }
}

export function createTrack(kind: TrackKind, name: string, index: number, instrument?: InstrumentId): Track {
  return {
    id: uid('trk'),
    name,
    kind,
    instrument: instrument ?? defaultInstrumentFor(kind),
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    volume: kind === 'drums' ? 0.85 : kind === 'bass' ? 0.8 : 0.7,
    pan: 0,
    mute: false,
    solo: false,
    effects: { ...DEFAULT_EFFECTS, reverb: kind === 'chords' || kind === 'melody' ? 0.2 : kind === 'vocals' ? 0.15 : 0.05 },
  };
}

export function defaultTracks(): Track[] {
  const kinds: [TrackKind, string][] = [
    ['drums', 'Drums'],
    ['bass', 'Bass'],
    ['chords', 'Chords'],
    ['melody', 'Melody'],
    ['vocals', 'Vocals / Audio'],
  ];
  return kinds.map(([k, n], i) => createTrack(k, n, i));
}

export interface NewProjectOptions {
  name?: string;
  genre?: Genre | 'blank';
  mood?: Mood;
  bpm?: number;
  key?: MusicalKey;
}

export function createEmptyProject(opts: NewProjectOptions = {}): Project {
  const now = Date.now();
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: uid('prj'),
    name: sanitizeName(opts.name, 'Untitled Song'),
    createdAt: now,
    updatedAt: now,
    genre: opts.genre ?? 'blank',
    mood: opts.mood ?? 'happy',
    bpm: clamp(opts.bpm ?? 100, LIMITS.bpmMin, LIMITS.bpmMax),
    timeSignature: [4, 4],
    key: opts.key ?? { tonic: 'C', mode: 'major' },
    swing: 0,
    masterVolume: 0.85,
    loop: { enabled: false, startBar: 0, endBar: 4 },
    tracks: defaultTracks(),
    patterns: [],
    clips: [],
    sections: [],
    samples: [],
  };
}

/* ------------------------------------------------------------------ */
/* Derived values                                                       */
/* ------------------------------------------------------------------ */

export function beatsPerBar(project: Pick<Project, 'timeSignature'>): number {
  return project.timeSignature[0];
}

/** Length of the arrangement in bars (end of last clip or section), minimum 1. */
export function songLengthBars(project: Project): number {
  let end = 0;
  for (const c of project.clips) end = Math.max(end, c.startBar + c.lengthBars);
  for (const s of project.sections) end = Math.max(end, s.startBar + s.lengthBars);
  return Math.max(1, end);
}

export function patternLengthBeats(pattern: Pattern): number {
  return pattern.type === 'drum' ? pattern.lengthSteps / 4 : pattern.lengthBeats;
}

/* ------------------------------------------------------------------ */
/* Validation / normalization / migration                              */
/* ------------------------------------------------------------------ */

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

const TRACK_KINDS: TrackKind[] = ['drums', 'bass', 'chords', 'melody', 'vocals', 'instrument'];
const INSTRUMENT_IDS = INSTRUMENTS.map((i) => i.id);
const GENRES: (Genre | 'blank')[] = ['hip-hop', 'pop', 'rock', 'electronic', 'ambient', 'blank'];
const MOOD_LIST: Mood[] = ['happy', 'emotional', 'dark', 'chill', 'energetic', 'epic'];

/**
 * Migrations from version N to N+1. Each receives raw JSON and returns raw JSON.
 * Version 0 = projects from before the format was versioned (no formatVersion field).
 */
const MIGRATIONS: Record<number, (raw: Json) => Json> = {
  0: (raw) => {
    // v0 stored `tempo` instead of `bpm` and had no loop/sections fields.
    const next: Json = { ...raw };
    if (next.bpm === undefined && typeof next.tempo === 'number') next.bpm = next.tempo;
    delete next.tempo;
    next.formatVersion = 1;
    return next;
  },
};

export function migrateProjectJson(raw: unknown): Json {
  if (!isObj(raw)) throw new ProjectFormatError('This file is not an EasyBeat project.');
  let data: Json = raw;
  let version = typeof data.formatVersion === 'number' ? data.formatVersion : 0;
  if (version > PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError(
      `This project was saved by a newer version of EasyBeat Studio (format ${version}). Please update the app to open it.`,
    );
  }
  while (version < PROJECT_FORMAT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new ProjectFormatError(`No upgrade path for project format ${version}.`);
    data = migrate(data);
    version += 1;
  }
  return data;
}

function normalizeNote(raw: unknown): Note | null {
  if (!isObj(raw)) return null;
  const pitch = num(raw.pitch, NaN);
  const start = num(raw.start, NaN);
  const duration = num(raw.duration, NaN);
  if (!Number.isFinite(pitch) || !Number.isFinite(start) || !Number.isFinite(duration)) return null;
  if (start < 0 || duration <= 0) return null;
  return {
    id: str(raw.id, uid('n')),
    pitch: clamp(Math.round(pitch), 0, 127),
    start,
    duration: Math.min(duration, 4096),
    velocity: num(raw.velocity, 0.8, 0.05, 1),
  };
}

function normalizePattern(raw: unknown): Pattern | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, uid('pat'));
  const name = sanitizeName(raw.name, 'Pattern');
  if (raw.type === 'drum') {
    const lengthSteps = Math.round(num(raw.lengthSteps, 16, 4, 64));
    const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
    const rows: DrumRow[] = DRUM_SOUNDS.map((sound) => {
      const found = rawRows.find((r) => isObj(r) && r.sound === sound) as Json | undefined;
      const steps = Array.isArray(found?.steps) ? (found!.steps as unknown[]) : [];
      return { sound, steps: Array.from({ length: lengthSteps }, (_, i) => num(steps[i], 0, 0, 1)) };
    });
    const p: DrumPattern = { id, name, type: 'drum', lengthSteps, rows };
    return p;
  }
  if (raw.type === 'notes') {
    const notes = (Array.isArray(raw.notes) ? raw.notes : [])
      .slice(0, LIMITS.maxNotesPerPattern)
      .map(normalizeNote)
      .filter((n): n is Note => n !== null);
    const p: NotePattern = { id, name, type: 'notes', lengthBeats: num(raw.lengthBeats, 16, 1, 1024), notes };
    return p;
  }
  return null;
}

function normalizeTrack(raw: unknown, index: number): Track | null {
  if (!isObj(raw)) return null;
  const kind = oneOf(raw.kind, TRACK_KINDS, 'instrument');
  const fx = isObj(raw.effects) ? raw.effects : {};
  return {
    id: str(raw.id, uid('trk')),
    name: sanitizeName(raw.name, `Track ${index + 1}`),
    kind,
    instrument: oneOf(raw.instrument, INSTRUMENT_IDS, defaultInstrumentFor(kind)),
    color: typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : TRACK_COLORS[index % TRACK_COLORS.length],
    volume: num(raw.volume, 0.75, 0, 1.2),
    pan: num(raw.pan, 0, -1, 1),
    mute: bool(raw.mute, false),
    solo: bool(raw.solo, false),
    effects: {
      reverb: num(fx.reverb, 0, 0, 1),
      delay: num(fx.delay, 0, 0, 1),
      eqLow: num(fx.eqLow, 0, -12, 12),
      eqMid: num(fx.eqMid, 0, -12, 12),
      eqHigh: num(fx.eqHigh, 0, -12, 12),
    },
  };
}

/**
 * Validates and normalizes any raw JSON (from IndexedDB or an imported backup) into a
 * safe Project. Upgrades older formats. Out-of-range values are clamped, broken
 * entries dropped, and dangling references removed — instead of crashing the app.
 */
export function normalizeProject(input: unknown): Project {
  const raw = migrateProjectJson(input);
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : [])
    .slice(0, LIMITS.maxTracks)
    .map(normalizeTrack)
    .filter((t): t is Track => t !== null);
  const patterns = (Array.isArray(raw.patterns) ? raw.patterns : [])
    .slice(0, LIMITS.maxPatterns)
    .map(normalizePattern)
    .filter((p): p is Pattern => p !== null);
  const samples: SampleRef[] = (Array.isArray(raw.samples) ? raw.samples : [])
    .filter(isObj)
    .map((s) => ({
      id: str(s.id, uid('smp')),
      name: sanitizeName(s.name, 'Sample', 120),
      mimeType: str(s.mimeType, 'audio/wav'),
      sizeBytes: num(s.sizeBytes, 0, 0),
      durationSec: num(s.durationSec, 0, 0),
      createdAt: num(s.createdAt, Date.now()),
    }));
  const trackIds = new Set(tracks.map((t) => t.id));
  const patternIds = new Set(patterns.map((p) => p.id));
  const sampleIds = new Set(samples.map((s) => s.id));
  const clips: Clip[] = (Array.isArray(raw.clips) ? raw.clips : [])
    .slice(0, LIMITS.maxClips)
    .filter(isObj)
    .map((c) => ({
      id: str(c.id, uid('clp')),
      trackId: str(c.trackId, ''),
      patternId: typeof c.patternId === 'string' ? c.patternId : undefined,
      sampleId: typeof c.sampleId === 'string' ? c.sampleId : undefined,
      startBar: Math.round(num(c.startBar, 0, 0, LIMITS.maxBars)),
      lengthBars: Math.round(num(c.lengthBars, 1, 1, LIMITS.maxBars)),
    }))
    .filter(
      (c) =>
        trackIds.has(c.trackId) &&
        ((c.patternId !== undefined && patternIds.has(c.patternId)) || (c.sampleId !== undefined && sampleIds.has(c.sampleId))),
    );
  const sections: Section[] = (Array.isArray(raw.sections) ? raw.sections : []).filter(isObj).map((s) => {
    const kind = oneOf<SectionKind>(s.kind, SECTION_KINDS, 'verse');
    return {
      id: str(s.id, uid('sec')),
      kind,
      name: sanitizeName(s.name, kind),
      startBar: Math.round(num(s.startBar, 0, 0, LIMITS.maxBars)),
      lengthBars: Math.round(num(s.lengthBars, 4, 1, LIMITS.maxBars)),
    };
  });
  const keyRaw = isObj(raw.key) ? raw.key : {};
  const ts = Array.isArray(raw.timeSignature) ? raw.timeSignature : [4, 4];
  const loopRaw = isObj(raw.loop) ? raw.loop : {};
  const loopStart = Math.round(num(loopRaw.startBar, 0, 0, LIMITS.maxBars));
  const progRaw = isObj(raw.progression) ? raw.progression : null;

  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: str(raw.id, uid('prj')),
    name: sanitizeName(raw.name, 'Untitled Song'),
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
    genre: oneOf(raw.genre, GENRES, 'blank'),
    mood: oneOf(raw.mood, MOOD_LIST, 'happy'),
    bpm: num(raw.bpm, 100, LIMITS.bpmMin, LIMITS.bpmMax),
    timeSignature: [Math.round(num(ts[0], 4, 2, 7)), 4],
    key: { tonic: oneOf(keyRaw.tonic, NOTE_NAMES, 'C'), mode: oneOf(keyRaw.mode, ['major', 'minor'] as const, 'major') },
    swing: num(raw.swing, 0, 0, 0.75),
    masterVolume: num(raw.masterVolume, 0.85, 0, 1.2),
    loop: {
      enabled: bool(loopRaw.enabled, false),
      startBar: loopStart,
      endBar: Math.max(loopStart + 1, Math.round(num(loopRaw.endBar, loopStart + 4, 1, LIMITS.maxBars))),
    },
    tracks,
    patterns,
    clips,
    sections,
    samples,
    progression:
      progRaw && Array.isArray(progRaw.degrees)
        ? {
            degrees: (progRaw.degrees as unknown[]).map((d) => Math.round(num(d, 1, 1, 7))).slice(0, 16),
            mood: oneOf(progRaw.mood, MOOD_LIST, 'happy'),
            labels: (Array.isArray(progRaw.labels) ? progRaw.labels : []).map((l) => str(l, '?')).slice(0, 16),
          }
        : undefined,
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify({ ...project, formatVersion: PROJECT_FORMAT_VERSION });
}

export function deserializeProject(json: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ProjectFormatError('The project file is damaged (it is not valid JSON).');
  }
  return normalizeProject(parsed);
}
