/**
 * EasyBeat Studio project data model.
 *
 * Time is measured in BEATS (quarter notes) inside patterns, and in BARS on the
 * arrangement timeline. One bar = `timeSignature[0]` beats (the denominator is
 * treated as a quarter note in this version).
 */

export type Genre = 'hip-hop' | 'pop' | 'rock' | 'electronic' | 'ambient';
export type Mood = 'happy' | 'emotional' | 'dark' | 'chill' | 'energetic' | 'epic';
export type Mode = 'major' | 'minor';
export type PitchClassName =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export interface MusicalKey {
  tonic: PitchClassName;
  mode: Mode;
}

export type DrumSound = 'kick' | 'snare' | 'clap' | 'hatClosed' | 'hatOpen' | 'perc';
export const DRUM_SOUNDS: DrumSound[] = ['kick', 'snare', 'clap', 'hatClosed', 'hatOpen', 'perc'];

export type InstrumentId =
  | 'drumkit'
  | 'keys'
  | 'pad'
  | 'lead'
  | 'bass'
  | 'pluck'
  | 'bell'
  | 'sampler';

export type TrackKind = 'drums' | 'bass' | 'chords' | 'melody' | 'vocals' | 'instrument';

export interface TrackEffects {
  /** Reverb send amount, 0..1 */
  reverb: number;
  /** Delay send amount, 0..1 */
  delay: number;
  /** EQ gains in dB, -12..12 */
  eqLow: number;
  eqMid: number;
  eqHigh: number;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  instrument: InstrumentId;
  color: string;
  /** 0..1.2 linear gain */
  volume: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mute: boolean;
  solo: boolean;
  effects: TrackEffects;
}

export interface Note {
  id: string;
  /** MIDI pitch 0..127 */
  pitch: number;
  /** start, in beats from pattern start */
  start: number;
  /** duration, in beats */
  duration: number;
  /** 0..1 */
  velocity: number;
}

export interface DrumRow {
  sound: DrumSound;
  /** velocity per step, 0 = off, (0..1] = hit */
  steps: number[];
}

export interface DrumPattern {
  id: string;
  name: string;
  type: 'drum';
  /** number of 16th-note steps */
  lengthSteps: number;
  rows: DrumRow[];
}

export interface NotePattern {
  id: string;
  name: string;
  type: 'notes';
  /** pattern length in beats */
  lengthBeats: number;
  notes: Note[];
}

export type Pattern = DrumPattern | NotePattern;

export interface Clip {
  id: string;
  trackId: string;
  /** a clip references either a pattern or an imported/recorded sample */
  patternId?: string;
  sampleId?: string;
  /** 0-based bar index on the timeline */
  startBar: number;
  lengthBars: number;
}

export type SectionKind = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'drop' | 'outro';
export const SECTION_KINDS: SectionKind[] = ['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'drop', 'outro'];

export interface Section {
  id: string;
  kind: SectionKind;
  name: string;
  startBar: number;
  lengthBars: number;
}

export interface SampleRef {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: number;
}

/** A chord progression as saved in the project (so it can be regenerated or explained). */
export interface ChordProgressionInfo {
  degrees: number[];
  mood: Mood;
  /** human readable labels, e.g. "Am", "F" */
  labels: string[];
}

export interface Project {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  genre: Genre | 'blank';
  mood: Mood;
  bpm: number;
  timeSignature: [number, number];
  key: MusicalKey;
  /** 0..0.75 – delays every second 16th-note */
  swing: number;
  masterVolume: number;
  loop: { enabled: boolean; startBar: number; endBar: number };
  tracks: Track[];
  patterns: Pattern[];
  clips: Clip[];
  sections: Section[];
  samples: SampleRef[];
  progression?: ChordProgressionInfo;
}

export interface ProjectSummary {
  id: string;
  name: string;
  genre: Project['genre'];
  bpm: number;
  updatedAt: number;
  createdAt: number;
}
