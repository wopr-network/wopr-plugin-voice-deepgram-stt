import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ws module
vi.mock("ws", () => ({
	default: vi.fn(),
	WebSocket: { OPEN: 1 },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeMockCtx(
	config: Record<string, unknown> = { apiKey: "test-key-123" },
) {
	const ctx = {
		getConfig: vi.fn().mockReturnValue(config),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		log: { info: vi.fn(), error: vi.fn() },
	};
	return ctx as unknown as WOPRPluginContext & typeof ctx;
}

describe("wopr-plugin-voice-deepgram-stt", () => {
	let plugin: WOPRPlugin;

	beforeEach(async () => {
		vi.resetModules();
		vi.stubEnv("DEEPGRAM_API_KEY", "test-key-123");
		const mod = await import("./index.js");
		plugin = mod.default;
	});

	describe("plugin metadata", () => {
		it("has correct name", () => {
			expect(plugin.name).toBe("voice-deepgram-stt");
		});

		it("has correct version", () => {
			expect(plugin.version).toBe("1.0.0");
		});

		it("exports init and shutdown", () => {
			expect(typeof plugin.init).toBe("function");
			expect(typeof plugin.shutdown).toBe("function");
		});
	});

	describe("init", () => {
		it("registers STT provider", async () => {
			const mockCtx = makeMockCtx();

			await plugin.init?.(mockCtx);

			expect(mockCtx.registerProvider).toHaveBeenCalledWith(
				expect.any(Object),
			);
		});

		it("throws when API key is missing", async () => {
			vi.stubEnv("DEEPGRAM_API_KEY", "");
			const mockCtx = makeMockCtx({});

			await expect(plugin.init?.(mockCtx)).rejects.toThrow(
				"DEEPGRAM_API_KEY is required",
			);
		});
	});

	describe("shutdown", () => {
		it("is idempotent (can be called multiple times)", async () => {
			await plugin.shutdown?.();
			await plugin.shutdown?.();
			// No throw = pass
		});

		it("cleans up after init", async () => {
			const mockCtx = makeMockCtx();
			await plugin.init?.(mockCtx);
			await plugin.shutdown?.();
			// Re-init works after shutdown
			await plugin.init?.(mockCtx);
		});
	});

	describe("DeepgramProvider (via init)", () => {
		it("validates config rejects invalid model", async () => {
			const mockCtx = makeMockCtx({
				apiKey: "test-key-123",
				model: "invalid-model",
			});

			await expect(plugin.init?.(mockCtx)).rejects.toThrow("Invalid model");
		});

		it("validates config rejects invalid timeout", async () => {
			const mockCtx = makeMockCtx({ apiKey: "test-key-123", timeoutMs: 500 });

			await expect(plugin.init?.(mockCtx)).rejects.toThrow("Invalid timeout");
		});
	});

	describe("transcribe (batch)", () => {
		it("calls Deepgram API and returns transcript", async () => {
			const mockCtx = makeMockCtx();

			await plugin.init?.(mockCtx);

			const registeredProvider = mockCtx.registerProvider.mock.calls[0][0];

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					results: {
						channels: [
							{
								alternatives: [{ transcript: "hello world", confidence: 0.98 }],
							},
						],
					},
				}),
			});

			const result = await registeredProvider.transcribe(
				Buffer.from("fake-audio"),
			);
			expect(result).toBe("hello world");
		});

		it("throws on HTTP error", async () => {
			const mockCtx = makeMockCtx();

			await plugin.init?.(mockCtx);
			const registeredProvider = mockCtx.registerProvider.mock.calls[0][0];

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => "Unauthorized",
			});

			await expect(
				registeredProvider.transcribe(Buffer.from("fake-audio")),
			).rejects.toThrow("Deepgram transcription failed (HTTP 401)");
		});

		it("throws when transcript is empty", async () => {
			const mockCtx = makeMockCtx();

			await plugin.init?.(mockCtx);
			const registeredProvider = mockCtx.registerProvider.mock.calls[0][0];

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ results: { channels: [] } }),
			});

			await expect(
				registeredProvider.transcribe(Buffer.from("fake-audio")),
			).rejects.toThrow("Deepgram response missing transcript");
		});
	});

	describe("healthCheck", () => {
		it("returns true on 405 (auth valid, wrong method)", async () => {
			const mockCtx = makeMockCtx();

			await plugin.init?.(mockCtx);
			const registeredProvider = mockCtx.registerProvider.mock.calls[0][0];

			mockFetch.mockResolvedValueOnce({ ok: false, status: 405 });

			const result = await registeredProvider.healthCheck();
			expect(result).toBe(true);
		});

		it("returns false on network error", async () => {
			const mockCtx = makeMockCtx();

			await plugin.init?.(mockCtx);
			const registeredProvider = mockCtx.registerProvider.mock.calls[0][0];

			mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

			const result = await registeredProvider.healthCheck();
			expect(result).toBe(false);
		});
	});
});
