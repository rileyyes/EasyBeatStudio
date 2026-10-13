import { describe, expect, it } from 'vitest';
import { Sequencer, type SequencerRange } from '../src/core/scheduler/sequencer';
import type { MusicEvent } from '../src/core/scheduler/events';

/** A source with one event on every beat. */
function everyBeat(from: number, to: number): MusicEvent[] {
  const out: MusicEvent[] = [];
  for (let b = Math.ceil(from - 1e-9) + 0; b < to; b++) if (b >= from) out.push({ type: 'drum', trackId: 't', beat: b === 0 ? 0 : b, sound: 'kick', velocity: 1 });
  return out;
}

function run(opts: { bpm?: () => number; range: SequencerRange; ticks: number[]; startTime?: number; fromBeat?: number }) {
  const scheduled: { beat: number; time: number }[] = [];
  let endTime: number | null = null;
  const seq = new Sequencer({
    getBpm: opts.bpm ?? (() => 120),
    getRange: () => opts.range,
    getEvents: (f, t) => everyBeat(f, t),
    schedule: (e, time) => scheduled.push({ beat: e.beat, time }),
    onEnd: (t) => (endTime = t),
  });
  seq.start(opts.startTime ?? 1, opts.fromBeat ?? 0);
  for (const t of opts.ticks) seq.tick(t);
  return { scheduled, endTime: endTime as number | null, seq };
}

describe('lookahead sequencer', () => {
  it('schedules events at exact audio times for the tempo', () => {
    const ticks = Array.from({ length: 200 }, (_, i) => 1 + i * 0.025);
    const { scheduled } = run({ range: { endBeat: 8 }, ticks });
    expect(scheduled.map((s) => s.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    scheduled.forEach((s) => expect(s.time).toBeCloseTo(1 + s.beat * 0.5, 9));
  });

  it('is unaffected by irregular (jittery) timer callbacks', () => {
    const regular = run({ range: { endBeat: 16 }, ticks: Array.from({ length: 400 }, (_, i) => 1 + i * 0.025) });
    const jitterTicks: number[] = [];
    let t = 1;
    const gaps = [0.01, 0.09, 0.03, 0.11, 0.02, 0.05];
    for (let i = 0; t < 11; i++) {
      jitterTicks.push(t);
      t += gaps[i % gaps.length];
    }
    const jittery = run({ range: { endBeat: 16 }, ticks: jitterTicks });
    const upTo = (list: { time: number }[]) => list.filter((s) => s.time < 10.5).map((s) => s.time.toFixed(9));
    expect(upTo(jittery.scheduled)).toEqual(upTo(regular.scheduled));
    expect(upTo(regular.scheduled)).toHaveLength(16);
  });

  it('never schedules further ahead than the lookahead window', () => {
    const scheduled: number[] = [];
    const seq = new Sequencer({
      getBpm: () => 120,
      getRange: () => ({ endBeat: 100 }),
      getEvents: everyBeat,
      schedule: (_e, time) => scheduled.push(time),
    });
    seq.start(0, 0);
    seq.tick(0);
    expect(Math.max(...scheduled)).toBeLessThanOrEqual(0 + seq.lookahead);
  });

  it('wraps around a loop region seamlessly', () => {
    const ticks = Array.from({ length: 400 }, (_, i) => 1 + i * 0.025);
    const { scheduled, endTime } = run({ range: { endBeat: 100, loop: { startBeat: 2, endBeat: 4 } }, ticks, fromBeat: 2 });
    expect(endTime).toBeNull();
    expect(scheduled.slice(0, 6).map((s) => s.beat)).toEqual([2, 3, 2, 3, 2, 3]);
    // equally spaced in time across the wrap
    for (let i = 1; i < 6; i++) expect(scheduled[i].time - scheduled[i - 1].time).toBeCloseTo(0.5, 9);
  });

  it('reports the end of the song', () => {
    const ticks = Array.from({ length: 200 }, (_, i) => 1 + i * 0.025);
    const { endTime, seq } = run({ range: { endBeat: 4 }, ticks });
    expect(endTime).toBeCloseTo(3, 9);
    expect(seq.hasEnded).toBe(true);
  });

  it('applies tempo changes from the next chunk on', () => {
    let bpm = 120;
    const scheduled: { beat: number; time: number }[] = [];
    const seq = new Sequencer({
      getBpm: () => bpm,
      getRange: () => ({ endBeat: 100 }),
      getEvents: everyBeat,
      schedule: (e, time) => scheduled.push({ beat: e.beat, time }),
    });
    seq.start(0, 0);
    for (let t = 0; t <= 1.0; t += 0.025) seq.tick(t);
    bpm = 60;
    for (let t = 1.025; t <= 5; t += 0.025) seq.tick(t);
    const gaps = scheduled.slice(1).map((s, i) => +(s.time - scheduled[i].time).toFixed(6));
    expect(gaps[0]).toBe(0.5);
    expect(gaps[gaps.length - 1]).toBe(1);
  });

  it('maps audio time back to musical position for the playhead', () => {
    const { seq } = run({ range: { endBeat: 100 }, ticks: [1], startTime: 1, fromBeat: 4 });
    expect(seq.beatAt(1)).toBeCloseTo(4, 9);
    expect(seq.beatAt(1.05)).toBeCloseTo(4.1, 9);
    // after a long run, the playhead still follows the current time
    for (let t = 1.025; t <= 3; t += 0.025) seq.tick(t);
    expect(seq.beatAt(3)).toBeCloseTo(8, 6);
  });

  it('skips ahead instead of bursting notes after a long stall', () => {
    const scheduled: number[] = [];
    const seq = new Sequencer({
      getBpm: () => 120,
      getRange: () => ({ endBeat: 1000 }),
      getEvents: everyBeat,
      schedule: (_e, time) => scheduled.push(time),
    });
    seq.start(0, 0);
    seq.tick(0);
    seq.tick(10); // tab was in the background for 10 seconds
    expect(scheduled.every((t) => t <= 0.12 || t >= 10)).toBe(true);
  });
});
