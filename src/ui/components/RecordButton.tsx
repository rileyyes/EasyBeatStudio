import { useEffect, useRef, useState } from 'react';
import { MicRecorder } from '../../audio/recorder';
import { useStudio } from '../studioContext';
import { importAudio } from '../audioImport';
import { beatsPerBar } from '../../core/project/schema';

/** Record from the microphone onto a track. Plays the song while recording so you can perform along. */
export default function RecordButton({ trackId }: { trackId: string }) {
  const studio = useStudio();
  const rec = useRef<MicRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startBar = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(rec.current?.elapsedSec ?? 0), 200);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => () => rec.current?.cancel(), []);

  if (!MicRecorder.isSupported) {
    return <button className="btn small ghost" disabled title="This browser cannot record audio">● Rec</button>;
  }

  const start = async () => {
    try {
      const r = new MicRecorder();
      await r.start();
      rec.current = r;
      const bpb = beatsPerBar(studio.project);
      startBar.current = Math.floor(studio.cursorBeat / bpb);
      setRecording(true);
      void studio.playSong(startBar.current * bpb);
    } catch (e) {
      studio.toast((e as Error).message, 'error');
    }
  };

  const stop = async () => {
    const r = rec.current;
    rec.current = null;
    setRecording(false);
    studio.stop();
    if (!r) return;
    try {
      const blob = await r.stop();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const n = studio.project.samples.length + 1;
      await importAudio(studio, blob, `Recording ${n}.${ext}`, trackId, startBar.current);
    } catch (e) {
      studio.toast((e as Error).message, 'error');
    }
  };

  return recording ? (
    <button className="btn small rec active" onClick={() => void stop()} title="Stop recording">■ {elapsed.toFixed(0)}s</button>
  ) : (
    <button className="btn small rec" onClick={() => void start()} title="Record from your microphone, starting at the playhead bar (the song plays while you record)">● Rec</button>
  );
}
