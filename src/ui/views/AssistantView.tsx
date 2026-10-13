import { useState } from 'react';
import { useStudio } from '../studioContext';
import type { Mood } from '../../core/types';
import { BASS_STYLES, DRUM_STYLE_LABELS, drumStyles, MOODS, PROGRESSIONS, progressionLabels, progressionVoicings, type BassStyle, type ChordStyle } from '../../core/music/generators';
import { keyLabel, NOTE_NAMES, pitchClassOf, romanNumeral, describeKey } from '../../core/music/theory';
import {
  deterministicProvider,
  makeBassAction,
  makeChordAction,
  makeDrumAction,
  makeInstrumentAction,
  makeMelodyAction,
  type AssistantAction,
  type AssistantResponse,
} from '../../core/assistant/engine';
import { CONCEPTS } from '../../core/assistant/glossary';
import { INSTRUMENTS } from '../../core/project/schema';
import { findTrackByKind } from '../../core/project/ops';
import type { MusicalKey } from '../../core/types';

const EXAMPLES = [
  'Help me make a dark hip-hop beat',
  'Give me a chord progression that sounds emotional',
  'Add a bassline that follows these chords',
  'Make my chorus feel bigger',
  'Help me create a smoother transition into the next section',
  'What is swing?',
];

interface Exchange {
  id: number;
  question: string;
  variation: number;
  response: AssistantResponse;
  applied: Set<string>;
}

function relative(key: MusicalKey, mode: MusicalKey['mode']): MusicalKey {
  if (key.mode === mode) return key;
  const pc = pitchClassOf(key.tonic);
  return { tonic: NOTE_NAMES[(pc + (mode === 'minor' ? 9 : 3)) % 12], mode };
}

export default function AssistantView() {
  const studio = useStudio();
  const { project, commit, engine } = studio;
  const [input, setInput] = useState('');
  const [log, setLog] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<Mood>(project.mood);
  const [chordStyle, setChordStyle] = useState<ChordStyle>('sustain');
  const [density, setDensity] = useState(0.5);
  const [bassStyle, setBassStyle] = useState<BassStyle>('roots');
  const [openConcept, setOpenConcept] = useState<string | null>(null);

  const apply = (action: AssistantAction, exchangeId?: number) => {
    commit(action.label, action.apply);
    studio.toast(`${action.label} — undo with Ctrl+Z`, 'success');
    if (exchangeId !== undefined) {
      setLog((l) => l.map((x) => (x.id === exchangeId ? { ...x, applied: new Set([...x.applied, action.id]) } : x)));
    }
  };

  const ask = async (text: string, variation = 0) => {
    const q = text.trim().slice(0, 300);
    if (!q) return;
    setBusy(true);
    try {
      const response = await deterministicProvider.respond({ text: q, variation }, project);
      setLog((l) => [...l.slice(-19), { id: Date.now(), question: q, variation, response, applied: new Set() }]);
      setInput('');
    } catch (e) {
      studio.toast(`The assistant could not answer: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const previewProgression = async (degrees: number[], mode: MusicalKey['mode']) => {
    const key = relative(project.key, mode);
    const chords = progressionVoicings(key, degrees);
    const t = findTrackByKind(project, 'chords') ?? project.tracks[0];
    if (!t) return;
    const inst = t.instrument === 'drumkit' || t.instrument === 'sampler' ? 'keys' : t.instrument;
    for (let i = 0; i < chords.length; i++) {
      setTimeout(() => void engine.previewChord(t.id, inst, chords[i], 0.75), i * 800);
    }
  };

  const genre = project.genre === 'blank' ? null : project.genre;

  return (
    <div className="view assistant">
      <div className="assistant-columns">
        <section className="assistant-chat card">
          <h2>Ask the music assistant</h2>
          <p className="muted small">
            Describe what you want in plain words. Every suggestion becomes normal, editable notes and patterns — nothing is locked.
            <br />
            <span className="badge" title="No AI service is connected. Suggestions come from a built-in rule-based engine that runs on your computer.">Built-in assistant · works offline · no AI service connected</span>
          </p>
          <div className="chips">
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" onClick={() => void ask(e)} disabled={busy}>{e}</button>
            ))}
          </div>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <input type="text" maxLength={300} placeholder='e.g. "happy pop chords in G" or "make it faster"' value={input} onChange={(e) => setInput(e.target.value)} aria-label="Ask the assistant" />
            <button className="btn primary" type="submit" disabled={busy || !input.trim()}>Ask</button>
          </form>
          <div className="chat-log">
            {log.length === 0 && <p className="muted">Answers appear here. Try one of the examples above.</p>}
            {[...log].reverse().map((x) => (
              <div className="exchange" key={x.id}>
                <div className="q">“{x.question}”</div>
                <div className="a">
                  {x.response.message.split('\n\n').map((para, i) => <p key={i}>{renderBold(para)}</p>)}
                  {x.response.actions.length > 0 && (
                    <ul className="actions">
                      {x.response.actions.map((a) => (
                        <li key={a.id}>
                          <div>
                            <strong>{a.label}</strong>
                            <span className="muted small">{a.description}</span>
                          </div>
                          <button className="btn small primary" disabled={x.applied.has(a.id)} onClick={() => apply(a, x.id)}>
                            {x.applied.has(a.id) ? 'Applied ✓' : 'Apply'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="chips">
                    {x.response.suggestions.map((s) => (
                      <button key={s} className="chip small" onClick={() => (s === 'Try another' ? void ask(x.question, x.variation + 1) : void ask(s))}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="assistant-tools">
          <div className="card">
            <h3>1 · Chord progression</h3>
            <p className="muted small">Pick a mood. Chords are shown in your key ({keyLabel(project.key)}); minor-mood options switch to the matching minor key.</p>
            <div className="inline wrap">
              {MOODS.map((m) => (
                <button key={m} className={`chip ${mood === m ? 'active' : ''}`} onClick={() => setMood(m)}>{m}</button>
              ))}
            </div>
            <label className="mini-field">
              <span>Rhythm</span>
              <select value={chordStyle} onChange={(e) => setChordStyle(e.target.value as ChordStyle)}>
                <option value="sustain">Long chords</option>
                <option value="stabs">Rhythmic stabs</option>
                <option value="arpeggio">Arpeggio (broken chords)</option>
              </select>
            </label>
            <ul className="prog-list">
              {PROGRESSIONS[mood].map((p) => {
                const key = relative(project.key, p.mode);
                return (
                  <li key={p.id}>
                    <div>
                      <strong>{p.name}</strong> <span className="muted small">{keyLabel(key)}</span>
                      <div className="chord-names">
                        {progressionLabels(key, p.degrees).map((l, i) => (
                          <span key={i} className="chord-pill" title={romanNumeral(key, p.degrees[i])}>{l}</span>
                        ))}
                      </div>
                      <span className="muted small">{p.description}</span>
                    </div>
                    <div className="stack">
                      <button className="btn small ghost" onClick={() => void previewProgression(p.degrees, p.mode)}>▶ Hear</button>
                      <button className="btn small primary" onClick={() => apply(makeChordAction(project, p, { style: chordStyle }))}>Use</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card">
            <h3>2 · Melody</h3>
            <p className="muted small">Generates a melody that fits your current chords{project.progression ? ` (${project.progression.labels.join(' – ')})` : ''}. Click again for a different one.</p>
            <label className="mini-field">
              <span>Busy-ness</span>
              <input type="range" min={0} max={1} step={0.05} value={density} onChange={(e) => setDensity(Number(e.target.value))} />
            </label>
            <button className="btn primary" onClick={() => apply(makeMelodyAction(project, Math.floor(Math.random() * 100000), density))}>Generate melody</button>
          </div>

          <div className="card">
            <h3>3 · Bassline</h3>
            <div className="radio-list">
              {BASS_STYLES.map((b) => (
                <label key={b.id} className={bassStyle === b.id ? 'active' : ''}>
                  <input type="radio" name="bass" checked={bassStyle === b.id} onChange={() => setBassStyle(b.id)} />
                  <span><strong>{b.label}</strong> <span className="muted small">{b.description}</span></span>
                </label>
              ))}
            </div>
            <button className="btn primary" onClick={() => apply(makeBassAction(project, bassStyle))}>Add bassline</button>
          </div>

          <div className="card">
            <h3>4 · Drums</h3>
            <div className="inline wrap">
              {drumStyles().filter((s) => s !== 'fill' && s !== 'intro').map((s) => (
                <button key={s} className="chip" onClick={() => apply(makeDrumAction(s))}>{DRUM_STYLE_LABELS[s]}</button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>5 · Instruments</h3>
            <p className="muted small">{genre ? `Good choices for ${genre}:` : 'Pick sounds for your parts:'}</p>
            <ul className="inst-list">
              {INSTRUMENTS.filter((i) => i.id !== 'drumkit' && i.id !== 'sampler').map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.label}</strong>
                    <span className="muted small">{i.description}</span>
                  </div>
                  <div className="stack">
                    {i.forKinds.includes('chords') && <button className="btn small ghost" onClick={() => apply(makeInstrumentAction('chords', i.id))}>Chords</button>}
                    {i.forKinds.includes('melody') && <button className="btn small ghost" onClick={() => apply(makeInstrumentAction('melody', i.id))}>Melody</button>}
                    {i.forKinds.includes('bass') && <button className="btn small ghost" onClick={() => apply(makeInstrumentAction('bass', i.id))}>Bass</button>}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Learn the basics</h3>
            <p className="muted small">{describeKey(project.key)}</p>
            <ul className="concepts">
              {CONCEPTS.map((c) => (
                <li key={c.id}>
                  <button className="concept-head" onClick={() => setOpenConcept(openConcept === c.id ? null : c.id)} aria-expanded={openConcept === c.id}>
                    <strong>{c.term}</strong> <span className="muted small">{c.short}</span>
                  </button>
                  {openConcept === c.id && <p className="small">{c.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Renders **bold** segments without using innerHTML. */
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}
