/**
 * Built-in instruments, synthesized in real time with the Web Audio API.
 * No sample files are needed, so every sound is original and license-free.
 * Every function takes a BaseAudioContext so it works for live playback AND offline WAV rendering.
 */
import type { DrumSound, InstrumentId } from '../core/types';
import { midiToFrequency } from '../core/music/theory';

export interface VoiceTarget {
  ctx: BaseAudioContext;
  out: AudioNode;
  /** lets the engine stop notes that are already scheduled when the user presses Stop */
  register: (node: AudioScheduledSourceNode) => void;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff) - 1;
    }
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function gainNode(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function autoDisconnect(source: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
  source.onended = () => {
    try {
      source.disconnect();
      for (const n of nodes) n.disconnect();
    } catch {
      /* already disconnected */
    }
  };
}

function noise(v: VoiceTarget, time: number, duration: number): AudioBufferSourceNode {
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx);
  src.start(time, Math.random() * 0.5);
  src.stop(time + duration);
  v.register(src);
  return src;
}

/* ------------------------------------------------------------------ */
/* Drums                                                               */
/* ------------------------------------------------------------------ */

export function playDrum(v: VoiceTarget, sound: DrumSound, time: number, velocity: number): void {
  const { ctx } = v;
  const vel = Math.max(0.05, Math.min(1, velocity));
  switch (sound) {
    case 'kick': {
      const osc = ctx.createOscillator();
      const g = gainNode(ctx);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, time);
      osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
      osc.frequency.exponentialRampToValueAtTime(38, time + 0.4);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(1.0 * vel, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);
      // short click for attack
      const click = ctx.createOscillator();
      const cg = gainNode(ctx);
      click.type = 'triangle';
      click.frequency.value = 1200;
      cg.gain.setValueAtTime(0.25 * vel, time);
      cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);
      osc.connect(g).connect(v.out);
      click.connect(cg).connect(v.out);
      osc.start(time);
      osc.stop(time + 0.5);
      click.start(time);
      click.stop(time + 0.02);
      v.register(osc);
      v.register(click);
      autoDisconnect(osc, g);
      autoDisconnect(click, cg);
      break;
    }
    case 'snare': {
      const n = noise(v, time, 0.25);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const ng = gainNode(ctx);
      ng.gain.setValueAtTime(0.55 * vel, time);
      ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
      n.connect(hp).connect(ng).connect(v.out);
      autoDisconnect(n, hp, ng);
      const tone = ctx.createOscillator();
      const tg = gainNode(ctx);
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(220, time);
      tone.frequency.exponentialRampToValueAtTime(160, time + 0.08);
      tg.gain.setValueAtTime(0.45 * vel, time);
      tg.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
      tone.connect(tg).connect(v.out);
      tone.start(time);
      tone.stop(time + 0.15);
      v.register(tone);
      autoDisconnect(tone, tg);
      break;
    }
    case 'clap': {
      const n = noise(v, time, 0.3);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 0.9;
      const g = gainNode(ctx);
      // three quick bursts then a short tail — the classic clap shape
      g.gain.setValueAtTime(0.0001, time);
      for (let i = 0; i < 3; i++) {
        const t = time + i * 0.011;
        g.gain.setValueAtTime(0.7 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.08 * vel, t + 0.009);
      }
      g.gain.setValueAtTime(0.55 * vel, time + 0.034);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
      n.connect(bp).connect(g).connect(v.out);
      autoDisconnect(n, bp, g);
      break;
    }
    case 'hatClosed':
    case 'hatOpen': {
      const open = sound === 'hatOpen';
      const len = open ? 0.38 : 0.06;
      const n = noise(v, time, len + 0.02);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      const g = gainNode(ctx);
      g.gain.setValueAtTime(0.32 * vel, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + len);
      n.connect(hp).connect(g).connect(v.out);
      autoDisconnect(n, hp, g);
      break;
    }
    case 'perc': {
      const osc = ctx.createOscillator();
      const g = gainNode(ctx);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, time);
      osc.frequency.exponentialRampToValueAtTime(260, time + 0.1);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      osc.connect(g).connect(v.out);
      osc.start(time);
      osc.stop(time + 0.2);
      v.register(osc);
      autoDisconnect(osc, g);
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Melodic synths                                                      */
/* ------------------------------------------------------------------ */

interface Env {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  peak: number;
}

const ENVELOPES: Record<Exclude<InstrumentId, 'drumkit' | 'sampler'>, Env> = {
  keys: { attack: 0.004, decay: 0.7, sustain: 0.3, release: 0.25, peak: 0.32 },
  pad: { attack: 0.35, decay: 0.6, sustain: 0.8, release: 0.9, peak: 0.16 },
  lead: { attack: 0.01, decay: 0.2, sustain: 0.65, release: 0.12, peak: 0.16 },
  pluck: { attack: 0.002, decay: 0.32, sustain: 0.0, release: 0.15, peak: 0.3 },
  bell: { attack: 0.002, decay: 1.6, sustain: 0.0, release: 0.4, peak: 0.24 },
  bass: { attack: 0.006, decay: 0.3, sustain: 0.75, release: 0.08, peak: 0.42 },
};

function applyEnvelope(param: AudioParam, env: Env, time: number, duration: number, velocity: number): number {
  const dur = Math.max(0.02, duration);
  const fullPeak = env.peak * (0.35 + 0.65 * velocity);
  // very short notes on slow-attack sounds only reach part of the peak
  const attackTime = Math.min(env.attack, dur);
  const peak = Math.max(0.0002, fullPeak * (attackTime / env.attack));
  const attackEnd = time + attackTime;
  param.setValueAtTime(0.0001, time);
  param.exponentialRampToValueAtTime(peak, attackEnd);
  if (env.sustain <= 0) {
    // plucked/struck sounds ring out naturally regardless of note length
    param.exponentialRampToValueAtTime(0.0001, attackEnd + env.decay);
    return attackEnd + env.decay + 0.05;
  }
  const noteEnd = time + dur;
  if (noteEnd > attackEnd) param.setTargetAtTime(Math.max(0.0001, peak * env.sustain), attackEnd, env.decay / 3);
  // release: a later setTarget takes over from whatever level the note has reached
  param.setTargetAtTime(0.0001, noteEnd, env.release / 4);
  return noteEnd + env.release + 0.05;
}

export function playSynthNote(
  v: VoiceTarget,
  instrument: InstrumentId,
  time: number,
  pitch: number,
  duration: number,
  velocity: number,
): void {
  if (instrument === 'drumkit' || instrument === 'sampler') instrument = 'keys';
  const { ctx } = v;
  const env = ENVELOPES[instrument];
  const freq = midiToFrequency(pitch);
  const vel = Math.max(0.05, Math.min(1, velocity));
  const amp = gainNode(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.connect(amp).connect(v.out);
  const oscs: OscillatorNode[] = [];
  const extra: AudioNode[] = [];

  const osc = (type: OscillatorType, detuneCents = 0, gain = 1, ratio = 1) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * ratio;
    o.detune.value = detuneCents;
    const g = gainNode(ctx, gain);
    o.connect(g).connect(filter);
    oscs.push(o);
    extra.push(g);
    return o;
  };

  switch (instrument) {
    case 'keys':
      osc('triangle', 0, 0.8);
      osc('sine', 0, 0.5, 2);
      filter.frequency.setValueAtTime(1800 + vel * 2600, time);
      filter.frequency.setTargetAtTime(1200, time, 0.4);
      break;
    case 'pad':
      osc('sawtooth', -9, 0.5);
      osc('sawtooth', 9, 0.5);
      osc('sine', 0, 0.4, 0.5);
      filter.frequency.setValueAtTime(500, time);
      filter.frequency.linearRampToValueAtTime(1600, time + Math.min(1.5, duration));
      break;
    case 'lead':
      osc('square', 0, 0.45);
      osc('sawtooth', 6, 0.45);
      filter.frequency.value = 2600 + vel * 2200;
      filter.Q.value = 2;
      break;
    case 'pluck':
      osc('sawtooth', 0, 0.7);
      osc('square', -5, 0.25);
      filter.frequency.setValueAtTime(5200 * (0.5 + vel / 2), time);
      filter.frequency.exponentialRampToValueAtTime(500, time + 0.22);
      filter.Q.value = 3;
      break;
    case 'bell': {
      const carrier = osc('sine', 0, 1);
      const mod = ctx.createOscillator();
      const modGain = gainNode(ctx);
      mod.frequency.value = freq * 3.5;
      modGain.gain.setValueAtTime(freq * 2.2, time);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.05), time + 1.2);
      mod.connect(modGain).connect(carrier.frequency);
      oscs.push(mod);
      extra.push(modGain);
      filter.frequency.value = 9000;
      break;
    }
    case 'bass':
      osc('sine', 0, 0.9);
      osc('sawtooth', 0, 0.35);
      filter.frequency.setValueAtTime(380 + vel * 700, time);
      filter.frequency.setTargetAtTime(260, time, 0.15);
      break;
  }

  const stopAt = applyEnvelope(amp.gain, env, time, duration, vel);
  for (const o of oscs) {
    o.start(time);
    o.stop(stopAt);
    v.register(o);
  }
  autoDisconnect(oscs[0], filter, amp, ...extra);
}

/* ------------------------------------------------------------------ */
/* Effects helpers                                                     */
/* ------------------------------------------------------------------ */

/** Generated stereo reverb impulse response (no external files). */
export function createReverbImpulse(ctx: BaseAudioContext, seconds = 2.4, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 987654;
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const r = seed / 4294967296 * 2 - 1;
      data[i] = r * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}
