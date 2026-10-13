/** Rules for files users import. Pure, so they can be unit-tested. */

export const AUDIO_LIMITS = {
  maxBytes: 50 * 1024 * 1024, // 50 MB per sample
  maxDurationSec: 10 * 60, // 10 minutes
  maxSamplesPerProject: 64,
} as const;

export const BACKUP_MAX_BYTES = 300 * 1024 * 1024;
export const MIDI_MAX_BYTES = 2 * 1024 * 1024;

const AUDIO_TYPES: Record<string, string[]> = {
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  ogg: ['audio/ogg', 'application/ogg'],
  oga: ['audio/ogg'],
  flac: ['audio/flac', 'audio/x-flac'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/aac'],
  aac: ['audio/aac'],
  webm: ['audio/webm', 'video/webm'],
};

export const AUDIO_ACCEPT = Object.keys(AUDIO_TYPES).map((e) => `.${e}`).join(',');

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function validateAudioFile(file: FileLike): ValidationResult {
  const ext = extension(file.name);
  const allowed = AUDIO_TYPES[ext];
  if (!allowed) {
    return { ok: false, reason: `"${file.name}" isn't a supported audio file. Use WAV, MP3, OGG, FLAC, M4A or WEBM.` };
  }
  // Browsers sometimes leave the MIME type empty; when present it must match the extension family.
  if (file.type && !allowed.includes(file.type) && !file.type.startsWith('audio/')) {
    return { ok: false, reason: `"${file.name}" does not look like an audio file (type ${file.type}).` };
  }
  if (file.size <= 0) return { ok: false, reason: `"${file.name}" is empty.` };
  if (file.size > AUDIO_LIMITS.maxBytes) {
    return { ok: false, reason: `"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${AUDIO_LIMITS.maxBytes / 1048576} MB per sample — trim or compress it first.` };
  }
  return { ok: true };
}

export function validateMidiFile(file: FileLike): ValidationResult {
  const ext = extension(file.name);
  if (ext !== 'mid' && ext !== 'midi') return { ok: false, reason: `"${file.name}" isn't a MIDI file (.mid or .midi).` };
  if (file.size <= 0) return { ok: false, reason: 'The MIDI file is empty.' };
  if (file.size > MIDI_MAX_BYTES) return { ok: false, reason: 'MIDI files larger than 2 MB are not supported.' };
  return { ok: true };
}

export function validateBackupFile(file: FileLike): ValidationResult {
  const ext = extension(file.name);
  if (ext !== 'json' && !file.name.toLowerCase().endsWith('.easybeat.json')) {
    return { ok: false, reason: `"${file.name}" isn't an EasyBeat backup (.easybeat.json).` };
  }
  if (file.size <= 0) return { ok: false, reason: 'The backup file is empty.' };
  if (file.size > BACKUP_MAX_BYTES) return { ok: false, reason: 'Backup files larger than 300 MB are not supported.' };
  return { ok: true };
}

/** Safe file name for downloads (Windows-safe). */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'easybeat';
  return `${base}.${ext}`;
}
