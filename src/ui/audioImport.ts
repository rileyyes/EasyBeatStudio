import type { StudioApi } from './studioContext';
import { AUDIO_LIMITS, validateAudioFile } from '../storage/fileValidation';
import { addClip } from '../core/project/ops';
import { beatsPerBar } from '../core/project/schema';

/**
 * Validates, decodes and stores an audio file (imported or recorded), then places it
 * on a track at `startBar`. Audio stays on this computer.
 */
export async function importAudio(studio: StudioApi, file: Blob, name: string, trackId: string, startBar: number): Promise<void> {
  const check = validateAudioFile({ name, type: file.type, size: file.size });
  if (!check.ok) {
    studio.toast(check.reason, 'error');
    return;
  }
  if (studio.project.samples.length >= AUDIO_LIMITS.maxSamplesPerProject) {
    studio.toast(`A project can hold up to ${AUDIO_LIMITS.maxSamplesPerProject} audio clips.`, 'error');
    return;
  }
  let buffer: AudioBuffer;
  try {
    buffer = await studio.engine.decodeFile(file);
  } catch (e) {
    studio.toast((e as Error).message, 'error');
    return;
  }
  if (buffer.duration > AUDIO_LIMITS.maxDurationSec) {
    studio.toast(`"${name}" is longer than ${AUDIO_LIMITS.maxDurationSec / 60} minutes. Trim it first.`, 'error');
    return;
  }
  try {
    const ref = await studio.repo.putSample(studio.project.id, file, {
      name,
      mimeType: file.type || 'audio/wav',
      sizeBytes: file.size,
      durationSec: buffer.duration,
    });
    studio.engine.cacheSampleBuffer(ref.id, buffer);
    studio.commit(`Add audio "${name}"`, (d) => {
      d.samples.push(ref);
      const barSec = (60 / d.bpm) * beatsPerBar(d);
      addClip(d, { trackId, sampleId: ref.id, startBar, lengthBars: Math.max(1, Math.ceil(buffer.duration / barSec - 1e-6)) });
    });
    // Persist immediately so the project never references audio that isn't saved yet
    setTimeout(() => void studio.saveNow(), 0);
    studio.toast(`Added "${name}" (${buffer.duration.toFixed(1)} s)`, 'success');
  } catch (e) {
    studio.toast(`Could not store the audio: ${(e as Error).message}. Browser storage may be full.`, 'error');
  }
}
