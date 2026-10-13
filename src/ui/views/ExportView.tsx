import { useRef, useState } from 'react';
import { useStudio } from '../studioContext';
import { downloadBytes } from '../hooks';
import { projectToMidi, parseMidi, gmNoteToDrum, MidiParseError } from '../../core/export/midi';
import { beatsPerBar, songLengthBars, LIMITS } from '../../core/project/schema';
import { addClip, addPattern, addTrack } from '../../core/project/ops';
import { emptyDrumRows, notePattern } from '../../core/music/generators';
import { safeFileName, validateMidiFile } from '../../storage/fileValidation';
import { storageEstimate } from '../../storage/stores';
import { uid } from '../../core/util';
import type { DrumPattern, Project } from '../../core/types';

export default function ExportView() {
  const studio = useStudio();
  const { project, engine, repo, commit } = studio;
  const [rendering, setRendering] = useState<string | null>(null);
  const [lastWav, setLastWav] = useState<{ seconds: number; peak: number; sizeMB: number; missing: string[] } | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const midiInput = useRef<HTMLInputElement>(null);
  const bpb = beatsPerBar(project);
  const bars = songLengthBars(project);
  const seconds = (bars * bpb * 60) / project.bpm;
  const hasContent = project.clips.length > 0;

  const exportWav = async () => {
    if (!hasContent) {
      studio.toast('Your song is empty — add some clips in Arrange first.', 'error');
      return;
    }
    studio.stop();
    setRendering('Preparing…');
    try {
      const result = await engine.renderWav(project, setRendering);
      downloadBytes(result.wav, safeFileName(project.name, 'wav'), 'audio/wav');
      setLastWav({ seconds: result.durationSec, peak: result.peak, sizeMB: result.wav.length / 1048576, missing: result.missingSamples });
      studio.toast('WAV exported — check your Downloads folder', 'success');
    } catch (e) {
      studio.toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setRendering(null);
    }
  };

  const exportMidi = () => {
    try {
      const bytes = projectToMidi(project);
      downloadBytes(bytes, safeFileName(project.name, 'mid'), 'audio/midi');
      studio.toast('MIDI exported', 'success');
    } catch (e) {
      studio.toast(`MIDI export failed: ${(e as Error).message}`, 'error');
    }
  };

  const exportBackup = async () => {
    try {
      await studio.saveNow();
      const backup = await repo.exportBackup(project);
      downloadBytes(JSON.stringify(backup), safeFileName(project.name, 'easybeat.json'), 'application/json');
      studio.toast('Backup saved — keep this file somewhere safe', 'success');
    } catch (e) {
      studio.toast(`Backup failed: ${(e as Error).message}`, 'error');
    }
  };

  const importMidi = async (file: File) => {
    const check = validateMidiFile(file);
    if (!check.ok) {
      studio.toast(check.reason, 'error');
      return;
    }
    try {
      const midi = parseMidi(new Uint8Array(await file.arrayBuffer()));
      const usable = midi.tracks.filter((t) => t.notes.length > 0);
      if (usable.length === 0) {
        studio.toast('That MIDI file has no notes.', 'error');
        return;
      }
      if (project.tracks.length + usable.length > LIMITS.maxTracks) {
        studio.toast(`Importing would exceed ${LIMITS.maxTracks} tracks. Remove some tracks first.`, 'error');
        return;
      }
      let truncated = false;
      commit(`Import MIDI "${file.name}"`, (d: Project) => {
        if (midi.bpm && d.clips.length === 0) d.bpm = Math.min(LIMITS.bpmMax, Math.max(LIMITS.bpmMin, midi.bpm));
        const dBpb = beatsPerBar(d);
        for (const t of usable) {
          if (t.isDrums) {
            const steps = 64;
            const rows = emptyDrumRows(steps);
            for (const n of t.notes) {
              const sound = gmNoteToDrum(n.pitch);
              const step = Math.round(n.start * 4);
              if (!sound) continue;
              if (step >= steps) { truncated = true; continue; }
              const row = rows.find((r) => r.sound === sound)!;
              row.steps[step] = Math.max(row.steps[step], n.velocity);
            }
            const pat: DrumPattern = { id: uid('pat'), name: `${t.name} (MIDI)`, type: 'drum', lengthSteps: steps, rows };
            addPattern(d, pat);
            const track = addTrack(d, 'drums', t.name);
            addClip(d, { trackId: track.id, patternId: pat.id, startBar: 0, lengthBars: Math.ceil(16 / dBpb) });
          } else {
            const end = Math.max(...t.notes.map((n) => n.start + n.duration));
            const lengthBeats = Math.min(1024, Math.max(dBpb, Math.ceil(end / dBpb) * dBpb));
            if (end > 1024) truncated = true;
            const notes = t.notes.filter((n) => n.start < lengthBeats);
            const avg = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
            const pat = addPattern(d, notePattern(`${t.name} (MIDI)`, lengthBeats, notes));
            const track = addTrack(d, avg < 48 ? 'bass' : 'instrument', t.name);
            addClip(d, { trackId: track.id, patternId: pat.id, startBar: 0, lengthBars: lengthBeats / dBpb });
          }
        }
      });
      studio.toast(`Imported ${usable.length} MIDI track(s)${truncated ? ' (very long parts were shortened)' : ''}. Find them in Arrange.`, 'success');
    } catch (e) {
      studio.toast(e instanceof MidiParseError ? e.message : `Could not import MIDI: ${(e as Error).message}`, 'error');
    }
  };

  const unusedSamples = project.samples.filter((s) => !project.clips.some((c) => c.sampleId === s.id));

  return (
    <div className="view export">
      <div className="export-grid">
        <div className="card export-card">
          <h3>Audio (WAV)</h3>
          <p className="muted small">Renders the whole arrangement — every track, effect and mixer setting — into a high-quality 44.1 kHz / 16-bit stereo WAV file you can share or upload anywhere.</p>
          <p className="small">Length: <strong>{bars} bars</strong> · about <strong>{Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, '0')}</strong> (plus a short reverb tail)</p>
          <button className="btn primary big" disabled={!!rendering} onClick={() => void exportWav()}>{rendering ? rendering : '⇩ Export WAV'}</button>
          {lastWav && (
            <div className="export-result small">
              Exported {lastWav.seconds.toFixed(1)} s, {lastWav.sizeMB.toFixed(1)} MB.
              {lastWav.peak >= 0.999 && <span className="warn"> The mix hit the maximum level — turn the master or loud tracks down slightly to avoid distortion.</span>}
              {lastWav.peak < 0.25 && <span className="warn"> The mix is quite quiet — try raising the master volume.</span>}
              {lastWav.missing.length > 0 && <span className="warn"> Missing audio (silent in the export): {lastWav.missing.join(', ')}.</span>}
            </div>
          )}
        </div>

        <div className="card export-card">
          <h3>MIDI</h3>
          <p className="muted small">Exports notes and drums (General MIDI drum map, channel 10) so you can continue in another music program. Audio clips are not included in MIDI.</p>
          <div className="inline">
            <button className="btn" onClick={exportMidi} disabled={!hasContent}>⇩ Export MIDI</button>
            <button className="btn ghost" onClick={() => midiInput.current?.click()}>Import MIDI…</button>
            <input ref={midiInput} type="file" accept=".mid,.midi,audio/midi" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importMidi(f);
            }} />
          </div>
        </div>

        <div className="card export-card">
          <h3>Backup project</h3>
          <p className="muted small">Saves everything — including recorded and imported audio — into one <code>.easybeat.json</code> file. Restore it from the home screen with “Import backup”. Do this regularly: browser storage can be cleared.</p>
          <button className="btn" onClick={() => void exportBackup()}>⇩ Download backup</button>
          <p className="muted small">
            <button className="link" onClick={async () => {
              const e = await storageEstimate();
              setUsage(e ? `This browser is using ${(e.usage / 1048576).toFixed(1)} MB of about ${(e.quota / 1073741824).toFixed(1)} GB allowed.` : 'Storage usage is not available in this browser.');
            }}>Check storage usage</button>
            {usage && ` ${usage}`}
          </p>
        </div>

        <div className="card export-card">
          <h3>Audio clips in this project</h3>
          {project.samples.length === 0 ? (
            <p className="muted small">None yet. Import or record audio on the Vocals / Audio track in Arrange.</p>
          ) : (
            <ul className="sample-list">
              {project.samples.map((s) => (
                <li key={s.id}>
                  <span>{s.name} <span className="muted small">{s.durationSec.toFixed(1)} s · {(s.sizeBytes / 1048576).toFixed(1)} MB{studio.missingSamples.includes(s.name) ? ' · MISSING' : ''}</span></span>
                  {unusedSamples.includes(s) && (
                    <button className="btn small ghost danger" onClick={() => {
                      commit('Delete audio clip', (d) => { d.samples = d.samples.filter((x) => x.id !== s.id); });
                      engine.forgetSample(s.id);
                      // free the stored audio once the change is saved
                      setTimeout(() => void studio.saveNow().then(() => repo.pruneSamples({ ...project, samples: project.samples.filter((x) => x.id !== s.id) })), 0);
                    }}>Delete</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {unusedSamples.length > 0 && <p className="muted small">Unused audio can be deleted to free space. Note: deleting audio cannot be undone.</p>}
        </div>
      </div>
    </div>
  );
}
