import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_SHARED_DISPLAY_CONFIG, loadSharedDisplayConfig, writeSharedDisplayConfig } from "./index.ts";
import type { SharedDisplayConfig } from "./index.ts";

describe("Shared Display configuration", () => {
	it("keeps explicit non-root paths as standalone config files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-shared-display-"));
		try {
			const configPath = path.join(root, "config.json");
			const config: SharedDisplayConfig = {
				...DEFAULT_SHARED_DISPLAY_CONFIG,
				order: ["headroom"],
				ponytail: { ...DEFAULT_SHARED_DISPLAY_CONFIG.ponytail, nativeVisible: true },
			};
			writeSharedDisplayConfig(config, configPath);
			expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(config);
			expect(loadSharedDisplayConfig(configPath)).toEqual(config);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("migrates legacy root config and applies root config events live", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "omp-shared-display-home-"));
		const legacyPath = path.join(home, ".config", "codesook-omp", "shared-display", "config.json");
		const rootPath = path.join(home, ".config", "codesook-omp", "config.json");
		fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
		fs.writeFileSync(
			legacyPath,
			JSON.stringify({ layout: "vertical", order: ["headroom"], ponytail: { nativeVisible: true } }),
			"utf8",
		);
		try {
			const source = `
				const mod = await import("./src/index.ts?shared-display-test=${Date.now()}");
			const listeners = new Map();
			const messages = [];
			const events = {
				on(channel, handler) {
					const set = listeners.get(channel) ?? new Set();
					set.add(handler);
					listeners.set(channel, set);
					return () => set.delete(handler);
				},
				emit(channel, data) {
					messages.push({ channel, data });
					for (const handler of listeners.get(channel) ?? []) handler(data);
				},
			};
			const handlers = {};
			const commands = [];
			const pi = {
				events,
				on(name, handler) { handlers[name] = handler; },
				registerCommand(name) { commands.push(name); },
			};
			const config = mod.loadSharedDisplayConfig();
			mod.default(pi);
			const widgets = [];
			const context = {
				hasUI: true,
				ui: { setWidget(key, content, options) { widgets.push({ key, content, options }); }, setStatus() {}, notify() {} },
				setInterval() { return 1; },
				clearTimer() {},
				sessionManager: { getBranch() { return []; } },
			};
			handlers.session_start({}, context);
			const request = messages.find(message => message.data?.kind === "request");
			events.emit(mod.CHANNEL, { protocol: 1, kind: "snapshot", source: "headroom", epoch: request.data.epoch, revision: 1, sequence: { frames: [["H"]] } });
			const mounted = widgets.at(-1)?.content !== undefined;
			events.emit(mod.CODESOOK_OMP_CONFIG_CHANGED, { config: { version: 1, display: { sharedDisplay: { enabled: false } }, behavior: {} } });
			console.log(JSON.stringify({ config, commands, mounted, cleared: widgets.at(-1)?.content === undefined }));
			`;
			const result = Bun.spawnSync([Bun.which("bun") ?? "bun", "-e", source], {
				cwd: path.resolve(import.meta.dir, ".."),
				env: { ...process.env, HOME: home },
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(result.exitCode).toBe(0);
			expect(result.stderr.toString()).toBe("");
			const output = JSON.parse(result.stdout.toString());
			expect(output.config.layout).toBe("vertical");
			expect(output.commands).toEqual([]);
			expect(output.mounted).toBe(true);
			expect(output.cleared).toBe(true);
			expect(fs.existsSync(legacyPath)).toBe(false);
			expect(JSON.parse(fs.readFileSync(rootPath, "utf8"))).toMatchObject({
				version: 1,
				display: { sharedDisplay: { layout: "vertical" } },
				behavior: {},
			});
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});
});
