import { describe, expect, it } from 'vitest';
import { encodeWav, peakLevel } from '../src/core/export/wav';
import { GM_DRUMS, parseMidi, projectToMidi, MidiParseError, PPQ } from '../src/core/export/midi';
import { createProjectFromTemplate } from '../src/core/music/templates';
import { collectArrangementEvents } from '../src/core/scheduler/events';
import { songLengthBars } from '../src/core/project/schema';

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));

describe('WAV encoder', () => {
  it('writes a valid 16-bit stereo PCM header and samples', () => {
    const left = new Float32Array([0, 1, -1, 0.5]);
    const right = new Float32Array([0, -0.5, 2, 0]);
    const wav = encodeWav([left, right], 44100);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(wav.length).toBe(44 + 16);
    expect(view.getInt16(44 + 4, true)).toBe(32767); // left[1] = 1
    expect(view.getInt16(44 + 6, true)).toBe(-16384); // right[1] = -0.5
    expect(view.getInt16(44 + 10, true)).toBe(32767); // right[2] = 2 → clipped
    expect(peakLevel([left, right])).toBe(2);
  });
});

describe('MIDI export / import', () => {
  it('exports a valid SMF that re-imports with the same notes and tempo', () => {
    const p = createProjectFromTemplate('pop');
    const bytes = projectToMidi(p);
    expect(ascii(bytes, 0, 4)).toBe('MThd');
    expect(bytes[9]).toBe(1); // format 1
    expect((bytes[12] << 8) | bytes[13]).toBe(PPQ);

    const parsed = parseMidi(bytes);
    expect(parsed.bpm).toBe(p.bpm);
    expect(parsed.beatsPerBar).toBe(4);

    const events = collectArrangementEvents(p, 0, songLengthBars(p) * 4 + 1);
    const expectedNotes = events.filter((e) => e.type === 'note').length;
    const expectedDrums = events.filter((e) => e.type === 'drum').length;
    const melodic = parsed.tracks.filter((t) => !t.isDrums);
    const drums = parsed.tracks.filter((t) => t.isDrums);
    expect(melodic.reduce((n, t) => n + t.notes.length, 0)).toBe(expectedNotes);
    expect(drums.reduce((n, t) => n + t.notes.length, 0)).toBe(expectedDrums);
    expect(drums[0].notes.some((n) => n.pitch === GM_DRUMS.kick)).toBe(true);

    const bassTrack = parsed.tracks.find((t) => t.name === 'Bass')!;
    const bassEvents = events.filter((e) => e.type === 'note' && e.trackId === p.tracks[1].id);
    expect(bassTrack.notes[0].start).toBeCloseTo(bassEvents[0].beat, 3);
  });

  it('rejects files that are not MIDI', () => {
    expect(() => parseMidi(new TextEncoder().encode('hello world'))).toThrow(MidiParseError);
    expect(() => parseMidi(new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0]))).toThrow(MidiParseError);
  });
});
