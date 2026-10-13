import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStudio } from '../studioContext';
import { useDrag, usePlayhead, isTypingTarget } from '../hooks';
import type { Note, NotePattern, Track } from '../../core/types';
import { isInScale, keyLabel, midiToName } from '../../core/music/theory';
import { quantizeNotes, notePattern, note as makeNote } from '../../core/music/generators';
import { addClip, addPattern, duplicatePattern, ensureTrack, patternBars, removePattern } from '../../core/project/ops';
import { beatsPerBar, INSTRUMENTS } from '../../core/project/schema';
import { clamp, snap } from '../../core/util';

const ROW_H = 16;
const VISIBLE_ROWS = 37; // three octaves + 1
const GRIDS = [
  { value: 1, label: '1/4 (beat)' },
  { value: 0.5, label: '1/8' },
  { value: 0.25, label: '1/16' },
  { value: 0.125, label: '1/32' },
];
const BLACK = new Set([1, 3, 6, 8, 10]);

type Preview = { ids: Set<string>; dBeat: number; dPitch: number; dLen: number } | null;

export default function PianoRoll() {
  const studio = useStudio();
  const { project, commit, engine, selection } = studio;
  const noteTracks = project.tracks.filter((t) => t.kind !== 'drums' && t.kind !== 'vocals' && t.instrument !== 'sampler');
  const track: Track | undefined = noteTracks.find((t) => t.id === selection.noteTrackId) ?? noteTracks[0];
  const patterns = project.patterns.filter((p): p is NotePattern => p.type === 'notes');
  const pattern = patterns.find((p) => p.id === selection.notePatternId) ?? patterns[0];
  const [grid, setGrid] = useState(0.25);
  const [drawLen, setDrawLen] = useState(1);
  const [zoom, setZoom] = useState(56);
  const [topPitch, setTopPitch] = useState(() => defaultTop(pattern));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview>(null);
  const [snapToKey, setSnapToKey] = useState(false);
  const startDrag = useDrag();
  const playhead = usePlayhead(engine);
  const scroller = useRef<HTMLDivElement>(null);
  const bpb = beatsPerBar(project);

  const mode = engine.playMode;
  const previewing = studio.playing && mode?.kind === 'pattern' && pattern && mode.patternId === pattern.id;

  useEffect(() => {
    if (pattern && pattern.id !== selection.notePatternId) studio.select({ notePatternId: pattern.id });
    if (track && track.id !== selection.noteTrackId) studio.select({ noteTrackId: track.id });
  }, [pattern, track, selection, studio]);

  // jump to the pattern's notes when switching patterns
  useEffect(() => {
    setTopPitch(defaultTop(pattern));
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern?.id]);

  const updateNotes = (label: string, fn: (notes: Note[]) => Note[], key?: string) => {
    if (!pattern) return;
    commit(label, (d) => {
      const p = d.patterns.find((x) => x.id === pattern.id);
      if (p?.type === 'notes') p.notes = fn(p.notes).slice(0, 4096);
    }, key);
  };

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !pattern) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault();
        updateNotes('Delete notes', (ns) => ns.filter((n) => !selected.has(n.id)));
        setSelected(new Set());
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(pattern.notes.map((n) => n.id)));
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selected.size) {
        e.preventDefault();
        const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        updateNotes('Transpose', (ns) => ns.map((n) => (selected.has(n.id) ? { ...n, pitch: clamp(n.pitch + step, 0, 127) } : n)), 'transpose');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const rows = useMemo(() => Array.from({ length: VISIBLE_ROWS }, (_, i) => topPitch - i), [topPitch]);

  if (!track || !pattern) {
    return (
      <div className="view piano-roll empty-state">
        <h2>Piano Roll</h2>
        <p>The piano roll is where you draw notes for chords, basslines and melodies. Create an empty pattern, or let the Assistant write one for you.</p>
        <div className="inline">
          <button className="btn primary" onClick={() => {
            const p = notePattern('Melody 1', bpb * 4, []);
            commit('New pattern', (d) => { addPattern(d, p); ensureTrack(d, 'melody', 'Melody'); });
            studio.select({ notePatternId: p.id });
          }}>New empty pattern</button>
          <button className="btn" onClick={() => studio.setView('assistant')}>Open the Assistant</button>
        </div>
      </div>
    );
  }

  const beatW = zoom;
  const lengthBeats = pattern.lengthBeats;
  const gridWidth = lengthBeats * beatW;

  const pitchAt = (y: number) => clamp(topPitch - Math.floor(y / ROW_H), 0, 127);
  const keyFit = (pitch: number) => {
    if (!snapToKey || isInScale(pitch, project.key)) return pitch;
    return isInScale(pitch + 1, project.key) ? pitch + 1 : pitch - 1;
  };

  const onGridDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const beat = Math.max(0, Math.floor((e.clientX - rect.left) / beatW / grid) * grid);
    if (beat >= lengthBeats) return;
    const pitch = keyFit(pitchAt(e.clientY - rect.top));
    const n = makeNote(pitch, beat, Math.min(drawLen, lengthBeats - beat), 0.8);
    updateNotes('Add note', (ns) => [...ns, n]);
    setSelected(new Set([n.id]));
    void engine.previewNote(track.id, track.instrument, pitch, 0.3);
  };

  const beginNoteDrag = (e: ReactPointerEvent, n: Note, resize: boolean) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) {
      updateNotes('Delete note', (ns) => ns.filter((x) => x.id !== n.id));
      return;
    }
    let ids = selected;
    if (e.shiftKey) {
      ids = new Set(selected);
      if (ids.has(n.id)) ids.delete(n.id);
      else ids.add(n.id);
      setSelected(ids);
      return;
    }
    if (!selected.has(n.id)) {
      ids = new Set([n.id]);
      setSelected(ids);
    }
    if (!resize) void engine.previewNote(track.id, track.instrument, n.pitch, 0.25);
    let latest: Preview = { ids, dBeat: 0, dPitch: 0, dLen: 0 };
    startDrag(
      e,
      (dx, dy) => {
        latest = resize
          ? { ids, dBeat: 0, dPitch: 0, dLen: snap(dx / beatW, grid) }
          : { ids, dBeat: snap(dx / beatW, grid), dPitch: -Math.round(dy / ROW_H), dLen: 0 };
        setPreview(latest);
      },
      () => {
        setPreview(null);
        if (!latest || (latest.dBeat === 0 && latest.dPitch === 0 && latest.dLen === 0)) return;
        const l = latest;
        updateNotes(resize ? 'Resize note' : 'Move notes', (ns) => ns.map((x) => (l.ids.has(x.id) ? applyDelta(x, l, lengthBeats, grid) : x)));
        if (!resize && l.dPitch !== 0) void engine.previewNote(track.id, track.instrument, clamp(n.pitch + l.dPitch, 0, 127), 0.25);
      },
    );
  };

  const selectedNotes = pattern.notes.filter((n) => selected.has(n.id));
  const avgVelocity = selectedNotes.length ? selectedNotes.reduce((s, n) => s + n.velocity, 0) / selectedNotes.length : 0.8;
  const playX = previewing && playhead !== null ? (playhead % lengthBeats) * beatW : null;

  return (
    <div className="view piano-roll">
      <div className="toolbar">
        <div className="tool-group">
          <button className={`btn play ${previewing ? 'active' : ''}`} onClick={() => (previewing ? studio.stop() : void studio.playPattern(pattern.id, track.id))} title="Loop this pattern (Space)">
            {previewing ? '■ Stop' : '▶ Play'}
          </button>
          <label className="mini-field" title="Which instrument plays the notes while you edit">
            <span>Track</span>
            <select value={track.id} onChange={(e) => studio.select({ noteTrackId: e.target.value })}>
              {noteTracks.map((t) => <option key={t.id} value={t.id}>{t.name} ({INSTRUMENTS.find((i) => i.id === t.instrument)?.label})</option>)}
            </select>
          </label>
          <label className="mini-field">
            <span>Pattern</span>
            <select value={pattern.id} onChange={(e) => studio.select({ notePatternId: e.target.value })}>
              {patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <input type="text" aria-label="Pattern name" maxLength={40} value={pattern.name}
            onChange={(e) => commit('Rename pattern', (d) => { const p = d.patterns.find((x) => x.id === pattern.id); if (p) p.name = e.target.value; }, `pname-${pattern.id}`)} />
        </div>
        <div className="tool-group">
          <button className="btn small" onClick={() => {
            const p = notePattern(`Pattern ${patterns.length + 1}`, bpb * 4, []);
            commit('New pattern', (d) => addPattern(d, p));
            studio.select({ notePatternId: p.id });
          }}>New</button>
          <button className="btn small" onClick={() => {
            let id = '';
            commit('Duplicate pattern', (d) => { id = duplicatePattern(d, pattern.id)?.id ?? ''; });
            if (id) studio.select({ notePatternId: id });
          }}>Duplicate</button>
          <button className="btn small danger" onClick={() => {
            if (window.confirm(`Delete "${pattern.name}"? Clips using it will be removed from the song.`)) {
              commit('Delete pattern', (d) => removePattern(d, pattern.id));
              studio.select({ notePatternId: null });
            }
          }}>Delete</button>
          <label className="mini-field" title="Pattern length in bars">
            <span>Bars</span>
            <select value={Math.round(lengthBeats / bpb)} onChange={(e) => commit('Pattern length', (d) => {
              const p = d.patterns.find((x) => x.id === pattern.id);
              if (p?.type === 'notes') p.lengthBeats = Number(e.target.value) * bpb;
            })}>
              {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="tool-group">
          <label className="mini-field" title="Notes snap to this grid">
            <span>Snap</span>
            <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
              {GRIDS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label className="mini-field" title="Length of new notes">
            <span>Draw</span>
            <select value={drawLen} onChange={(e) => setDrawLen(Number(e.target.value))}>
              {[4, 2, 1, 0.5, 0.25].map((v) => <option key={v} value={v}>{v >= 1 ? `${v} beat${v > 1 ? 's' : ''}` : `1/${4 / v}`}</option>)}
            </select>
          </label>
          <button className="btn small" title="Snap the selected notes (or all notes) to the grid" onClick={() => {
            const ids = selected.size ? selected : null;
            updateNotes('Quantize', (ns) => {
              const target = ns.filter((n) => !ids || ids.has(n.id));
              const q = new Map(quantizeNotes(target, grid).map((n) => [n.id, n]));
              return ns.map((n) => q.get(n.id) ?? n);
            });
          }}>Quantize</button>
          <label className="toggle" title={`Keep new notes inside ${keyLabel(project.key)}`}>
            <input type="checkbox" checked={snapToKey} onChange={(e) => setSnapToKey(e.target.checked)} />
            <span>Stay in key</span>
          </label>
        </div>
        <div className="tool-group">
          <label className="mini-field" title="How hard the selected notes are played">
            <span>Velocity</span>
            <input type="range" min={0.05} max={1} step={0.01} value={avgVelocity} disabled={!selectedNotes.length}
              onChange={(e) => {
                const v = Number(e.target.value);
                updateNotes('Velocity', (ns) => ns.map((n) => (selected.has(n.id) ? { ...n, velocity: v } : n)), 'velocity');
              }} />
          </label>
          <button className="btn small" onClick={() => setTopPitch((p) => Math.min(127, p + 12))} title="Show higher notes">Octave ▲</button>
          <button className="btn small" onClick={() => setTopPitch((p) => Math.max(VISIBLE_ROWS - 1, p - 12))} title="Show lower notes">Octave ▼</button>
          <input type="range" aria-label="Zoom" min={24} max={120} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </div>
      </div>

      <div className="roll" ref={scroller}>
        <div className="keys" style={{ height: VISIBLE_ROWS * ROW_H }}>
          {rows.map((p) => (
            <button
              key={p}
              className={`key ${BLACK.has(p % 12) ? 'black' : 'white'} ${p % 12 === 0 ? 'c' : ''} ${isInScale(p, project.key) ? 'in-key' : ''}`}
              style={{ height: ROW_H }}
              onPointerDown={() => void engine.previewNote(track.id, track.instrument, p, 0.4)}
              title={midiToName(p)}
            >
              {p % 12 === 0 ? midiToName(p) : ''}
            </button>
          ))}
        </div>
        <div className="roll-scroll">
          <div
            className="roll-grid"
            style={{
              width: gridWidth,
              height: VISIBLE_ROWS * ROW_H,
              backgroundSize: `${beatW * grid}px ${ROW_H}px, ${beatW}px 100%, ${beatW * bpb}px 100%`,
            }}
            onPointerDown={onGridDown}
            onContextMenu={(e) => e.preventDefault()}
          >
            {rows.map((p, i) => (
              <div key={p} className={`roll-row ${BLACK.has(p % 12) ? 'black' : ''} ${isInScale(p, project.key) ? 'in-key' : ''}`} style={{ top: i * ROW_H, height: ROW_H }} />
            ))}
            {pattern.notes.map((n) => {
              const shown = preview && preview.ids.has(n.id) ? applyDelta(n, preview, lengthBeats, grid) : n;
              const y = (topPitch - shown.pitch) * ROW_H;
              if (y < -ROW_H || y > VISIBLE_ROWS * ROW_H) return null;
              return (
                <div
                  key={n.id}
                  className={`note ${selected.has(n.id) ? 'selected' : ''}`}
                  style={{ left: shown.start * beatW, top: y, width: Math.max(4, shown.duration * beatW - 1), height: ROW_H - 1, opacity: 0.45 + shown.velocity * 0.55, ['--note-color' as string]: track.color }}
                  onPointerDown={(e) => beginNoteDrag(e, n, false)}
                  onContextMenu={(e) => e.preventDefault()}
                  title={`${midiToName(n.pitch)} · velocity ${Math.round(n.velocity * 100)}% — right-click to delete`}
                >
                  <span className="note-label">{midiToName(shown.pitch)}</span>
                  <div className="note-resize" onPointerDown={(e) => beginNoteDrag(e, n, true)} />
                </div>
              );
            })}
            {outOfView(pattern.notes, topPitch) && <div className="offscreen-hint">Some notes are above or below — use Octave ▲/▼</div>}
            {playX !== null && <div className="roll-playhead" style={{ left: playX }} />}
          </div>
        </div>
      </div>
      <p className="hint">
        Click the grid to add a note · drag a note to move it · drag its right edge to change length · right-click or
        <kbd>Delete</kbd> to remove · <kbd>Shift</kbd>+click to select several · <kbd>↑</kbd>/<kbd>↓</kbd> transpose. Highlighted rows are in {keyLabel(project.key)}.
      </p>

      <div className="card add-to-song">
        <strong>Use this pattern in your song</strong>
        <div className="inline">
          <button className="btn" onClick={() => {
            const startBar = Math.floor(studio.cursorBeat / bpb);
            commit('Add pattern to song', (d) => {
              const p = d.patterns.find((x) => x.id === pattern.id)!;
              addClip(d, { trackId: track.id, patternId: pattern.id, startBar, lengthBars: patternBars(d, p) });
            });
            studio.toast(`Added to ${track.name} at bar ${startBar + 1}`, 'success');
          }}>Add to “{track.name}” at bar {Math.floor(studio.cursorBeat / bpb) + 1}</button>
          <button className="btn ghost" onClick={() => studio.setView('arrange')}>Open Arrange →</button>
        </div>
      </div>
    </div>
  );
}

function defaultTop(pattern: NotePattern | undefined): number {
  if (!pattern || pattern.notes.length === 0) return 84;
  const max = Math.max(...pattern.notes.map((n) => n.pitch));
  const min = Math.min(...pattern.notes.map((n) => n.pitch));
  const center = Math.round((max + min) / 2);
  return clamp(center + Math.floor(VISIBLE_ROWS / 2), VISIBLE_ROWS - 1, 127);
}

function outOfView(notes: Note[], top: number): boolean {
  return notes.some((n) => n.pitch > top || n.pitch <= top - VISIBLE_ROWS);
}

function applyDelta(n: Note, d: { dBeat: number; dPitch: number; dLen: number }, lengthBeats: number, grid: number): Note {
  const duration = clamp(n.duration + d.dLen, grid, lengthBeats);
  const start = clamp(n.start + d.dBeat, 0, Math.max(0, lengthBeats - grid));
  return { ...n, start, duration: Math.min(duration, lengthBeats - start), pitch: clamp(n.pitch + d.dPitch, 0, 127) };
}
