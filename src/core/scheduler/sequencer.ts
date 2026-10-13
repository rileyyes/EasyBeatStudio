import type { MusicEvent } from './events';

/**
 * Lookahead sequencer ("two clocks" pattern).
 *
 * A UI timer calls `tick(now)` every ~25 ms, but timing never depends on that timer:
 * each event is handed to `schedule()` with an exact time on the AUDIO clock, a little
 * ahead of when it should sound. This keeps playback sample-accurate even when the UI
 * thread is busy. The class is pure (no Web Audio), so it is fully unit-testable.
 */

export interface SequencerRange {
  /** where playback stops when not looping (beats) */
  endBeat: number;
  /** when set, playback wraps from end back to start (beats) */
  loop?: { startBeat: number; endBeat: number } | null;
}

export interface SequencerHooks {
  /** current tempo; read each chunk so tempo changes apply within the lookahead */
  getBpm: () => number;
  getRange: () => SequencerRange;
  /** events whose start beat is in [from, to) */
  getEvents: (from: number, to: number, isStart: boolean) => MusicEvent[];
  /** schedule one event at an absolute audio-clock time */
  schedule: (event: MusicEvent, time: number, secondsPerBeat: number) => void;
  /** called once, with the audio time at which the song ends (non-loop mode) */
  onEnd?: (time: number) => void;
}

interface Anchor {
  time: number;
  beat: number;
  spb: number;
}

export class Sequencer {
  /** how far ahead events are scheduled (seconds) */
  lookahead = 0.12;
  /** max beats processed per chunk (so tempo/loop/edit changes are picked up quickly) */
  chunkBeats = 0.5;

  private cursorBeat = 0;
  private cursorTime = 0;
  private running = false;
  private ended = false;
  private pendingStart = true;
  private anchors: Anchor[] = [];

  constructor(private hooks: SequencerHooks) {}

  get isRunning(): boolean {
    return this.running;
  }

  get hasEnded(): boolean {
    return this.ended;
  }

  start(audioTime: number, fromBeat: number): void {
    this.running = true;
    this.ended = false;
    this.pendingStart = true;
    this.cursorBeat = Math.max(0, fromBeat);
    this.cursorTime = audioTime;
    this.anchors = [{ time: audioTime, beat: this.cursorBeat, spb: 60 / this.bpm() }];
  }

  stop(): void {
    this.running = false;
  }

  private bpm(): number {
    const b = this.hooks.getBpm();
    return Number.isFinite(b) && b > 0 ? b : 120;
  }

  /** Schedule everything that falls within [cursor, now + lookahead). */
  tick(now: number): void {
    if (!this.running || this.ended) return;
    const horizon = now + this.lookahead;
    // If the timer stalled badly (tab in background), skip ahead instead of bursting old notes.
    if (this.cursorTime < now - 0.25) {
      const spb = 60 / this.bpm();
      const skippedBeats = (now - this.cursorTime) / spb;
      this.cursorBeat += skippedBeats;
      this.cursorTime = now;
      this.wrapIfLooping();
      this.pushAnchor(this.cursorTime, this.cursorBeat, spb);
    }
    let guard = 0;
    while (this.cursorTime < horizon && this.running && !this.ended && guard++ < 1000) {
      const spb = 60 / this.bpm();
      const range = this.hooks.getRange();
      const loop = range.loop && range.loop.endBeat > range.loop.startBeat ? range.loop : null;
      const limit = loop ? loop.endBeat : range.endBeat;

      if (this.cursorBeat >= limit) {
        if (loop) {
          this.cursorBeat = loop.startBeat;
          this.pendingStart = true;
          this.pushAnchor(this.cursorTime, this.cursorBeat, spb);
          continue;
        }
        this.ended = true;
        this.hooks.onEnd?.(this.cursorTime);
        break;
      }

      const beatsUntilHorizon = (horizon - this.cursorTime) / spb;
      const chunk = Math.max(1e-6, Math.min(this.chunkBeats, beatsUntilHorizon, limit - this.cursorBeat));
      const from = this.cursorBeat;
      // land exactly on the loop/song boundary so floating-point drift can't leak an extra event
      const to = limit - (from + chunk) < 1e-9 ? limit : from + chunk;
      const events = this.hooks.getEvents(from, to, this.pendingStart);
      this.pendingStart = false;
      for (const e of events) {
        const t = this.cursorTime + (e.beat - from) * spb;
        this.hooks.schedule(e, t, spb);
      }
      this.cursorTime += (to - from) * spb;
      this.cursorBeat = to;
      this.pushAnchor(this.cursorTime, this.cursorBeat, spb);
    }
  }

  private wrapIfLooping(): void {
    const range = this.hooks.getRange();
    const loop = range.loop;
    if (loop && loop.endBeat > loop.startBeat && this.cursorBeat >= loop.endBeat) {
      const len = loop.endBeat - loop.startBeat;
      this.cursorBeat = loop.startBeat + ((this.cursorBeat - loop.startBeat) % len);
      this.pendingStart = true;
    }
  }

  private pushAnchor(time: number, beat: number, spb: number): void {
    this.anchors.push({ time, beat, spb });
    if (this.anchors.length > 64) this.anchors.splice(0, this.anchors.length - 64);
  }

  /** Musical position (beats) that is audible at the given audio time — drives the playhead. */
  beatAt(time: number): number {
    if (this.anchors.length === 0) return this.cursorBeat;
    let a = this.anchors[0];
    for (const anchor of this.anchors) {
      if (anchor.time <= time + 1e-9) a = anchor;
      else break;
    }
    return a.beat + Math.max(0, time - a.time) / a.spb;
  }
}
