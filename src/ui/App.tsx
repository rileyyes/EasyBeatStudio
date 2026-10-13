import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../core/types';
import { IndexedDbStorage, requestPersistentStorage } from '../storage/stores';
import { ProjectRepository } from '../storage/projectRepository';
import Home from './Home';
import Studio from './Studio';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  const repo = useMemo(() => new ProjectRepository(new IndexedDbStorage()), []);
  const [open, setOpen] = useState<{ project: Project; missingSamples: string[] } | null>(null);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  const openProject = useCallback((project: Project, missingSamples: string[] = []) => {
    setOpen({ project, missingSamples });
  }, []);

  return (
    <ErrorBoundary onReset={() => setOpen(null)}>
      {open ? (
        <Studio
          key={open.project.id}
          initialProject={open.project}
          missingSamples={open.missingSamples}
          repo={repo}
          onClose={() => setOpen(null)}
        />
      ) : (
        <Home repo={repo} onOpen={openProject} />
      )}
    </ErrorBoundary>
  );
}
