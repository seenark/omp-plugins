import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defaultCodesookOmpConfig,
	readCodesookOmpConfig,
	updateCodesookOmpConfig,
	writeCodesookOmpConfig,
	type CodesookOmpConfig,
} from "./config-store.ts";

describe("Codesook OMP config store", () => {
	it("returns fresh defaults for missing files and writes canonical config", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-config-store-"));
		try {
			const configPath = path.join(root, "nested", "config.json");
			const first = readCodesookOmpConfig(configPath);
			const second = readCodesookOmpConfig(configPath);
			expect(first).toEqual({ exists: false, valid: true, value: defaultCodesookOmpConfig() });
			expect(first.value).not.toBe(second.value);
			expect(first.value.display).not.toBe(second.value.display);

			const updated = updateCodesookOmpConfig((config) => {
				config.display.enabled = true;
				config.behavior.mode = "safe";
			}, configPath);

			expect(updated).toEqual({ version: 1, display: { enabled: true }, behavior: { mode: "safe" } });
			expect(fs.readFileSync(configPath, "utf8")).toBe(
				'{\n  "version": 1,\n  "display": {\n    "enabled": true\n  },\n  "behavior": {\n    "mode": "safe"\n  }\n}\n',
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves unknown sections and keys during updates", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-config-store-"));
		try {
			const configPath = path.join(root, "config.json");
			const initial = {
				version: 1,
				display: { existing: "display", nested: { keep: true } },
				behavior: { existing: "behavior" },
				future: { keep: [1, 2, 3] },
			} satisfies CodesookOmpConfig & { future: Record<string, unknown> };
			writeCodesookOmpConfig(initial, configPath);

			const updated = updateCodesookOmpConfig((config) => {
				config.display.changed = "yes";
			}, configPath) as CodesookOmpConfig & { future: Record<string, unknown> };

			expect(updated).toEqual({
				version: 1,
				display: { existing: "display", nested: { keep: true }, changed: "yes" },
				behavior: { existing: "behavior" },
				future: { keep: [1, 2, 3] },
			});
			expect(readCodesookOmpConfig(configPath).value).toEqual(updated);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports invalid files and refuses updates", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-config-store-"));
		try {
			const configPath = path.join(root, "config.json");
			fs.writeFileSync(configPath, "{invalid", "utf8");

			expect(readCodesookOmpConfig(configPath)).toEqual({
				exists: true,
				valid: false,
				value: defaultCodesookOmpConfig(),
			});
			expect(() => updateCodesookOmpConfig(() => {}, configPath)).toThrow(
				`Invalid Codesook OMP config: ${configPath}`,
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
