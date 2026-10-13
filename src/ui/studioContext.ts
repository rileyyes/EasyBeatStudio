import { createContext, useContext } from 'react';
import type { Project } from '../core/types';
import type { AudioEngine, PlayMode } from '../audio/engine';
import type { ProjectRepository } from '../storage/projectRepository';

export type StudioView = 'arrange' | 'beats' | 'piano' | 'assistant' | 'mixer' | 'export';

export type ToastKind = 'info' | 'success' | 'error';

export interface Selection {
  drumPatternId: string | null;
  notePatternId: string | null;
  noteTrackId: string | null;
}

export interface StudioApi {
  project: Project;
  /** Apply an undoable edit. `fn` mutates a draft copy of the project. */
  commit: (label: string, fn: (draft: Project) => void, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  engine: AudioEngine;
  repo: ProjectRepository;
  toast: (message: string, kind?: ToastKind) => void;
  view: StudioView;
  setView: (v: StudioView) => void;
  selection: Selection;
  select: (patch: Partial<Selection>) => void;
  /** where song playback starts (beats) */
  cursorBeat: number;
  setCursorBeat: (beat: number) => void;
  playing: boolean;
  playMode: PlayMode['kind'] | null;
  playSong: (fromBeat?: number) => Promise<void>;
  playPattern: (patternId: string, trackId: string) => Promise<void>;
  pause: () => void;
  stop: () => void;
  saveNow: () => Promise<void>;
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  missingSamples: string[];
  closeProject: () => void;
}

export const StudioContext = createContext<StudioApi | null>(null);

export function useStudio(): StudioApi {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside <Studio>');
  return ctx;
}
