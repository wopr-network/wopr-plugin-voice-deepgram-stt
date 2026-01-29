/**
 * WOPR Voice Plugin: Deepgram STT
 *
 * Provides cloud-based STT using Deepgram's nova-3 model.
 * Supports both batch transcription and streaming via WebSocket.
 *
 * Usage:
 * ```typescript
 * // Plugin auto-registers on init
 * // Channel plugins access via:
 * const stt = ctx.getSTT();
 * if (stt) {
 *   // Batch transcription
 *   const text = await stt.transcribe(audioBuffer);
 *
 *   // Streaming transcription
 *   const session = await stt.createSession({ language: "en" });
 *   session.onPartial((chunk) => console.log("Partial:", chunk.text));
 *   session.sendAudio(audioChunk);
 *   session.endAudio();
 *   const finalText = await session.waitForTranscript();
 * }
 * ```
 */

import type {
  STTProvider,
  STTSession,
  STTOptions,
  STTTranscriptChunk,
  VoicePluginMetadata,
} from "wopr/voice";
import type { WOPRPlugin, WOPRPluginContext } from "wopr";
import WebSocket from "ws";

// =============================================================================
// Configuration
// =============================================================================

interface DeepgramConfig {
  /** Deepgram API key (overrides DEEPGRAM_API_KEY env var) */
  apiKey?: string;
  /** Base URL for Deepgram API */
  baseUrl?: string;
  /** Model to use (default: nova-3) */
  model?: string;
  /** Language code (e.g., "en", "es", "auto" for auto-detect) */
  language?: string;
  /** Enable word timestamps */
  wordTimestamps?: boolean;
  /** Request timeout in ms */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<Omit<DeepgramConfig, "apiKey">> = {
  baseUrl: "https://api.deepgram.com/v1",
  model: "nova-3",
  language: "en",
  wordTimestamps: false,
  timeoutMs: 30000,
};

// =============================================================================
// Deepgram API Types
// =============================================================================

interface DeepgramTranscriptResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    }>;
  };
}

interface DeepgramStreamMessage {
  type: "Results" | "Metadata" | "SpeechStarted" | "UtteranceEnd";
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
}

// =============================================================================
// Utility Functions
// =============================================================================

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  const raw = baseUrl?.trim() || fallback;
  return raw.replace(/\/+$/, "");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorResponse(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (!collapsed) return undefined;
    if (collapsed.length <= 300) return collapsed;
    return `${collapsed.slice(0, 300)}…`;
  } catch {
    return undefined;
  }
}

// =============================================================================
// STT Session Implementation (Streaming)
// =============================================================================

class DeepgramSession implements STTSession {
  private ws: WebSocket | null = null;
  private partialCallback?: (chunk: STTTranscriptChunk) => void;
  private finalTranscript = "";
  private ended = false;
  private resolveTranscript?: (text: string) => void;
  private rejectTranscript?: (err: Error) => void;

  constructor(
    private apiKey: string,
    private model: string,
    private options: STTOptions,
  ) {}

  async connect(): Promise<void> {
    const wsUrl = new URL("wss://api.deepgram.com/v1/listen");
    wsUrl.searchParams.set("model", this.model);

    if (this.options.language?.trim()) {
      wsUrl.searchParams.set("language", this.options.language.trim());
    }

    // Enable interim results for partial transcripts
    wsUrl.searchParams.set("interim_results", "true");
    wsUrl.searchParams.set("punctuate", "true");
    wsUrl.searchParams.set("smart_format", "true");

    if (this.options.vadEnabled) {
      wsUrl.searchParams.set("vad_events", "true");
    }

    if (this.options.wordTimestamps) {
      wsUrl.searchParams.set("utterance_end_ms", "1000");
    }

    this.ws = new WebSocket(wsUrl.toString(), {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    return new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws?.removeListener("error", onError);
        this.setupMessageHandlers();
        resolve();
      };

      const onError = (err: Error) => {
        this.ws?.removeListener("open", onOpen);
        reject(new Error(`Deepgram WebSocket connection failed: ${err.message}`));
      };

      this.ws?.once("open", onOpen);
      this.ws?.once("error", onError);
    });
  }

  private setupMessageHandlers(): void {
    this.ws?.on("message", (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as DeepgramStreamMessage;

        if (message.type === "Results" && message.channel?.alternatives?.[0]) {
          const alt = message.channel.alternatives[0];
          const text = alt.transcript?.trim() || "";
          const confidence = alt.confidence;

          if (text) {
            const isFinal = message.is_final || message.speech_final || false;

            if (isFinal) {
              // Append to final transcript
              this.finalTranscript += (this.finalTranscript ? " " : "") + text;
            }

            // Emit partial or final chunk
            if (this.partialCallback) {
              this.partialCallback({
                text,
                isFinal,
                confidence,
                timestamp: Date.now(),
              });
            }
          }
        } else if (message.type === "UtteranceEnd") {
          // Natural speech boundary detected
          if (this.options.vadEnabled && this.ended) {
            this.finishTranscript();
          }
        }
      } catch (err) {
        console.error("[deepgram] Failed to parse message:", err);
      }
    });

    this.ws?.on("error", (err: Error) => {
      this.rejectTranscript?.(new Error(`Deepgram WebSocket error: ${err.message}`));
    });

    this.ws?.on("close", () => {
      if (this.ended && this.resolveTranscript) {
        this.finishTranscript();
      }
    });
  }

  sendAudio(audio: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Deepgram session not connected");
    }
    if (this.ended) {
      throw new Error("Session ended, cannot send more audio");
    }
    this.ws.send(audio);
  }

  endAudio(): void {
    this.ended = true;
    // Send close frame to signal end of audio
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    }
  }

  onPartial(callback: (chunk: STTTranscriptChunk) => void): void {
    this.partialCallback = callback;
  }

  async waitForTranscript(timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.resolveTranscript = resolve;
      this.rejectTranscript = reject;

      // Set timeout
      const timer = setTimeout(() => {
        reject(new Error("Transcript timeout"));
        this.close();
      }, timeoutMs);

      // Clear timeout when resolved
      const originalResolve = this.resolveTranscript;
      this.resolveTranscript = (text: string) => {
        clearTimeout(timer);
        originalResolve(text);
      };
    });
  }

  private finishTranscript(): void {
    const text = this.finalTranscript.trim();
    this.resolveTranscript?.(text);
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.ended = true;
  }
}

// =============================================================================
// STT Provider Implementation
// =============================================================================

class DeepgramProvider implements STTProvider {
  readonly metadata: VoicePluginMetadata = {
    name: "deepgram-stt",
    version: "1.0.0",
    type: "stt",
    description: "Cloud STT using Deepgram's nova-3 model",
    capabilities: ["batch", "streaming", "language-detection"],
    local: false,
    emoji: "🎙️",
    homepage: "https://deepgram.com",
    requires: {
      env: ["DEEPGRAM_API_KEY"],
    },
    primaryEnv: "DEEPGRAM_API_KEY",
  };

  private config: Required<Omit<DeepgramConfig, "apiKey">> & { apiKey: string };
  private baseUrl: string;

  constructor(config: DeepgramConfig = {}) {
    const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY || "";
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is required");
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      apiKey,
    };

    this.baseUrl = normalizeBaseUrl(this.config.baseUrl, DEFAULT_CONFIG.baseUrl);
  }

  validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is required");
    }

    // Validate model
    const validModels = ["nova-3", "nova-2", "nova", "enhanced", "base"];
    if (!validModels.includes(this.config.model)) {
      throw new Error(
        `Invalid model: ${this.config.model}. Valid: ${validModels.join(", ")}`,
      );
    }

    // Validate timeout
    if (this.config.timeoutMs < 1000 || this.config.timeoutMs > 300000) {
      throw new Error(`Invalid timeout: ${this.config.timeoutMs}ms (must be 1000-300000)`);
    }
  }

  async createSession(options?: STTOptions): Promise<STTSession> {
    const session = new DeepgramSession(this.config.apiKey, this.config.model, {
      language: this.config.language,
      wordTimestamps: this.config.wordTimestamps,
      ...options,
    });

    await session.connect();
    return session;
  }

  async transcribe(audio: Buffer, options?: STTOptions): Promise<string> {
    const url = new URL(`${this.baseUrl}/listen`);
    url.searchParams.set("model", this.config.model);

    const language = options?.language || this.config.language;
    if (language?.trim()) {
      url.searchParams.set("language", language.trim());
    }

    // Additional query parameters
    url.searchParams.set("punctuate", "true");
    url.searchParams.set("smart_format", "true");

    if (options?.wordTimestamps || this.config.wordTimestamps) {
      url.searchParams.set("utterances", "true");
    }

    const headers = new Headers({
      Authorization: `Token ${this.config.apiKey}`,
      "Content-Type": "application/octet-stream",
    });

    const res = await fetchWithTimeout(
      url.toString(),
      {
        method: "POST",
        headers,
        body: audio,
      },
      this.config.timeoutMs,
    );

    if (!res.ok) {
      const detail = await readErrorResponse(res);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`Deepgram transcription failed (HTTP ${res.status})${suffix}`);
    }

    const payload = (await res.json()) as DeepgramTranscriptResponse;
    const transcript =
      payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();

    if (!transcript) {
      throw new Error("Deepgram response missing transcript");
    }

    return transcript;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Use the batch endpoint with empty audio to check connectivity
      const url = new URL(`${this.baseUrl}/listen`);
      url.searchParams.set("model", this.config.model);

      const headers = new Headers({
        Authorization: `Token ${this.config.apiKey}`,
      });

      const res = await fetchWithTimeout(
        url.toString(),
        {
          method: "GET",
          headers,
        },
        5000,
      );

      // 405 Method Not Allowed is expected for GET (we just want to check auth)
      // 200/201 would be valid, 401/403 would indicate auth issues
      return res.status === 405 || res.ok;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Plugin Export
// =============================================================================

let provider: DeepgramProvider | null = null;

const plugin: WOPRPlugin = {
  name: "voice-deepgram-stt",
  version: "1.0.0",
  description: "Cloud STT using Deepgram's nova-3 model",

  async init(ctx: WOPRPluginContext) {
    const config = ctx.getConfig<DeepgramConfig>();

    try {
      provider = new DeepgramProvider(config);
      provider.validateConfig();
      ctx.registerSTTProvider(provider);
      ctx.log.info("Deepgram STT provider registered");
    } catch (err) {
      ctx.log.error(`Failed to register Deepgram STT: ${err}`);
      throw err;
    }
  },

  async shutdown() {
    // No persistent connections to clean up
    provider = null;
  },
};

export default plugin;
