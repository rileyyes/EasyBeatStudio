import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorage } from '../src/storage/stores';
import { ProjectRepository } from '../src/storage/projectRepository';
import { createProjectFromTemplate } from '../src/core/music/templates';

/** Exercises the real IndexedDB adapter against an in-memory IndexedDB implementation. */
describe('IndexedDB storage adapter', () => {
  it('persists projects and assets across repository instances', async () => {
    const p = createProjectFromTemplate('ambient', 'Persisted');
    const repo1 = new ProjectRepository(new IndexedDbStorage());
    const ref = await repo1.putSample(p.id, new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/wav' }), {
      name: 's.wav', mimeType: 'audio/wav', sizeBytes: 3, durationSec: 0.1,
    });
    p.samples.push(ref);
    await repo1.save(p);

    const repo2 = new ProjectRepository(new IndexedDbStorage());
    const list = await repo2.list();
    expect(list.some((s) => s.id === p.id && s.name === 'Persisted')).toBe(true);
    const { project, missingSamples } = await repo2.load(p.id);
    expect(project.patterns.length).toBe(p.patterns.length);
    expect(missingSamples).toEqual([]);

    await repo2.delete(p.id);
    expect((await repo2.list()).some((s) => s.id === p.id)).toBe(false);
    expect(await repo2.getSampleBlob(ref.id)).toBeUndefined();
  });
});
