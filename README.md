# EasyBeat Studio

A beginner-friendly music production app that runs in your browser. Make beats, chord
progressions, melodies and basslines, arrange them into a full song, mix it, and export
a WAV or MIDI file — without needing to know music theory or a professional DAW.

Everything runs **locally**: no account, no cloud, no paid API. Projects and recordings are
stored privately in your browser on your own computer.

---

## Run it on Windows

### 1. Install Node.js (one time)

Download the **LTS** installer from <https://nodejs.org> (version 20 or newer) and run it
with the default options. Close and reopen VS Code afterwards.

Check it worked — in VS Code open **Terminal → New Terminal** and run:

```powershell
node -v
npm -v
```

### 2. Install the project's packages (one time)

Open the `easybeat-studio` folder in VS Code (**File → Open Folder…**), then in the terminal:

```powershell
npm install
```

> If PowerShell says *"running scripts is disabled on this system"*, either switch the
> terminal to **Command Prompt** (the `˅` arrow next to `+` in the terminal panel), or run
> `npm.cmd install` instead of `npm install` (and `npm.cmd run dev` below).

### 3. Start the app

```powershell
npm run dev
```

The terminal prints a link such as `http://localhost:5173/`. Ctrl+click it (or paste it into
Chrome or Edge).

### 4. Stop the app

Click into the terminal and press **Ctrl + C**. If asked `Terminate batch job (Y/N)?`, type
`Y` and press Enter. Your projects stay saved in the browser.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs the automated tests (Vitest) |
| `npm run typecheck` | Checks the TypeScript code for errors |
| `npm run build` | Creates an optimized version in `dist/` |
| `npm run preview` | Serves the `dist/` build locally (run `npm run build` first) |

---

## How to make a song

1. **Home → pick a template** (Hip-Hop, Pop, Rock, Electronic, Ambient) for a complete,
   editable starter song — or create a blank project with a direction, mood, tempo and key.
2. **Beat Maker** — click squares to build a drum pattern, or use *Suggest a beat*.
   Press **Space** to loop it. *Add at bar…* or *Use in all main sections* puts it in the song.
3. **Assistant** — choose a mood and add a chord progression, then generate a melody and a
   bassline that fit. Or type requests like *"Help me make a dark hip-hop beat"* or
   *"Make my chorus feel bigger"* and press **Apply** on the suggestions.
4. **Piano Roll** — edit any notes: click to add, drag to move, drag the right edge to
   lengthen, right-click to delete, Quantize to tidy up timing.
5. **Arrange** — add sections (Intro, Verse, Chorus…), drag clips around, stretch them to
   repeat, import or record audio on the *Vocals / Audio* track.
6. **Mixer** — balance volume, pan, EQ, reverb and delay for each track.
7. **Export** — download a WAV (the finished song), a MIDI file, or a full project backup.

Everything generated is ordinary notes and patterns, and every edit can be undone
(**Ctrl+Z** / **Ctrl+Y**).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause (loops the pattern in Beat Maker and Piano Roll) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save now (projects also auto-save) |
| Delete | Delete the selected clip or notes |
| Ctrl+D | Duplicate the selected clip (Arrange) |
| Ctrl+A, ↑ / ↓ | Select all notes, transpose (Piano Roll; Shift = octave) |

---

## Project structure

```
src/
  core/                 Pure TypeScript — no browser APIs, fully unit-tested
    types.ts            Project data model
    util.ts             ids, clamping, seeded random
    music/theory.ts     scales, chords, voice leading
    music/generators.ts chord / melody / bass / drum generators, quantize
    music/templates.ts  genre starter songs
    scheduler/events.ts turns the arrangement into timed note/drum/sample events
    scheduler/sequencer.ts  lookahead transport (audio-clock scheduling, loop, tempo)
    project/schema.ts   versioned format, validation, migrations
    project/ops.ts      editing operations (clips, sections, patterns)
    export/midi.ts      MIDI writer and reader
    export/wav.ts       WAV encoder
    assistant/          rule-based music assistant + glossary
    history.ts          undo / redo
  audio/                Web Audio implementation (kept separate from the UI)
    engine.ts           AudioContext, transport, previews, offline WAV render
    instruments.ts      synthesized drum kit and 6 instruments (no sample files)
    mixer.ts            channel strips, EQ, pan, reverb/delay buses, limiter, meters
    recorder.ts         microphone recording
  storage/              local-first persistence
    stores.ts           IndexedDB adapter + in-memory adapter (same interface)
    projectRepository.ts save / load / rename / duplicate / delete / backups
    fileValidation.ts   import rules (types, sizes)
  ui/                   React interface (Home, Studio and its views)
tests/                  Vitest tests
```

## Technology choices

| Need | Choice | Why |
| --- | --- | --- |
| UI | React 19 + TypeScript + Vite | Fast local dev server, typed code |
| Styling | Plain CSS with variables (`src/styles.css`) | No extra build tooling; easy to read |
| Audio | **Web Audio API directly** | The engine needs precise scheduling, offline rendering and synthesized instruments — all built into the browser. Tone.js was considered but wasn't needed, so it stays out to keep dependencies minimal. |
| MIDI | Small built-in reader/writer (`core/export/midi.ts`) | Covers note export/import without a dependency |
| Storage | IndexedDB (browser built-in) | Local, private, handles audio files |
| Tests | Vitest + fake-indexeddb | Runs the core logic and the storage adapter in Node |

There is **no backend, database server, account system or paid service**. All dependencies
are free and open-source (MIT). Nothing in the app requires an API key.

## Storage and backups

- Projects auto-save to the browser's IndexedDB about a second after each change.
- Browser storage is tied to **this browser on this computer**. Clearing site data, using a
  private window, or switching browsers means you won't see your projects there.
- Use **Export → Download backup** to save a `.easybeat.json` file containing the project
  and all its audio. Restore it with **Home → Import backup…** (it opens as a new project
  and never overwrites an existing one).
- The app asks the browser to mark storage as persistent so it is less likely to be evicted.

## Connecting an AI provider (optional, later)

The assistant is a deterministic, rule-based engine that works offline. It does **not**
use an AI model, and the UI says so. To add a real model later:

1. Implement the `AssistantProvider` interface in `src/core/assistant/engine.ts`.
2. Have the provider return `AssistantAction`s built with the existing helpers
   (`makeChordAction`, `makeMelodyAction`, `makeDrumAction`, …) so results stay editable
   and undoable.
3. **Never put an API key in the browser code.** Call the model from a small backend
   (for example Python + FastAPI) that holds the key in an environment variable, and have
   the provider call that backend. Show users clearly when their request is sent to an
   external service.

## Known limitations

- **One tempo per song.** The time-signature numerator (2–7) is supported; the beat unit is
  always a quarter note.
- **Audio clips do not time-stretch or pitch-shift.** If you change the tempo, recorded
  audio keeps its original speed.
- **Recording has no latency compensation.** Use headphones so the song doesn't bleed into
  the microphone; recordings may land a few milliseconds late.
- Imported audio is decoded fully into memory (a Web Audio requirement), so files are
  limited to 50 MB / 10 minutes each and 64 per project.
- Drum patterns are up to 64 steps (4 bars). MIDI drum import keeps the first 4 bars.
- No third-party plugin (VST) hosting — the built-in instruments are synthesized.
- Deleting an unused audio file on the Export screen frees its storage and cannot be undone.
- Moving a clip's start over another clip trims the other clip; a trimmed pattern clip
  restarts its pattern from the new start.
- Mainly intended for the latest **Chrome or Edge on Windows**. Firefox should work;
  Safari has not been tested.

See `PROJECT_STATUS.md` for what was verified, what wasn't, and next steps, and
`SECURITY.md` for the security model and the plan for optional accounts.
