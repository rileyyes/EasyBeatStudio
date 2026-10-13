import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  deserializeProject,
  normalizeProject,
  PROJECT_FORMAT_VERSION,
  ProjectFormatError,
  serializeProject,
  songLengthBars,
} from '../src/core/project/schema';
import { createProjectFromTemplate } from '../src/core/music/templates';

describe('project format', () => {
  it('round-trips a full template project without losing data', () => {
    const p = createProjectFromTemplate('electronic');
    const back = deserializeProject(serializeProject(p));
    expect(back).toEqual({ ...p, formatVersion: PROJECT_FORMAT_VERSION });
  });

  it('upgrades a legacy (unversioned) project', () => {
    const legacy: Record<string, unknown> = JSON.parse(serializeProject(createEmptyProject({ name: 'Old' })));
    delete legacy.formatVersion;
    delete legacy.bpm;
    legacy.tempo = 93;
    const p = normalizeProject(legacy);
    expect(p.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(p.bpm).toBe(93);
    expect(p.name).toBe('Old');
  });

  it('refuses projects from a newer app version with a clear message', () => {
    const raw = { ...createEmptyProject(), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    expect(() => normalizeProject(raw)).toThrow(ProjectFormatError);
    expect(() => normalizeProject(raw)).toThrow(/newer version/);
  });

  it('rejects garbage gracefully', () => {
    expect(() => deserializeProject('{not json')).toThrow(ProjectFormatError);
    expect(() => normalizeProject(42)).toThrow(ProjectFormatError);
    expect(() => normalizeProject(null)).toThrow(ProjectFormatError);
  });

  it('repairs invalid values and drops broken references', () => {
    const p = createProjectFromTemplate('pop');
    const raw = JSON.parse(serializeProject(p));
    raw.bpm = 9999;
    raw.swing = -3;
    raw.name = '  \u0007Bad\u0000 name  ';
    raw.tracks[0].volume = 'loud';
    raw.tracks[1].instrument = 'stradivarius';
    raw.patterns.find((x: { type: string }) => x.type === 'notes').notes.push({ pitch: 'x' }, { pitch: 60, start: -1, duration: 1 }, { pitch: 300, start: 0, duration: 1 });
    raw.clips.push({ id: 'ghost', trackId: 'nope', patternId: 'nope', startBar: 0, lengthBars: 1 });
    raw.clips.push({ id: 'ghost2', trackId: raw.tracks[0].id, patternId: 'missing', startBar: 0, lengthBars: 1 });
    const fixed = normalizeProject(raw);
    expect(fixed.bpm).toBe(240);
    expect(fixed.swing).toBe(0);
    expect(fixed.name).toBe('Bad name');
    expect(fixed.tracks[0].volume).toBe(0.75);
    expect(fixed.tracks[1].instrument).toBe('bass');
    expect(fixed.clips.find((c) => c.id.startsWith('ghost'))).toBeUndefined();
    const notes = fixed.patterns.filter((x) => x.type === 'notes').flatMap((x) => (x.type === 'notes' ? x.notes : []));
    expect(notes.every((n) => n.pitch >= 0 && n.pitch <= 127 && n.start >= 0)).toBe(true);
    expect(notes.some((n) => n.pitch === 127)).toBe(true); // 300 clamped
  });

  it('computes song length from clips and sections', () => {
    const p = createProjectFromTemplate('rock');
    expect(songLengthBars(p)).toBe(40);
    expect(songLengthBars(createEmptyProject())).toBe(1);
  });
});
