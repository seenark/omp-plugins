import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharedDisplayExtension, {
	CHANNEL,
	connectSharedDisplay,
	composeDisplayRows,
	DEFAULT_SHARED_DISPLAY_CONFIG,
	normalizeSharedDisplayConfig,
	validateSharedDisplayConfig,
	parseSharedDisplayMessage,
	writeSharedDisplayConfig,
} from "./index.ts";
import type {
	FrameSequence,
	SharedDisplayConfig,
	SharedDisplayLayout,
	SharedDisplayPalette,
	SharedDisplayStyle,
	ResolvedPalette,
} from "./index.ts";

type HarnessTheme = { getColorHex(name: string): string; getBgHex(name: string): string };

function makeHostHarness(
	enabled = true,
	hasUI = true,
	order = DEFAULT_SHARED_DISPLAY_CONFIG.order,
	display: {
		style?: SharedDisplayStyle;
		palette?: SharedDisplayPalette;
		layout?: SharedDisplayLayout;
		theme?: HarnessTheme;
	} = {},
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-display-host-"));
	const configPath = path.join(root, "config.json");
	writeSharedDisplayConfig(
		{
			...DEFAULT_SHARED_DISPLAY_CONFIG,
			enabled,
			order,
			...(display.style === undefined ? {} : { style: display.style }),
			...(display.palette === undefined ? {} : { palette: display.palette }),
			...(display.layout === undefined ? {} : { layout: display.layout }),
		},
		configPath,
	);
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
			setStatus(_key: string, _text: string | undefined) {},
			notify() {},
			theme: display.theme,
		},
		sessionManager: { getBranch() { return [{ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } }]; } },
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
				getCommands() { return [{ name: "ponytail", source: "extension" }]; },
			} as unknown as Parameters<typeof sharedDisplayExtension>[0], { configPath });
		},
		start() { handlers.session_start!({}, context); },
		switchSession() { handlers.session_switch!({}, context); },
		context,
		rows() { return widget?.render(120).map(row => row.trim()) ?? []; },
		close() {
			handlers.session_shutdown?.({}, context);
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}

describe("Shared Display host presence", () => {
	it("renders a reconnected producer after a host-first session switch", () => {
		const host = makeHostHarness();
		try {
			host.load();
			host.start();
			const previous = connectSharedDisplay(host.events, "headroom");
			for (const state of ["starting", "online", "compressed", "online", "previous"]) {
				previous.publish({ frames: [[`Headroom ${state}`]] });
			}
			expect(host.rows()).toEqual(["Headroom previous"]);
			host.switchSession();
			expect(previous.hostAvailable).toBe(true);
			expect(host.rows()).toEqual(["Headroom previous"]);
			previous.dispose();
			const current = connectSharedDisplay(host.events, "headroom");
			expect(current.hostAvailable).toBe(true);
			current.publish({ frames: [["Headroom current"]] });
			expect(host.rows()).toEqual(["Headroom current"]);
			current.dispose();
		} finally {
			host.close();
		}
	});

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

describe("Shared Display powerline style", () => {
	const theme: HarnessTheme = {
		getColorHex: name =>
			({
				statusLineModel: "#ff0000",
				statusLinePath: "#00ff00",
				statusLineGitClean: "#0000ff",
				statusLineContext: "#ffff00",
				statusLineSpend: "#ff00ff",
				statusLineDirty: "#00ffff",
			})[name] ?? "#000000",
		getBgHex: () => "#101010",
	};
	const FG = "\x1b[38;2;16;16;16m";

	function publishHeadroomAndRtk(host: { load(): void; start(): void; events: Parameters<typeof connectSharedDisplay>[0] }) {
		host.load();
		host.start();
		const headroom = connectSharedDisplay(host.events, "headroom");
		const rtk = connectSharedDisplay(host.events, "rtk");
		headroom.publish({ frames: [["\x1b[31mH\x1b[0m"]] });
		rtk.publish({ frames: [["R"]] });
		return () => { headroom.dispose(); rtk.dispose(); };
	}

	it("renders themed segments with cap, arrow and end cap, stripping producer colors", () => {
		const host = makeHostHarness(true, true, ["headroom", "rtk"], { style: "powerline", theme });
		try {
			const dispose = publishHeadroomAndRtk(host);
			expect(host.rows()).toEqual([
				"\x1b[38;2;255;0;0m\ue0b6" +
					`\x1b[48;2;255;0;0m${FG} H ` +
					"\x1b[48;2;0;255;0m\x1b[38;2;255;0;0m\ue0b0" +
					`\x1b[48;2;0;255;0m${FG} R ` +
					"\x1b[0m\x1b[38;2;0;255;0m\ue0b4\x1b[0m",
			]);
			dispose();
		} finally {
			host.close();
		}
	});

	it("renders the plain separator-joined row when the theme lacks true colors", () => {
		const host = makeHostHarness(true, true, ["headroom", "rtk"], {
			style: "powerline",
			theme: { getColorHex: () => "ansi-256", getBgHex: () => "ansi-256" },
		});
		try {
			const dispose = publishHeadroomAndRtk(host);
			expect(host.rows()).toEqual(["\x1b[31mH\x1b[0m  R"]);
			dispose();
		} finally {
			host.close();
		}
	});

	it("renders one capped segment per row in vertical layout, cycling colors per block", () => {
		const host = makeHostHarness(true, true, ["headroom", "rtk"], { style: "powerline", layout: "vertical", theme });
		try {
			const dispose = publishHeadroomAndRtk(host);
			expect(host.rows()).toEqual([
				`\x1b[38;2;255;0;0m\ue0b6\x1b[48;2;255;0;0m${FG} H \x1b[0m\x1b[38;2;255;0;0m\ue0b4\x1b[0m`,
				`\x1b[38;2;0;255;0m\ue0b6\x1b[48;2;0;255;0m${FG} R \x1b[0m\x1b[38;2;0;255;0m\ue0b4\x1b[0m`,
			]);
			dispose();
		} finally {
			host.close();
		}
	});
});

describe("Shared Display palettes", () => {
	const theme: HarnessTheme = {
		getColorHex: name =>
			({
				statusLineModel: "#ff0000",
				statusLinePath: "#00ff00",
				statusLineGitClean: "#0000ff",
				statusLineContext: "#ffff00",
				statusLineSpend: "#ff00ff",
				statusLineDirty: "#00ffff",
			})[name] ?? "#000000",
		getBgHex: () => "#101010",
	};
	const RESET = "\x1b[0m";
	const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
	const bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;

	function publishHeadroomAndRtk(host: { load(): void; start(): void; events: Parameters<typeof connectSharedDisplay>[0] }) {
		host.load();
		host.start();
		const headroom = connectSharedDisplay(host.events, "headroom");
		const rtk = connectSharedDisplay(host.events, "rtk");
		headroom.publish({ frames: [["\x1b[31mH\x1b[0m"]] });
		rtk.publish({ frames: [["R"]] });
		return () => { headroom.dispose(); rtk.dispose(); };
	}

	function rowsFor(display: Parameters<typeof makeHostHarness>[3]): string[] {
		const host = makeHostHarness(true, true, ["headroom", "rtk"], display);
		try {
			const dispose = publishHeadroomAndRtk(host);
			const rows = host.rows();
			dispose();
			return rows;
		} finally {
			host.close();
		}
	}

	const POWERLINE_FIRST_TWO_BACKGROUNDS: readonly (readonly [Exclude<SharedDisplayPalette, "none" | "theme">, string, string])[] = [
		["gruvbox", bg(214, 93, 14), bg(215, 153, 33)],
		["catppuccin", bg(243, 139, 168), bg(250, 179, 135)],
		["pastel", bg(154, 52, 142), bg(218, 98, 125)],
		["tokyo-night", bg(163, 174, 210), bg(118, 159, 240)],
	];

	for (const [palette, first, second] of POWERLINE_FIRST_TWO_BACKGROUNDS) {
		it(`paints powerline segments with the ${palette} backgrounds`, () => {
			const [row] = rowsFor({ style: "powerline", palette });
			expect(row).toContain(first);
			expect(row).toContain(second);
			expect(row!.indexOf(first)).toBeLessThan(row!.indexOf(second));
		});
	}

	it("shows each tokyo-night segment foreground", () => {
		const [row] = rowsFor({ style: "powerline", palette: "tokyo-night" });
		const first = fg(9, 12, 12);
		const second = fg(227, 229, 229);
		expect(row).toContain(first);
		expect(row).toContain(second);
		expect(row!.indexOf(first)).toBeLessThan(row!.indexOf(second));
	});

	it("leaves the pastel foreground at the terminal default", () => {
		const [row] = rowsFor({ style: "powerline", palette: "pastel" });
		expect(row).toContain(`${bg(154, 52, 142)}\x1b[39m H `);
	});

	it("colors plain text with gruvbox, leaving the separator uncolored and stripping producer colors", () => {
		expect(rowsFor({ style: "plain", palette: "gruvbox" })).toEqual([
			`${fg(214, 93, 14)}H${RESET}  ${fg(215, 153, 33)}R${RESET}`,
		]);
	});

	it("colors each vertical plain row by its block index", () => {
		expect(rowsFor({ style: "plain", palette: "gruvbox", layout: "vertical" })).toEqual([
			`${fg(214, 93, 14)}H${RESET}`,
			`${fg(215, 153, 33)}R${RESET}`,
		]);
	});

	it("renders plain with palette none exactly as the producers' text joined by the separator", () => {
		expect(rowsFor({ style: "plain", palette: "none", theme })).toEqual(["\x1b[31mH\x1b[0m  R"]);
	});

	it("renders powerline with palette none in the plain shape", () => {
		expect(rowsFor({ style: "powerline", palette: "none", theme })).toEqual(["\x1b[31mH\x1b[0m  R"]);
	});

	it("colors plain text from the OMP theme by default", () => {
		expect(rowsFor({ theme })).toEqual([`${fg(255, 0, 0)}H${RESET}  ${fg(0, 255, 0)}R${RESET}`]);
	});

	it("renders uncolored plain by default when the theme lacks true colors", () => {
		expect(
			rowsFor({ theme: { getColorHex: () => "ansi-256", getBgHex: () => "ansi-256" } }),
		).toEqual(["\x1b[31mH\x1b[0m  R"]);
	});

	it("normalizes an unknown palette to theme and keeps known palettes", () => {
		expect(normalizeSharedDisplayConfig({ palette: "neon" }).palette).toBe("theme");
		expect(normalizeSharedDisplayConfig({}).palette).toBe("theme");
		for (const palette of ["none", "theme", "gruvbox", "catppuccin", "pastel", "tokyo-night"] as const) {
			expect(normalizeSharedDisplayConfig({ palette }).palette).toBe(palette);
		}
	});

	it("rejects an unknown palette when validating", () => {
		expect(validateSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, palette: "neon" })).toEqual(["palette is invalid"]);
		expect(validateSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, palette: "gruvbox" })).toEqual([]);
	});

	it("renders bracketed gruvbox cells through the host with brackets outside the color codes", () => {
		expect(rowsFor({ style: "bracketed", palette: "gruvbox" })).toEqual([
			`[${fg(214, 93, 14)}H${RESET}][${fg(215, 153, 33)}R${RESET}]`,
		]);
	});

	it("renders rounded tokyo-night segments through the host without powerline glyphs", () => {
		const [row] = rowsFor({ style: "rounded", palette: "tokyo-night" });
		expect(row!.startsWith(`${fg(163, 174, 210)}░▒▓`)).toBe(true);
		expect(row!.endsWith(`${RESET}${fg(118, 159, 240)}\ue0b4${RESET}`)).toBe(true);
		expect(row!.split("\ue0b4")).toHaveLength(3);
		expect(row).toContain(fg(9, 12, 12));
		expect(row).toContain(fg(227, 229, 229));
		expect(row!.indexOf(fg(9, 12, 12))).toBeLessThan(row!.indexOf(fg(227, 229, 229)));
		expect(row).not.toContain("\ue0b0");
		expect(row).not.toContain("\ue0b6");
	});
});

describe("Shared Display bracketed and rounded styles", () => {
	const RESET = "\x1b[0m";
	const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
	const bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
	const palette: ResolvedPalette = {
		segments: [{ bg: "#112233", fg: "#aabbcc" }, { bg: "#445566" }],
		text: ["#d65d0e", "#d79921"],
	};
	const two = new Map<"headroom" | "rtk", FrameSequence>([
		["headroom", { frames: [["\x1b[31mA\x1b[0m"]] }],
		["rtk", { frames: [["B"]] }],
	]);
	const compose = (
		snapshots: ReadonlyMap<"headroom" | "rtk", FrameSequence>,
		options: Partial<Parameters<typeof composeDisplayRows>[1]>,
	) =>
		composeDisplayRows(snapshots, { layout: "horizontal", order: ["headroom", "rtk"], width: 80, ...options }).map(row =>
			row.replace(/^ +/u, ""),
		);

	it("renders bracketed cells adjacent with producer colors kept and the separator ignored without a palette", () => {
		expect(compose(two, { style: "bracketed", horizontalSeparator: " | " })).toEqual(["[\x1b[31mA\x1b[0m][B]"]);
	});

	it("colors only the bracketed inner text and strips producer colors", () => {
		expect(compose(two, { style: "bracketed", palette })).toEqual([
			`[${fg(214, 93, 14)}A${RESET}][${fg(215, 153, 33)}B${RESET}]`,
		]);
	});

	it("renders one unpadded bracketed row per block row in vertical layout, colored by block index", () => {
		const snapshots = new Map<"headroom" | "rtk", FrameSequence>([
			["headroom", { frames: [["A1", "A22"]] }],
			["rtk", { frames: [["B"]] }],
		]);
		expect(compose(snapshots, { style: "bracketed", layout: "vertical", palette })).toEqual([
			`[${fg(214, 93, 14)}A1${RESET}]`,
			`[${fg(214, 93, 14)}A22${RESET}]`,
			`[${fg(215, 153, 33)}B${RESET}]`,
		]);
	});

	it("renders rounded segments with the gradient start, rounded joint and end cap, ignoring the separator", () => {
		expect(compose(two, { style: "rounded", palette, horizontalSeparator: " | " })).toEqual([
			`${fg(17, 34, 51)}░▒▓` +
				`${bg(17, 34, 51)}${fg(170, 187, 204)} A ` +
				`${bg(68, 85, 102)}${fg(17, 34, 51)}\ue0b4` +
				`${bg(68, 85, 102)}\x1b[39m B ` +
				`${RESET}${fg(68, 85, 102)}\ue0b4${RESET}`,
		]);
	});

	it("renders rounded with no palette as the plain separator-joined row", () => {
		expect(compose(two, { style: "rounded", horizontalSeparator: " | " })).toEqual(["\x1b[31mA\x1b[0m | B"]);
	});

	it("renders one padded rounded row per block row in vertical layout, cycling colors per block", () => {
		const snapshots = new Map<"headroom" | "rtk", FrameSequence>([
			["headroom", { frames: [["A", "AA"]] }],
			["rtk", { frames: [["B"]] }],
		]);
		expect(compose(snapshots, { style: "rounded", layout: "vertical", palette })).toEqual([
			`${fg(17, 34, 51)}░▒▓${bg(17, 34, 51)}${fg(170, 187, 204)} A  ${RESET}${fg(17, 34, 51)}\ue0b4${RESET}`,
			`${fg(17, 34, 51)}░▒▓${bg(17, 34, 51)}${fg(170, 187, 204)} AA ${RESET}${fg(17, 34, 51)}\ue0b4${RESET}`,
			`${fg(68, 85, 102)}░▒▓${bg(68, 85, 102)}\x1b[39m B ${RESET}${fg(68, 85, 102)}\ue0b4${RESET}`,
		]);
	});

	it("keeps bracketed and rounded when normalizing and sends unknown styles to plain", () => {
		for (const style of ["plain", "bracketed", "powerline", "rounded"] as const) {
			expect(normalizeSharedDisplayConfig({ style }).style).toBe(style);
			expect(validateSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, style })).toEqual([]);
		}
		expect(normalizeSharedDisplayConfig({ style: "fancy" }).style).toBe("plain");
		expect(validateSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, style: "fancy" })).toEqual(["style is invalid"]);
	});
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

	it("keeps Beads and CodeGraph independent with a persisted legacy order", () => {
		const host = makeHostHarness(true, true, ["headroom", "caveman"]);
		try {
			host.load();
			host.start();
			connectSharedDisplay(host.events, "headroom").publish({ frames: [["H"]] });
			connectSharedDisplay(host.events, "caveman").publish({ frames: [["C"]] });
			const codegraph = connectSharedDisplay(host.events, "codegraph");
			const beads = connectSharedDisplay(host.events, "beads");
			codegraph.publish({ frames: [["CodeGraph ready"]] });
			beads.publish({ frames: [["Beads ready"]] });
			expect(host.rows()).toEqual(["H  C  CodeGraph ready  Beads ready"]);
			beads.publish(null);
			expect(host.rows()).toEqual(["H  C  CodeGraph ready"]);
			beads.publish({ frames: [["Beads suppressed"]] });
			codegraph.dispose();
			expect(host.rows()).toEqual(["H  C  Beads suppressed"]);
			beads.dispose();
			expect(host.rows()).toEqual(["H  C"]);
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

describe("Shared Display pstack producer", () => {
	it("renders pstack last by default and drops its segment on a tombstone", () => {
		const host = makeHostHarness();
		try {
			host.load();
			host.start();
			const ponytail = connectSharedDisplay(host.events, "ponytail");
			const pstack = connectSharedDisplay(host.events, "pstack");
			pstack.publish({ frames: [["pstack"]] });
			ponytail.publish({ frames: [["P"]] });
			expect(host.rows()).toEqual(["P  pstack"]);
			pstack.publish(null);
			expect(host.rows()).toEqual(["P"]);
			pstack.dispose();
			ponytail.dispose();
		} finally {
			host.close();
		}
	});
});

describe("Shared Display Ponytail producer", () => {
	it("renders Ponytail only from a producer snapshot, ignoring native status, commands and session entries", () => {
		const host = makeHostHarness();
		try {
			host.load();
			host.start();
			host.context.ui.setStatus("ponytail", "● ponytail: ULTRA");
			expect(host.rows()).toEqual([]);
			const producer = connectSharedDisplay(host.events, "ponytail");
			producer.publish({ frames: [["P ponytail"]] });
			expect(host.rows()).toEqual(["P ponytail"]);
			producer.publish(null);
			expect(host.rows()).toEqual([]);
			producer.dispose();
		} finally {
			host.close();
		}
	});
});

describe("Shared Display configuration", () => {
	it("appends every missing known source to a saved order and drops unknown or duplicate entries", () => {
		expect(normalizeSharedDisplayConfig({ order: ["caveman", "bogus", "ponytail", "caveman"] }).order).toEqual([
			"caveman",
			"ponytail",
			"headroom",
			"rtk",
			"codegraph",
			"beads",
			"pstack",
			"process-monitor",
		]);
		expect(normalizeSharedDisplayConfig({ order: ["headroom", "codegraph", "beads"] }).order).toEqual([
			"headroom",
			"codegraph",
			"beads",
			"ponytail",
			"caveman",
			"rtk",
			"pstack",
			"process-monitor",
		]);
	});

	it("renders RTK snapshots at its configured position", () => {
		const snapshots = new Map<"rtk" | "headroom", FrameSequence>([
			["rtk", { frames: [["R"]] }],
			["headroom", { frames: [["H"]] }],
		]);
		expect(composeDisplayRows(snapshots, { layout: "horizontal", order: DEFAULT_SHARED_DISPLAY_CONFIG.order, width: 10 }).map(row => row.trim())).toEqual(["H  R"]);
	});

	it("keeps explicit non-root paths as standalone config files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-shared-display-"));
		try {
			const configPath = path.join(root, "config.json");
			const config: SharedDisplayConfig = {
				...DEFAULT_SHARED_DISPLAY_CONFIG,
				order: ["headroom"],
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
			JSON.stringify({ layout: "vertical", order: ["headroom"] }),
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
