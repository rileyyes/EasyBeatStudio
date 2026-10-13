import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/storage/stores';
import { ProjectRepository } from '../src/storage/projectRepository';
import { createProjectFromTemplate } from '../src/core/music/templates';
import { addClip } from '../src/core/project/ops';
import { safeFileName, validateAudioFile, validateBackupFile, validateMidiFile } from '../src/storage/fileValidation';
import { ProjectFormatError } from '../src/core/project/schema';

async function projectWithSample(repo: ProjectRepository) {
  const p = createProjectFromTemplate('hip-hop', 'Beat One');
  const bytes = new Uint8Array([1, 2, 3, 4, 250, 251]);
  const ref = await repo.putSample(p.id, new Blob([bytes], { type: 'audio/wav' }), { name: 'vox.wav', mimeType: 'audio/wav', sizeBytes: 6, durationSec: 1 });
  p.samples.push(ref);
  addClip(p, { trackId: p.tracks.find((t) => t.kind === 'vocals')!.id, sampleId: ref.id, startBar: 4, lengthBars: 2 });
  await repo.save(p);
  return { p, ref, bytes };
}

describe('project repository', () => {
  it('saves, lists, loads, renames, duplicates and deletes', async () => {
    const repo = new ProjectRepository(new MemoryStorage());
    const { p } = await projectWithSample(repo);
    expect((await repo.list()).map((s) => s.name)).toEqual(['Beat One']);

    const { project, missingSamples } = await repo.load(p.id);
    expect(project.clips.length).toBe(p.clips.length);
    expect(missingSamples).toEqual([]);

    await repo.rename(p.id, '  Renamed  ');
    expect((await repo.load(p.id)).project.name).toBe('Renamed');

    const copy = await repo.duplicate(p.id);
    expect(copy.id).not.toBe(p.id);
    expect(copy.samples[0].id).not.toBe(p.samples[0].id);
    expect(await repo.getSampleBlob(copy.samples[0].id)).toBeDefined();
    expect((await repo.list())).toHaveLength(2);

    await repo.delete(p.id);
    expect((await repo.list()).map((s) => s.id)).toEqual([copy.id]);
    expect(await repo.getSampleBlob(p.samples[0].id)).toBeUndefined();
    // the copy's audio survives deleting the original
    expect(await repo.getSampleBlob(copy.samples[0].id)).toBeDefined();
  });

  it('reports missing audio instead of failing to open the project', async () => {
    const storage = new MemoryStorage();
    const repo = new ProjectRepository(storage);
    const { p, ref } = await projectWithSample(repo);
    await storage.deleteAsset(ref.id);
    const { missingSamples } = await repo.load(p.id);
    expect(missingSamples).toEqual(['vox.wav']);
  });

  it('round-trips a full backup including audio, as a new project', async () => {
    const repo = new ProjectRepository(new MemoryStorage());
    const { p, bytes } = await projectWithSample(repo);
    const backup = await repo.exportBackup(p);
    const json = JSON.stringify(backup);

    const target = new ProjectRepository(new MemoryStorage());
    const { project, skippedAssets } = await target.importBackup(json);
    expect(skippedAssets).toBe(0);
    expect(project.id).not.toBe(p.id);
    expect(project.name).toBe('Beat One (imported)');
    expect(project.patterns).toEqual(p.patterns);
    const blob = await target.getSampleBlob(project.samples[0].id);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes);
    expect(project.clips.some((c) => c.sampleId === project.samples[0].id)).toBe(true);
  });

  it('rejects files that are not backups', async () => {
    const repo = new ProjectRepository(new MemoryStorage());
    await expect(repo.importBackup('{"hello":1}')).rejects.toThrow(ProjectFormatError);
    await expect(repo.importBackup('oops')).rejects.toThrow(ProjectFormatError);
  });
});

describe('file validation', () => {
  it('accepts common audio formats and rejects others', () => {
    expect(validateAudioFile({ name: 'a.wav', type: 'audio/wav', size: 1000 }).ok).toBe(true);
    expect(validateAudioFile({ name: 'a.MP3', type: '', size: 1000 }).ok).toBe(true);
    expect(validateAudioFile({ name: 'a.exe', type: 'application/x-msdownload', size: 1000 }).ok).toBe(false);
    expect(validateAudioFile({ name: 'a.wav', type: 'text/html', size: 1000 }).ok).toBe(false);
    expect(validateAudioFile({ name: 'a.wav', type: 'audio/wav', size: 0 }).ok).toBe(false);
    expect(validateAudioFile({ name: 'big.wav', type: 'audio/wav', size: 60 * 1024 * 1024 }).ok).toBe(false);
    expect(validateMidiFile({ name: 'x.mid', type: 'audio/midi', size: 100 }).ok).toBe(true);
    expect(validateMidiFile({ name: 'x.txt', type: 'text/plain', size: 100 }).ok).toBe(false);
    expect(validateBackupFile({ name: 'song.easybeat.json', type: 'application/json', size: 100 }).ok).toBe(true);
  });

  it('makes Windows-safe file names', () => {
    expect(safeFileName('My: "Song"/v2?', 'wav')).toBe('My Songv2.wav');
    expect(safeFileName('   ', 'mid')).toBe('easybeat.mid');
  });
});
