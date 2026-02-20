# wopr-plugin-voice-deepgram-stt

Deepgram STT (speech-to-text) capability provider for WOPR using the nova-3 model.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run format    # biome format --write src/
npm test          # vitest run
```

## Key Details

- Implements the `stt` capability provider from `@wopr-network/plugin-types`
- Uses `@deepgram/sdk`
- Model: `nova-3` (best accuracy as of 2025) — configurable
- Supports both file transcription and real-time streaming via WebSocket
- API key configured via plugin config schema
- Hosted capability — revenue-generating.
- **Gotcha**: Real-time streaming requires a WebSocket connection to Deepgram. Ensure the host has stable network for live transcription.

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-voice-deepgram-stt`.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.