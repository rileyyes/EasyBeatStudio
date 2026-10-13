import { describe, expect, it } from 'vitest';
import { parseIntent, respondDeterministic } from '../src/core/assistant/engine';
import { createProjectFromTemplate, TEMPLATES } from '../src/core/music/templates';
import { createEmptyProject, normalizeProject, serializeProject } from '../src/core/project/schema';
import { collectArrangementEvents } from '../src/core/scheduler/events';
import { deepClone } from '../src/core/util';
import type { Genre, Project } from '../src/core/types';

function applyAll(project: Project, text: string): Project {
  const res = respondDeterministic({ text }, project);
  const draft = deepClone(project);
  for (const a of res.actions.slice(0, 1)) a.apply(draft);
  // still a valid project after the edit
  return normalizeProject(JSON.parse(serializeProject(draft)));
}

describe('genre templates', () => {
  it.each(TEMPLATES.map((t) => t.genre))('%s template is a complete, playable song', (genre: Genre) => {
    const p = createProjectFromTemplate(genre);
    expect(p.sections.map((s) => s.kind)).toEqual(['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro']);
    for (const s of p.sections) {
      const ev = collectArrangementEvents(p, s.startBar * 4, (s.startBar + s.lengthBars) * 4);
      expect(ev.length).toBeGreaterThan(0);
    }
    const kinds = new Set(collectArrangementEvents(p, 0, 160).map((e) => p.tracks.find((t) => t.id === e.trackId)!.kind));
    expect(kinds).toEqual(new Set(['drums', 'bass', 'chords', 'melody']));
  });
});

describe('assistant intent parsing', () => {
  it('understands the example requests', () => {
    const a = parseIntent('Help me make a dark hip-hop beat.');
    expect([a.genre, a.mood, a.wantsDrums]).toEqual(['hip-hop', 'dark', true]);
    const b = parseIntent('Give me a chord progression that sounds emotional.');
    expect([b.wantsChords, b.mood]).toEqual([true, 'emotional']);
    expect(parseIntent('Add a bassline that follows these chords.').wantsBass).toBe(true);
    expect(parseIntent('Make my chorus feel bigger.').wantsBiggerChorus).toBe(true);
    expect(parseIntent('Help me create a smoother transition into the next section.').wantsTransition).toBe(true);
    expect(parseIntent('set the tempo to 140').tempo).toEqual({ bpm: 140 });
    expect(parseIntent('chords in F# minor').key).toEqual({ tonic: 'F#', mode: 'minor' });
    expect(parseIntent('chords in Bb').key).toEqual({ tonic: 'A#', mode: 'major' });
  });
});

describe('assistant actions produce editable, valid music', () => {
  it('dark hip-hop beat → new drum pattern placed on the drums track', () => {
    const p = createEmptyProject();
    const res = respondDeterministic({ text: 'Help me make a dark hip-hop beat' }, p);
    expect(res.actions.length).toBeGreaterThan(0);
    const draft = deepClone(p);
    for (const a of res.actions) a.apply(draft);
    expect(draft.bpm).toBe(88);
    const drums = draft.tracks.find((t) => t.kind === 'drums')!;
    expect(draft.clips.some((c) => c.trackId === drums.id)).toBe(true);
  });

  it('emotional progression changes key/progression and adds chord clips', () => {
    const p = createEmptyProject();
    const after = applyAll(p, 'Give me a chord progression that sounds emotional');
    expect(after.progression?.mood).toBe('emotional');
    const chords = after.tracks.find((t) => t.kind === 'chords')!;
    expect(after.clips.filter((c) => c.trackId === chords.id).length).toBeGreaterThan(0);
  });

  it('bassline follows the chord clips', () => {
    const p = createProjectFromTemplate('pop');
    const after = applyAll(p, 'Add a bassline that follows these chords');
    const chords = after.tracks.find((t) => t.kind === 'chords')!;
    const bass = after.tracks.find((t) => t.kind === 'bass')!;
    const chordSpans = after.clips.filter((c) => c.trackId === chords.id).map((c) => `${c.startBar}+${c.lengthBars}`).sort();
    const bassSpans = after.clips.filter((c) => c.trackId === bass.id).map((c) => `${c.startBar}+${c.lengthBars}`).sort();
    expect(bassSpans).toEqual(chordSpans);
  });

  it('bigger chorus adds layers only inside choruses', () => {
    const p = createProjectFromTemplate('pop');
    const before = p.tracks.length;
    const after = applyAll(p, 'Make my chorus feel bigger');
    expect(after.tracks.length).toBe(before + 1);
    const layer = after.tracks[after.tracks.length - 1];
    const choruses = after.sections.filter((s) => s.kind === 'chorus');
    for (const c of after.clips.filter((x) => x.trackId === layer.id)) {
      expect(choruses.some((s) => s.startBar === c.startBar && s.lengthBars === c.lengthBars)).toBe(true);
    }
  });

  it('transition adds a fill in the bar before every section change', () => {
    const p = createProjectFromTemplate('rock');
    const after = applyAll(p, 'Help me create a smoother transition into the next section');
    const fill = after.patterns.find((x) => x.name === 'Transition fill')!;
    const fillBars = after.clips.filter((c) => c.patternId === fill.id).map((c) => c.startBar).sort((a, b) => a - b);
    expect(fillBars).toEqual(after.sections.filter((s) => s.startBar > 0).map((s) => s.startBar - 1));
  });

  it('explains concepts without changing anything', () => {
    const res = respondDeterministic({ text: 'What is swing?' }, createEmptyProject());
    expect(res.actions).toHaveLength(0);
    expect(res.message).toMatch(/Swing/);
  });

  it('gives helpful suggestions for unclear requests', () => {
    const res = respondDeterministic({ text: 'hmm' }, createEmptyProject());
    expect(res.actions).toHaveLength(0);
    expect(res.suggestions.length).toBeGreaterThan(2);
  });
});
