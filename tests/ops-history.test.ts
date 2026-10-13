import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../src/core/project/schema';
import { addClip, addPattern, appendSection, clearRange, duplicateClip, moveClip, resizeClip } from '../src/core/project/ops';
import { generateDrumPattern, notePattern } from '../src/core/music/generators';
import { createHistory, pushHistory, redo, undo, canRedo } from '../src/core/history';

function setup() {
  const p = createEmptyProject();
  const drums = p.tracks[0];
  const melody = p.tracks[3];
  const beat = addPattern(p, generateDrumPattern('pop'));
  const tune = addPattern(p, notePattern('t', 4, []));
  return { p, drums, melody, beat, tune };
}

describe('arrangement editing', () => {
  it('splits, trims and removes clips to make room', () => {
    const { p, drums, beat } = setup();
    addClip(p, { trackId: drums.id, patternId: beat.id, startBar: 0, lengthBars: 8 });
    clearRange(p, drums.id, 2, 4);
    const spans = p.clips.map((c) => [c.startBar, c.lengthBars]).sort((a, b) => a[0] - b[0]);
    expect(spans).toEqual([[0, 2], [4, 4]]);
    addClip(p, { trackId: drums.id, patternId: beat.id, startBar: 1, lengthBars: 4 });
    const after = p.clips.map((c) => [c.startBar, c.lengthBars]).sort((a, b) => a[0] - b[0]);
    expect(after).toEqual([[0, 1], [1, 4], [5, 3]]);
  });

  it('moves, resizes and duplicates clips without overlaps', () => {
    const { p, drums, beat } = setup();
    const a = addClip(p, { trackId: drums.id, patternId: beat.id, startBar: 0, lengthBars: 2 });
    const b = duplicateClip(p, a.id)!;
    expect(b.startBar).toBe(2);
    resizeClip(p, a.id, 3); // now overlaps b by one bar → b trimmed
    const bNow = p.clips.find((c) => c.id === b.id)!;
    expect([bNow.startBar, bNow.lengthBars]).toEqual([3, 1]);
    moveClip(p, a.id, 10);
    expect(p.clips.find((c) => c.id === a.id)!.startBar).toBe(10);
  });

  it('refuses to move a drum clip onto a melodic track', () => {
    const { p, drums, melody, beat } = setup();
    const a = addClip(p, { trackId: drums.id, patternId: beat.id, startBar: 0, lengthBars: 2 });
    moveClip(p, a.id, 4, melody.id);
    expect(p.clips[0].trackId).toBe(drums.id);
    expect(p.clips[0].startBar).toBe(0);
  });

  it('appends a section that copies the clips of the previous section of that kind', () => {
    const { p, drums, beat } = setup();
    appendSection(p, 'verse', 4);
    addClip(p, { trackId: drums.id, patternId: beat.id, startBar: 0, lengthBars: 4 });
    appendSection(p, 'chorus', 4);
    appendSection(p, 'verse', 4);
    expect(p.sections.map((s) => [s.kind, s.startBar])).toEqual([['verse', 0], ['chorus', 4], ['verse', 8]]);
    expect(p.clips.filter((c) => c.startBar === 8)).toHaveLength(1);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes snapshots, and coalesces rapid drags', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1, 'a', null, 1000);
    h = pushHistory(h, 2, 'drag', 'fader', 2000);
    h = pushHistory(h, 3, 'drag', 'fader', 2100);
    h = pushHistory(h, 4, 'drag', 'fader', 2200);
    expect(h.present).toBe(4);
    h = undo(h);
    expect(h.present).toBe(1);
    h = undo(h);
    expect(h.present).toBe(0);
    h = undo(h);
    expect(h.present).toBe(0);
    h = redo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, 9, 'new edit', null, 5000);
    expect(canRedo(h)).toBe(false);
  });
});
