/**
 * Editing operations on a project DRAFT (a cloned project that may be mutated).
 * The UI wraps every call in `commit(label, draft => op(draft, ...))` so each one is undoable.
 */
import type { Clip, DrumPattern, InstrumentId, NotePattern, Pattern, Project, SectionKind, Track, TrackKind } from '../types';
import { LIMITS, createTrack, patternLengthBeats, songLengthBars, beatsPerBar } from './schema';
import { clamp, deepClone, uid } from '../util';

export function getTrack(p: Project, trackId: string): Track | undefined {
  return p.tracks.find((t) => t.id === trackId);
}

export function findTrackByKind(p: Project, kind: TrackKind): Track | undefined {
  return p.tracks.find((t) => t.kind === kind);
}

export function ensureTrack(p: Project, kind: TrackKind, name?: string, instrument?: InstrumentId): Track {
  const existing = findTrackByKind(p, kind);
  if (existing) return existing;
  return addTrack(p, kind, name, instrument);
}

export function addTrack(p: Project, kind: TrackKind, name?: string, instrument?: InstrumentId): Track {
  if (p.tracks.length >= LIMITS.maxTracks) throw new Error(`A project can have at most ${LIMITS.maxTracks} tracks.`);
  const label = name ?? kind[0].toUpperCase() + kind.slice(1);
  const t = createTrack(kind, label, p.tracks.length, instrument);
  p.tracks.push(t);
  return t;
}

export function removeTrack(p: Project, trackId: string): void {
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  p.clips = p.clips.filter((c) => c.trackId !== trackId);
}

export function getPattern(p: Project, patternId: string | undefined): Pattern | undefined {
  return patternId ? p.patterns.find((x) => x.id === patternId) : undefined;
}

export function addPattern<T extends Pattern>(p: Project, pattern: T): T {
  if (p.patterns.length >= LIMITS.maxPatterns) throw new Error(`A project can have at most ${LIMITS.maxPatterns} patterns.`);
  p.patterns.push(pattern);
  return pattern;
}

export function duplicatePattern(p: Project, patternId: string): Pattern | undefined {
  const src = getPattern(p, patternId);
  if (!src) return undefined;
  const copy = deepClone(src);
  copy.id = uid('pat');
  copy.name = `${src.name} copy`;
  if (copy.type === 'notes') copy.notes = copy.notes.map((n) => ({ ...n, id: uid('n') }));
  return addPattern(p, copy);
}

export function removePattern(p: Project, patternId: string): void {
  p.patterns = p.patterns.filter((x) => x.id !== patternId);
  p.clips = p.clips.filter((c) => c.patternId !== patternId);
}

/** Patterns used by (or compatible with) a track: drum patterns for drum tracks, note patterns otherwise. */
export function patternsForTrack(p: Project, track: Track): Pattern[] {
  return p.patterns.filter((x) => (track.kind === 'drums' ? x.type === 'drum' : x.type === 'notes'));
}

/** Bars needed to play a pattern once (rounded up). */
export function patternBars(p: Project, pattern: Pattern): number {
  return Math.max(1, Math.ceil(patternLengthBeats(pattern) / beatsPerBar(p) - 1e-9));
}

/**
 * Makes room for a clip on [start, end) of a track: clips fully inside are removed,
 * partially overlapping clips are trimmed, and a clip spanning the range is split.
 */
export function clearRange(p: Project, trackId: string, start: number, end: number, exceptId?: string): void {
  const result: Clip[] = [];
  for (const c of p.clips) {
    if (c.trackId !== trackId || c.id === exceptId) {
      result.push(c);
      continue;
    }
    const cs = c.startBar;
    const ce = c.startBar + c.lengthBars;
    if (ce <= start || cs >= end) {
      result.push(c);
    } else if (cs >= start && ce <= end) {
      // fully covered → removed
    } else if (cs < start && ce > end) {
      result.push({ ...c, lengthBars: start - cs });
      result.push({ ...c, id: uid('clp'), startBar: end, lengthBars: ce - end });
    } else if (cs < start) {
      result.push({ ...c, lengthBars: start - cs });
    } else {
      result.push({ ...c, startBar: end, lengthBars: ce - end });
    }
  }
  p.clips = result;
}

export function addClip(
  p: Project,
  clip: { trackId: string; patternId?: string; sampleId?: string; startBar: number; lengthBars: number },
): Clip {
  if (p.clips.length >= LIMITS.maxClips) throw new Error('This project has too many clips.');
  const c: Clip = {
    id: uid('clp'),
    trackId: clip.trackId,
    patternId: clip.patternId,
    sampleId: clip.sampleId,
    startBar: clamp(Math.round(clip.startBar), 0, LIMITS.maxBars - 1),
    lengthBars: clamp(Math.round(clip.lengthBars), 1, LIMITS.maxBars),
  };
  clearRange(p, c.trackId, c.startBar, c.startBar + c.lengthBars);
  p.clips.push(c);
  return c;
}

export function moveClip(p: Project, clipId: string, startBar: number, trackId?: string): void {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  if (trackId && trackId !== c.trackId) {
    const from = getTrack(p, c.trackId);
    const to = getTrack(p, trackId);
    if (!from || !to) return;
    // Only move between compatible tracks (drum patterns to drum tracks, notes to melodic tracks)
    const pat = getPattern(p, c.patternId);
    if (pat && (pat.type === 'drum') !== (to.kind === 'drums')) return;
    if (c.sampleId && to.kind !== 'vocals' && to.instrument !== 'sampler') return;
    c.trackId = trackId;
  }
  c.startBar = clamp(Math.round(startBar), 0, LIMITS.maxBars - 1);
  clearRange(p, c.trackId, c.startBar, c.startBar + c.lengthBars, c.id);
}

export function resizeClip(p: Project, clipId: string, lengthBars: number): void {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  c.lengthBars = clamp(Math.round(lengthBars), 1, LIMITS.maxBars);
  clearRange(p, c.trackId, c.startBar, c.startBar + c.lengthBars, c.id);
}

export function duplicateClip(p: Project, clipId: string): Clip | undefined {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return undefined;
  return addClip(p, { ...c, startBar: c.startBar + c.lengthBars });
}

export function removeClip(p: Project, clipId: string): void {
  p.clips = p.clips.filter((c) => c.id !== clipId);
}

/** Bars covered by sections of the given kinds, or the whole song if there are no sections. */
export function targetRanges(p: Project, kinds?: SectionKind[]): { startBar: number; lengthBars: number }[] {
  const secs = p.sections.filter((s) => !kinds || kinds.includes(s.kind));
  if (secs.length > 0) return secs.map((s) => ({ startBar: s.startBar, lengthBars: s.lengthBars }));
  if (p.sections.length > 0) return [];
  const len = Math.max(songLengthBars(p), 8);
  return [{ startBar: 0, lengthBars: len }];
}

/** Place a pattern on a track across sections (e.g. all choruses). Returns number of clips placed. */
export function placeAcrossSections(p: Project, trackId: string, patternId: string, kinds?: SectionKind[]): number {
  const ranges = targetRanges(p, kinds);
  for (const r of ranges) addClip(p, { trackId, patternId, startBar: r.startBar, lengthBars: r.lengthBars });
  return ranges.length;
}

export function addSection(p: Project, kind: SectionKind, startBar: number, lengthBars: number, name?: string): void {
  const s = { id: uid('sec'), kind, name: name ?? kind[0].toUpperCase() + kind.slice(1), startBar: Math.max(0, Math.round(startBar)), lengthBars: clamp(Math.round(lengthBars), 1, 64) };
  // Sections never overlap: earlier sections are shortened, later overlapping ones are pushed back.
  const sEnd = s.startBar + s.lengthBars;
  const kept: typeof p.sections = [];
  for (const x of p.sections) {
    const xEnd = x.startBar + x.lengthBars;
    if (xEnd <= s.startBar || x.startBar >= sEnd) kept.push(x);
    else if (x.startBar < s.startBar) kept.push({ ...x, lengthBars: s.startBar - x.startBar });
    else if (xEnd > sEnd) kept.push({ ...x, startBar: sEnd, lengthBars: xEnd - sEnd });
  }
  p.sections = [...kept, s].sort((a, b) => a.startBar - b.startBar);
}

export function removeSection(p: Project, sectionId: string): void {
  p.sections = p.sections.filter((s) => s.id !== sectionId);
}

/** Appends a new section at the end of the song, copying the clips of the most recent section of the same kind. */
export function appendSection(p: Project, kind: SectionKind, lengthBars = 8): void {
  const start = songLengthBars(p) === 1 && p.clips.length === 0 && p.sections.length === 0 ? 0 : songLengthBars(p);
  const template = [...p.sections].reverse().find((s) => s.kind === kind);
  addSection(p, kind, start, lengthBars);
  if (template) {
    const clips = p.clips.filter((c) => c.startBar >= template.startBar && c.startBar < template.startBar + template.lengthBars);
    for (const c of clips) {
      const offset = c.startBar - template.startBar;
      if (offset >= lengthBars) continue;
      addClip(p, { ...c, startBar: start + offset, lengthBars: Math.min(c.lengthBars, lengthBars - offset) });
    }
  }
}

export function setNotes(pattern: NotePattern, notes: NotePattern['notes']): void {
  pattern.notes = notes.slice(0, LIMITS.maxNotesPerPattern);
}

export function setDrumLength(pattern: DrumPattern, lengthSteps: number): void {
  const len = clamp(Math.round(lengthSteps / 4) * 4, 4, 64);
  pattern.rows = pattern.rows.map((r) => ({ ...r, steps: Array.from({ length: len }, (_, i) => r.steps[i % Math.max(1, pattern.lengthSteps)] ?? 0) }));
  pattern.lengthSteps = len;
}
