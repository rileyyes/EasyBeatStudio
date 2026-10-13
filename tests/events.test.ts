import { describe, expect, it } from 'vitest';
import { collectArrangementEvents, swingOffsetBeats, type MusicEvent } from '../src/core/scheduler/events';
import { createEmptyProject } from '../src/core/project/schema';
import { addClip, addPattern } from '../src/core/project/ops';
import { generateDrumPattern, notePattern, note } from '../src/core/music/generators';
import { createProjectFromTemplate } from '../src/core/music/templates';
import type { Project } from '../src/core/types';

function simpleProject(): Project {
  const p = createEmptyProject();
  const melody = p.tracks.find((t) => t.kind === 'melody')!;
  // 1-bar pattern (4 beats) with notes on beats 0 and 3, the second one 2 beats long
  const pat = addPattern(p, notePattern('m', 4, [note(60, 0, 1, 0.8), note(64, 3, 2, 0.8)]));
  addClip(p, { trackId: melody.id, patternId: pat.id, startBar: 1, lengthBars: 2 });
  return p;
}

const key = (e: MusicEvent) => `${e.type}:${e.trackId}:${e.beat.toFixed(4)}:${'pitch' in e ? e.pitch : 'sound' in e ? e.sound : ''}`;

describe('arrangement events', () => {
  it('loops a pattern inside its clip and truncates notes at the pattern/clip end', () => {
    const p = simpleProject();
    const events = collectArrangementEvents(p, 0, 100).filter((e) => e.type === 'note');
    expect(events.map((e) => e.beat)).toEqual([4, 7, 8, 11]);
    const last = events[3];
    expect(last.type === 'note' && last.durationBeats).toBe(1); // truncated to pattern end
  });

  it('never loses or duplicates events when the timeline is split into windows', () => {
    const p = createProjectFromTemplate('hip-hop');
    const whole = collectArrangementEvents(p, 0, 160).map(key).sort();
    const pieces: string[] = [];
    let t = 0;
    const steps = [0.13, 0.5, 0.07, 1, 0.33];
    let i = 0;
    while (t < 160) {
      const next = Math.min(160, t + steps[i++ % steps.length]);
      pieces.push(...collectArrangementEvents(p, t, next).map(key));
      t = next;
    }
    expect(pieces.sort()).toEqual(whole);
    expect(whole.length).toBeGreaterThan(500);
  });

  it('applies swing to off-beat 16ths only', () => {
    expect(swingOffsetBeats(0, 0.5)).toBe(0);
    expect(swingOffsetBeats(1, 0.75)).toBeCloseTo(1 / 12, 9);
    const p = createEmptyProject();
    p.swing = 0.75;
    const drums = p.tracks.find((t) => t.kind === 'drums')!;
    const pat = addPattern(p, generateDrumPattern('trap'));
    addClip(p, { trackId: drums.id, patternId: pat.id, startBar: 0, lengthBars: 2 });
    const hats = collectArrangementEvents(p, 0, 1).filter((e) => e.type === 'drum' && e.sound === 'hatClosed');
    expect(hats.map((e) => +e.beat.toFixed(4))).toEqual([0, +(0.25 + 1 / 12).toFixed(4), 0.5, +(0.75 + 1 / 12).toFixed(4)]);
  });

  it('honours mute and solo', () => {
    const p = createProjectFromTemplate('pop');
    const drums = p.tracks.find((t) => t.kind === 'drums')!;
    const bass = p.tracks.find((t) => t.kind === 'bass')!;
    drums.mute = true;
    expect(collectArrangementEvents(p, 0, 200).some((e) => e.trackId === drums.id)).toBe(false);
    drums.mute = false;
    bass.solo = true;
    const ev = collectArrangementEvents(p, 0, 200);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.trackId === bass.id)).toBe(true);
  });

  it('starts samples mid-clip only on the first window after play/loop', () => {
    const p = createEmptyProject();
    const vox = p.tracks.find((t) => t.kind === 'vocals')!;
    p.samples.push({ id: 's1', name: 'vox', mimeType: 'audio/wav', sizeBytes: 10, durationSec: 4, createdAt: 0 });
    addClip(p, { trackId: vox.id, sampleId: 's1', startBar: 0, lengthBars: 2 });
    expect(collectArrangementEvents(p, 0, 1)).toHaveLength(1);
    expect(collectArrangementEvents(p, 2, 3)).toHaveLength(0);
    const resumed = collectArrangementEvents(p, 2, 3, { isStart: true });
    expect(resumed).toHaveLength(1);
    expect(resumed[0].type === 'sample' && resumed[0].offsetBeats).toBe(2);
  });
});
