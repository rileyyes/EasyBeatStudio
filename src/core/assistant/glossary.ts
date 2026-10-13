export interface Concept {
  id: string;
  term: string;
  short: string;
  detail: string;
  keywords: string[];
}

/** Plain-language music concepts for beginners. */
export const CONCEPTS: Concept[] = [
  { id: 'tempo', term: 'Tempo (BPM)', keywords: ['tempo', 'bpm', 'speed', 'fast', 'slow'],
    short: 'How fast the song is, in beats per minute.',
    detail: 'Hip-hop is often 80–95 BPM, pop 100–125, house/electronic 120–128, ambient 60–80. Change it any time with the BPM box at the top.' },
  { id: 'key', term: 'Key', keywords: ['key', 'scale', 'major', 'minor'],
    short: 'The set of notes that sound "right" together in your song.',
    detail: 'Major keys tend to sound bright and happy; minor keys sound darker or more emotional. The piano roll highlights in-key rows so you can stay safe.' },
  { id: 'chord', term: 'Chord', keywords: ['chord', 'chords', 'triad', 'harmony'],
    short: 'Several notes played together.',
    detail: 'EasyBeat builds chords from your key automatically. Chord names like "Am" mean A minor; "F" means F major.' },
  { id: 'progression', term: 'Chord progression', keywords: ['progression', 'sequence', 'roman', 'numeral'],
    short: 'A repeating sequence of chords — the emotional backbone of a song.',
    detail: 'Numbers like I–V–vi–IV describe chords by their position in the key, so the same progression works in any key.' },
  { id: 'melody', term: 'Melody', keywords: ['melody', 'tune', 'hook', 'lead', 'topline'],
    short: 'The single-note line people hum — the "tune".',
    detail: 'Good melodies mostly move in small steps, land on chord notes on strong beats, and repeat a short idea (a motif).' },
  { id: 'bassline', term: 'Bassline', keywords: ['bass', 'bassline', 'low end', 'sub'],
    short: 'The low notes that connect the drums to the chords.',
    detail: 'A safe start is to play the root (the chord\'s name note) of each chord. Then try rhythms like steady 8ths or octave jumps.' },
  { id: 'pattern', term: 'Pattern & clip', keywords: ['pattern', 'clip', 'loop'],
    short: 'A pattern is a short musical idea; a clip places it on the timeline.',
    detail: 'Edit a pattern once and every clip using it updates. A clip longer than its pattern repeats the pattern.' },
  { id: 'arrangement', term: 'Arrangement & sections', keywords: ['arrange', 'arrangement', 'section', 'verse', 'chorus', 'intro', 'outro', 'bridge', 'structure'],
    short: 'How the song unfolds over time: intro, verse, chorus, bridge, outro.',
    detail: 'Contrast keeps songs interesting: strip things back in verses, bring everything in for the chorus, and use a fill to lead into each new section.' },
  { id: 'swing', term: 'Swing', keywords: ['swing', 'shuffle', 'groove', 'bounce'],
    short: 'Delays every second 16th-note to give a bouncy, human feel.',
    detail: 'A little swing (15–30%) is classic for hip-hop and lo-fi. Pop and electronic usually use none.' },
  { id: 'velocity', term: 'Velocity', keywords: ['velocity', 'loudness', 'accent', 'ghost'],
    short: 'How hard a note is played (quiet ↔ loud).',
    detail: 'Varying velocity makes parts sound less robotic. Quiet "ghost" snare hits add groove.' },
  { id: 'quantize', term: 'Quantize', keywords: ['quantize', 'snap', 'grid', 'timing'],
    short: 'Snaps notes to the grid so they are perfectly in time.',
    detail: 'Use it after recording or dragging notes by hand. Choose the grid size (1/4, 1/8, 1/16) first.' },
  { id: 'mixing', term: 'Mixing', keywords: ['mix', 'mixing', 'level', 'volume', 'balance', 'pan', 'panning'],
    short: 'Balancing the volume, position and tone of every track.',
    detail: 'Start with drums and bass loud and centered, then bring chords and melody in around them. Pan supporting parts a little left or right for width.' },
  { id: 'reverb', term: 'Reverb & delay', keywords: ['reverb', 'delay', 'echo', 'space', 'effects', 'fx'],
    short: 'Effects that add space (reverb) and echoes (delay).',
    detail: 'Use more on pads and melodies, little or none on kick and bass to keep the low end tight.' },
  { id: 'eq', term: 'EQ', keywords: ['eq', 'equalizer', 'equalization', 'bass boost', 'treble', 'muddy', 'bright'],
    short: 'Turns low, mid and high frequencies up or down.',
    detail: 'Cut lows on chords to make room for the bass; boost highs on a melody to help it stand out.' },
];

export function findConcepts(text: string): Concept[] {
  const lower = text.toLowerCase();
  return CONCEPTS.filter((c) => c.keywords.some((k) => new RegExp(`\\b${k}\\b`).test(lower)));
}
