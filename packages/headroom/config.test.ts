import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	isRemoteBlocked,
	loadHeadroomConfig,
	loadHeadroomSettingsWithFallback,
} from "./config.ts";

describe("Headroom config", () => {
	it("keeps the Pi extension defaults", () => {
		const config = loadHeadroomConfig({});

		expect(config).toEqual({
			enabled: true,
			baseUrl: "http://127.0.0.1:8788",
			allowRemote: false,
			autoStart: true,
			command: "headroom",
			minContextTokens: 20_000,
			minMessageChars: 2_000,
			timeoutMs: 30_000,
		});
	});

	it("blocks remote proxies unless explicitly allowed", () => {
		const blocked = loadHeadroomConfig({ PI_HEADROOM_URL: "https://headroom.example.com/" });
		const allowed = loadHeadroomConfig({
			PI_HEADROOM_URL: "https://headroom.example.com/",
			PI_HEADROOM_ALLOW_REMOTE: "1",
		});

		expect(isRemoteBlocked(blocked)).toBe(true);
		expect(isRemoteBlocked(allowed)).toBe(false);
	});

	it("prefers OMP settings and falls back to missing or invalid legacy candidates", () => {
		const settingsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-priority-"));
		const preferredPath = path.join(settingsDirectory, "omp", "settings.json");
		const legacyPath = path.join(settingsDirectory, "legacy", "settings.json");
		try {
			fs.mkdirSync(path.dirname(preferredPath), { recursive: true });
			fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
			fs.writeFileSync(preferredPath, JSON.stringify({ baseUrl: "http://127.0.0.1:9100" }));
			fs.writeFileSync(legacyPath, JSON.stringify({ baseUrl: "http://127.0.0.1:9200" }));

			expect(loadHeadroomSettingsWithFallback([preferredPath, legacyPath])).toEqual({
				baseUrl: "http://127.0.0.1:9100",
			});

			fs.rmSync(preferredPath);
			expect(loadHeadroomSettingsWithFallback([preferredPath, legacyPath])).toEqual({
				baseUrl: "http://127.0.0.1:9200",
			});

			fs.mkdirSync(path.dirname(preferredPath), { recursive: true });
			fs.writeFileSync(preferredPath, "{invalid");
			expect(loadHeadroomSettingsWithFallback([preferredPath, legacyPath])).toEqual({
				baseUrl: "http://127.0.0.1:9200",
			});
		} finally {
			fs.rmSync(settingsDirectory, { recursive: true, force: true });
		}
	});

	it("gives valid environment values precedence field by field", () => {
		const config = loadHeadroomConfig(
			{
				PI_HEADROOM_ENABLED: "0",
				HEADROOM_ENABLED: "1",
				PI_HEADROOM_URL: "http://127.0.0.1:9100/",
				HEADROOM_URL: "http://127.0.0.1:9200",
				HEADROOM_BASE_URL: "http://127.0.0.1:9300",
				PI_HEADROOM_ALLOW_REMOTE: "1",
				HEADROOM_ALLOW_REMOTE: "0",
				PI_HEADROOM_AUTO_START: "false",
				HEADROOM_AUTO_START: "true",
				PI_HEADROOM_COMMAND: "pi-headroom",
				HEADROOM_COMMAND: "generic-headroom",
				PI_HEADROOM_MIN_CONTEXT_TOKENS: "123",
				HEADROOM_MIN_CONTEXT_TOKENS: "456",
				PI_HEADROOM_MIN_MESSAGE_CHARS: "321",
				HEADROOM_MIN_MESSAGE_CHARS: "654",
				PI_HEADROOM_TIMEOUT_MS: "1000",
				HEADROOM_TIMEOUT_MS: "2000",
			},
			{
				enabled: true,
				baseUrl: "http://127.0.0.1:9000",
				allowRemote: false,
				autoStart: true,
				command: "settings-headroom",
				minContextTokens: 900,
				minMessageChars: 901,
				timeoutMs: 902,
			},
		);

		expect(config).toEqual({
			enabled: false,
			baseUrl: "http://127.0.0.1:9100",
			allowRemote: true,
			autoStart: false,
			command: "pi-headroom",
			minContextTokens: 123,
			minMessageChars: 321,
			timeoutMs: 1000,
		});
	});

	it("falls through invalid or empty environment values to settings", () => {
		const config = loadHeadroomConfig(
			{
				PI_HEADROOM_ENABLED: "sometimes",
				HEADROOM_ENABLED: "",
				PI_HEADROOM_URL: "not-a-url",
				HEADROOM_URL: " ",
				HEADROOM_BASE_URL: "",
				PI_HEADROOM_ALLOW_REMOTE: "invalid",
				PI_HEADROOM_AUTO_START: " ",
				PI_HEADROOM_COMMAND: " ",
				PI_HEADROOM_MIN_CONTEXT_TOKENS: "not-a-number",
				PI_HEADROOM_MIN_MESSAGE_CHARS: "0",
				PI_HEADROOM_TIMEOUT_MS: "99",
			},
			{
				enabled: false,
				baseUrl: "http://127.0.0.1:9000",
				allowRemote: true,
				autoStart: false,
				command: "settings-headroom",
				minContextTokens: 900,
				minMessageChars: 901,
				timeoutMs: 902,
			},
		);

		expect(config).toEqual({
			enabled: false,
			baseUrl: "http://127.0.0.1:9000",
			allowRemote: true,
			autoStart: false,
			command: "settings-headroom",
			minContextTokens: 900,
			minMessageChars: 901,
			timeoutMs: 902,
		});
	});

});
