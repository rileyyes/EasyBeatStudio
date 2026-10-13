/**
 * AudioEngine — owns the AudioContext, the mixer graph and the transport.
 * The UI never touches Web Audio directly; it calls these methods.
 */
import type { DrumSound, InstrumentId, Project } from '../core/types';
import { Sequencer } from '../core/scheduler/sequencer';
import { collectArrangementEvents, collectPatternPreviewEvents, type MusicEvent } from '../core/scheduler/events';
import { beatsPerBar, patternLengthBeats, songLengthBars } from '../core/project/schema';
import { encodeWav, peakLevel } from '../core/export/wav';
import { MixerGraph, readLevel } from './mixer';
import { playDrum, playSynthNote, type VoiceTarget } from './instruments';

export type PlayMode =
  | { kind: 'song'; fromBeat: number }
  | { kind: 'pattern'; patternId: string; trackId: string };

export interface EngineStatus {
  playing: boolean;
  mode: PlayMode['kind'] | null;
}

export interface RenderResult {
  wav: Uint8Array;
  durationSec: number;
  peak: number;
  missingSamples: string[];
}

type Listener = (status: EngineStatus) => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mixer: MixerGraph | null = null;
  private sequencer: Sequencer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeSources = new Set<AudioScheduledSourceNode>();
  private getProject: () => Project;
  private mode: PlayMode | null = null;
  private listeners = new Set<Listener>();
  private sampleBuffers = new Map<string, AudioBuffer>();
  private sampleLoader: ((sampleId: string) => Promise<Blob | undefined>) | null = null;
  private missingSamples = new Set<string>();
  private meterScratch = new Float32Array(1024);
  private visibilityHandler = () => {
    // Background tabs throttle timers to ~1 s; schedule further ahead so playback doesn't drop out.
    if (this.sequencer) this.sequencer.lookahead = document.hidden ? 1.5 : 0.12;
  };

  constructor(getProject: () => Project) {
    this.getProject = getProject;
  }

  /* ---------------- lifecycle ---------------- */

  get isSupported(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  /** Must be called from a user gesture (click) the first time — browsers block autoplay. */
  async ensureStarted(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('Your browser does not support the Web Audio API. Try the latest Chrome, Edge or Firefox.');
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.mixer = new MixerGraph(this.ctx, this.ctx.destination, true);
      this.mixer.sync(this.getProject(), true);
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  setSampleLoader(loader: (sampleId: string) => Promise<Blob | undefined>): void {
    this.sampleLoader = loader;
  }

  onStatus(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const status: EngineStatus = { playing: !!this.sequencer?.isRunning, mode: this.mode?.kind ?? null };
    for (const l of this.listeners) l(status);
  }

  /** Release audio resources (when closing a project). */
  async dispose(): Promise<void> {
    this.stop();
    this.sampleBuffers.clear();
    this.missingSamples.clear();
    if (this.mixer) this.mixer.dispose();
    this.mixer = null;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
  }

  /* ---------------- mixer ---------------- */

  syncMixer(project: Project): void {
    this.mixer?.sync(project);
  }

  levels(): { master: number; tracks: Record<string, number> } {
    if (!this.mixer) return { master: 0, tracks: {} };
    const tracks: Record<string, number> = {};
    for (const [id, strip] of this.mixer.channels) tracks[id] = readLevel(strip.analyser, this.meterScratch);
    return { master: readLevel(this.mixer.masterAnalyser, this.meterScratch), tracks };
  }

  /* ---------------- samples ---------------- */

  /** Decodes and caches the project's audio samples. Returns names of samples that could not be loaded. */
  async loadSamples(project: Project): Promise<string[]> {
    const ctx = await this.ensureStarted();
    const failed: string[] = [];
    for (const s of project.samples) {
      if (this.sampleBuffers.has(s.id)) continue;
      const buffer = await this.decodeSample(ctx, s.id);
      if (buffer) this.sampleBuffers.set(s.id, buffer);
      else {
        this.missingSamples.add(s.id);
        failed.push(s.name);
      }
    }
    return failed;
  }

  private async decodeSample(ctx: BaseAudioContext, sampleId: string): Promise<AudioBuffer | null> {
    try {
      const blob = this.sampleLoader ? await this.sampleLoader(sampleId) : undefined;
      if (!blob) return null;
      return await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Decode an imported file once (to validate it and read its duration). */
  async decodeFile(blob: Blob): Promise<AudioBuffer> {
    const ctx = await this.ensureStarted();
    try {
      return await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new Error('This audio file could not be decoded. It may be damaged or use an unsupported codec.');
    }
  }

  cacheSampleBuffer(sampleId: string, buffer: AudioBuffer): void {
    this.sampleBuffers.set(sampleId, buffer);
    this.missingSamples.delete(sampleId);
  }

  forgetSample(sampleId: string): void {
    this.sampleBuffers.delete(sampleId);
  }

  /* ---------------- transport ---------------- */

  get playing(): boolean {
    return !!this.sequencer?.isRunning;
  }

  get playMode(): PlayMode | null {
    return this.mode;
  }

  async play(mode: PlayMode): Promise<void> {
    const ctx = await this.ensureStarted();
    this.stop();
    const project = this.getProject();
    this.mixer!.sync(project, true);
    this.mode = mode;

    const target = (trackId: string): VoiceTarget => ({
      ctx,
      out: this.mixer!.input(trackId),
      register: (node) => this.trackSource(node),
    });

    const seq = new Sequencer({
      getBpm: () => this.getProject().bpm,
      getRange: () => {
        const p = this.getProject();
        const bpb = beatsPerBar(p);
        if (mode.kind === 'pattern') {
          const pat = p.patterns.find((x) => x.id === mode.patternId);
          const len = pat ? patternLengthBeats(pat) : 4;
          return { endBeat: len, loop: { startBeat: 0, endBeat: len } };
        }
        return {
          endBeat: songLengthBars(p) * bpb,
          loop: p.loop.enabled ? { startBeat: p.loop.startBar * bpb, endBeat: p.loop.endBar * bpb } : null,
        };
      },
      getEvents: (from, to, isStart) => {
        const p = this.getProject();
        return mode.kind === 'pattern'
          ? collectPatternPreviewEvents(p, mode.patternId, mode.trackId, from, to)
          : collectArrangementEvents(p, from, to, { isStart });
      },
      schedule: (event, time, spb) => this.scheduleEvent(event, time, spb, target),
      onEnd: (time) => {
        const delay = Math.max(0, (time - ctx.currentTime) * 1000) + 50;
        setTimeout(() => {
          if (this.sequencer === seq) {
            this.stop();
          }
        }, delay);
      },
    });
    seq.lookahead = document.hidden ? 1.5 : 0.12;
    this.sequencer = seq;
    seq.start(ctx.currentTime + 0.05, mode.kind === 'song' ? mode.fromBeat : 0);
    seq.tick(ctx.currentTime);
    // The timer only *wakes up* the scheduler; all timing comes from the audio clock.
    this.timer = setInterval(() => seq.tick(ctx.currentTime), 25);
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sequencer?.stop();
    this.sequencer = null;
    this.mode = null;
    const now = this.ctx?.currentTime ?? 0;
    for (const src of this.activeSources) {
      try {
        src.stop(now + 0.01);
      } catch {
        /* not started or already stopped */
      }
    }
    this.activeSources.clear();
    this.emit();
  }

  /** Current musical position in beats while playing, otherwise null. */
  positionBeats(): number | null {
    if (!this.ctx || !this.sequencer?.isRunning) return null;
    return this.sequencer.beatAt(this.ctx.currentTime);
  }

  private trackSource(node: AudioScheduledSourceNode) {
    this.activeSources.add(node);
    node.addEventListener('ended', () => this.activeSources.delete(node));
  }

  private scheduleEvent(e: MusicEvent, time: number, spb: number, target: (trackId: string) => VoiceTarget) {
    const project = this.getProject();
    const track = project.tracks.find((t) => t.id === e.trackId);
    if (!track) return;
    const v = target(track.id);
    scheduleOn(v, e, time, spb, track.instrument, this.sampleBuffers);
  }

  /* ---------------- previews (audition sounds while editing) ---------------- */

  async previewDrum(trackId: string, sound: DrumSound, velocity = 0.9): Promise<void> {
    const ctx = await this.ensureStarted();
    if (!this.mixer) return;
    playDrum({ ctx, out: this.mixer.input(trackId), register: () => {} }, sound, ctx.currentTime + 0.01, velocity);
  }

  async previewNote(trackId: string, instrument: InstrumentId, pitch: number, durationSec = 0.4, velocity = 0.8): Promise<void> {
    const ctx = await this.ensureStarted();
    if (!this.mixer) return;
    playSynthNote({ ctx, out: this.mixer.input(trackId), register: () => {} }, instrument, ctx.currentTime + 0.01, pitch, durationSec, velocity);
  }

  async previewChord(trackId: string, instrument: InstrumentId, pitches: number[], durationSec = 0.9): Promise<void> {
    for (const p of pitches) await this.previewNote(trackId, instrument, p, durationSec, 0.7);
  }

  /* ---------------- offline WAV rendering ---------------- */

  async renderWav(project: Project, onProgress?: (msg: string) => void, sampleRate = 44100): Promise<RenderResult> {
    const bpb = beatsPerBar(project);
    const totalBeats = songLengthBars(project) * bpb;
    const spb = 60 / project.bpm;
    const tail = 3;
    const durationSec = totalBeats * spb + tail;
    const length = Math.ceil(durationSec * sampleRate);
    if (length > sampleRate * 60 * 20) throw new Error('Songs longer than 20 minutes cannot be exported in the browser.');

    const OfflineCtor: typeof OfflineAudioContext =
      window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineCtor) throw new Error('Offline rendering is not supported in this browser.');
    const offline = new OfflineCtor(2, length, sampleRate);
    const mixer = new MixerGraph(offline, offline.destination, false);
    mixer.sync(project, true);

    onProgress?.('Loading audio clips…');
    const buffers = new Map<string, AudioBuffer>();
    const missing: string[] = [];
    for (const s of project.samples) {
      const cached = this.sampleBuffers.get(s.id);
      const buf = cached ?? (await this.decodeSample(offline, s.id));
      if (buf) buffers.set(s.id, buf);
      else if (project.clips.some((c) => c.sampleId === s.id)) missing.push(s.name);
    }

    onProgress?.('Scheduling notes…');
    const events = collectArrangementEvents(project, 0, totalBeats, { isStart: true });
    const start = 0.02;
    for (const e of events) {
      const track = project.tracks.find((t) => t.id === e.trackId);
      if (!track) continue;
      scheduleOn({ ctx: offline, out: mixer.input(track.id), register: () => {} }, e, start + e.beat * spb, spb, track.instrument, buffers);
    }

    onProgress?.('Rendering audio (this can take a few seconds)…');
    const rendered = await offline.startRendering();
    const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
    onProgress?.('Encoding WAV…');
    const wav = encodeWav(channels, sampleRate, 16);
    return { wav, durationSec, peak: peakLevel(channels), missingSamples: missing };
  }
}

function scheduleOn(
  v: VoiceTarget,
  e: MusicEvent,
  time: number,
  spb: number,
  instrument: InstrumentId,
  buffers: Map<string, AudioBuffer>,
) {
  if (e.type === 'drum') {
    playDrum(v, e.sound, time, e.velocity);
  } else if (e.type === 'note') {
    playSynthNote(v, instrument, time, e.pitch, e.durationBeats * spb, e.velocity);
  } else {
    const buffer = buffers.get(e.sampleId);
    if (!buffer) return;
    const offset = e.offsetBeats * spb;
    if (offset >= buffer.duration) return;
    const src = v.ctx.createBufferSource();
    src.buffer = buffer;
    const g = v.ctx.createGain();
    const dur = Math.min(buffer.duration - offset, e.durationBeats * spb);
    // tiny fades avoid clicks at clip edges
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(1, time + 0.005);
    g.gain.setValueAtTime(1, time + Math.max(0.006, dur - 0.01));
    g.gain.linearRampToValueAtTime(0, time + dur);
    src.connect(g).connect(v.out);
    src.start(time, offset, dur);
    v.register(src);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
  }
}
