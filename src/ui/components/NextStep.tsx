import { useState } from 'react';
import { useStudio, type StudioView } from '../studioContext';
import type { Project, TrackKind } from '../../core/types';

interface Step {
  id: string;
  label: string;
  done: (p: Project) => boolean;
  view: StudioView;
  tip: string;
}

const hasClips = (p: Project, kind: TrackKind) => p.clips.some((c) => p.tracks.find((t) => t.id === c.trackId)?.kind === kind);

/** The guided beginner workflow, shown as a progress strip with a suggested next action. */
const STEPS: Step[] = [
  { id: 'drums', label: 'Beat', done: (p) => hasClips(p, 'drums'), view: 'beats', tip: 'Build a drum pattern in the Beat Maker (or ask the Assistant for one), then press "Add to song".' },
  { id: 'chords', label: 'Chords', done: (p) => hasClips(p, 'chords'), view: 'assistant', tip: 'Pick a mood in the Assistant and add a chord progression.' },
  { id: 'melody', label: 'Melody', done: (p) => hasClips(p, 'melody'), view: 'assistant', tip: 'Generate a melody that fits your chords, then tweak it in the Piano Roll.' },
  { id: 'bass', label: 'Bass', done: (p) => hasClips(p, 'bass'), view: 'assistant', tip: 'Add a bassline that follows your chords.' },
  { id: 'arrange', label: 'Arrange', done: (p) => p.sections.length >= 3, view: 'arrange', tip: 'Add sections (Intro, Verse, Chorus…) in Arrange to turn your loop into a full song.' },
  { id: 'mix', label: 'Mix', done: (p) => p.tracks.some((t) => t.pan !== 0 || t.effects.delay > 0 || t.effects.eqLow !== 0 || t.effects.eqHigh !== 0), view: 'mixer', tip: 'Balance levels and add a little reverb or delay in the Mixer.' },
  { id: 'export', label: 'Export', done: () => false, view: 'export', tip: 'Export your song as a WAV file when it sounds good.' },
];

export default function NextStep() {
  const { project, setView, view } = useStudio();
  const [hidden, setHidden] = useState(false);
  const next = STEPS.find((s) => !s.done(project));
  if (hidden) return null;
  return (
    <div className="next-step">
      <ol className="steps" aria-label="Song progress">
        {STEPS.map((s) => (
          <li key={s.id} className={s.done(project) ? 'done' : s === next ? 'current' : ''}>
            <button onClick={() => setView(s.view)} title={s.tip}>{s.label}</button>
          </li>
        ))}
      </ol>
      {next && (
        <p className="next-tip">
          <strong>Next:</strong> {next.tip}{' '}
          {view !== next.view && <button className="link" onClick={() => setView(next.view)}>Take me there →</button>}
        </p>
      )}
      <button className="btn ghost small close" onClick={() => setHidden(true)} aria-label="Hide guide" title="Hide guide">×</button>
    </div>
  );
}
