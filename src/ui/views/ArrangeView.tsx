import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { useStudio } from '../studioContext';
import { useDrag, usePlayhead } from '../hooks';
import type { Clip, Pattern, Project, SectionKind, Track, TrackKind } from '../../core/types';
import { SECTION_KINDS } from '../../core/types';
import { beatsPerBar, INSTRUMENTS, patternLengthBeats, songLengthBars } from '../../core/project/schema';
import {
  addClip,
  addTrack,
  appendSection,
  duplicateClip,
  getPattern,
  moveClip,
  patternBars,
  patternsForTrack,
  removeClip,
  removeSection,
  removeTrack,
  resizeClip,
} from '../../core/project/ops';
import { AUDIO_ACCEPT } from '../../storage/fileValidation';
import { importAudio } from '../audioImport';
import RecordButton from '../components/RecordButton';

const ROW_H = 64;
const HEADER_W = 210;

const SECTION_COLORS: Record<SectionKind, string> = {
  intro: '#5ab0ff', verse: '#7c6cff', 'pre-chorus': '#b07cff', chorus: '#ff5fa2', bridge: '#3fd0c9', drop: '#ff7a59', outro: '#5ab0ff',
};

type DragPreview = { clipId: string; startBar: number; lengthBars: number; trackIndex: number } | null;

export default function ArrangeView() {
  const studio = useStudio();
  const { project, commit, engine } = studio;
  const bpb = beatsPerBar(project);
  const [zoom, setZoom] = useState(30);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [brush, setBrush] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<DragPreview>(null);
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('instrument');
  const startDrag = useDrag();
  const playhead = usePlayhead(engine);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const totalBars = Math.max(songLengthBars(project) + 8, 32);
  const laneWidth = totalBars * zoom;
  const posBeat = playhead ?? studio.cursorBeat;

  // keep the playhead visible while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || playhead === null) return;
    const x = (playhead / bpb) * zoom;
    if (x > el.scrollLeft + el.clientWidth - 80 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 120);
  }, [playhead, bpb, zoom]);

  const brushFor = (track: Track): Pattern | undefined => {
    const id = brush[track.id];
    const pats = patternsForTrack(project, track);
    return pats.find((p) => p.id === id) ?? lastUsedPattern(project, track) ?? pats[0];
  };

  /* ---------------- keyboard: delete / duplicate selected clip ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (!selectedClip) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commit('Delete clip', (d) => removeClip(d, selectedClip));
        setSelectedClip(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        commit('Duplicate clip', (d) => {
          const c = duplicateClip(d, selectedClip);
          if (c) setSelectedClip(c.id);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClip, commit]);

  const barFromEvent = (e: ReactMouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.floor((e.clientX - rect.left) / zoom));
  };

  const onLaneClick = (e: ReactMouseEvent<HTMLDivElement>, track: Track) => {
    if (e.target !== e.currentTarget) return;
    setSelectedClip(null);
    const bar = barFromEvent(e);
    if (track.kind === 'vocals' || track.instrument === 'sampler') {
      studio.setCursorBeat(bar * bpb);
      studio.toast('Use "Import" or "● Rec" in the track header to add audio here.');
      return;
    }
    const pat = brushFor(track);
    if (!pat) {
      studio.toast(track.kind === 'drums' ? 'Create a beat in the Beat Maker first.' : 'Create a pattern in the Piano Roll or Assistant first.');
      return;
    }
    commit('Add clip', (d) => {
      const c = addClip(d, { trackId: track.id, patternId: pat.id, startBar: bar, lengthBars: patternBars(d, pat) });
      setSelectedClip(c.id);
    });
  };

  const beginMove = (e: ReactPointerEvent, clip: Clip, trackIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedClip(clip.id);
    let latest: DragPreview = { clipId: clip.id, startBar: clip.startBar, lengthBars: clip.lengthBars, trackIndex };
    startDrag(
      e,
      (dx, dy) => {
        latest = {
          clipId: clip.id,
          startBar: Math.max(0, clip.startBar + Math.round(dx / zoom)),
          lengthBars: clip.lengthBars,
          trackIndex: Math.max(0, Math.min(project.tracks.length - 1, trackIndex + Math.round(dy / ROW_H))),
        };
        setPreview(latest);
      },
      () => {
        setPreview(null);
        if (!latest) return;
        const target = project.tracks[latest.trackIndex];
        if (latest.startBar === clip.startBar && target.id === clip.trackId) return;
        const startBar = latest.startBar;
        commit('Move clip', (d) => moveClip(d, clip.id, startBar, target.id));
      },
    );
  };

  const beginResize = (e: ReactPointerEvent, clip: Clip, trackIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedClip(clip.id);
    let latestLen = clip.lengthBars;
    startDrag(
      e,
      (dx) => {
        latestLen = Math.max(1, clip.lengthBars + Math.round(dx / zoom));
        setPreview({ clipId: clip.id, startBar: clip.startBar, lengthBars: latestLen, trackIndex });
      },
      () => {
        setPreview(null);
        if (latestLen !== clip.lengthBars) commit('Resize clip', (d) => resizeClip(d, clip.id, latestLen));
      },
    );
  };

  const openEditor = (clip: Clip) => {
    const pat = getPattern(project, clip.patternId);
    if (!pat) return;
    if (pat.type === 'drum') {
      studio.select({ drumPatternId: pat.id });
      studio.setView('beats');
    } else {
      studio.select({ notePatternId: pat.id, noteTrackId: clip.trackId });
      studio.setView('piano');
    }
  };

  const selected = project.clips.find((c) => c.id === selectedClip) ?? null;
  const section = project.sections.find((s) => s.id === selectedSection) ?? null;

  const ruler = useMemo(() => Array.from({ length: totalBars }, (_, i) => i), [totalBars]);

  return (
    <div className="arrange view">
      <div className="toolbar">
        <div className="tool-group">
          <span className="tool-label">Song</span>
          <select aria-label="Section type to add" id="add-section-kind" defaultValue="verse">
            {SECTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button
            className="btn small"
            title="Add a section at the end of the song. It copies the clips of the last section of the same type."
            onClick={() => {
              const kind = (document.getElementById('add-section-kind') as HTMLSelectElement).value as SectionKind;
              commit(`Add ${kind}`, (d) => appendSection(d, kind, kind === 'intro' || kind === 'outro' ? 4 : 8));
            }}
          >
            + Section
          </button>
        </div>
        {selected && (
          <div className="tool-group">
            <span className="tool-label">Clip</span>
            <button className="btn small" onClick={() => openEditor(selected)} disabled={!selected.patternId}>Edit</button>
            <button className="btn small" title="Ctrl+D" onClick={() => commit('Duplicate clip', (d) => { const c = duplicateClip(d, selected.id); if (c) setSelectedClip(c.id); })}>Duplicate</button>
            <button className="btn small danger" title="Delete key" onClick={() => { commit('Delete clip', (d) => removeClip(d, selected.id)); setSelectedClip(null); }}>Delete</button>
          </div>
        )}
        {section && (
          <div className="tool-group">
            <span className="tool-label">Section</span>
            <select value={section.kind} onChange={(e) => commit('Change section', (d) => {
              const s = d.sections.find((x) => x.id === section.id);
              if (s) { s.kind = e.target.value as SectionKind; s.name = s.kind[0].toUpperCase() + s.kind.slice(1); }
            })}>
              {SECTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <label className="mini-field">
              <span>bars</span>
              <input type="number" min={1} max={64} value={section.lengthBars} onChange={(e) => {
                const v = Math.max(1, Math.min(64, Number(e.target.value) || 1));
                commit('Resize section', (d) => { const s = d.sections.find((x) => x.id === section.id); if (s) s.lengthBars = v; }, `sec-len-${section.id}`);
              }} />
            </label>
            <button className="btn small" onClick={() => commit('Loop section', (d) => { d.loop = { enabled: true, startBar: section.startBar, endBar: section.startBar + section.lengthBars }; })}>Loop it</button>
            <button className="btn small" onClick={() => void studio.playSong(section.startBar * bpb)}>▶ From here</button>
            <button className="btn small danger" onClick={() => { commit('Remove section', (d) => removeSection(d, section.id)); setSelectedSection(null); }} title="Removes the section marker (clips stay)">Remove</button>
          </div>
        )}
        <div className="tool-group">
          <span className="tool-label">Loop</span>
          <input type="number" aria-label="Loop start bar" min={1} value={project.loop.startBar + 1} onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1) - 1;
            commit('Loop range', (d) => { d.loop.startBar = v; d.loop.endBar = Math.max(v + 1, d.loop.endBar); }, 'loop');
          }} />
          <span className="muted">to</span>
          <input type="number" aria-label="Loop end bar" min={1} value={project.loop.endBar} onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1);
            commit('Loop range', (d) => { d.loop.endBar = Math.max(d.loop.startBar + 1, v); }, 'loop');
          }} />
        </div>
        <div className="tool-group end">
          <span className="tool-label">Zoom</span>
          <input type="range" min={14} max={70} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
        </div>
      </div>

      <p className="hint">
        Click an empty spot in a lane to drop the selected pattern there. Drag clips to move them, drag their right edge to
        make them longer (the pattern repeats), double-click to edit. Click the ruler to move the playhead.
      </p>

      <div className="arrange-scroll" ref={scroller}>
        <div className="arrange-grid" style={{ width: HEADER_W + laneWidth }}>
          {/* Ruler */}
          <div className="arr-row ruler-row">
            <div className="arr-header sticky">Bar</div>
            <div
              className="ruler"
              style={{ width: laneWidth, backgroundSize: `${zoom}px 100%` }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const beat = Math.max(0, Math.floor(((e.clientX - rect.left) / zoom) * bpb) );
                const snapped = Math.floor(beat / bpb) * bpb;
                studio.setCursorBeat(snapped);
                if (studio.playing && studio.playMode === 'song') void studio.playSong(snapped);
              }}
              title="Click to move the playhead"
            >
              {ruler.map((i) => (
                <span key={i} className="ruler-num" style={{ left: i * zoom }}>{i % (zoom < 22 ? 4 : 1) === 0 ? i + 1 : ''}</span>
              ))}
              {project.loop.enabled && (
                <div className="loop-region" style={{ left: project.loop.startBar * zoom, width: (project.loop.endBar - project.loop.startBar) * zoom }} />
              )}
            </div>
          </div>

          {/* Sections */}
          <div className="arr-row section-row">
            <div className="arr-header sticky">Sections</div>
            <div className="lane section-lane" style={{ width: laneWidth }}>
              {project.sections.map((s) => (
                <button
                  key={s.id}
                  className={`section-block ${selectedSection === s.id ? 'selected' : ''}`}
                  style={{ left: s.startBar * zoom, width: s.lengthBars * zoom - 2, background: SECTION_COLORS[s.kind] }}
                  onClick={() => { setSelectedSection(s.id === selectedSection ? null : s.id); setSelectedClip(null); }}
                  title={`${s.name}: bars ${s.startBar + 1}–${s.startBar + s.lengthBars}`}
                >
                  {s.name}
                </button>
              ))}
              {project.sections.length === 0 && <span className="lane-empty">No sections yet — use “+ Section” to build your song structure.</span>}
            </div>
          </div>

          {/* Tracks */}
          {project.tracks.map((track, ti) => {
            const pats = patternsForTrack(project, track);
            const brushPat = brushFor(track);
            const isAudio = track.kind === 'vocals' || track.instrument === 'sampler';
            return (
              <div className="arr-row track-row" key={track.id} style={{ height: ROW_H }}>
                <div className="arr-header sticky track-header" style={{ borderLeftColor: track.color }}>
                  <div className="track-title">
                    <input
                      type="text"
                      aria-label="Track name"
                      maxLength={40}
                      value={track.name}
                      onChange={(e) => commit('Rename track', (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) t.name = e.target.value; }, `tname-${track.id}`)}
                    />
                    <button className={`ms ${track.mute ? 'on mute' : ''}`} title="Mute" aria-pressed={track.mute} onClick={() => commit('Mute', (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) t.mute = !t.mute; })}>M</button>
                    <button className={`ms ${track.solo ? 'on solo' : ''}`} title="Solo (hear only this track)" aria-pressed={track.solo} onClick={() => commit('Solo', (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) t.solo = !t.solo; })}>S</button>
                  </div>
                  <div className="track-tools">
                    {isAudio ? (
                      <>
                        <button className="btn small ghost" onClick={() => fileInputs.current[track.id]?.click()} title="Import an audio file at the playhead bar">Import</button>
                        <input ref={(el: HTMLInputElement | null) => { fileInputs.current[track.id] = el; }} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) void importAudio(studio, f, f.name, track.id, Math.floor(studio.cursorBeat / bpb));
                        }} />
                        <RecordButton trackId={track.id} />
                      </>
                    ) : (
                      <select
                        aria-label="Pattern to place"
                        title="Pattern placed when you click the lane"
                        value={brushPat?.id ?? ''}
                        onChange={(e) => setBrush({ ...brush, [track.id]: e.target.value })}
                      >
                        {pats.length === 0 && <option value="">(no patterns yet)</option>}
                        {pats.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                    <button className="icon-btn" title="Remove track" aria-label="Remove track" onClick={() => {
                      if (window.confirm(`Remove the "${track.name}" track and its clips?`)) commit('Remove track', (d) => removeTrack(d, track.id));
                    }}>✕</button>
                  </div>
                </div>
                <div className="lane" style={{ width: laneWidth, backgroundSize: `${zoom}px 100%, ${zoom * 4}px 100%` }} onClick={(e) => onLaneClick(e, track)}>
                  {project.clips
                    .filter((c) => (preview?.clipId === c.id ? false : c.trackId === track.id))
                    .map((c) => (
                      <ClipView key={c.id} clip={c} project={project} track={track} zoom={zoom} selected={c.id === selectedClip}
                        onPointerDown={(e) => beginMove(e, c, ti)}
                        onResize={(e) => beginResize(e, c, ti)}
                        onDoubleClick={() => openEditor(c)} />
                    ))}
                  {preview && preview.trackIndex === ti && (() => {
                    const c = project.clips.find((x) => x.id === preview.clipId);
                    return c ? (
                      <ClipView clip={{ ...c, startBar: preview.startBar, lengthBars: preview.lengthBars }} project={project} track={track} zoom={zoom} selected dragging
                        onPointerDown={() => {}} onResize={() => {}} onDoubleClick={() => {}} />
                    ) : null;
                  })()}
                </div>
              </div>
            );
          })}

          <div className="playhead" style={{ left: HEADER_W + (posBeat / bpb) * zoom }} aria-hidden />
        </div>
      </div>

      <div className="add-track">
        <select value={newTrackKind} onChange={(e) => setNewTrackKind(e.target.value as TrackKind)} aria-label="New track type">
          <option value="instrument">Instrument</option>
          <option value="melody">Melody</option>
          <option value="chords">Chords</option>
          <option value="bass">Bass</option>
          <option value="drums">Drums</option>
          <option value="vocals">Vocals / audio</option>
        </select>
        <button className="btn small" onClick={() => commit('Add track', (d) => {
          const label = newTrackKind === 'vocals' ? 'Audio' : newTrackKind[0].toUpperCase() + newTrackKind.slice(1);
          addTrack(d, newTrackKind, `${label} ${d.tracks.filter((t) => t.kind === newTrackKind).length + 1}`);
        })}>+ Add track</button>
        <span className="muted small">Instruments: {INSTRUMENTS.filter((i) => i.id !== 'sampler' && i.id !== 'drumkit').map((i) => i.label).join(', ')} — change them in the Mixer.</span>
      </div>
    </div>
  );
}

function lastUsedPattern(project: Project, track: Track): Pattern | undefined {
  const clips = project.clips.filter((c) => c.trackId === track.id && c.patternId);
  const last = clips[clips.length - 1];
  return last ? getPattern(project, last.patternId) : undefined;
}

interface ClipViewProps {
  clip: Clip;
  project: Project;
  track: Track;
  zoom: number;
  selected: boolean;
  dragging?: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
  onResize: (e: ReactPointerEvent) => void;
  onDoubleClick: () => void;
}

function ClipView({ clip, project, track, zoom, selected, dragging, onPointerDown, onResize, onDoubleClick }: ClipViewProps) {
  const pattern = getPattern(project, clip.patternId);
  const sample = clip.sampleId ? project.samples.find((s) => s.id === clip.sampleId) : undefined;
  const bpb = beatsPerBar(project);
  const width = clip.lengthBars * zoom - 2;
  const label = pattern?.name ?? sample?.name ?? 'Missing';
  return (
    <div
      className={`clip ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${!pattern && !sample ? 'missing' : ''}`}
      style={{ left: clip.startBar * zoom, width, ['--clip-color' as string]: track.color }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
      title={`${label} — bars ${clip.startBar + 1}–${clip.startBar + clip.lengthBars}. Drag to move, double-click to edit.`}
    >
      <span className="clip-label">{label}</span>
      {pattern && <ClipPreview pattern={pattern} lengthBeats={clip.lengthBars * bpb} width={width} />}
      {sample && <div className="clip-audio" aria-hidden />}
      <div className="clip-resize" onPointerDown={onResize} title="Drag to change length" />
    </div>
  );
}

function ClipPreview({ pattern, lengthBeats, width }: { pattern: Pattern; lengthBeats: number; width: number }) {
  const h = 34;
  const len = patternLengthBeats(pattern);
  const reps = Math.min(64, Math.ceil(lengthBeats / len));
  const items: ReactElement[] = [];
  if (pattern.type === 'drum') {
    const rows = pattern.rows;
    for (let r = 0; r < reps; r++) {
      rows.forEach((row, ri) => {
        row.steps.forEach((v, i) => {
          const beat = r * len + i * 0.25;
          if (v > 0 && beat < lengthBeats) items.push(<rect key={`${r}-${ri}-${i}`} x={beat} y={ri * (h / rows.length)} width={0.18} height={h / rows.length - 1} opacity={0.35 + v * 0.6} />);
        });
      });
    }
  } else if (pattern.notes.length > 0) {
    const pitches = pattern.notes.map((n) => n.pitch);
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches) + 1;
    const span = Math.max(12, hi - lo);
    for (let r = 0; r < reps; r++) {
      pattern.notes.forEach((n, i) => {
        const beat = r * len + n.start;
        if (beat >= lengthBeats || n.start >= len) return;
        items.push(<rect key={`${r}-${i}`} x={beat} y={h - ((n.pitch - lo + 1) / span) * h} width={Math.max(0.1, Math.min(n.duration, len - n.start) - 0.05)} height={Math.max(1.5, h / span)} />);
      });
    }
  }
  return (
    <svg className="clip-preview" width={Math.max(0, width)} height={h} viewBox={`0 0 ${lengthBeats} ${h}`} preserveAspectRatio="none" aria-hidden>
      {items}
    </svg>
  );
}
