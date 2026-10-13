import { useStudio } from '../studioContext';
import { formatPosition, useLevels, usePlayhead } from '../hooks';
import { beatsPerBar, LIMITS } from '../../core/project/schema';
import { NOTE_NAMES } from '../../core/music/theory';
import type { MusicalKey } from '../../core/types';
import { clamp, sanitizeName } from '../../core/util';
import Meter from './Meter';

export default function TransportBar() {
  const s = useStudio();
  const { project, commit, engine } = s;
  const pos = usePlayhead(engine);
  const levels = useLevels(engine, s.playing);
  const bpb = beatsPerBar(project);
  const shown = pos ?? s.cursorBeat;
  const saveText = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed!' }[s.saveStatus];

  return (
    <header className="transport">
      <div className="transport-group">
        <button className="btn ghost" onClick={s.closeProject} title="Save and go back to your projects">← Projects</button>
        <input
          className="project-name"
          type="text"
          aria-label="Project name"
          maxLength={60}
          value={project.name}
          onChange={(e) => commit('Rename project', (d) => { d.name = e.target.value.slice(0, 60); }, 'rename')}
          onBlur={(e) => commit('Rename project', (d) => { d.name = sanitizeName(e.target.value, 'Untitled Song'); }, 'rename')}
        />
      </div>

      <div className="transport-group">
        <button className="btn icon" onClick={s.undo} disabled={!s.canUndo} title={s.canUndo ? `Undo ${s.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo">↶</button>
        <button className="btn icon" onClick={s.redo} disabled={!s.canRedo} title={s.canRedo ? `Redo ${s.redoLabel} (Ctrl+Y)` : 'Nothing to redo'} aria-label="Redo">↷</button>
      </div>

      <div className="transport-group transport-controls">
        <button className="btn icon" onClick={s.stop} title="Stop and go back to the start" aria-label="Stop">■</button>
        {s.playing && s.playMode === 'song' ? (
          <button className="btn play active" onClick={s.pause} title="Pause (Space)" aria-label="Pause">❚❚</button>
        ) : (
          <button className="btn play" onClick={() => void s.playSong()} title="Play the song (Space)" aria-label="Play song">▶</button>
        )}
        <button
          className={`btn icon ${project.loop.enabled ? 'toggled' : ''}`}
          onClick={() => commit(project.loop.enabled ? 'Loop off' : 'Loop on', (d) => { d.loop.enabled = !d.loop.enabled; })}
          title={`Loop bars ${project.loop.startBar + 1}–${project.loop.endBar} (set the loop range in Arrange)`}
          aria-pressed={project.loop.enabled}
          aria-label="Loop"
        >
          ⟳
        </button>
        <div className="position" title="Bar.Beat">
          <span className="position-value">{formatPosition(shown, bpb)}</span>
          <span className="position-label">{s.playing && s.playMode === 'pattern' ? 'pattern' : 'bar.beat'}</span>
        </div>
      </div>

      <div className="transport-group">
        <label className="mini-field" title="Tempo in beats per minute">
          <span>BPM</span>
          <input
            type="number"
            min={LIMITS.bpmMin}
            max={LIMITS.bpmMax}
            value={Math.round(project.bpm)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= LIMITS.bpmMin && v <= LIMITS.bpmMax) commit('Change tempo', (d) => { d.bpm = v; }, 'bpm');
            }}
            onBlur={(e) => commit('Change tempo', (d) => { d.bpm = clamp(Number(e.target.value) || 100, LIMITS.bpmMin, LIMITS.bpmMax); }, 'bpm')}
          />
        </label>
        <label className="mini-field" title="Beats per bar">
          <span>Time</span>
          <select value={project.timeSignature[0]} onChange={(e) => commit('Change time signature', (d) => { d.timeSignature = [Number(e.target.value), 4]; })}>
            {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
          </select>
        </label>
        <label className="mini-field" title="Musical key — generated chords and melodies use it">
          <span>Key</span>
          <span className="inline">
            <select value={project.key.tonic} onChange={(e) => commit('Change key', (d) => { d.key = { ...d.key, tonic: e.target.value as MusicalKey['tonic'] }; })}>
              {NOTE_NAMES.map((n) => <option key={n}>{n}</option>)}
            </select>
            <select value={project.key.mode} onChange={(e) => commit('Change key', (d) => { d.key = { ...d.key, mode: e.target.value as MusicalKey['mode'] }; })}>
              <option value="major">maj</option>
              <option value="minor">min</option>
            </select>
          </span>
        </label>
      </div>

      <div className="transport-group">
        <label className="mini-field master" title="Master volume">
          <span>Master</span>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.01}
            value={project.masterVolume}
            onChange={(e) => commit('Master volume', (d) => { d.masterVolume = Number(e.target.value); }, 'master')}
          />
        </label>
        <Meter level={levels.master} />
      </div>

      <div className="transport-group end">
        <span className={`save-status ${s.saveStatus}`} title="Projects auto-save in this browser">{saveText}</span>
        <button className="btn primary" onClick={() => s.setView('export')} title="Export WAV or MIDI">Export</button>
      </div>
    </header>
  );
}
