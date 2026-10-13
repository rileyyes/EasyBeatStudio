import { useStudio } from '../studioContext';
import { useLevels } from '../hooks';
import type { Track, TrackEffects } from '../../core/types';
import { INSTRUMENTS } from '../../core/project/schema';
import Meter from '../components/Meter';

function dbLabel(gain: number): string {
  if (gain <= 0.0001) return '-∞ dB';
  const db = 20 * Math.log10(gain);
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

function panLabel(pan: number): string {
  if (Math.abs(pan) < 0.02) return 'C';
  return `${Math.round(Math.abs(pan) * 100)}${pan < 0 ? 'L' : 'R'}`;
}

export default function MixerView() {
  const { project, commit, engine, playing } = useStudio();
  const levels = useLevels(engine, playing);

  const update = (track: Track, label: string, key: string, fn: (t: Track) => void) =>
    commit(label, (d) => {
      const t = d.tracks.find((x) => x.id === track.id);
      if (t) fn(t);
    }, `${key}-${track.id}`);

  const fx = (track: Track, name: keyof TrackEffects, value: number) =>
    update(track, `Change ${name}`, name, (t) => {
      t.effects[name] = value;
    });

  return (
    <div className="view mixer">
      <p className="hint">
        Start with everything around the same level, then turn down whatever feels too loud. Keep kick and bass centered;
        pan supporting parts a little left or right. Meters move while the song plays.
      </p>
      <div className="mixer-strips">
        {project.tracks.map((t) => {
          const isDrums = t.kind === 'drums';
          const isAudio = t.kind === 'vocals' || t.instrument === 'sampler';
          return (
            <div className={`strip ${t.mute ? 'muted' : ''}`} key={t.id} style={{ ['--strip-color' as string]: t.color }}>
              <div className="strip-name" title={t.name}>{t.name}</div>
              {!isDrums && !isAudio ? (
                <select aria-label="Instrument" value={t.instrument} onChange={(e) => update(t, 'Change instrument', 'inst', (x) => { x.instrument = e.target.value as Track['instrument']; })}>
                  {INSTRUMENTS.filter((i) => i.id !== 'drumkit' && i.id !== 'sampler').map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              ) : (
                <div className="strip-inst muted small">{isDrums ? 'Drum Kit' : 'Audio clips'}</div>
              )}

              <div className="knobs">
                <Knob label="Low" title="Bass frequencies (EQ)" min={-12} max={12} step={0.5} value={t.effects.eqLow} display={`${t.effects.eqLow > 0 ? '+' : ''}${t.effects.eqLow}`} onChange={(v) => fx(t, 'eqLow', v)} />
                <Knob label="Mid" title="Middle frequencies (EQ)" min={-12} max={12} step={0.5} value={t.effects.eqMid} display={`${t.effects.eqMid > 0 ? '+' : ''}${t.effects.eqMid}`} onChange={(v) => fx(t, 'eqMid', v)} />
                <Knob label="High" title="Treble frequencies (EQ)" min={-12} max={12} step={0.5} value={t.effects.eqHigh} display={`${t.effects.eqHigh > 0 ? '+' : ''}${t.effects.eqHigh}`} onChange={(v) => fx(t, 'eqHigh', v)} />
                <Knob label="Reverb" title="Adds space / room" min={0} max={1} step={0.01} value={t.effects.reverb} display={`${Math.round(t.effects.reverb * 100)}%`} onChange={(v) => fx(t, 'reverb', v)} />
                <Knob label="Delay" title="Echoes in time with the tempo" min={0} max={1} step={0.01} value={t.effects.delay} display={`${Math.round(t.effects.delay * 100)}%`} onChange={(v) => fx(t, 'delay', v)} />
                <Knob label="Pan" title="Left ↔ right position" min={-1} max={1} step={0.01} value={t.pan} display={panLabel(t.pan)} onChange={(v) => update(t, 'Pan', 'pan', (x) => { x.pan = Math.abs(v) < 0.03 ? 0 : v; })} />
              </div>

              <div className="fader-area">
                <input
                  className="fader"
                  type="range"
                  min={0}
                  max={1.2}
                  step={0.01}
                  value={t.volume}
                  aria-label={`${t.name} volume`}
                  onChange={(e) => update(t, 'Volume', 'vol', (x) => { x.volume = Number(e.target.value); })}
                  onDoubleClick={() => update(t, 'Reset volume', 'vol', (x) => { x.volume = 0.75; })}
                  title="Volume (double-click to reset)"
                />
                <Meter level={t.mute ? 0 : levels.tracks[t.id] ?? 0} vertical />
              </div>
              <div className="strip-db">{dbLabel(t.volume)}</div>
              <div className="ms-row">
                <button className={`ms ${t.mute ? 'on mute' : ''}`} aria-pressed={t.mute} onClick={() => update(t, 'Mute', 'mute', (x) => { x.mute = !x.mute; })} title="Mute">M</button>
                <button className={`ms ${t.solo ? 'on solo' : ''}`} aria-pressed={t.solo} onClick={() => update(t, 'Solo', 'solo', (x) => { x.solo = !x.solo; })} title="Solo">S</button>
              </div>
            </div>
          );
        })}

        <div className="strip master-strip">
          <div className="strip-name">Master</div>
          <div className="strip-inst muted small">Final output</div>
          <p className="muted small master-note">A built-in limiter keeps the final mix from distorting.</p>
          <div className="fader-area">
            <input className="fader" type="range" min={0} max={1.2} step={0.01} value={project.masterVolume} aria-label="Master volume"
              onChange={(e) => commit('Master volume', (d) => { d.masterVolume = Number(e.target.value); }, 'master')} />
            <Meter level={levels.master} vertical />
          </div>
          <div className="strip-db">{dbLabel(project.masterVolume)}</div>
        </div>
      </div>
    </div>
  );
}

function Knob(props: { label: string; title: string; min: number; max: number; step: number; value: number; display: string; onChange: (v: number) => void }) {
  return (
    <label className="knob" title={props.title}>
      <span className="knob-label">{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <span className="knob-value">{props.display}</span>
    </label>
  );
}
