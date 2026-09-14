import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_HEADROOM_CONFIG,
	isRemoteBlocked,
	loadHeadroomConfig,
	writeHeadroomConfig,
} from "./config.ts";

describe("Headroom unified config", () => {
	it("creates the destination and returns normalized defaults", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-config-"));
		try {
			const configPath = path.join(root, "headroom", "config.json");
			const config = loadHeadroomConfig({
				configPath,
				env: {},
				legacySettingsPaths: [path.join(root, "missing-settings.json")],
				legacyDisplayPath: path.join(root, "missing-display.json"),
			});
			expect(config).toEqual(DEFAULT_HEADROOM_CONFIG);
			expect(fs.existsSync(configPath)).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("gives PI environment values precedence and blocks remote proxies by default", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-env-"));
		try {
			const configPath = path.join(root, "config.json");
			writeHeadroomConfig({ ...DEFAULT_HEADROOM_CONFIG, baseUrl: "http://127.0.0.1:9000" }, configPath);
			const config = loadHeadroomConfig({
				configPath,
				env: {
					PI_HEADROOM_URL: "https://headroom.example.com/",
					HEADROOM_URL: "http://127.0.0.1:9100",
					PI_HEADROOM_ENABLED: "0",
					HEADROOM_ENABLED: "1",
				},
			});
			expect(config.baseUrl).toBe("https://headroom.example.com");
			expect(config.enabled).toBe(false);
			expect(isRemoteBlocked(config)).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("migrates legacy settings and display once, then lets destination win", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-migration-"));
		try {
			const configPath = path.join(root, "headroom", "config.json");
			const settingsPath = path.join(root, "legacy", "settings.json");
			const displayPath = path.join(root, "legacy", "display.json");
			fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
			fs.writeFileSync(settingsPath, JSON.stringify({ enabled: false, baseUrl: "http://127.0.0.1:9100" }));
			fs.writeFileSync(displayPath, JSON.stringify({ visible: false }));
			const first = loadHeadroomConfig({ configPath, env: {}, legacySettingsPaths: [settingsPath], legacyDisplayPath: displayPath });
			expect(first.enabled).toBe(false);
			expect(first.baseUrl).toBe("http://127.0.0.1:9100");
			expect(first.display.visible).toBe(false);
			fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true, baseUrl: "http://127.0.0.1:9200" }));
			const second = loadHeadroomConfig({ configPath, env: {}, legacySettingsPaths: [settingsPath], legacyDisplayPath: displayPath });
			expect(second.enabled).toBe(false);
			expect(second.baseUrl).toBe("http://127.0.0.1:9100");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
