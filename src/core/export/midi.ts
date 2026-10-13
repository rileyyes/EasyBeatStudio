import type { DrumSound, Note, Project } from '../types';
import { beatsPerBar, songLengthBars } from '../project/schema';
import { collectArrangementEvents, collectPatternPreviewEvents } from '../scheduler/events';
import { clamp, uid } from '../util';

/** General MIDI drum map (channel 10). */
export const GM_DRUMS: Record<DrumSound, number> = {
  kick: 36,
  snare: 38,
  clap: 39,
  hatClosed: 42,
  hatOpen: 46,
  perc: 45,
};

export const PPQ = 480;

interface RawMidiEvent {
  tick: number;
  /** sort order at equal ticks: note-offs before note-ons */
  order: number;
  bytes: number[];
}

function varLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0) & 0x7f);
}

function trackChunk(events: RawMidiEvent[], name: string): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const nameBytes = ascii(name).slice(0, 100);
  const data: number[] = [0x00, 0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes];
  let last = 0;
  for (const e of sorted) {
    data.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0x00, 0xff, 0x2f, 0x00);
  return [...ascii('MTrk'), ...u32(data.length), ...data];
}

export interface MidiExportOptions {
  /** export only one pattern instead of the whole arrangement */
  patternId?: string;
  trackId?: string;
}

/**
 * Builds a Standard MIDI File (format 1). One MIDI track per project track that has
 * notes. Drums go to channel 10 using the General MIDI drum map.
 */
export function projectToMidi(project: Project, opts: MidiExportOptions = {}): Uint8Array {
  const bpb = beatsPerBar(project);
  const totalBeats = songLengthBars(project) * bpb;
  const events = opts.patternId && opts.trackId
    ? collectPatternPreviewEvents(project, opts.patternId, opts.trackId, 0, 1e9)
    : collectArrangementEvents(project, 0, totalBeats + 1, { ignoreMuteSolo: false });

  const microsPerBeat = Math.round(60_000_000 / project.bpm);
  const tempoTrack = trackChunk(
    [
      { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (microsPerBeat >> 16) & 0xff, (microsPerBeat >> 8) & 0xff, microsPerBeat & 0xff] },
      { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, bpb, 2, 24, 8] },
    ],
    project.name,
  );

  const chunks: number[][] = [tempoTrack];
  let melodicChannel = 0;
  for (const track of project.tracks) {
    const trackEvents = events.filter((e) => e.trackId === track.id && e.type !== 'sample');
    if (trackEvents.length === 0) continue;
    const isDrums = trackEvents.every((e) => e.type === 'drum');
    const channel = isDrums ? 9 : melodicChannel;
    if (!isDrums) {
      melodicChannel = (melodicChannel + 1) % 16;
      if (melodicChannel === 9) melodicChannel = 10;
    }
    const raw: RawMidiEvent[] = [];
    for (const e of trackEvents) {
      const tick = Math.round(e.beat * PPQ);
      if (e.type === 'drum') {
        const vel = clamp(Math.round(e.velocity * 127), 1, 127);
        raw.push({ tick, order: 1, bytes: [0x90 | channel, GM_DRUMS[e.sound], vel] });
        raw.push({ tick: tick + PPQ / 8, order: 0, bytes: [0x80 | channel, GM_DRUMS[e.sound], 0] });
      } else if (e.type === 'note') {
        const vel = clamp(Math.round(e.velocity * 127), 1, 127);
        const off = tick + Math.max(1, Math.round(e.durationBeats * PPQ));
        raw.push({ tick, order: 1, bytes: [0x90 | channel, e.pitch, vel] });
        raw.push({ tick: off, order: 0, bytes: [0x80 | channel, e.pitch, 0] });
      }
    }
    chunks.push(trackChunk(raw, track.name));
  }

  const header = [...ascii('MThd'), ...u32(6), 0x00, 0x01, 0x00, chunks.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const all = header.concat(...chunks);
  return new Uint8Array(all);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export interface ImportedMidiTrack {
  name: string;
  channel: number;
  isDrums: boolean;
  notes: Note[];
}

export interface ImportedMidi {
  bpm: number | null;
  beatsPerBar: number | null;
  tracks: ImportedMidiTrack[];
}

export class MidiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiParseError';
  }
}

/** Parses note data, tempo and time signature from a Standard MIDI File (format 0 or 1). */
export function parseMidi(data: Uint8Array): ImportedMidi {
  let pos = 0;
  const need = (n: number) => {
    if (pos + n > data.length) throw new MidiParseError('The MIDI file is incomplete or damaged.');
  };
  const readU32 = () => {
    need(4);
    const v = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
    pos += 4;
    return v;
  };
  const readU16 = () => {
    need(2);
    const v = (data[pos] << 8) | data[pos + 1];
    pos += 2;
    return v;
  };
  const readStr = (n: number) => {
    need(n);
    const s = String.fromCharCode(...data.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const readVar = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      need(1);
      const b = data[pos++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new MidiParseError('Invalid variable-length value in MIDI file.');
  };

  if (readStr(4) !== 'MThd') throw new MidiParseError('This is not a MIDI file.');
  const headerLen = readU32();
  const format = readU16();
  const nTracks = readU16();
  const division = readU16();
  pos += headerLen - 6;
  if (format > 1) throw new MidiParseError('Only MIDI format 0 and 1 are supported.');
  if (division & 0x8000) throw new MidiParseError('SMPTE-timed MIDI files are not supported.');
  const ppq = division || 480;

  let bpm: number | null = null;
  let bpbOut: number | null = null;
  const result: ImportedMidiTrack[] = [];

  for (let t = 0; t < nTracks && pos < data.length; t++) {
    if (readStr(4) !== 'MTrk') throw new MidiParseError('Unexpected data in MIDI file.');
    const len = readU32();
    const end = pos + len;
    need(len);
    let tick = 0;
    let status = 0;
    let name = `Track ${t + 1}`;
    const open = new Map<string, { tick: number; vel: number }>();
    const byChannel = new Map<number, Note[]>();
    while (pos < end) {
      tick += readVar();
      need(1);
      let b = data[pos];
      if (b & 0x80) {
        status = b;
        pos++;
      } else if (!status) {
        throw new MidiParseError('Invalid running status in MIDI file.');
      }
      b = status;
      if (b === 0xff) {
        need(1);
        const type = data[pos++];
        const l = readVar();
        need(l);
        const payload = data.subarray(pos, pos + l);
        pos += l;
        if (type === 0x51 && l === 3 && bpm === null) bpm = Math.round(60_000_000 / ((payload[0] << 16) | (payload[1] << 8) | payload[2]));
        if (type === 0x58 && l >= 2 && bpbOut === null) bpbOut = payload[0];
        if (type === 0x03) name = String.fromCharCode(...payload).replace(/[^\x20-\x7e]/g, '').slice(0, 60) || name;
        status = 0;
      } else if (b === 0xf0 || b === 0xf7) {
        const l = readVar();
        need(l);
        pos += l;
        status = 0;
      } else {
        const kind = b & 0xf0;
        const ch = b & 0x0f;
        const dataLen = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        need(dataLen);
        const d1 = data[pos];
        const d2 = dataLen === 2 ? data[pos + 1] : 0;
        pos += dataLen;
        const k = `${ch}:${d1}`;
        if (kind === 0x90 && d2 > 0) {
          open.set(k, { tick, vel: d2 });
        } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
          const o = open.get(k);
          if (o) {
            open.delete(k);
            const list = byChannel.get(ch) ?? [];
            if (list.length < 8192) {
              list.push({
                id: uid('n'),
                pitch: d1,
                start: o.tick / ppq,
                duration: Math.max(1 / 16, (tick - o.tick) / ppq),
                velocity: clamp(o.vel / 127, 0.05, 1),
              });
            }
            byChannel.set(ch, list);
          }
        }
      }
    }
    pos = end;
    for (const [ch, notes] of byChannel) {
      result.push({ name, channel: ch, isDrums: ch === 9, notes: notes.sort((a, b) => a.start - b.start) });
    }
  }
  return { bpm, beatsPerBar: bpbOut, tracks: result };
}

/** Reverse GM drum lookup used when importing drum tracks. */
export function gmNoteToDrum(pitch: number): DrumSound | null {
  switch (pitch) {
    case 35:
    case 36:
      return 'kick';
    case 38:
    case 40:
      return 'snare';
    case 39:
      return 'clap';
    case 42:
    case 44:
      return 'hatClosed';
    case 46:
      return 'hatOpen';
    default:
      return pitch >= 41 && pitch <= 81 ? 'perc' : null;
  }
}
