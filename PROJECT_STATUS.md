# EasyBeat Studio — project status

_Last updated: 2026-10-13 (version 0.1.0, first working version)_

## How this version was built and checked

The project was written in a cloud sandbox **without access to the npm registry**, so
React, Vite and Vitest could not be installed there. As a result:

- ✅ **Verified there:** all core logic tests (run with Bun's test runner through a
  Vitest-compatible shim), a full TypeScript strict-mode type check (UI type-checked against
  minimal stand-in React type declarations), and a bundle build of the whole app.
- ⚠️ **Not yet verified:** the app has **not been launched in a real browser**, so audio
  playback, the UI interactions and the IndexedDB adapter have not been exercised
  end-to-end. The first `npm install` / `npm test` / `npm run dev` on your PC is the first
  real run. Please report anything that breaks.

## Automated test results (actually executed)

`bun test` against the Vitest test files — **59 passed, 0 failed** (5,579 assertions), 9 files:

| File | Covers |
| --- | --- |
| `theory.test.ts` | scales, chord qualities and names, voice leading, MIDI note names |
| `generators.test.ts` | every chord preset in every mood stays in key; bass starts on chord roots; melody in key, chord tones on strong beats, deterministic by seed, no overlaps; drum patterns and variations keep the backbeat; quantize |
| `events.test.ts` | pattern looping/truncation in clips; splitting the timeline into windows never loses or duplicates events; swing; mute/solo; sample clips started mid-way |
| `sequencer.test.ts` | exact audio-clock times; identical output under jittery timer callbacks; lookahead bound; seamless loop wrap; song end; tempo changes; playhead mapping; no note burst after a stalled tab |
| `schema.test.ts` | lossless round-trip; legacy-format migration; newer format refused; garbage rejected; invalid values repaired and dangling references removed |
| `export.test.ts` | WAV header/sample encoding and clipping; MIDI export → import round trip (note counts, tempo, drum channel); invalid MIDI rejected |
| `ops-history.test.ts` | clip split/trim/move/resize/duplicate, incompatible moves blocked, sections; undo/redo with drag coalescing |
| `assistant-templates.test.ts` | every genre template is a full playable song; all five example requests from the brief parse correctly and produce valid, editable edits; explanations; fallback suggestions |
| `storage.test.ts` | save/list/load/rename/duplicate/delete (with audio); missing-audio reporting; backup round trip including audio; non-backup files rejected; file validation; Windows-safe names |

`indexeddb.test.ts` (the real IndexedDB adapter against `fake-indexeddb`) was **not run**
in the sandbox because that package couldn't be installed. It will run with `npm test`.

## Stage checklist

| Stage | Status |
| --- | --- |
| 1. Tech stack | ✅ React + TS + Vite, raw Web Audio, IndexedDB, Vitest. No paid/cloud services. |
| 2. App UI | ✅ Home, Studio (transport, timeline), Beat Maker, Piano Roll, Assistant, Mixer, Export. Dark theme, tooltips, guided "next step" strip. ⚠️ not yet seen in a browser. |
| 3. Core experience | ✅ 5 genre templates, guided workflow, deterministic assistant with a provider interface for a future AI model. |
| 4. Authentication | ✅ Planned only (see SECURITY.md) — intentionally not built; local use needs no account. |
| 5. Project data | ✅ Versioned format with migrations, validation, save/load/rename/duplicate/delete, backup export/import. |
| 6. Audio engine | ✅ Lookahead scheduler on the audio clock, 6 synth instruments + synth drum kit, per-track EQ/pan/volume, reverb & delay sends, limiter, meters, loop, arrangement playback, offline WAV render, MIDI export/import. ⚠️ sound not yet heard. |
| 7. Files | ✅ Audio import with validation, microphone recording, per-project storage, missing-asset handling, cleanup on close, storage explanation. |
| 8. Testing & docs | ✅ Tests above, README with Windows commands, SECURITY.md, this file. |

## Next steps

1. On your PC: `npm install`, `npm test` (expect 60 tests including the IndexedDB one),
   then `npm run dev` and walk through the 14 checks from the brief:
   create/save/reload a project, play and edit a beat, edit notes, add chords, play all
   tracks, adjust the mixer, arrange clips, export WAV and MIDI, import a bad file.
2. Fix whatever the first real browser run turns up (most likely: layout details, audio
   levels/balance of the synths).
3. Add browser end-to-end tests (Playwright) for the main workflow once the UI is confirmed.
4. Nice-to-haves: velocity lane in the piano roll, clip loop/trim handles on the left edge,
   per-section tempo, audio clip waveform drawing, more instruments.
