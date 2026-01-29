# WOPR Voice Plugin: Deepgram STT

Cloud-based Speech-to-Text provider using Deepgram's nova-3 model.

## Features

- **Batch Transcription**: Transcribe complete audio buffers via REST API
- **Streaming Transcription**: Real-time transcription via WebSocket
- **Language Detection**: Auto-detect language or specify explicitly
- **High Accuracy**: Uses Deepgram's latest nova-3 model
- **Partial Transcripts**: Get interim results during streaming

## Requirements

- Deepgram API key (sign up at https://deepgram.com)
- Environment variable: `DEEPGRAM_API_KEY`

## Installation

```bash
cd /home/tsavo/wopr-project/plugins/wopr-plugin-voice-deepgram-stt
pnpm install
pnpm build
```

## Configuration

Set your API key in the environment:

```bash
export DEEPGRAM_API_KEY="your-api-key-here"
```

Or configure via WOPR config:

```javascript
{
  "plugins": {
    "voice-deepgram-stt": {
      "apiKey": "your-api-key-here",
      "model": "nova-3",              // nova-3, nova-2, nova, enhanced, base
      "language": "en",                // Language code or "auto"
      "wordTimestamps": false,
      "timeoutMs": 30000
    }
  }
}
```

## Usage

### Batch Transcription

```typescript
const stt = ctx.getSTT();
if (!stt) {
  throw new Error("No STT provider registered");
}

const audioBuffer = await fs.readFile("audio.wav");
const transcript = await stt.transcribe(audioBuffer, {
  language: "en",
});

console.log("Transcript:", transcript);
```

### Streaming Transcription

```typescript
const stt = ctx.getSTT();
const session = await stt.createSession({
  language: "en",
  vadEnabled: true,
  vadSilenceMs: 1000,
});

// Listen for partial results
session.onPartial((chunk) => {
  if (chunk.isFinal) {
    console.log("Final:", chunk.text);
  } else {
    console.log("Partial:", chunk.text);
  }
});

// Send audio chunks
for (const chunk of audioChunks) {
  session.sendAudio(chunk);
}

// Signal end of audio
session.endAudio();

// Wait for final transcript
const finalTranscript = await session.waitForTranscript();
console.log("Complete:", finalTranscript);

// Cleanup
await session.close();
```

## API Reference

### DeepgramProvider

Implements the `STTProvider` interface from `wopr/voice`.

#### Methods

- `validateConfig()`: Validates configuration (throws on error)
- `createSession(options?: STTOptions)`: Create streaming session
- `transcribe(audio: Buffer, options?: STTOptions)`: Batch transcription
- `healthCheck()`: Check API connectivity (returns boolean)

### DeepgramSession

Implements the `STTSession` interface for streaming.

#### Methods

- `sendAudio(audio: Buffer)`: Send audio chunk for transcription
- `endAudio()`: Signal end of audio stream
- `onPartial(callback)`: Register callback for partial transcripts
- `waitForTranscript(timeoutMs?)`: Wait for final transcript
- `close()`: Close session and cleanup

## Supported Models

- `nova-3` (default): Latest and most accurate
- `nova-2`: Previous generation
- `nova`: Original nova model
- `enhanced`: Enhanced accuracy
- `base`: Baseline model

## Supported Languages

Deepgram supports 30+ languages. Common codes:

- `en` - English
- `es` - Spanish
- `fr` - French
- `de` - German
- `zh` - Chinese
- `auto` - Auto-detect

Full list: https://developers.deepgram.com/docs/languages

## Error Handling

All methods throw descriptive errors:

```typescript
try {
  const transcript = await stt.transcribe(audio);
} catch (err) {
  if (err.message.includes("HTTP 401")) {
    console.error("Invalid API key");
  } else if (err.message.includes("timeout")) {
    console.error("Request timed out");
  } else {
    console.error("Transcription failed:", err);
  }
}
```

## Performance

- **Batch**: ~2-5 seconds for 1 minute of audio
- **Streaming**: Real-time with <500ms latency
- **Accuracy**: 90-95% on clean audio
- **Rate Limits**: Varies by plan (check Deepgram dashboard)

## License

MIT
