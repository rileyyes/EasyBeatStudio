import type { DrumPattern, DrumSound, NotePattern, Pattern, Project, Track } from '../types';
import { beatsPerBar, patternLengthBeats } from '../project/schema';

export interface NoteEvent {
  type: 'note';
  trackId: string;
  beat: number;
  durationBeats: number;
  pitch: number;
  velocity: number;
}

export interface DrumEvent {
  type: 'drum';
  trackId: string;
  beat: number;
  sound: DrumSound;
  velocity: number;
}

export interface SampleEvent {
  type: 'sample';
  trackId: string;
  beat: number;
  sampleId: string;
  /** how far into the sample to start (beats) — non-zero when playback starts mid-clip */
  offsetBeats: number;
  durationBeats: number;
}

export type MusicEvent = NoteEvent | DrumEvent | SampleEvent;

/** Max swing delay (at swing = 0.75) is a triplet feel: 1/12 beat. */
export function swingOffsetBeats(stepIndex: number, swing: number): number {
  return stepIndex % 2 === 1 ? swing * (1 / 9) : 0;
}

/** Tracks that should be heard, honouring mute and solo. */
export function audibleTrackIds(tracks: Track[]): Set<string> {
  const anySolo = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => !t.mute && (!anySolo || t.solo)).map((t) => t.id));
}

/**
 * Events of one pattern placed at `offsetBeat`, looping inside [regionStart, regionEnd),
 * restricted to the window [from, to).
 */
export function patternEvents(
  pattern: Pattern,
  trackId: string,
  regionStart: number,
  regionEnd: number,
  from: number,
  to: number,
  swing: number,
): MusicEvent[] {
  const out: MusicEvent[] = [];
  const len = patternLengthBeats(pattern);
  if (len <= 0) return out;
  const lo = Math.max(from, regionStart);
  const hi = Math.min(to, regionEnd);
  if (hi <= lo) return out;
  const firstRep = Math.max(0, Math.floor((lo - regionStart) / len) - 1);
  const lastRep = Math.floor((hi - regionStart) / len);
  for (let rep = firstRep; rep <= lastRep; rep++) {
    const base = regionStart + rep * len;
    if (pattern.type === 'drum') {
      pushDrumEvents(pattern, trackId, base, lo, hi, regionEnd, swing, out);
    } else {
      pushNoteEvents(pattern, trackId, base, len, lo, hi, regionEnd, out);
    }
  }
  return out;
}

function pushDrumEvents(
  pattern: DrumPattern,
  trackId: string,
  base: number,
  lo: number,
  hi: number,
  regionEnd: number,
  swing: number,
  out: MusicEvent[],
) {
  for (const row of pattern.rows) {
    for (let i = 0; i < pattern.lengthSteps; i++) {
      const v = row.steps[i];
      if (!v) continue;
      const nominal = base + i * 0.25;
      if (nominal >= regionEnd) break;
      const beat = nominal + swingOffsetBeats(i, swing);
      // window membership is decided by the un-swung grid position so no hit is lost or doubled
      if (nominal >= lo && nominal < hi) out.push({ type: 'drum', trackId, beat, sound: row.sound, velocity: v });
    }
  }
}

function pushNoteEvents(
  pattern: NotePattern,
  trackId: string,
  base: number,
  len: number,
  lo: number,
  hi: number,
  regionEnd: number,
  out: MusicEvent[],
) {
  for (const n of pattern.notes) {
    if (n.start >= len) continue;
    const beat = base + n.start;
    if (beat < lo || beat >= hi || beat >= regionEnd) continue;
    const end = Math.min(beat + n.duration, base + len, regionEnd);
    out.push({ type: 'note', trackId, beat, durationBeats: Math.max(0.01, end - beat), pitch: n.pitch, velocity: n.velocity });
  }
}

export interface CollectOptions {
  /** true for the first window after playback starts (or loops): includes samples already in progress */
  isStart?: boolean;
  /** ignore mute/solo (used for e.g. stems in the future) */
  ignoreMuteSolo?: boolean;
}

/** All arrangement events whose start beat is in [from, to), sorted by beat. */
export function collectArrangementEvents(project: Project, from: number, to: number, opts: CollectOptions = {}): MusicEvent[] {
  const bpb = beatsPerBar(project);
  const audible = opts.ignoreMuteSolo ? new Set(project.tracks.map((t) => t.id)) : audibleTrackIds(project.tracks);
  const patterns = new Map(project.patterns.map((p) => [p.id, p]));
  const samples = new Map(project.samples.map((s) => [s.id, s]));
  const out: MusicEvent[] = [];
  for (const clip of project.clips) {
    if (!audible.has(clip.trackId)) continue;
    const start = clip.startBar * bpb;
    const end = (clip.startBar + clip.lengthBars) * bpb;
    if (end <= from || start >= to) continue;
    if (clip.patternId) {
      const pattern = patterns.get(clip.patternId);
      if (pattern) out.push(...patternEvents(pattern, clip.trackId, start, end, from, to, project.swing));
    } else if (clip.sampleId && samples.has(clip.sampleId)) {
      if (start >= from && start < to) {
        out.push({ type: 'sample', trackId: clip.trackId, beat: start, sampleId: clip.sampleId, offsetBeats: 0, durationBeats: end - start });
      } else if (opts.isStart && start < from && end > from) {
        out.push({ type: 'sample', trackId: clip.trackId, beat: from, sampleId: clip.sampleId, offsetBeats: from - start, durationBeats: end - from });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** Events for previewing a single pattern on loop (Beat Maker / Piano Roll). */
export function collectPatternPreviewEvents(project: Project, patternId: string, trackId: string, from: number, to: number): MusicEvent[] {
  const pattern = project.patterns.find((p) => p.id === patternId);
  if (!pattern) return [];
  const len = patternLengthBeats(pattern);
  // A huge region: the transport loops it every `len` beats.
  return patternEvents(pattern, trackId, 0, len, from, to, project.swing);
}
