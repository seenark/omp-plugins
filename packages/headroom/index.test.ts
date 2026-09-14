import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

type ManagedTimer = {
	callback: (...args: unknown[]) => void;
	ms: number | undefined;
	cleared: boolean;
};

type WidgetComponent = {
	render(width: number): readonly string[];
	dispose?(): void;
	invalidate?(): void;
};

type MockContext = {
	hasUI: boolean;
	ui: {
		theme: { symbol(key: string): string };
		notify(...args: unknown[]): void;
		confirm(title: string, message: string): Promise<boolean>;
		setWidget(
			key: string,
			content: RegisteredWidget["content"] | undefined,
			options?: { placement?: string },
		): void;
		setStatus?(key: string, text: string | undefined): void;
	};
	sessionManager?: { getBranch(): unknown[] };
	getContextUsage(): undefined;
	model: undefined;
	setInterval(callback: (...args: unknown[]) => void, ms?: number): ManagedTimer;
	clearTimer(timer: ManagedTimer): void;
};

type ExtensionHandler = (event: unknown, context: MockContext) => unknown | Promise<unknown>;
type CommandCompletion = { value: string; label: string };
type CommandRegistration = {
	handler(args: string, context: MockContext): unknown | Promise<unknown>;
	getArgumentCompletions?(argumentPrefix: string): CommandCompletion[] | null;
};

interface RegisteredWidget {
	key: string;
	content: (tui: unknown, theme: unknown) => WidgetComponent;
	placement: string | undefined;
}


describe("OMP Headroom extension", () => {
	it("registers commands and independently renders merged and native Ponytail status", async () => {
		const previousEnabled = process.env.PI_HEADROOM_ENABLED;
		const displayRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-index-widget-"));
		const displayConfigPath = path.join(displayRoot, "display-config.json");
		fs.writeFileSync(displayConfigPath, JSON.stringify({ visible: true, glyphDirectory: displayRoot }));
		process.env.PI_HEADROOM_ENABLED = "0";
		try {
			// Dynamic import is intentional: the runtime reads configuration at module initialization.
			const { default: headroomExtension } = await import(`./index.ts?smoke=${Date.now()}`);
			const handlers = new Map<string, ExtensionHandler>();
			const commands = new Map<string, CommandRegistration>();
			let widget: RegisteredWidget | undefined;
			const cleared: string[] = [];
			const timers: ManagedTimer[] = [];
			const nativeStatusWrites: Array<{ key: string; text: string | undefined }> = [];
			const extensionApi = {
				on(event: string, handler: ExtensionHandler) {
					handlers.set(event, handler);
				},
				registerCommand(name: string, config: CommandRegistration) {
					commands.set(name, config);
				},
			};
			headroomExtension(extensionApi as unknown as ExtensionAPI, { displayConfigPath });

			expect([...commands.keys()]).toEqual(["headroom", "headroom-health", "ponytail-display", "ponytail-native"]);
			expect(handlers.has("context")).toBe(true);
			expect(handlers.has("session_start")).toBe(true);
			expect(handlers.has("session_shutdown")).toBe(true);

			const context: MockContext = {
				hasUI: true,
				ui: {
					theme: { symbol: (key: string) => (key === "status.disabled" ? "D" : "?") },
					notify() {},
					confirm: async () => false,
					setStatus(key, text) {
						nativeStatusWrites.push({ key, text });
					},
					setWidget(key, content, options) {
						if (content) widget = { key, content, placement: options?.placement };
						else cleared.push(key);
					},
				},
				sessionManager: { getBranch: () => [] },
				getContextUsage() {
					return undefined;
				},
				model: undefined,
				setInterval(callback, ms) {
					const timer = { callback, ms, cleared: false };
					timers.push(timer);
					return timer;
				},
				clearTimer(timer) {
					timer.cleared = true;
				},
			};
			await commands.get("headroom")?.handler("off", context);

			await handlers.get("session_start")?.({}, context);
			expect(widget?.key).toBe("headroom");
			expect(widget?.placement).toBe("belowEditor");
			const component = widget?.content({}, context.ui.theme);
			const rendered = component?.render(40)[0] ?? "";
			expect(rendered).toHaveLength(40);
			expect(rendered.endsWith("D Headroom off")).toBe(true);

			context.ui.setStatus?.("ponytail", "○ 🐴 ponytail: ⚡ FULL");
			const combined = widget?.content({}, context.ui.theme).render(80)[0] ?? "";
			expect(combined.endsWith("○ 🐴 ponytail: ⚡ FULL  D Headroom off")).toBe(true);
			expect(nativeStatusWrites).toEqual([{ key: "ponytail", text: undefined }]);

			const nativeCommand = commands.get("ponytail-native");
			expect(nativeCommand?.getArgumentCompletions?.("t")?.map((item) => item.value)).toEqual(["toggle"]);
			await nativeCommand?.handler("on", context);
			expect(nativeStatusWrites).toEqual([
				{ key: "ponytail", text: undefined },
				{ key: "ponytail", text: "○ 🐴 ponytail: ⚡ FULL" },
			]);

			await commands.get("ponytail-display")?.handler("off", context);
			const headroomOnly = widget?.content({}, context.ui.theme).render(80)[0] ?? "";
			expect(headroomOnly.endsWith("D Headroom off")).toBe(true);
			expect(headroomOnly).not.toContain("ponytail:");
			expect(JSON.parse(fs.readFileSync(displayConfigPath, "utf8"))).toMatchObject({
				segments: { ponytail: { visible: false, nativeVisible: true } },
			});
			context.ui.setStatus?.("ponytail", "● 🐴 ponytail: 🔥 ULTRA");
			expect(nativeStatusWrites.at(-1)).toEqual({ key: "ponytail", text: "● 🐴 ponytail: 🔥 ULTRA" });
			await nativeCommand?.handler("off", context);
			expect(nativeStatusWrites.at(-1)).toEqual({ key: "ponytail", text: undefined });
			context.ui.setStatus?.("ponytail", "○ 🐴 ponytail: ⚡ FULL");
			expect(nativeStatusWrites.at(-1)).toEqual({ key: "ponytail", text: undefined });

			await handlers.get("session_shutdown")?.({}, context);
			expect(cleared).toEqual(["headroom"]);
		} finally {
			fs.rmSync(displayRoot, { recursive: true, force: true });
			if (previousEnabled === undefined) delete process.env.PI_HEADROOM_ENABLED;
			else process.env.PI_HEADROOM_ENABLED = previousEnabled;
		}
	});
	it("persists independent display visibility without changing compression", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-index-display-"));
		const previousEnabled = process.env.PI_HEADROOM_ENABLED;
		process.env.PI_HEADROOM_ENABLED = "0";
		try {
			const displayConfigPath = path.join(root, "display-config.json");
			fs.writeFileSync(displayConfigPath, JSON.stringify({ visible: false, glyphDirectory: root }));
			const { default: headroomExtension } = await import(`./index.ts?display=${Date.now()}`);
			const handlers = new Map<string, ExtensionHandler>();
			const commands = new Map<string, CommandRegistration>();
			const notifications: Array<{ message: string; type: string | undefined }> = [];
			const cleared: string[] = [];
			let widget: RegisteredWidget | undefined;
			const extensionApi = {
				on(event: string, handler: ExtensionHandler) {
					handlers.set(event, handler);
				},
				registerCommand(name: string, config: CommandRegistration) {
					commands.set(name, config);
				},
			};
			headroomExtension(extensionApi as unknown as ExtensionAPI, { displayConfigPath });
			const command = commands.get("headroom");
			const context: MockContext = {
				hasUI: true,
				ui: {
					theme: { symbol: () => "D" },
					notify(message: string, type?: string) {
						notifications.push({ message, type });
					},
					confirm: async () => false,
					setWidget(key, content, options) {
						if (content) widget = { key, content, placement: options?.placement };
						else {
							widget = undefined;
							cleared.push(key);
						}
					},
					setStatus() {},
				},
				sessionManager: { getBranch: () => [] },
				getContextUsage() {
					return undefined;
				},
				model: undefined,
				setInterval(callback, ms) {
					return { callback, ms, cleared: false };
				},
				clearTimer(timer) {
					timer.cleared = true;
				},
			};

			await handlers.get("session_start")?.({}, context);
			expect(widget).toBeUndefined();
			expect(cleared).toEqual(["headroom"]);
			expect(command?.getArgumentCompletions?.("d")?.map((item) => item.value)).toEqual(["display"]);
			expect(command?.getArgumentCompletions?.("display ")?.map((item) => item.value)).toEqual([
				"on",
				"off",
				"toggle",
				"status",
			]);

			await command?.handler("display on", context);
			expect(widget?.key).toBe("headroom");
			expect(notifications[0]).toEqual({
				message: "Headroom display shown and saved.",
				type: "info",
			});

			await command?.handler("status", context);
			expect(notifications[1]?.message).toContain("Enabled: no");
			expect(notifications[1]?.message).toContain("Headroom display: shown");

			await command?.handler("display off", context);
			expect(widget).toBeUndefined();
			expect(notifications[2]).toEqual({
				message: "Headroom display hidden and saved.",
				type: "info",
			});

			await command?.handler("status", context);
			expect(notifications[3]?.message).toContain("Headroom display: hidden");
			expect(JSON.parse(fs.readFileSync(displayConfigPath, "utf8"))).toMatchObject({
				order: ["ponytail", "headroom"],
				segments: {
					headroom: { visible: false, glyphDirectory: root },
					ponytail: { visible: true },
				},
			});
		} finally {
			if (previousEnabled === undefined) delete process.env.PI_HEADROOM_ENABLED;
			else process.env.PI_HEADROOM_ENABLED = previousEnabled;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("animates opt-in glyph frames with a managed timer and disposes it", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-index-animation-"));
		const previousEnabled = process.env.PI_HEADROOM_ENABLED;
		process.env.PI_HEADROOM_ENABLED = "0";
		try {
			const displayConfigPath = path.join(root, "display-config.json");
			fs.writeFileSync(
				displayConfigPath,
				JSON.stringify({
					visible: true,
					glyphDirectory: root,
					ponytail: { glyphDirectory: root },
				}),
			);
			fs.writeFileSync(path.join(root, "off.txt"), "fps=16\nA\n\nB");
			fs.writeFileSync(path.join(root, "full.txt"), "fps=8\nC\n\nD");
			const { default: headroomExtension } = await import(`./index.ts?animation=${Date.now()}`);
			const handlers = new Map<string, ExtensionHandler>();
			const commands = new Map<string, CommandRegistration>();
			const cleared: string[] = [];
			const timers: ManagedTimer[] = [];
			const renderRequests: unknown[] = [];
			let widget: RegisteredWidget | undefined;
			let activeComponent: WidgetComponent | undefined;
			const extensionApi = {
				on(event: string, handler: ExtensionHandler) {
					handlers.set(event, handler);
				},
				registerCommand(name: string, config: CommandRegistration) {
					commands.set(name, config);
				},
			};
			headroomExtension(extensionApi as unknown as ExtensionAPI, { displayConfigPath });
			const context: MockContext = {
				hasUI: true,
				ui: {
					theme: { symbol: () => "D" },
					notify() {},
					confirm: async () => false,
					setStatus() {},
					setWidget(key, content, options) {
						activeComponent?.dispose?.();
						activeComponent = undefined;
						if (content) widget = { key, content, placement: options?.placement };
						else {
							widget = undefined;
							cleared.push(key);
						}
					},
				},
				sessionManager: { getBranch: () => [] },
				getContextUsage() {
					return undefined;
				},
				model: undefined,
				setInterval(callback, ms) {
					const timer = { callback, ms, cleared: false };
					timers.push(timer);
					return timer;
				},
				clearTimer(timer) {
					timer.cleared = true;
				},
			};

			await handlers.get("session_start")?.({}, context);
			context.ui.setStatus?.("ponytail", "○ 🐴 ponytail: ⚡ FULL");
			const component = widget?.content(
				{
					requestComponentRender(requestedComponent: unknown) {
						renderRequests.push(requestedComponent);
					},
				},
				context.ui.theme,
			);
			if (!component) throw new Error("Headroom widget component was not created");
			activeComponent = component;
			expect(component.render(80)[0]?.endsWith("○ C ponytail: ⚡ FULL  A Headroom off")).toBe(true);
			expect(timers).toHaveLength(2);
			expect(timers.map((timer) => timer.ms)).toEqual([63, 125]);

			timers[0]?.callback();
			timers[1]?.callback();
			expect(renderRequests).toEqual([component, component]);
			expect(component.render(80)[0]?.endsWith("○ D ponytail: ⚡ FULL  B Headroom off")).toBe(true);

			await commands.get("headroom")?.handler("off", context);
			expect(timers.every((timer) => timer.cleared)).toBe(true);
			timers[0]?.callback();
			timers[1]?.callback();
			expect(renderRequests).toHaveLength(2);

			await handlers.get("session_shutdown")?.({}, context);
			expect(cleared).toEqual(["headroom"]);
		} finally {
			if (previousEnabled === undefined) delete process.env.PI_HEADROOM_ENABLED;
			else process.env.PI_HEADROOM_ENABLED = previousEnabled;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	it("completes and runs init without overwriting declined files", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-index-init-"));
		const previousEnabled = process.env.PI_HEADROOM_ENABLED;
		process.env.PI_HEADROOM_ENABLED = "0";
		try {
			const initPaths = {
				config: path.join(root, "config", "settings.json"),
				display: path.join(root, "display", "display-config.json"),
				glyphs: path.join(root, "glyphs"),
			};
			const { default: headroomExtension } = await import(`./index.ts?init=${Date.now()}`);
			const commands = new Map<string, CommandRegistration>();
			const extensionApi = {
				on() {},
				registerCommand(name: string, config: CommandRegistration) {
					commands.set(name, config);
				},
			};
			headroomExtension(extensionApi as unknown as ExtensionAPI, { initPaths });
			const command = commands.get("headroom");
			expect(command).toBeDefined();

			const notifications: Array<{ message: string; type: string | undefined }> = [];
			const confirmations: Array<{ title: string; message: string }> = [];
			let overwrite = false;
			const context: MockContext = {
				hasUI: false,
				ui: {
					theme: { symbol: (key: string) => (key === "status.success" ? "S" : "") },
					notify(message: string, type?: string) {
						notifications.push({ message, type });
					},
					async confirm(title: string, message: string) {
						confirmations.push({ title, message });
						return overwrite;
					},
					setWidget() {},
				},
				getContextUsage() {
					return undefined;
				},
				model: undefined,
				setInterval(callback, ms) {
					return { callback, ms, cleared: false };
				},
				clearTimer(timer) {
					timer.cleared = true;
				},
			};

			expect(command?.getArgumentCompletions?.("in")?.map((item) => item.value)).toEqual(["init"]);
			expect(command?.getArgumentCompletions?.("init ")?.map((item) => item.value)).toEqual([
				"config",
				"display",
				"glyphs",
				"all",
			]);
			await command?.handler("init invalid", context);
			expect(notifications[0]).toEqual({
				message: "Usage: /headroom [on|off|status|display [on|off|toggle|status]|health|stats|init [config|display|glyphs|all]]",
				type: "warning",
			});

			await command?.handler("init", context);
			const files = [
				initPaths.config,
				initPaths.display,
				...["off", "remote-blocked", "starting", "offline", "idle", "online", "compressed"].map((state) =>
					path.join(initPaths.glyphs, `${state}.txt`),
				),
			];
			expect(files.every((file) => fs.existsSync(file))).toBe(true);
			const before = files.map((file) => fs.readFileSync(file, "utf8"));

			await command?.handler("init", context);
			expect(confirmations).toHaveLength(9);
			expect(confirmations[0]).toEqual({
				title: "Overwrite Headroom file?",
				message: `${files[0]} already exists. Overwrite it?`,
			});
			expect(files.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
			expect(notifications.some(({ message, type }) => type === "info" && message.includes("Created (9)"))).toBe(true);
			expect(notifications.some(({ message, type }) => type === "warning" && message.includes("Skipped (9)"))).toBe(true);
		} finally {
			if (previousEnabled === undefined) delete process.env.PI_HEADROOM_ENABLED;
			else process.env.PI_HEADROOM_ENABLED = previousEnabled;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
