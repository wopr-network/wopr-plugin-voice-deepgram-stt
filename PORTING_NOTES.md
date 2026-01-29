# Porting Notes: Clawdbot → WOPR

This document outlines how the Deepgram STT provider was ported from clawdbot to WOPR.

## Source Reference

- **Original**: `/home/tsavo/wopr-project/reference/clawdbot-1154/src/media-understanding/providers/deepgram/audio.ts`
- **WOPR Plugin**: `/home/tsavo/wopr-project/plugins/wopr-plugin-voice-deepgram-stt/`

## Architecture Changes

### 1. Interface Adaptation

**Clawdbot**:
```typescript
export async function transcribeDeepgramAudio(
  params: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult>
```

**WOPR**:
```typescript
class DeepgramProvider implements STTProvider {
  async transcribe(audio: Buffer, options?: STTOptions): Promise<string>
  async createSession(options?: STTOptions): Promise<STTSession>
}
```

### 2. Configuration

**Clawdbot**: Function parameters with explicit `apiKey`, `baseUrl`, `model`, etc.

**WOPR**:
- Plugin config via `WOPRPluginContext.getConfig<DeepgramConfig>()`
- Environment variable fallback (`DEEPGRAM_API_KEY`)
- Metadata with dependency requirements

### 3. Plugin Metadata

Added to WOPR version:

```typescript
readonly metadata: VoicePluginMetadata = {
  name: "deepgram-stt",
  version: "1.0.0",
  type: "stt",
  capabilities: ["batch", "streaming", "language-detection"],
  requires: {
    env: ["DEEPGRAM_API_KEY"],
  },
  primaryEnv: "DEEPGRAM_API_KEY",
}
```

### 4. Streaming Support

**Clawdbot**: Only batch transcription via REST API

**WOPR**: Added streaming via WebSocket

- `DeepgramSession` class for WebSocket connections
- Partial transcript callbacks
- Voice Activity Detection (VAD) support
- Real-time interim results

## Key Features Added

1. **Streaming Transcription**: WebSocket-based real-time transcription
2. **Partial Results**: Interim transcripts during streaming
3. **Session Management**: Proper session lifecycle (connect, send, end, close)
4. **Health Check**: API connectivity validation
5. **Plugin Registration**: Auto-registers via `ctx.registerSTTProvider()`

## Implementation Details

### Batch Transcription (Preserved from clawdbot)

```typescript
// Same REST API endpoint: /v1/listen
// Same query parameters: model, language, punctuate
// Same authorization: Token header
// Same error handling pattern
```

### Streaming Transcription (New)

```typescript
// WebSocket endpoint: wss://api.deepgram.com/v1/listen
// Message types: Results, Metadata, SpeechStarted, UtteranceEnd
// Supports interim_results for partial transcripts
// Handles isFinal and speech_final flags
```

### Error Handling

Both implementations use:
- `fetchWithTimeout` for timeout control
- `readErrorResponse` for error extraction
- Descriptive error messages with HTTP status codes

## Utility Functions

Copied from clawdbot's `shared.ts`:
- `normalizeBaseUrl()`: Remove trailing slashes
- `fetchWithTimeout()`: Abort controller-based timeout
- `readErrorResponse()`: Extract and truncate error messages

## Dependencies

**Clawdbot**: No external dependencies (uses global `fetch`)

**WOPR**:
- `ws@^8.16.0` for WebSocket support
- `@types/ws@^8.5.10` for TypeScript types

## Testing Strategy

Suggested tests (not implemented in this port):

1. **Unit Tests**:
   - Config validation
   - URL construction
   - Error message formatting

2. **Integration Tests**:
   - Batch transcription with real API
   - Streaming with WebSocket
   - Health check

3. **Mock Tests**:
   - Simulate API responses
   - Test timeout handling
   - Test WebSocket message parsing

## Migration Guide for Existing Users

### From clawdbot function:

```typescript
// Old (clawdbot)
import { transcribeDeepgramAudio } from "./providers/deepgram/audio.js";

const result = await transcribeDeepgramAudio({
  apiKey: process.env.DEEPGRAM_API_KEY,
  buffer: audioBuffer,
  model: "nova-3",
  language: "en",
});
console.log(result.text);
```

### To WOPR plugin:

```typescript
// New (WOPR)
const stt = ctx.getSTT(); // Auto-registered by plugin
const text = await stt.transcribe(audioBuffer, { language: "en" });
console.log(text);
```

## Future Enhancements

1. **Diarization**: Speaker separation
2. **Redaction**: PII removal
3. **Topics**: Automatic topic detection
4. **Summaries**: AI-generated summaries
5. **Search**: Keyword search within transcripts
6. **Multi-channel**: Stereo/multi-track support
7. **Custom Vocabulary**: Domain-specific terms
8. **Confidence Thresholds**: Filter low-confidence results

## API Compatibility

**Deepgram REST API**: v1 (stable)
**Deepgram WebSocket API**: v1 (stable)

Model support:
- ✅ nova-3 (default)
- ✅ nova-2
- ✅ nova
- ✅ enhanced
- ✅ base

## License

Both implementations: MIT
