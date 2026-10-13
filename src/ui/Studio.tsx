import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Project } from '../core/types';
import { canRedo, canUndo, createHistory, pushHistory, redo, redoLabel, undo, undoLabel, type HistoryState } from '../core/history';
import { deepClone } from '../core/util';
import { beatsPerBar } from '../core/project/schema';
import { AudioEngine } from '../audio/engine';
import type { ProjectRepository } from '../storage/projectRepository';
import { StudioContext, type Selection, type StudioApi, type StudioView, type ToastKind } from './studioContext';
import { isTypingTarget } from './hooks';
import TransportBar from './components/TransportBar';
import NextStep from './components/NextStep';
import ArrangeView from './views/ArrangeView';
import BeatMaker from './views/BeatMaker';
import PianoRoll from './views/PianoRoll';
import AssistantView from './views/AssistantView';
import MixerView from './views/MixerView';
import ExportView from './views/ExportView';

type Action =
  | { type: 'commit'; next: Project; label: string; key?: string }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: HistoryState<Project>, action: Action): HistoryState<Project> {
  switch (action.type) {
    case 'commit':
      return pushHistory(state, action.next, action.label, action.key ?? null);
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
  }
}

const VIEWS: { id: StudioView; label: string; icon: string; hint: string }[] = [
  { id: 'arrange', label: 'Arrange', icon: '▤', hint: 'Song timeline: place patterns into sections' },
  { id: 'beats', label: 'Beat Maker', icon: '◼', hint: 'Click the grid to build drum patterns' },
  { id: 'piano', label: 'Piano Roll', icon: '♪', hint: 'Draw and edit notes for chords, bass and melodies' },
  { id: 'assistant', label: 'Assistant', icon: '✦', hint: 'Generate chords, melodies, basslines and beats' },
  { id: 'mixer', label: 'Mixer', icon: '⫶', hint: 'Balance volume, panning and effects' },
  { id: 'export', label: 'Export', icon: '⇩', hint: 'Save WAV / MIDI files and backups' },
];

interface Props {
  initialProject: Project;
  missingSamples: string[];
  repo: ProjectRepository;
  onClose: () => void;
}

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export default function Studio({ initialProject, missingSamples, repo, onClose }: Props) {
  const [history, dispatch] = useReducer(reducer, initialProject, createHistory);
  const project = history.present;
  const projectRef = useRef(project);
  projectRef.current = project;

  const engine = useMemo(() => new AudioEngine(() => projectRef.current), []);
  const [playing, setPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<StudioApi['playMode']>(null);
  const [view, setView] = useState<StudioView>('arrange');
  const [cursorBeat, setCursorBeat] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveStatus, setSaveStatus] = useState<StudioApi['saveStatus']>('saved');
  const lastSavedJson = useRef<string>(JSON.stringify(initialProject));
  const [selection, setSelection] = useState<Selection>(() => {
    const drum = initialProject.patterns.find((p) => p.type === 'drum');
    const note = initialProject.patterns.find((p) => p.type === 'notes');
    const noteTrack = initialProject.tracks.find((t) => t.kind === 'chords') ?? initialProject.tracks.find((t) => t.kind !== 'drums');
    return { drumPatternId: drum?.id ?? null, notePatternId: note?.id ?? null, noteTrackId: noteTrack?.id ?? null };
  });

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  /* ---------------- engine wiring ---------------- */

  useEffect(() => {
    engine.setSampleLoader((id) => repo.getSampleBlob(id));
    const off = engine.onStatus((s) => {
      setPlaying(s.playing);
      setPlayMode(s.mode);
    });
    return () => {
      off();
      void engine.dispose(); // free audio resources when the project closes
    };
  }, [engine, repo]);

  useEffect(() => {
    engine.syncMixer(project);
  }, [engine, project]);

  useEffect(() => {
    if (missingSamples.length > 0) {
      toast(`Some audio could not be found and will be silent: ${missingSamples.join(', ')}`, 'error');
    }
  }, [missingSamples, toast]);

  /* ---------------- editing ---------------- */

  const commit = useCallback(
    (label: string, fn: (draft: Project) => void, key?: string) => {
      const draft = deepClone(projectRef.current);
      try {
        fn(draft);
      } catch (e) {
        toast((e as Error).message, 'error');
        return;
      }
      projectRef.current = draft;
      dispatch({ type: 'commit', next: draft, label, key });
    },
    [toast],
  );

  const doUndo = useCallback(() => dispatch({ type: 'undo' }), []);
  const doRedo = useCallback(() => dispatch({ type: 'redo' }), []);

  /* ---------------- saving ---------------- */

  const saveNow = useCallback(async () => {
    const p = projectRef.current;
    const json = JSON.stringify(p);
    if (json === lastSavedJson.current) {
      setSaveStatus('saved');
      return;
    }
    setSaveStatus('saving');
    try {
      await repo.save(p);
      lastSavedJson.current = json;
      setSaveStatus(JSON.stringify(projectRef.current) === json ? 'saved' : 'unsaved');
    } catch (e) {
      setSaveStatus('error');
      toast(`Could not save: ${(e as Error).message}. Export a backup to be safe.`, 'error');
    }
  }, [repo, toast]);

  // Autosave shortly after every change
  useEffect(() => {
    if (JSON.stringify(project) === lastSavedJson.current) return;
    setSaveStatus('unsaved');
    const t = setTimeout(() => void saveNow(), 1200);
    return () => clearTimeout(t);
  }, [project, saveNow]);

  // Warn before leaving the page with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(projectRef.current) !== lastSavedJson.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const closeProject = useCallback(() => {
    engine.stop();
    void saveNow().finally(onClose);
  }, [engine, saveNow, onClose]);

  /* ---------------- transport ---------------- */

  const loadSamplesIfNeeded = useCallback(async () => {
    if (projectRef.current.samples.length === 0) return;
    const failed = await engine.loadSamples(projectRef.current);
    if (failed.length) toast(`Could not load: ${failed.join(', ')}`, 'error');
  }, [engine, toast]);

  const playSong = useCallback(
    async (fromBeat?: number) => {
      try {
        await loadSamplesIfNeeded();
        const p = projectRef.current;
        let start = fromBeat ?? cursorBeat;
        if (p.loop.enabled) {
          const bpb = beatsPerBar(p);
          if (start < p.loop.startBar * bpb || start >= p.loop.endBar * bpb) start = p.loop.startBar * bpb;
        }
        await engine.play({ kind: 'song', fromBeat: start });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [engine, cursorBeat, loadSamplesIfNeeded, toast],
  );

  const playPattern = useCallback(
    async (patternId: string, trackId: string) => {
      try {
        await engine.play({ kind: 'pattern', patternId, trackId });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [engine, toast],
  );

  const pause = useCallback(() => {
    const pos = engine.positionBeats();
    if (pos !== null && engine.playMode?.kind === 'song') setCursorBeat(Math.max(0, pos));
    engine.stop();
  }, [engine]);

  const stop = useCallback(() => {
    engine.stop();
    const p = projectRef.current;
    setCursorBeat(p.loop.enabled ? p.loop.startBar * beatsPerBar(p) : 0);
  }, [engine]);

  /* ---------------- keyboard shortcuts ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        doRedo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow().then(() => toast('Saved', 'success'));
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (engine.playing) {
          pause();
        } else if (view === 'beats' && selection.drumPatternId) {
          const drums = projectRef.current.tracks.find((t) => t.kind === 'drums');
          if (drums) void playPattern(selection.drumPatternId, drums.id);
        } else if (view === 'piano' && selection.notePatternId && selection.noteTrackId) {
          void playPattern(selection.notePatternId, selection.noteTrackId);
        } else {
          void playSong();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo, saveNow, toast, engine, pause, playSong, playPattern, view, selection]);

  const api: StudioApi = {
    project,
    commit,
    undo: doUndo,
    redo: doRedo,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undoLabel: undoLabel(history),
    redoLabel: redoLabel(history),
    engine,
    repo,
    toast,
    view,
    setView,
    selection,
    select: (patch) => setSelection((s) => ({ ...s, ...patch })),
    cursorBeat,
    setCursorBeat,
    playing,
    playMode,
    playSong,
    playPattern,
    pause,
    stop,
    saveNow,
    saveStatus,
    missingSamples,
    closeProject,
  };

  return (
    <StudioContext.Provider value={api}>
      <div className="studio">
        <TransportBar />
        <div className="studio-body">
          <nav className="side-nav" aria-label="Studio sections">
            {VIEWS.map((v) => (
              <button key={v.id} className={`nav-btn ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)} title={v.hint} aria-current={view === v.id}>
                <span className="nav-icon" aria-hidden>{v.icon}</span>
                <span>{v.label}</span>
              </button>
            ))}
          </nav>
          <main className="studio-main">
            <NextStep />
            {view === 'arrange' && <ArrangeView />}
            {view === 'beats' && <BeatMaker />}
            {view === 'piano' && <PianoRoll />}
            {view === 'assistant' && <AssistantView />}
            {view === 'mixer' && <MixerView />}
            {view === 'export' && <ExportView />}
          </main>
        </div>
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
          ))}
        </div>
      </div>
    </StudioContext.Provider>
  );
}
