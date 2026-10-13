import type { Project, ProjectSummary, SampleRef } from '../core/types';
import { deserializeProject, normalizeProject, PROJECT_FORMAT_VERSION, ProjectFormatError, serializeProject } from '../core/project/schema';
import { deepClone, sanitizeName, uid } from '../core/util';
import type { Storage, StoredAsset } from './stores';

export const BACKUP_APP_ID = 'easybeat-studio';

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  backupVersion: 1;
  exportedAt: number;
  project: Project;
  assets: { id: string; name: string; mimeType: string; dataBase64: string }[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * All project persistence goes through this class: save/load/rename/duplicate/delete,
 * sample assets, and full backups (project + audio in one JSON file).
 */
export class ProjectRepository {
  constructor(private storage: Storage) {}

  async list(): Promise<ProjectSummary[]> {
    const all = await this.storage.listProjects();
    return all
      .map((p) => ({ id: p.id, name: p.name, genre: p.genre as ProjectSummary['genre'], bpm: p.bpm, createdAt: p.createdAt, updatedAt: p.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async save(project: Project): Promise<Project> {
    const saved: Project = { ...project, formatVersion: PROJECT_FORMAT_VERSION, updatedAt: Date.now() };
    await this.storage.putProject({
      id: saved.id,
      json: serializeProject(saved),
      name: saved.name,
      genre: saved.genre,
      bpm: saved.bpm,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    });
    return saved;
  }

  /** Loads and validates a project. Throws ProjectFormatError for unreadable data. */
  async load(id: string): Promise<{ project: Project; missingSamples: string[] }> {
    const stored = await this.storage.getProject(id);
    if (!stored) throw new ProjectFormatError('That project no longer exists.');
    const project = deserializeProject(stored.json);
    const missingSamples: string[] = [];
    for (const s of project.samples) {
      const asset = await this.storage.getAsset(s.id);
      if (!asset) missingSamples.push(s.name);
    }
    return { project, missingSamples };
  }

  async rename(id: string, name: string): Promise<void> {
    const { project } = await this.load(id);
    project.name = sanitizeName(name, project.name);
    await this.save(project);
  }

  async duplicate(id: string): Promise<Project> {
    const { project } = await this.load(id);
    const copy = deepClone(project);
    copy.id = uid('prj');
    copy.name = sanitizeName(`${project.name} (copy)`, 'Untitled Song');
    copy.createdAt = Date.now();
    // Copy audio so the two projects stay independent
    const idMap = new Map<string, string>();
    for (const s of project.samples) {
      const asset = await this.storage.getAsset(s.id);
      if (!asset) continue;
      const newId = uid('smp');
      idMap.set(s.id, newId);
      await this.storage.putAsset({ ...asset, id: newId, projectId: copy.id });
    }
    copy.samples = copy.samples.filter((s) => idMap.has(s.id)).map((s) => ({ ...s, id: idMap.get(s.id)! }));
    copy.clips = copy.clips
      .filter((c) => !c.sampleId || idMap.has(c.sampleId))
      .map((c) => (c.sampleId ? { ...c, sampleId: idMap.get(c.sampleId) } : c));
    return this.save(copy);
  }

  async delete(id: string): Promise<void> {
    const assets = await this.storage.listAssets(id);
    for (const a of assets) await this.storage.deleteAsset(a.id);
    await this.storage.deleteProject(id);
  }

  /* ---------------- samples ---------------- */

  async putSample(projectId: string, blob: Blob, meta: Omit<SampleRef, 'id' | 'createdAt'>): Promise<SampleRef> {
    const ref: SampleRef = { ...meta, id: uid('smp'), createdAt: Date.now() };
    await this.storage.putAsset({ id: ref.id, projectId, name: ref.name, mimeType: ref.mimeType, sizeBytes: ref.sizeBytes, blob });
    return ref;
  }

  async getSampleBlob(sampleId: string): Promise<Blob | undefined> {
    return (await this.storage.getAsset(sampleId))?.blob;
  }

  /** Removes stored audio that the project no longer references (after deleting a sample). */
  async pruneSamples(project: Project): Promise<number> {
    const keep = new Set(project.samples.map((s) => s.id));
    const assets = await this.storage.listAssets(project.id);
    let removed = 0;
    for (const a of assets) {
      if (!keep.has(a.id)) {
        await this.storage.deleteAsset(a.id);
        removed++;
      }
    }
    return removed;
  }

  /* ---------------- backups ---------------- */

  async exportBackup(project: Project): Promise<BackupFile> {
    const assets: BackupFile['assets'] = [];
    for (const s of project.samples) {
      const asset = await this.storage.getAsset(s.id);
      if (!asset) continue;
      const bytes = new Uint8Array(await asset.blob.arrayBuffer());
      assets.push({ id: s.id, name: s.name, mimeType: asset.mimeType, dataBase64: toBase64(bytes) });
    }
    return { app: BACKUP_APP_ID, backupVersion: 1, exportedAt: Date.now(), project: deepClone(project), assets };
  }

  /** Imports a backup as a NEW project (never overwrites an existing one). */
  async importBackup(json: string): Promise<{ project: Project; skippedAssets: number }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new ProjectFormatError('The backup file is damaged (not valid JSON).');
    }
    const data = parsed as Partial<BackupFile> | null;
    if (!data || typeof data !== 'object' || data.app !== BACKUP_APP_ID || !data.project) {
      throw new ProjectFormatError('This file is not an EasyBeat Studio backup.');
    }
    const project = normalizeProject(data.project);
    project.id = uid('prj');
    project.name = sanitizeName(`${project.name} (imported)`, 'Imported Song');
    project.createdAt = Date.now();

    const assetsIn = Array.isArray(data.assets) ? data.assets : [];
    const idMap = new Map<string, string>();
    let skipped = 0;
    for (const s of project.samples) {
      const a = assetsIn.find((x) => x && x.id === s.id);
      if (!a || typeof a.dataBase64 !== 'string') {
        skipped++;
        continue;
      }
      try {
        const bytes = fromBase64(a.dataBase64);
        const newId = uid('smp');
        const stored: StoredAsset = {
          id: newId,
          projectId: project.id,
          name: s.name,
          mimeType: s.mimeType,
          sizeBytes: bytes.length,
          blob: new Blob([bytes as BlobPart], { type: s.mimeType }),
        };
        await this.storage.putAsset(stored);
        idMap.set(s.id, newId);
      } catch {
        skipped++;
      }
    }
    project.samples = project.samples.filter((s) => idMap.has(s.id)).map((s) => ({ ...s, id: idMap.get(s.id)! }));
    project.clips = project.clips
      .filter((c) => !c.sampleId || idMap.has(c.sampleId))
      .map((c) => (c.sampleId ? { ...c, sampleId: idMap.get(c.sampleId) } : c));
    const saved = await this.save(project);
    return { project: saved, skippedAssets: skipped };
  }
}
