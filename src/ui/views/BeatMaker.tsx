import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useStudio } from '../studioContext';
import { usePlayhead } from '../hooks';
import type { DrumPattern, DrumSound } from '../../core/types';
import { DRUM_STYLE_LABELS, drumStyles, emptyDrumRows, generateDrumPattern, varyDrumPattern } from '../../core/music/generators';
import { addClip, addPattern, duplicatePattern, ensureTrack, patternBars, placeAcrossSections, removePattern, setDrumLength } from '../../core/project/ops';
import { beatsPerBar } from '../../core/project/schema';
import { uid } from '../../core/util';

const SOUND_LABELS: Record<DrumSound, { name: string; tip: string }> = {
  kick: { name: 'Kick', tip: 'The deep "boom". Usually on beat 1.' },
  snare: { name: 'Snare', tip: 'The sharp "crack", classically on beats 2 and 4.' },
  clap: { name: 'Clap', tip: 'Layer with the snare or use instead of it.' },
  hatClosed: { name: 'Hi-hat', tip: 'Short "tss" that keeps time — try every 8th or 16th note.' },
  hatOpen: { name: 'Open hat', tip: 'Longer, splashy hat. Great on off-beats.' },
  perc: { name: 'Perc', tip: 'A woody tom/percussion hit for extra groove.' },
};

const VELOCITY_CYCLE = [1, 0.6, 0.3];

export default function BeatMaker() {
  const studio = useStudio();
  const { project, commit, engine, selection } = studio;
  const drumPatterns = project.patterns.filter((p): p is DrumPattern => p.type === 'drum');
  const pattern = drumPatterns.find((p) => p.id === selection.drumPatternId) ?? drumPatterns[0];
  const drumTrack = project.tracks.find((t) => t.kind === 'drums');
  const playhead = usePlayhead(engine);
  const mode = engine.playMode;
  const previewing = studio.playing && mode?.kind === 'pattern' && pattern && mode.patternId === pattern.id;
  const currentStep = previewing && playhead !== null ? Math.floor(playhead * 4) % pattern.lengthSteps : -1;
  const paint = useRef<{ value: number } | null>(null);

  useEffect(() => {
    const up = () => (paint.current = null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  useEffect(() => {
    if (pattern && pattern.id !== selection.drumPatternId) studio.select({ drumPatternId: pattern.id });
  }, [pattern, selection.drumPatternId, studio]);

  const createPattern = (p: DrumPattern, label: string) => {
    commit(label, (d) => addPattern(d, p));
    studio.select({ drumPatternId: p.id });
  };

  if (!pattern) {
    return (
      <div className="view beat-maker empty-state">
        <h2>Beat Maker</h2>
        <p>Make a drum pattern by clicking squares on a grid. Start empty, or let EasyBeat suggest a groove.</p>
        <div className="inline">
          <button className="btn primary" onClick={() => createPattern({ id: uid('pat'), name: 'Beat 1', type: 'drum', lengthSteps: 16, rows: emptyDrumRows(16) }, 'New beat')}>New empty beat</button>
          <SuggestPicker onPick={(style) => createPattern(generateDrumPattern(style), 'Suggest beat')} />
        </div>
      </div>
    );
  }

  const setStep = (sound: DrumSound, step: number, value: number) => {
    commit('Edit beat', (d) => {
      const p = d.patterns.find((x) => x.id === pattern.id);
      if (p?.type !== 'drum') return;
      const row = p.rows.find((r) => r.sound === sound);
      if (row) row.steps[step] = value;
    }, `paint-${pattern.id}`);
  };

  const onCellDown = (e: ReactPointerEvent, sound: DrumSound, step: number, current: number) => {
    e.preventDefault();
    let value: number;
    if (e.shiftKey || e.button === 2) {
      const idx = VELOCITY_CYCLE.indexOf(current);
      value = current === 0 ? 1 : VELOCITY_CYCLE[(idx + 1) % VELOCITY_CYCLE.length];
    } else {
      value = current > 0 ? 0 : 1;
      if (value > 0 && drumTrack && !studio.playing) void engine.previewDrum(drumTrack.id, sound, 0.9);
    }
    paint.current = { value };
    setStep(sound, step, value);
  };

  const onCellEnter = (sound: DrumSound, step: number, current: number) => {
    if (paint.current && current !== paint.current.value) setStep(sound, step, paint.current.value);
  };

  const togglePreview = () => {
    if (previewing) studio.stop();
    else if (drumTrack) void studio.playPattern(pattern.id, drumTrack.id);
    else studio.toast('Add a Drums track first (Arrange → + Add track).', 'error');
  };

  const bpb = beatsPerBar(project);

  return (
    <div className="view beat-maker">
      <div className="toolbar">
        <div className="tool-group">
          <button className={`btn play ${previewing ? 'active' : ''}`} onClick={togglePreview} title="Loop this pattern (Space)">
            {previewing ? '■ Stop' : '▶ Play beat'}
          </button>
          <select aria-label="Drum pattern" value={pattern.id} onChange={(e) => studio.select({ drumPatternId: e.target.value })}>
            {drumPatterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            type="text"
            aria-label="Pattern name"
            maxLength={40}
            value={pattern.name}
            onChange={(e) => commit('Rename pattern', (d) => { const p = d.patterns.find((x) => x.id === pattern.id); if (p) p.name = e.target.value; }, `pname-${pattern.id}`)}
          />
        </div>
        <div className="tool-group">
          <button className="btn small" onClick={() => createPattern({ id: uid('pat'), name: `Beat ${drumPatterns.length + 1}`, type: 'drum', lengthSteps: 16, rows: emptyDrumRows(16) }, 'New beat')}>New</button>
          <button className="btn small" title="Make an exact copy you can change" onClick={() => {
            let newId = '';
            commit('Duplicate pattern', (d) => { newId = duplicatePattern(d, pattern.id)?.id ?? ''; });
            if (newId) studio.select({ drumPatternId: newId });
          }}>Duplicate</button>
          <button className="btn small" title="A copy with small changes — great for choruses" onClick={() => createPattern(varyDrumPattern(pattern, Date.now() % 1000), 'Beat variation')}>Variation</button>
          <SuggestPicker onPick={(style) => createPattern(generateDrumPattern(style), 'Suggest beat')} />
          <button className="btn small danger" onClick={() => {
            if (window.confirm(`Delete "${pattern.name}"? Clips using it will be removed from the song.`)) {
              commit('Delete pattern', (d) => removePattern(d, pattern.id));
              studio.select({ drumPatternId: null });
            }
          }}>Delete</button>
        </div>
        <div className="tool-group">
          <label className="mini-field" title="Pattern length">
            <span>Steps</span>
            <select value={pattern.lengthSteps} onChange={(e) => commit('Pattern length', (d) => {
              const p = d.patterns.find((x) => x.id === pattern.id);
              if (p?.type === 'drum') setDrumLength(p, Number(e.target.value));
            })}>
              {[8, 16, 32, 48, 64].map((n) => <option key={n} value={n}>{n} ({n / 4 / bpb} bar{n / 4 / bpb === 1 ? '' : 's'})</option>)}
            </select>
          </label>
          <label className="mini-field" title="Swing delays every second 16th note for a bouncy, human feel">
            <span>Swing {Math.round((project.swing / 0.75) * 100)}%</span>
            <input type="range" min={0} max={0.75} step={0.01} value={project.swing} onChange={(e) => commit('Swing', (d) => { d.swing = Number(e.target.value); }, 'swing')} />
          </label>
        </div>
      </div>

      <div className="drum-grid" style={{ ['--steps' as string]: pattern.lengthSteps }} onContextMenu={(e) => e.preventDefault()}>
        <div className="drum-row step-numbers" aria-hidden>
          <div className="drum-label" />
          <div className="drum-cells">
            {Array.from({ length: pattern.lengthSteps }, (_, i) => (
              <div key={i} className={`step-num ${i % 4 === 0 ? 'beat' : ''} ${i === currentStep ? 'now' : ''}`}>{i % 4 === 0 ? i / 4 + 1 : '·'}</div>
            ))}
          </div>
        </div>
        {pattern.rows.map((row) => (
          <div className="drum-row" key={row.sound}>
            <button className="drum-label" title={`${SOUND_LABELS[row.sound].tip} Click to hear it.`} onClick={() => drumTrack && void engine.previewDrum(drumTrack.id, row.sound)}>
              {SOUND_LABELS[row.sound].name}
            </button>
            <div className="drum-cells" role="group" aria-label={`${SOUND_LABELS[row.sound].name} steps`}>
              {row.steps.map((v, i) => (
                <button
                  key={i}
                  className={`cell ${v > 0 ? 'on' : ''} ${Math.floor(i / 4) % 2 === 1 ? 'alt' : ''} ${i === currentStep ? 'now' : ''}`}
                  style={v > 0 ? { opacity: 0.35 + v * 0.65 } : undefined}
                  aria-pressed={v > 0}
                  aria-label={`${SOUND_LABELS[row.sound].name} step ${i + 1}${v > 0 ? `, velocity ${Math.round(v * 100)}%` : ''}`}
                  onPointerDown={(e) => onCellDown(e, row.sound, i, v)}
                  onPointerEnter={() => onCellEnter(row.sound, i, v)}
                />
              ))}
            </div>
            <button className="icon-btn" title={`Clear ${SOUND_LABELS[row.sound].name}`} aria-label={`Clear ${SOUND_LABELS[row.sound].name}`} onClick={() => commit('Clear row', (d) => {
              const p = d.patterns.find((x) => x.id === pattern.id);
              if (p?.type === 'drum') { const r = p.rows.find((x) => x.sound === row.sound); if (r) r.steps = r.steps.map(() => 0); }
            })}>✕</button>
          </div>
        ))}
      </div>
      <p className="hint">Click to add or remove a hit · drag to paint · <kbd>Shift</kbd>+click (or right-click) to make a hit softer · the numbers are beats.</p>

      <div className="card add-to-song">
        <strong>Use this beat in your song</strong>
        <div className="inline">
          <button className="btn" onClick={() => {
            const startBar = Math.floor(studio.cursorBeat / bpb);
            commit('Add beat to song', (d) => {
              const t = ensureTrack(d, 'drums', 'Drums');
              const p = d.patterns.find((x) => x.id === pattern.id)!;
              addClip(d, { trackId: t.id, patternId: pattern.id, startBar, lengthBars: Math.max(4, patternBars(d, p)) });
            });
            studio.toast(`Added "${pattern.name}" at bar ${startBar + 1}`, 'success');
          }}>Add at bar {Math.floor(studio.cursorBeat / bpb) + 1}</button>
          <button className="btn" title="Place this beat in every verse, chorus, bridge and drop" onClick={() => {
            commit('Use beat in song', (d) => {
              const t = ensureTrack(d, 'drums', 'Drums');
              if (d.sections.length === 0) addClip(d, { trackId: t.id, patternId: pattern.id, startBar: 0, lengthBars: 8 });
              else placeAcrossSections(d, t.id, pattern.id, ['verse', 'pre-chorus', 'chorus', 'bridge', 'drop']);
            });
            studio.toast('Beat placed in the song', 'success');
          }}>Use in all main sections</button>
          <button className="btn ghost" onClick={() => studio.setView('arrange')}>Open Arrange →</button>
        </div>
      </div>
    </div>
  );
}

function SuggestPicker({ onPick }: { onPick: (style: Parameters<typeof generateDrumPattern>[0]) => void }) {
  return (
    <select
      className="suggest"
      aria-label="Suggest a beat"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as Parameters<typeof generateDrumPattern>[0]);
      }}
    >
      <option value="">✦ Suggest a beat…</option>
      {drumStyles().map((s) => <option key={s} value={s}>{DRUM_STYLE_LABELS[s]}</option>)}
    </select>
  );
}
