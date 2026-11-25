# Songwriter Karaoke

A small browser-based workspace for organizing local tracks, syncing lyrics, and singing along.

## Run it

Open `index.html` in a modern browser, or serve this directory with any static web server. The app has no build step or external runtime dependencies. Google Fonts are an optional stylesheet enhancement; system fonts are used as fallback.

## Features

- Library, Import, Editor, and Player tabs with sample projects on first launch.
- Local project metadata saved in `localStorage`; uploaded audio files saved in IndexedDB.
- Audio import, decoded waveform display, click-to-seek, and playback controls.
- Paste lyrics or import/export `.lrc`; stamp the next untimed lyric with Space while audio is playing.
- Real-time active lyric highlighting, text-size and backdrop controls.
- Optional Web Audio center-channel reduction using phase inversion. It is a basic mix-dependent effect, not source separation; results vary by recording.

## Storage and privacy

Audio and project data remain in the browser and are not uploaded. Clearing site data removes saved projects and audio. Audio storage depends on browser quota and IndexedDB support. The initial specification file (`SPEC.md`) was not present in the repository, so this implementation follows the requested feature list.
