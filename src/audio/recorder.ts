/**
 * Microphone recording via MediaRecorder. Audio never leaves the computer:
 * the recording is stored locally in the browser like an imported sample.
 */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  static get isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get elapsedSec(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  async start(): Promise<void> {
    if (!MicRecorder.isSupported) throw new Error('Recording is not supported in this browser.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError') throw new Error('Microphone access was blocked. Allow it in your browser\'s site settings to record.');
      if (name === 'NotFoundError') throw new Error('No microphone was found.');
      throw new Error('Could not start the microphone.');
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
    this.startedAt = performance.now();
  }

  /** Stops recording and returns the audio as a Blob. */
  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) {
        reject(new Error('Not recording.'));
        return;
      }
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: type.split(';')[0] });
        this.cleanup();
        resolve(blob);
      };
      rec.stop();
    });
  }

  cancel(): void {
    try {
      this.recorder?.stop();
    } catch {
      /* ignore */
    }
    this.cleanup();
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
