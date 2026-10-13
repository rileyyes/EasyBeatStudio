/**
 * Storage abstraction. The app talks to `ProjectStore` / `AssetStore`; the browser
 * implementation uses IndexedDB, tests use the in-memory one. A future cloud backend
 * would implement the same interfaces without touching the audio engine or UI.
 */

export interface StoredProject {
  id: string;
  /** serialized Project JSON */
  json: string;
  name: string;
  genre: string;
  bpm: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredAsset {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

export interface ProjectStore {
  getProject(id: string): Promise<StoredProject | undefined>;
  putProject(p: StoredProject): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listProjects(): Promise<StoredProject[]>;
}

export interface AssetStore {
  getAsset(id: string): Promise<StoredAsset | undefined>;
  putAsset(a: StoredAsset): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  listAssets(projectId: string): Promise<StoredAsset[]>;
}

export type Storage = ProjectStore & AssetStore;

export class MemoryStorage implements Storage {
  private projects = new Map<string, StoredProject>();
  private assets = new Map<string, StoredAsset>();
  async getProject(id: string) {
    const p = this.projects.get(id);
    return p ? { ...p } : undefined;
  }
  async putProject(p: StoredProject) {
    this.projects.set(p.id, { ...p });
  }
  async deleteProject(id: string) {
    this.projects.delete(id);
  }
  async listProjects() {
    return [...this.projects.values()].map((p) => ({ ...p }));
  }
  async getAsset(id: string) {
    return this.assets.get(id);
  }
  async putAsset(a: StoredAsset) {
    this.assets.set(a.id, a);
  }
  async deleteAsset(id: string) {
    this.assets.delete(id);
  }
  async listAssets(projectId: string) {
    return [...this.assets.values()].filter((a) => a.projectId === projectId);
  }
}

interface StoredAssetRow {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  data: ArrayBuffer;
}

function rowToAsset(row: StoredAssetRow): StoredAsset {
  return { id: row.id, projectId: row.projectId, name: row.name, mimeType: row.mimeType, sizeBytes: row.sizeBytes, blob: new Blob([row.data], { type: row.mimeType }) };
}

const DB_NAME = 'easybeat-studio';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbStorage implements Storage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory = globalThis.indexedDB) {}

  private db(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('This browser does not support IndexedDB, so projects cannot be saved.'));
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = this.factory.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          // Additive upgrades only — never drop user data.
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('assets')) {
            const s = db.createObjectStore('assets', { keyPath: 'id' });
            s.createIndex('byProject', 'projectId', { unique: false });
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('Could not open the local project database.'));
        open.onblocked = () => reject(new Error('The project database is open in another tab with an older version. Close other EasyBeat tabs and reload.'));
      });
    }
    return this.dbPromise;
  }

  private async store(name: 'projects' | 'assets', mode: IDBTransactionMode) {
    const db = await this.db();
    return db.transaction(name, mode).objectStore(name);
  }

  async getProject(id: string) {
    return req<StoredProject | undefined>((await this.store('projects', 'readonly')).get(id));
  }
  async putProject(p: StoredProject) {
    await req((await this.store('projects', 'readwrite')).put(p));
  }
  async deleteProject(id: string) {
    await req((await this.store('projects', 'readwrite')).delete(id));
  }
  async listProjects() {
    return req<StoredProject[]>((await this.store('projects', 'readonly')).getAll());
  }
  // Audio is stored as an ArrayBuffer (cloneable in every browser) and turned back into a Blob on read.
  async getAsset(id: string) {
    const row = await req<StoredAssetRow | undefined>((await this.store('assets', 'readonly')).get(id));
    return row ? rowToAsset(row) : undefined;
  }
  async putAsset(a: StoredAsset) {
    const data = await a.blob.arrayBuffer();
    const row: StoredAssetRow = { id: a.id, projectId: a.projectId, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, data };
    await req((await this.store('assets', 'readwrite')).put(row));
  }
  async deleteAsset(id: string) {
    await req((await this.store('assets', 'readwrite')).delete(id));
  }
  async listAssets(projectId: string) {
    const s = await this.store('assets', 'readonly');
    const rows = await req<StoredAssetRow[]>(s.index('byProject').getAll(projectId));
    return rows.map(rowToAsset);
  }
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.storage?.persist) return await nav.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.storage?.estimate) {
      const e = await nav.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}
