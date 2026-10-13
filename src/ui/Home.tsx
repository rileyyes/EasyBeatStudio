import { useEffect, useRef, useState } from 'react';
import type { Genre, Mood, MusicalKey, Project, ProjectSummary } from '../core/types';
import { createProjectFromTemplate, TEMPLATES } from '../core/music/templates';
import { createEmptyProject, ProjectFormatError } from '../core/project/schema';
import { MOODS } from '../core/music/generators';
import { NOTE_NAMES } from '../core/music/theory';
import type { ProjectRepository } from '../storage/projectRepository';
import { storageEstimate } from '../storage/stores';
import { validateBackupFile } from '../storage/fileValidation';

interface Props {
  repo: ProjectRepository;
  onOpen: (project: Project, missingSamples?: string[]) => void;
}

const GENRE_ICONS: Record<Genre, string> = { 'hip-hop': '🎧', pop: '✨', rock: '🎸', electronic: '🎛️', ambient: '🌙' };

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function Home({ repo, onOpen }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [blank, setBlank] = useState<{ name: string; genre: Genre | 'blank'; mood: Mood; bpm: number; key: MusicalKey }>({
    name: '',
    genre: 'blank',
    mood: 'happy',
    bpm: 100,
    key: { tonic: 'C', mode: 'major' },
  });
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setProjects(await repo.list());
      setUsage(await storageEstimate());
    } catch (e) {
      setProjects([]);
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ProjectFormatError ? e.message : `Something went wrong: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const startTemplate = (genre: Genre) =>
    run(async () => {
      const p = await repo.save(createProjectFromTemplate(genre, undefined, Math.floor(Math.random() * 1000)));
      onOpen(p);
    });

  const startBlank = () =>
    run(async () => {
      const p = createEmptyProject({ name: blank.name || 'Untitled Song', genre: blank.genre, mood: blank.mood, bpm: blank.bpm, key: blank.key });
      onOpen(await repo.save(p));
    });

  const openExisting = (id: string) =>
    run(async () => {
      const { project, missingSamples } = await repo.load(id);
      onOpen(project, missingSamples);
    });

  const importBackup = (file: File) =>
    run(async () => {
      const check = validateBackupFile(file);
      if (!check.ok) throw new ProjectFormatError(check.reason);
      const { project, skippedAssets } = await repo.importBackup(await file.text());
      onOpen(project, skippedAssets > 0 ? [`${skippedAssets} audio clip(s) from the backup`] : []);
    });

  return (
    <div className="home">
      <header className="home-hero">
        <div className="logo-mark" aria-hidden>
          <span /><span /><span /><span />
        </div>
        <div>
          <h1>EasyBeat Studio</h1>
          <p>Make a complete song in minutes — no music theory or studio experience needed.</p>
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="btn ghost small" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="home-section">
        <h2>Start from a template</h2>
        <p className="muted">A full, playable song with drums, bass, chords and melody. Change anything you like.</p>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button key={t.genre} className={`template-card genre-${t.genre}`} disabled={busy} onClick={() => startTemplate(t.genre)}>
              <span className="template-icon" aria-hidden>{GENRE_ICONS[t.genre]}</span>
              <strong>{t.label}</strong>
              <span className="muted small">{t.tagline}</span>
              <span className="template-meta">{t.bpm} BPM · {t.key.tonic} {t.key.mode} · {t.mood}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="home-columns">
        <section className="home-section card">
          <h2>New blank project</h2>
          <p className="muted small">Start from scratch. You can change all of these later.</p>
          <label className="field">
            <span>Song name</span>
            <input type="text" maxLength={60} placeholder="Untitled Song" value={blank.name} onChange={(e) => setBlank({ ...blank, name: e.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Direction</span>
              <select value={blank.genre} onChange={(e) => {
                const g = e.target.value as Genre | 'blank';
                const t = TEMPLATES.find((x) => x.genre === g);
                setBlank({ ...blank, genre: g, ...(t ? { bpm: t.bpm, mood: t.mood, key: t.key } : {}) });
              }}>
                <option value="blank">Not sure yet</option>
                {TEMPLATES.map((t) => <option key={t.genre} value={t.genre}>{t.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Mood</span>
              <select value={blank.mood} onChange={(e) => setBlank({ ...blank, mood: e.target.value as Mood })}>
                {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Tempo (BPM)</span>
              <input type="number" min={40} max={240} value={blank.bpm} onChange={(e) => setBlank({ ...blank, bpm: Math.max(40, Math.min(240, Number(e.target.value) || 100)) })} />
            </label>
            <label className="field">
              <span>Key</span>
              <div className="inline">
                <select value={blank.key.tonic} onChange={(e) => setBlank({ ...blank, key: { ...blank.key, tonic: e.target.value as MusicalKey['tonic'] } })}>
                  {NOTE_NAMES.map((n) => <option key={n}>{n}</option>)}
                </select>
                <select value={blank.key.mode} onChange={(e) => setBlank({ ...blank, key: { ...blank.key, mode: e.target.value as MusicalKey['mode'] } })}>
                  <option value="major">major</option>
                  <option value="minor">minor</option>
                </select>
              </div>
            </label>
          </div>
          <button className="btn primary" disabled={busy} onClick={startBlank}>Create project</button>
        </section>

        <section className="home-section card">
          <div className="section-head">
            <h2>Your projects</h2>
            <button className="btn ghost small" disabled={busy} onClick={() => fileInput.current?.click()} title="Open a .easybeat.json backup file">
              Import backup…
            </button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importBackup(f);
            }} />
          </div>
          {projects === null ? (
            <p className="muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="muted">No saved projects yet. Pick a template above to start your first song.</p>
          ) : (
            <ul className="project-list">
              {projects.map((p) => (
                <li key={p.id}>
                  {renaming === p.id ? (
                    <form className="inline grow" onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await repo.rename(p.id, renameValue);
                        setRenaming(null);
                        await refresh();
                      });
                    }}>
                      <input type="text" autoFocus maxLength={60} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                      <button className="btn small primary" type="submit">Save</button>
                      <button className="btn small ghost" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <button className="project-open grow" disabled={busy} onClick={() => openExisting(p.id)}>
                      <strong>{p.name}</strong>
                      <span className="muted small">{p.genre === 'blank' ? 'Blank' : p.genre} · {Math.round(p.bpm)} BPM · edited {timeAgo(p.updatedAt)}</span>
                    </button>
                  )}
                  {renaming !== p.id && (
                    <div className="row-actions">
                      <button className="btn small ghost" title="Rename" onClick={() => { setRenaming(p.id); setRenameValue(p.name); }}>Rename</button>
                      <button className="btn small ghost" title="Make a copy" disabled={busy} onClick={() => run(async () => { await repo.duplicate(p.id); await refresh(); })}>Duplicate</button>
                      <button className="btn small ghost danger" title="Delete permanently" disabled={busy} onClick={() => {
                        if (window.confirm(`Delete "${p.name}"? This cannot be undone. Tip: export a backup first from the Export tab.`)) {
                          void run(async () => { await repo.delete(p.id); await refresh(); });
                        }
                      }}>Delete</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small storage-note">
            Projects are saved privately in this browser on this computer — nothing is uploaded. Clearing browser data
            deletes them, so use <em>Export → Backup project</em> to keep a copy.
            {usage && usage.quota > 0 && ` Using ${(usage.usage / 1048576).toFixed(1)} MB of ${(usage.quota / 1073741824).toFixed(1)} GB available.`}
          </p>
        </section>
      </div>
    </div>
  );
}
