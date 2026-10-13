/**
 * Mixer graph: one channel strip per track (EQ → volume → pan → master) plus shared
 * reverb and delay buses, a gentle master limiter, and level meters.
 *
 *   track input → lowshelf → peaking → highshelf → fader → panner ─┬─► master bus
 *                                                                   ├─► reverb send
 *                                                                   └─► delay send
 *   master bus → master fader → limiter → analyser → destination
 */
import type { Project, Track } from '../core/types';
import { audibleTrackIds } from '../core/scheduler/events';
import { createReverbImpulse } from './instruments';

export interface ChannelStrip {
  trackId: string;
  input: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  fader: GainNode;
  panner: StereoPannerNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  analyser: AnalyserNode | null;
}

function smooth(param: AudioParam, value: number, ctx: BaseAudioContext, immediate: boolean) {
  if (immediate) param.value = value;
  else param.setTargetAtTime(value, ctx.currentTime, 0.02);
}

export class MixerGraph {
  readonly master: GainNode;
  readonly masterAnalyser: AnalyserNode | null;
  private limiter: DynamicsCompressorNode;
  private reverb: ConvolverNode;
  private reverbReturn: GainNode;
  private delay: DelayNode;
  private delayFeedback: GainNode;
  private delayReturn: GainNode;
  readonly channels = new Map<string, ChannelStrip>();

  constructor(private ctx: BaseAudioContext, destination: AudioNode, private withMeters: boolean) {
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.master.connect(this.limiter);
    if (withMeters) {
      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 1024;
      this.limiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(destination);
    } else {
      this.masterAnalyser = null;
      this.limiter.connect(destination);
    }

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createReverbImpulse(ctx);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.9;
    this.reverb.connect(this.reverbReturn).connect(this.master);

    this.delay = ctx.createDelay(4);
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 3500;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.7;
    this.delay.connect(delayTone).connect(this.delayFeedback).connect(this.delay);
    delayTone.connect(this.delayReturn).connect(this.master);
  }

  private createChannel(track: Track): ChannelStrip {
    const { ctx } = this;
    const input = ctx.createGain();
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1200;
    eqMid.Q.value = 0.8;
    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 5000;
    const fader = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const reverbSend = ctx.createGain();
    const delaySend = ctx.createGain();
    input.connect(eqLow).connect(eqMid).connect(eqHigh).connect(fader).connect(panner);
    panner.connect(this.master);
    panner.connect(reverbSend).connect(this.reverb);
    panner.connect(delaySend).connect(this.delay);
    let analyser: AnalyserNode | null = null;
    if (this.withMeters) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      panner.connect(analyser);
    }
    const strip: ChannelStrip = { trackId: track.id, input, eqLow, eqMid, eqHigh, fader, panner, reverbSend, delaySend, analyser };
    this.channels.set(track.id, strip);
    return strip;
  }

  /** Bring the graph in line with the project's mixer settings (creates/removes channels as needed). */
  sync(project: Project, immediate = false): void {
    const { ctx } = this;
    const audible = audibleTrackIds(project.tracks);
    const present = new Set(project.tracks.map((t) => t.id));
    for (const [id, strip] of this.channels) {
      if (!present.has(id)) {
        strip.input.disconnect();
        strip.panner.disconnect();
        this.channels.delete(id);
      }
    }
    for (const track of project.tracks) {
      const strip = this.channels.get(track.id) ?? this.createChannel(track);
      const gain = audible.has(track.id) ? track.volume : 0;
      smooth(strip.fader.gain, gain, ctx, immediate);
      smooth(strip.panner.pan, track.pan, ctx, immediate);
      smooth(strip.eqLow.gain, track.effects.eqLow, ctx, immediate);
      smooth(strip.eqMid.gain, track.effects.eqMid, ctx, immediate);
      smooth(strip.eqHigh.gain, track.effects.eqHigh, ctx, immediate);
      smooth(strip.reverbSend.gain, track.effects.reverb * 0.6, ctx, immediate);
      smooth(strip.delaySend.gain, track.effects.delay * 0.5, ctx, immediate);
    }
    smooth(this.master.gain, project.masterVolume, ctx, immediate);
    // dotted-8th delay, synced to tempo
    smooth(this.delay.delayTime, Math.min(3.9, (60 / project.bpm) * 0.75), ctx, immediate);
  }

  input(trackId: string): AudioNode {
    return this.channels.get(trackId)?.input ?? this.master;
  }

  dispose(): void {
    for (const strip of this.channels.values()) {
      strip.input.disconnect();
      strip.panner.disconnect();
    }
    this.channels.clear();
    this.master.disconnect();
    this.limiter.disconnect();
    this.reverb.disconnect();
    this.delay.disconnect();
  }
}

/** RMS level (0..1) of an analyser's current window. */
export function readLevel(analyser: AnalyserNode | null, scratch: Float32Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(scratch);
  const n = Math.min(scratch.length, analyser.fftSize);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += scratch[i] * scratch[i];
  return Math.sqrt(sum / n);
}
