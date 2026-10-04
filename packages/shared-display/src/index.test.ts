import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharedDisplayExtension, {
	CHANNEL,
	connectSharedDisplay,
	composeDisplayRows,
	DEFAULT_SHARED_DISPLAY_CONFIG,
	parseSharedDisplayMessage,
	writeSharedDisplayConfig,
} from "./index.ts";
import type { FrameSequence, SharedDisplayConfig } from "./index.ts";

function makeHostHarness(enabled = true, hasUI = true, order = DEFAULT_SHARED_DISPLAY_CONFIG.order) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-display-host-"));
	const configPath = path.join(root, "config.json");
	writeSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, enabled, order }, configPath);
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const messages: unknown[] = [];
	const events = {
		on(channel: string, handler: (data: unknown) => void) {
			const handlers = listeners.get(channel) ?? new Set();
			handlers.add(handler);
			listeners.set(channel, handlers);
			return () => handlers.delete(handler);
		},
		emit(channel: string, data: unknown) {
			messages.push(data);
			for (const handler of listeners.get(channel) ?? []) handler(data);
		},
	};
	const handlers: Record<string, (event: unknown, context: unknown) => void> = {};
	let widget: { render(width: number): readonly string[] } | undefined;
	const context = {
		hasUI,
		ui: {
			setWidget(_key: string, factory: ((tui: { requestComponentRender(): void }) => typeof widget) | undefined) {
				widget = factory?.({ requestComponentRender() {} });
			},
			setStatus() {},
			notify() {},
		},
		sessionManager: { getBranch() { return []; } },
		setInterval() { throw new Error("Static sources must not start a timer"); },
		clearTimer() {},
	};
	return {
		events,
		messages,
		load() {
			sharedDisplayExtension({
				events,
				on(name: string, handler: (event: unknown, context: unknown) => void) { handlers[name] = handler; },
			} as unknown as Parameters<typeof sharedDisplayExtension>[0], { configPath });
		},
		start() { handlers.session_start!({}, context); },
		switchSession() { handlers.session_switch!({}, context); },
		rows() { return widget?.render(120).map(row => row.trim()) ?? []; },
		close() {
			handlers.session_shutdown?.({}, context);
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}

describe("Shared Display host presence", () => {
	for (const producerFirst of [true, false]) {
		it(`replays CodeGraph with ${producerFirst ? "producer" : "host"} loaded first and clears disposed segments`, () => {
			const host = makeHostHarness();
			try {
				if (!producerFirst) { host.load(); host.start(); }
				const publisher = connectSharedDisplay(host.events, "codegraph");
				expect(publisher.hostAvailable).toBe(!producerFirst);
				const frames = [["CodeGraph ready"]];
				publisher.publish({ frames });
				frames[0]![0] = "changed";
				if (producerFirst) { host.load(); host.start(); }
				expect(publisher.hostAvailable).toBe(true);
				expect(host.rows()).toEqual(["CodeGraph ready"]);
				const availability: boolean[] = [];
				publisher.onHostAvailabilityChange(active => availability.push(active));
				const oldEpoch = host.messages.map(parseSharedDisplayMessage).find(message => message?.kind === "host")!.epoch;
				host.switchSession();
				expect(publisher.hostAvailable).toBe(true);
				expect(host.rows()).toEqual(["CodeGraph ready"]);
				host.events.emit(CHANNEL, { protocol: 1, kind: "snapshot", epoch: oldEpoch, source: "codegraph", revision: 99, sequence: { frames: [["stale session"]] } });
				const currentEpoch = host.messages.map(parseSharedDisplayMessage).findLast(message => message?.kind === "host")!.epoch;
				host.events.emit(CHANNEL, { protocol: 1, kind: "snapshot", epoch: currentEpoch, source: "codegraph", revision: 2, sequence: { frames: [["newer"]] } });
				host.events.emit(CHANNEL, { protocol: 1, kind: "snapshot", epoch: currentEpoch, source: "codegraph", revision: 1, sequence: { frames: [["older"]] } });
				expect(host.rows()).toEqual(["newer"]);
				publisher.publish({ frames: [["latest"]] });
				publisher.dispose();
				expect(host.rows()).toEqual([]);
				expect(availability).toEqual([false, true]);
			} finally {
				host.close();
			}
		});
	}

	for (const [enabled, hasUI] of [[false, true], [true, false]]) {
		it(`keeps host unavailable when enabled=${enabled}, hasUI=${hasUI}`, () => {
			const host = makeHostHarness(enabled, hasUI);
			try {
				host.load();
				host.start();
				const publisher = connectSharedDisplay(host.events, "codegraph");
				publisher.publish({ frames: [["CodeGraph ready"]] });
				expect(publisher.hostAvailable).toBe(false);
				expect(host.rows()).toEqual([]);
				publisher.dispose();
			} finally {
				host.close();
			}
		});
	}
});

describe("Shared Display source composition", () => {
	it("renders CodeGraph with a persisted legacy producer order", () => {
		const host = makeHostHarness(true, true, ["ponytail", "caveman", "headroom"]);
		try {
			host.load();
			host.start();
			connectSharedDisplay(host.events, "headroom").publish({ frames: [["H"]] });
			connectSharedDisplay(host.events, "caveman").publish({ frames: [["C"]] });
			const codegraph = connectSharedDisplay(host.events, "codegraph");
			codegraph.publish({ frames: [["CodeGraph ready"]] });
			expect(codegraph.hostAvailable).toBe(true);
			expect(host.rows()).toEqual(["C  H  CodeGraph ready"]);
		} finally {
			host.close();
		}
	});

	it("appends CodeGraph after existing producers without changing their order", () => {
		const snapshots = new Map([
			["codegraph", { frames: [["G"]] }],
			["headroom", { frames: [["H"]] }],
			["caveman", { frames: [["C"]] }],
			["ponytail", { frames: [["P"]] }],
		] as const);
		expect(composeDisplayRows(snapshots, {
			layout: "horizontal",
			order: DEFAULT_SHARED_DISPLAY_CONFIG.order,
			width: 10,
		})).toEqual(["P  C  H  G"]);
	});
});

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
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	describe("Shared Display animation", () => {
		it("animates configured frames while the agent is idle", () => {
			const snapshots = new Map<"headroom", FrameSequence>([
				["headroom", { frames: [["A"], ["B"]], fps: 1 }],
			]);
			expect(
				composeDisplayRows(snapshots, {
					layout: "horizontal",
					order: ["headroom"],
					width: 1,
					nowMs: 1_500,
					animationOriginMs: 0,
					active: false,
				}),
			).toEqual(["B"]);
		});
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
			const availability = [];
			const pi = {
				events,
				on(name, handler) { handlers[name] = handler; },
			};
			const config = mod.loadSharedDisplayConfig();
			mod.default(pi);
			const publisher = mod.connectSharedDisplay(events, "headroom");
			publisher.onHostAvailabilityChange(active => availability.push(active));
			publisher.publish({ frames: [["H"]] });
			const widgets = [];
			let widget;
			const context = {
				hasUI: true,
				ui: {
					setWidget(key, content, options) {
						widgets.push({ key, content, options });
						widget = content?.({ requestComponentRender() {} });
					},
					setStatus() {}, notify() {}
				},
				setInterval() { return 1; },
				clearTimer() {},
				sessionManager: { getBranch() { return []; } },
			};
			handlers.session_start({}, context);
			const mounted = widgets.at(-1)?.content !== undefined;
			events.emit(mod.CODESOOK_OMP_CONFIG_CHANGED, { config: { version: 1, display: { sharedDisplay: { enabled: false } }, behavior: {} } });
			const disabled = !publisher.hostAvailable && widget === undefined;
			publisher.publish({ frames: [["latest while disabled"]] });
			events.emit(mod.CODESOOK_OMP_CONFIG_CHANGED, { config: { version: 1, display: { sharedDisplay: { enabled: true } }, behavior: {} } });
			const enabled = publisher.hostAvailable;
			const replay = widget.render(40).map(row => row.trim());
			handlers.session_shutdown({});
			const shutdown = !publisher.hostAvailable && widget === undefined;
			const late = mod.connectSharedDisplay(events, "codegraph");
			console.log(JSON.stringify({ config, mounted, disabled, enabled, replay, shutdown, lateAvailable: late.hostAvailable, availability }));
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
			expect(output.mounted).toBe(true);
			expect(output.disabled).toBe(true);
			expect(output.enabled).toBe(true);
			expect(output.replay).toEqual(["latest while disabled"]);
			expect(output.shutdown).toBe(true);
			expect(output.lateAvailable).toBe(false);
			expect(output.availability).toEqual([true, false, true, false]);
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
