/**
 * Guided music assistant.
 *
 * The default provider is a DETERMINISTIC rule-based engine — no AI model, no network,
 * no API key. It turns plain-language requests into editable musical data (patterns,
 * clips, tempo/key changes) that the user previews and applies with one click.
 *
 * To connect a real AI model later, implement `AssistantProvider` (see README → "Connecting
 * an AI provider"). Provider output must still be expressed as AssistantActions so the
 * result stays editable and undoable.
 */
import type { Genre, InstrumentId, Mood, MusicalKey, Project, SectionKind } from '../types';
import {
  type BassStyle,
  type ProgressionPreset,
  generateBassNotes,
  generateChordNotes,
  generateDrumPattern,
  generateMelodyNotes,
  notePattern,
  PROGRESSIONS,
  progressionLabels,
  transposeNotes,
  varyDrumPattern,
  DRUM_STYLE_LABELS,
} from '../music/generators';
import { keyLabel, NOTE_NAMES, pitchClassOf } from '../music/theory';
import { getTemplate } from '../music/templates';
import { INSTRUMENTS } from '../project/schema';
import { addClip, addPattern, ensureTrack, findTrackByKind, placeAcrossSections, addTrack } from '../project/ops';
import { findConcepts, type Concept } from './glossary';
import { clamp } from '../util';

export interface AssistantAction {
  id: string;
  label: string;
  description: string;
  /** mutates a project draft; the caller wraps it in an undoable commit */
  apply: (draft: Project) => void;
}

export interface AssistantResponse {
  message: string;
  actions: AssistantAction[];
  concepts: Concept[];
  /** follow-up prompts the user can click */
  suggestions: string[];
}

export interface AssistantRequest {
  text: string;
  /** increments on "Try another" so results vary deterministically */
  variation?: number;
}

export interface AssistantProvider {
  id: string;
  name: string;
  /** true if this provider sends data to an external service */
  usesNetwork: boolean;
  respond(request: AssistantRequest, project: Readonly<Project>): Promise<AssistantResponse>;
}

/* ------------------------------------------------------------------ */
/* Intent parsing                                                      */
/* ------------------------------------------------------------------ */

export interface ParsedIntent {
  genre: Genre | null;
  trap: boolean;
  mood: Mood | null;
  wantsDrums: boolean;
  wantsChords: boolean;
  wantsMelody: boolean;
  wantsBass: boolean;
  wantsBiggerChorus: boolean;
  wantsTransition: boolean;
  wantsInstruments: boolean;
  wantsExplain: boolean;
  wantsFullSong: boolean;
  tempo: { bpm?: number; direction?: 'faster' | 'slower' } | null;
  key: MusicalKey | null;
}

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));

export function parseIntent(input: string): ParsedIntent {
  const text = input.toLowerCase();
  const trap = has(text, ['trap', 'drill']);
  let genre: Genre | null = null;
  if (has(text, ['hip-hop', 'hip hop', 'hiphop', 'rap', 'boom bap', 'boom-bap', 'lo-fi', 'lofi']) || trap) genre = 'hip-hop';
  else if (has(text, ['pop'])) genre = 'pop';
  else if (has(text, ['rock', 'punk', 'indie'])) genre = 'rock';
  else if (has(text, ['electronic', 'edm', 'house', 'techno', 'dance', 'club', 'synthwave'])) genre = 'electronic';
  else if (has(text, ['ambient', 'cinematic score', 'atmospheric'])) genre = 'ambient';

  let mood: Mood | null = null;
  if (has(text, ['dark', 'evil', 'sinister', 'moody', 'menacing', 'spooky', 'gritty'])) mood = 'dark';
  else if (has(text, ['emotional', 'sad', 'heartfelt', 'melancholy', 'melancholic', 'nostalgic', 'bittersweet', 'romantic'])) mood = 'emotional';
  else if (has(text, ['happy', 'bright', 'uplifting', 'cheerful', 'joyful', 'sunny', 'fun'])) mood = 'happy';
  else if (has(text, ['chill', 'relaxed', 'calm', 'mellow', 'smooth', 'lo-fi', 'lofi', 'laid back', 'laid-back'])) mood = 'chill';
  else if (has(text, ['energetic', 'hype', 'aggressive', 'driving', 'pumping', 'upbeat'])) mood = 'energetic';
  else if (has(text, ['epic', 'cinematic', 'dramatic', 'huge', 'heroic'])) mood = 'epic';

  const wantsBiggerChorus = has(text, ['chorus', 'drop', 'hook']) && has(text, ['bigger', 'big', 'fuller', 'louder', 'more energy', 'hit harder', 'wider', 'stand out', 'impact']);
  const wantsTransition = has(text, ['transition', 'transitions', 'fill', 'fills', 'build', 'build-up', 'buildup', 'smoother', 'lead into', 'leading into']);
  const wantsDrums = has(text, ['beat', 'beats', 'drum', 'drums', 'groove', 'rhythm', 'percussion', 'hats', 'kick', 'snare']);
  const chordsAsReference = /\b(these|my|the|existing|current|your|our)\s+chords?\b/.test(text) && !has(text, ['progression', 'new chords', 'different chords']);
  const wantsChords = has(text, ['chord', 'chords', 'progression', 'harmony']) && !chordsAsReference;
  const wantsMelody = has(text, ['melody', 'melodies', 'tune', 'lead', 'topline']) || (has(text, ['hook']) && !wantsBiggerChorus);
  const wantsBass = has(text, ['bass', 'bassline', 'bass line', 'low end', '808']);
  const wantsInstruments = has(text, ['instrument', 'instruments', 'sound', 'sounds', 'which synth', 'what synth']);
  const wantsExplain = /\b(what is|what's|what are|explain|how do|how does|why|teach|learn|meaning of|define)\b/i.test(text);
  const wantsFullSong = has(text, ['song', 'track', 'instrumental', 'everything', 'full']) && !wantsBiggerChorus && !wantsTransition && !wantsExplain;

  let tempo: ParsedIntent['tempo'] = null;
  const bpmMatch = text.match(/(\d{2,3})\s*bpm/) ?? text.match(/tempo (?:to |of |at )?(\d{2,3})/);
  if (bpmMatch) tempo = { bpm: clamp(parseInt(bpmMatch[1], 10), 40, 240) };
  else if (has(text, ['faster', 'speed up', 'quicker'])) tempo = { direction: 'faster' };
  else if (has(text, ['slower', 'slow down', 'slow it down'])) tempo = { direction: 'slower' };

  let key: MusicalKey | null = null;
  const keyMatch = input.match(/\b(?:in|key of)\s+([A-Ga-g])(#|b|♯|♭)?\s*(major|minor|maj|min|m)?\b/);
  if (keyMatch) {
    let pc = pitchClassOf(keyMatch[1].toUpperCase() as MusicalKey['tonic']);
    if (keyMatch[2] === '#' || keyMatch[2] === '♯') pc += 1;
    if (keyMatch[2] === 'b' || keyMatch[2] === '♭') pc += 11;
    const modeWord = (keyMatch[3] ?? '').toLowerCase();
    key = { tonic: NOTE_NAMES[pc % 12], mode: modeWord.startsWith('min') || modeWord === 'm' ? 'minor' : 'major' };
  }

  return { genre, trap, mood, wantsDrums, wantsChords, wantsMelody, wantsBass, wantsBiggerChorus, wantsTransition, wantsInstruments, wantsExplain, wantsFullSong, tempo, key };
}

/* ------------------------------------------------------------------ */
/* Action builders (also used directly by the "Quick tools" panel)     */
/* ------------------------------------------------------------------ */

const PLAY_SECTIONS: SectionKind[] = ['verse', 'pre-chorus', 'chorus', 'bridge', 'drop'];

function relativeKey(key: MusicalKey, mode: MusicalKey['mode']): MusicalKey {
  if (key.mode === mode) return key;
  const pc = pitchClassOf(key.tonic);
  return { tonic: NOTE_NAMES[(pc + (mode === 'minor' ? 9 : 3)) % 12], mode };
}

export function chooseProgression(mood: Mood, variation = 0): ProgressionPreset {
  const list = PROGRESSIONS[mood];
  return list[variation % list.length];
}

/** Current progression degrees, or a sensible default for the project's mood. */
export function projectDegrees(project: Readonly<Project>): number[] {
  if (project.progression?.degrees.length) return project.progression.degrees;
  const preset = PROGRESSIONS[project.mood].find((p) => p.mode === project.key.mode) ?? PROGRESSIONS[project.mood][0];
  return preset.degrees;
}

function progLengthBeats(degrees: number[]): number {
  return degrees.length * 4;
}

export function makeChordAction(project: Readonly<Project>, preset: ProgressionPreset, opts: { key?: MusicalKey; style?: 'sustain' | 'stabs' | 'arpeggio' } = {}): AssistantAction {
  const key = opts.key ?? relativeKey(project.key, preset.mode);
  const labels = progressionLabels(key, preset.degrees);
  const style = opts.style ?? 'sustain';
  const keyChange = key.tonic !== project.key.tonic || key.mode !== project.key.mode;
  return {
    id: `chords-${preset.id}-${style}`,
    label: `Use "${preset.name}" chords (${labels.join(' – ')})`,
    description: `${preset.description}${keyChange ? ` Sets the key to ${keyLabel(key)}.` : ''} Places the chords on the Chords track.`,
    apply: (draft) => {
      draft.key = key;
      draft.mood = moodOfPreset(preset) ?? draft.mood;
      draft.progression = { degrees: preset.degrees, mood: draft.mood, labels };
      const track = ensureTrack(draft, 'chords', 'Chords');
      const pat = addPattern(draft, notePattern(`${preset.name} chords`, progLengthBeats(preset.degrees), generateChordNotes({ key, degrees: preset.degrees, style })));
      placeOnTrack(draft, track.id, pat.id, PLAY_SECTIONS);
    },
  };
}

function moodOfPreset(preset: ProgressionPreset): Mood | null {
  for (const m of Object.keys(PROGRESSIONS) as Mood[]) if (PROGRESSIONS[m].some((p) => p.id === preset.id)) return m;
  return null;
}

/** Places a pattern into sections; on an empty song, fills the first 8 bars. */
function placeOnTrack(draft: Project, trackId: string, patternId: string, kinds?: SectionKind[]) {
  if (draft.sections.length === 0) {
    addClip(draft, { trackId, patternId, startBar: 0, lengthBars: 8 });
    return;
  }
  const placed = placeAcrossSections(draft, trackId, patternId, kinds);
  if (placed === 0) placeAcrossSections(draft, trackId, patternId);
}

export function makeBassAction(project: Readonly<Project>, style: BassStyle): AssistantAction {
  const degrees = projectDegrees(project);
  return {
    id: `bass-${style}`,
    label: `Add a ${style === 'roots' ? 'simple root' : style === 'pulse' ? 'driving 8th-note' : style === 'octaves' ? 'bouncing octave' : 'moving'} bassline`,
    description: `Follows your chords (${progressionLabels(project.key, degrees).join(' – ')}) wherever the Chords track plays.`,
    apply: (draft) => {
      const track = ensureTrack(draft, 'bass', 'Bass');
      const pat = addPattern(draft, notePattern('Bassline', progLengthBeats(degrees), generateBassNotes(draft.key, degrees, style)));
      const chordTrack = findTrackByKind(draft, 'chords');
      const chordClips = chordTrack ? draft.clips.filter((c) => c.trackId === chordTrack.id) : [];
      if (chordClips.length > 0) {
        for (const c of chordClips) addClip(draft, { trackId: track.id, patternId: pat.id, startBar: c.startBar, lengthBars: c.lengthBars });
      } else {
        placeOnTrack(draft, track.id, pat.id, PLAY_SECTIONS);
      }
    },
  };
}

export function makeMelodyAction(project: Readonly<Project>, seed: number, density = 0.5): AssistantAction {
  const degrees = projectDegrees(project);
  return {
    id: `melody-${seed}`,
    label: 'Add a melody that fits your chords',
    description: `A new melody in ${keyLabel(project.key)}, landing on chord notes on strong beats. Placed in your choruses (or the first 8 bars).`,
    apply: (draft) => {
      const track = ensureTrack(draft, 'melody', 'Melody');
      const pat = addPattern(draft, notePattern(`Melody ${seed}`, progLengthBeats(degrees), generateMelodyNotes({ key: draft.key, degrees, seed, density })));
      placeOnTrack(draft, track.id, pat.id, ['chorus', 'drop']);
    },
  };
}

export function makeDrumAction(style: keyof typeof DRUM_STYLE_LABELS, variation = 0): AssistantAction {
  return {
    id: `drums-${style}-${variation}`,
    label: `Add a ${DRUM_STYLE_LABELS[style]} beat`,
    description: 'Creates a new drum pattern you can edit in the Beat Maker and places it on the Drums track.',
    apply: (draft) => {
      const track = ensureTrack(draft, 'drums', 'Drums');
      let pat = generateDrumPattern(style);
      if (variation > 0) pat = varyDrumPattern(pat, variation);
      addPattern(draft, pat);
      placeOnTrack(draft, track.id, pat.id, PLAY_SECTIONS);
    },
  };
}

export function makeTempoAction(bpm: number): AssistantAction {
  const v = Math.round(clamp(bpm, 40, 240));
  return {
    id: `tempo-${v}`,
    label: `Set tempo to ${v} BPM`,
    description: 'Changes the speed of the whole song.',
    apply: (draft) => {
      draft.bpm = v;
    },
  };
}

export function makeInstrumentAction(kind: 'chords' | 'melody' | 'bass', instrument: InstrumentId): AssistantAction {
  const info = INSTRUMENTS.find((i) => i.id === instrument);
  return {
    id: `inst-${kind}-${instrument}`,
    label: `Use ${info?.label ?? instrument} for ${kind}`,
    description: info?.description ?? '',
    apply: (draft) => {
      const t = ensureTrack(draft, kind);
      t.instrument = instrument;
    },
  };
}

export function makeBiggerChorusAction(project: Readonly<Project>): AssistantAction | null {
  const choruses = project.sections.filter((s) => s.kind === 'chorus' || s.kind === 'drop');
  if (choruses.length === 0) return null;
  return {
    id: 'bigger-chorus',
    label: 'Make the chorus bigger',
    description: 'Adds an octave-up melody layer, a fuller drum variation and more space (reverb) on chords — only in chorus sections.',
    apply: (draft) => {
      const drums = findTrackByKind(draft, 'drums');
      const melody = findTrackByKind(draft, 'melody');
      const chords = findTrackByKind(draft, 'chords');
      const sections = draft.sections.filter((s) => s.kind === 'chorus' || s.kind === 'drop');

      // 1. Fuller drums: variation of whatever plays in the first chorus, plus open hats and clap layer
      if (drums) {
        const first = sections[0];
        const clip = draft.clips.find((c) => c.trackId === drums.id && c.startBar <= first.startBar && c.startBar + c.lengthBars > first.startBar && c.patternId);
        const src = clip && draft.patterns.find((p) => p.id === clip.patternId);
        const base = src && src.type === 'drum' ? src : generateDrumPattern(draft.genre === 'blank' ? 'pop' : draft.genre);
        const big = varyDrumPattern(base, 99);
        big.name = 'Big chorus beat';
        big.rows = big.rows.map((r) => {
          if (r.sound === 'hatOpen') return { ...r, steps: r.steps.map((v, i) => (i % 8 === 6 ? Math.max(v, 0.7) : v)) };
          if (r.sound === 'clap') {
            const snare = big.rows.find((x) => x.sound === 'snare');
            return { ...r, steps: r.steps.map((v, i) => Math.max(v, snare && snare.steps[i] >= 0.9 ? 0.8 : 0)) };
          }
          return r;
        });
        addPattern(draft, big);
        for (const s of sections) addClip(draft, { trackId: drums.id, patternId: big.id, startBar: s.startBar, lengthBars: s.lengthBars });
      }

      // 2. Octave-up melody layer on a new track
      if (melody) {
        const mClip = draft.clips.find((c) => c.trackId === melody.id && sections.some((s) => c.startBar >= s.startBar && c.startBar < s.startBar + s.lengthBars));
        const mPat = mClip && draft.patterns.find((p) => p.id === mClip.patternId);
        if (mPat && mPat.type === 'notes') {
          const layer = addTrack(draft, 'instrument', 'Chorus layer', melody.instrument === 'bell' ? 'pluck' : 'bell');
          layer.volume = 0.45;
          layer.pan = 0.25;
          layer.effects.reverb = 0.35;
          const up = addPattern(draft, notePattern(`${mPat.name} (octave up)`, mPat.lengthBeats, transposeNotes(mPat.notes, 12).map((n) => ({ ...n, velocity: n.velocity * 0.8 }))));
          for (const s of sections) addClip(draft, { trackId: layer.id, patternId: up.id, startBar: s.startBar, lengthBars: s.lengthBars });
        }
      }

      // 3. More space on chords
      if (chords) chords.effects.reverb = clamp(chords.effects.reverb + 0.15, 0, 1);
    },
  };
}

export function makeTransitionAction(project: Readonly<Project>): AssistantAction | null {
  const boundaries = project.sections.filter((s) => s.startBar > 0).map((s) => s.startBar);
  if (boundaries.length === 0) return null;
  return {
    id: 'transitions',
    label: `Add drum fills before ${boundaries.length} section change${boundaries.length > 1 ? 's' : ''}`,
    description: 'Puts a one-bar fill in the last bar of each section so the song flows into the next part.',
    apply: (draft) => {
      const drums = ensureTrack(draft, 'drums', 'Drums');
      const fill = addPattern(draft, generateDrumPattern('fill', 'Transition fill'));
      for (const s of draft.sections) {
        if (s.startBar > 0) addClip(draft, { trackId: drums.id, patternId: fill.id, startBar: s.startBar - 1, lengthBars: 1 });
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic provider                                              */
/* ------------------------------------------------------------------ */

const INSTRUMENT_TIPS: Record<Genre, { chords: InstrumentId; melody: InstrumentId; text: string }> = {
  'hip-hop': { chords: 'keys', melody: 'bell', text: 'Soft Keys for chords and a Glass Bell melody give a classic dusty hip-hop vibe.' },
  pop: { chords: 'keys', melody: 'pluck', text: 'Bright keys with a bouncy Pluck melody sound modern and catchy.' },
  rock: { chords: 'pluck', melody: 'lead', text: 'Use Pluck for rhythmic chord stabs and Bright Lead to stand in for a guitar line.' },
  electronic: { chords: 'pad', melody: 'pluck', text: 'Wide Dream Pad chords with a Pluck melody are a staple of electronic music.' },
  ambient: { chords: 'pad', melody: 'bell', text: 'Dream Pad plus Glass Bell with lots of reverb creates floating ambience.' },
};

export function respondDeterministic(request: AssistantRequest, project: Readonly<Project>): AssistantResponse {
  const intent = parseIntent(request.text);
  const variation = request.variation ?? 0;
  const actions: AssistantAction[] = [];
  const lines: string[] = [];
  const genre: Genre = intent.genre ?? (project.genre === 'blank' ? 'pop' : project.genre);
  const template = getTemplate(genre);
  const mood: Mood = intent.mood ?? (intent.genre ? template.mood : project.mood);
  const concepts = intent.wantsExplain ? findConcepts(request.text) : [];

  if (intent.wantsExplain && concepts.length > 0 && !intent.wantsDrums && !intent.wantsChords && !intent.wantsMelody && !intent.wantsBass) {
    return {
      message: concepts.map((c) => `**${c.term}** — ${c.short} ${c.detail}`).join('\n\n'),
      actions: [],
      concepts,
      suggestions: ['Give me a chord progression that sounds emotional', 'Help me make a dark hip-hop beat'],
    };
  }

  const any = intent.wantsDrums || intent.wantsChords || intent.wantsMelody || intent.wantsBass || intent.wantsBiggerChorus || intent.wantsTransition || intent.wantsInstruments || intent.tempo || intent.wantsFullSong;

  if (intent.wantsFullSong && !intent.wantsDrums && !intent.wantsChords && !intent.wantsMelody && !intent.wantsBass) {
    intent.wantsDrums = intent.wantsChords = intent.wantsBass = intent.wantsMelody = true;
  }

  // Tempo
  if (intent.tempo?.bpm) {
    actions.push(makeTempoAction(intent.tempo.bpm));
  } else if (intent.tempo?.direction) {
    const delta = intent.tempo.direction === 'faster' ? 8 : -8;
    actions.push(makeTempoAction(project.bpm + delta));
    lines.push(`Changing tempo by ${delta > 0 ? '+' : ''}${delta} BPM keeps the feel while making it ${intent.tempo.direction}.`);
  } else if (intent.genre && Math.abs(project.bpm - template.bpm) > 10 && (intent.wantsDrums || intent.wantsFullSong)) {
    actions.push(makeTempoAction(template.bpm));
    lines.push(`${template.label} usually sits around ${template.bpm} BPM.`);
  }

  // Drums
  if (intent.wantsDrums) {
    const style = intent.trap ? 'trap' : genre;
    actions.push(makeDrumAction(style, variation));
    lines.push(`Here's a ${DRUM_STYLE_LABELS[style].toLowerCase()} pattern${mood === 'dark' ? ' — pair it with minor chords for a darker feel' : ''}.`);
    if (genre === 'hip-hop' && project.swing < 0.15) lines.push('Tip: add some Swing (around 25%) in the Beat Maker for a bouncier groove.');
  }

  // Chords
  if (intent.wantsChords || (intent.wantsFullSong && !project.progression)) {
    const preset = chooseProgression(mood, variation);
    const key = intent.key ?? undefined;
    actions.push(makeChordAction(project, preset, { key, style: genre === 'pop' || genre === 'rock' ? 'stabs' : 'sustain' }));
    const pk = key ?? relativeKey(project.key, preset.mode);
    lines.push(`For a ${mood} sound I'd use ${preset.name}: ${progressionLabels(pk, preset.degrees).join(' → ')} in ${keyLabel(pk)}. ${preset.description}`);
    // Offer the other presets for this mood too
    for (const alt of PROGRESSIONS[mood]) if (alt.id !== preset.id) actions.push(makeChordAction(project, alt, { key, style: 'sustain' }));
  }

  // Bass
  if (intent.wantsBass) {
    const style: BassStyle = genre === 'electronic' ? 'octaves' : genre === 'rock' || genre === 'pop' ? 'pulse' : variation % 2 ? 'walking' : 'roots';
    actions.push(makeBassAction(project, style));
    lines.push(`The bassline plays the root of each chord${style === 'roots' ? '' : ` with a ${style} rhythm`}, so it always fits.`);
  }

  // Melody
  if (intent.wantsMelody) {
    actions.push(makeMelodyAction(project, 11 + variation * 7, genre === 'ambient' ? 0.2 : 0.55));
    lines.push('The melody repeats a short idea and lands on chord notes on strong beats — click "Try another" for a different one.');
  }

  if (intent.wantsBiggerChorus) {
    const a = makeBiggerChorusAction(project);
    if (a) {
      actions.push(a);
      lines.push('Choruses feel bigger through contrast: more layers, brighter drums and more space than the verse.');
    } else {
      lines.push('Your song has no chorus section yet. Add one in the Arrange view ("+ Section" → Chorus), then ask again.');
    }
  }

  if (intent.wantsTransition) {
    const a = makeTransitionAction(project);
    if (a) {
      actions.push(a);
      lines.push('A short drum fill at the end of a section tells the listener something new is coming.');
    } else {
      lines.push('Transitions happen between sections. Add sections (Intro, Verse, Chorus…) in the Arrange view first.');
    }
  }

  if (intent.wantsInstruments) {
    const tip = INSTRUMENT_TIPS[genre];
    lines.push(tip.text);
    actions.push(makeInstrumentAction('chords', tip.chords), makeInstrumentAction('melody', tip.melody));
  }

  if (!any) {
    return {
      message:
        "I can build editable parts for you. Try asking for a beat, chords, a melody or a bassline — and include a genre or mood (e.g. \"dark hip-hop\", \"happy pop\"). I can also make your chorus bigger, add transitions, or explain terms like swing or quantize.",
      actions: [],
      concepts,
      suggestions: [
        'Help me make a dark hip-hop beat',
        'Give me a chord progression that sounds emotional',
        'Add a bassline that follows these chords',
        'Make my chorus feel bigger',
        'Help me create a smoother transition into the next section',
      ],
    };
  }

  return {
    message: lines.join(' '),
    actions,
    concepts,
    suggestions: ['Try another', ...(intent.wantsDrums ? [] : ['Add a beat that fits']), ...(intent.wantsBass ? [] : ['Add a bassline that follows these chords'])].slice(0, 3),
  };
}

export const deterministicProvider: AssistantProvider = {
  id: 'built-in',
  name: 'Built-in music assistant (offline)',
  usesNetwork: false,
  respond: async (req, project) => respondDeterministic(req, project),
};
