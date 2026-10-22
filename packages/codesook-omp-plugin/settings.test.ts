import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { draftFromRootConfig, loadSettingsDraft, openSettings, parsePluginList, persistDraftToRoot, persistSettingsDraft } from "./index";
import type { Component } from "@oh-my-pi/pi-tui";
import { projectIntegrationConfigPath } from "@codesook/omp-shared-display/project-integrations";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temporary(): string { const directory = mkdtempSync(path.join(os.tmpdir(), "root-settings-")); directories.push(directory); return directory; }

test("staged root settings persist CodeGraph policy and visibility without losing unknown fields", () => {
	const file = path.join(temporary(), "global.json");
	const root = { version: 1, display: { codegraph: { visibility: "never", custom: 42 } }, behavior: { codegraph: { policy: "off", custom: true }, beads: { policy: "off" } } };
	writeFileSync(file, JSON.stringify(root));
	const draft = draftFromRootConfig(root);
	draft.behavior.codegraph.policy = "auto";
	draft.display.codegraph.visibility = "always";
	persistDraftToRoot(draft, file);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(saved.behavior.codegraph).toEqual({ policy: "auto", custom: true });
	expect(saved.display.codegraph).toEqual({ visibility: "always", custom: 42 });
	expect(saved.behavior.beads).toEqual({ policy: "off" });
});

test("Apply keeps a hand-written display.beads.template while changing Beads visibility", () => {
	const file = path.join(temporary(), "global.json");
	const root = { version: 1, display: { beads: { visibility: "ready", template: "{ready}/{open}" } }, behavior: {} };
	writeFileSync(file, JSON.stringify(root));
	const draft = draftFromRootConfig(root);
	draft.display.beads.visibility = "always";
	persistDraftToRoot(draft, file);
	expect(JSON.parse(readFileSync(file, "utf8")).display.beads).toEqual({ visibility: "always", template: "{ready}/{open}" });
});

test("Instruction Mode settings persist Mode Levels and fail closed on removed Caveman defaultLevel", () => {
	const file = path.join(temporary(), "global.json");
	const root = { version: 1, display: { ponytail: { template: "{mode}", custom: 1 } }, behavior: { caveman: { defaultLevel: "full" }, ponytail: { defaultMode: "ultra" } } };
	writeFileSync(file, JSON.stringify(root));
	const draft = draftFromRootConfig(root);
	expect(draft.behavior.caveman.defaultMode).toBe("off");
	expect(draft.behavior.ponytail.defaultMode).toBe("ultra");
	draft.behavior.caveman.defaultMode = "megacave";
	draft.display.ponytail.nativeVisible = true;
	persistDraftToRoot(draft, file);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(saved.behavior.caveman.defaultMode).toBe("megacave");
	expect(saved.behavior.ponytail).toEqual({ defaultMode: "ultra" });
	expect(saved.display.ponytail).toMatchObject({ template: "{mode}", nativeVisible: true, visible: true, custom: 1 });
	expect(draftFromRootConfig({ version: 1, display: {}, behavior: {} }).behavior).toMatchObject({ caveman: { defaultMode: "caveman" }, ponytail: { defaultMode: "full" } });
});

test("invalid policy and documents block Apply without rewriting originals", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	for (const policy of ["bad", null, 1, false]) {
		const root = { version: 1, display: {}, behavior: { codegraph: { policy } } };
		const original = JSON.stringify(root);
		writeFileSync(global, original);
		const draft = draftFromRootConfig(root);
		expect(draft.behavior.codegraph.policy).toBeUndefined();
		draft.behavior.headroom.enabled = false;
		expect(() => persistDraftToRoot(draft, global)).toThrow();
		expect(readFileSync(global, "utf8")).toBe(original);
	}
	writeFileSync(global, JSON.stringify({ version: 1, display: {}, behavior: {} }));
	const file = projectIntegrationConfigPath(project);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, "{broken project");
	const globalOriginal = readFileSync(global, "utf8");
	const loaded = loadSettingsDraft(project, global);
	loaded.draft.behavior.codegraph.policy = "off";
	expect(loaded.errors.join("\n")).toContain(file);
	expect(() => persistSettingsDraft(loaded.draft, global)).toThrow();
	expect(readFileSync(global, "utf8")).toBe(globalOriginal);
	expect(readFileSync(file, "utf8")).toBe("{broken project");
});

test("project draft Apply writes only edited integration fields; Reload discards edits", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	const file = projectIntegrationConfigPath(project);
	writeFileSync(global, JSON.stringify({ version: 1, display: {}, behavior: {} }));
	let loaded = loadSettingsDraft(project, global);
	loaded.draft.behavior.headroom.enabled = false;
	persistSettingsDraft(loaded.draft, global);
	expect(existsSync(file)).toBe(false);
	loaded = loadSettingsDraft(project, global);
	loaded.draft.projectIntegration!.codegraph.policy = "off";
	loaded.draft.projectIntegration!.codegraph.visibility = "always";
	const reloaded = loadSettingsDraft(project, global);
	expect(reloaded.draft.projectIntegration!.codegraph.policy).toBe("inherit");
	expect(reloaded.draft.projectIntegration!.codegraph.visibility).toBe("inherit");
	expect(existsSync(file)).toBe(false);
	persistSettingsDraft(loaded.draft, global);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, display: { codegraph: { visibility: "always" } }, behavior: { codegraph: { policy: "off" } } });
	loaded = loadSettingsDraft(project, global);
	loaded.draft.projectIntegration!.codegraph.policy = "inherit";
	persistSettingsDraft(loaded.draft, global);
	expect(JSON.parse(readFileSync(file, "utf8")).behavior.codegraph).toEqual({});
});

test("dialog Cancel preserves disk/events; immediate Apply works; Reload discards both scope edits", async () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	const original = JSON.stringify({ version: 1, display: {}, behavior: {} });
	writeFileSync(global, original);
	const events: unknown[] = [];
	const pi = {
		exec: async () => ({ code: 0, stdout: '{"npm":[]}', stderr: "" }),
		events: { emit: (_channel: string, value: unknown) => events.push(value) },
	} as unknown as Parameters<typeof openSettings>[0];
	let mode: "cancel" | "apply" | "reload" = "cancel";
	const ctx = {
		cwd: project,
		hasUI: true,
		ui: {
			custom: async (builder: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => Component) => {
				let closed = false;
				const component = builder({ requestRender() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, {}, () => { closed = true; });
				const select = (label: string): void => {
					for (let index = 0; index < 150; index++) {
						if (component.render(140).join("\n").includes(`> ${label}`)) return;
						component.handleInput?.("\x1b[B");
					}
					throw new Error(`Setting not reachable: ${label}`);
				};
				const open = (label: string): void => {
					select(label);
					component.handleInput?.("\r");
				};
				const back = (): void => component.handleInput?.("\x1b");
				open("CodeGraph Integration");
				select("Global policy");
				component.handleInput?.("\r");
				if (mode !== "apply") {
					select("Project policy");
					component.handleInput?.("\r");
					component.handleInput?.("\r");
				}
				back();
				open("Beads Integration");
				select("Global policy");
				component.handleInput?.("\r");
				select("Global visibility");
				component.handleInput?.("\r");
				select("Project policy");
				component.handleInput?.("\r");
				component.handleInput?.("\r");
				select("Project visibility");
				component.handleInput?.("\r");
				component.handleInput?.("\r");
				back();
				if (mode === "reload") {
					select("Reload from disk");
					component.handleInput?.("\r");
				}
				component.handleInput?.(mode === "cancel" ? "\x1b" : "\x1b[13;2u");
				if (mode === "cancel") {
					expect(closed).toBe(false);
					component.handleInput?.("\x1b");
					expect(closed).toBe(false);
					component.handleInput?.("\x1b");
					component.handleInput?.("\r");
				}
				expect(closed).toBe(true);
			},
		},
	} as unknown as Parameters<typeof openSettings>[1];
	await openSettings(pi, ctx, global);
	expect(readFileSync(global, "utf8")).toBe(original);
	expect(events).toEqual([]);
	mode = "apply";
	await openSettings(pi, ctx, global);
	expect(JSON.parse(readFileSync(global, "utf8")).behavior.codegraph.policy).toBe("off");
	expect(JSON.parse(readFileSync(global, "utf8")).behavior.beads.policy).toBe("off");
	expect(JSON.parse(readFileSync(global, "utf8")).display.beads.visibility).toBe("always");
	const savedProject = readFileSync(projectIntegrationConfigPath(project), "utf8");
	expect(JSON.parse(savedProject)).toEqual({ version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" } } });
	const savedGlobal = readFileSync(global, "utf8");
	mode = "reload";
	await openSettings(pi, ctx, global);
	expect(readFileSync(global, "utf8")).toBe(savedGlobal);
	expect(readFileSync(projectIntegrationConfigPath(project), "utf8")).toBe(savedProject);
});

test("failed project persistence keeps the saved global edit and leaves project settings absent", () => {
	const project = temporary();
	const global = path.join(project, ".omp");
	const loaded = loadSettingsDraft(project, global);
	loaded.draft.behavior.codegraph.policy = "off";
	loaded.draft.projectIntegration!.codegraph.policy = "off";
	expect(() => persistSettingsDraft(loaded.draft, global)).toThrow();
	expect(JSON.parse(readFileSync(global, "utf8")).behavior.codegraph.policy).toBe("off");
	expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
});

test("Beads global and project edits preserve CodeGraph and unrelated fields; inherit removes only Beads overrides", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	const file = projectIntegrationConfigPath(project);
	const codegraph = { visibility: "never", custom: 42 };
	const codegraphBehavior = { policy: "off", custom: true };
	writeFileSync(global, JSON.stringify({ version: 1, custom: "root", display: { codegraph, beads: { visibility: "ready", custom: "display" } }, behavior: { codegraph: codegraphBehavior, beads: { policy: "auto", custom: "behavior" } } }));
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ version: 1, custom: "project", display: { codegraph, beads: { visibility: "never", custom: "project display" } }, behavior: { codegraph: codegraphBehavior, beads: { policy: "auto", custom: "project behavior" } } }));
	let loaded = loadSettingsDraft(project, global);
	loaded.draft.behavior.beads.policy = "off";
	loaded.draft.display.beads.visibility = "always";
	loaded.draft.projectIntegration!.beads.policy = "off";
	loaded.draft.projectIntegration!.beads.visibility = "always";
	persistSettingsDraft(loaded.draft, global);
	for (const [savedPath, custom] of [[global, "root"], [file, "project"]] as const) {
		const saved = JSON.parse(readFileSync(savedPath, "utf8"));
		expect(saved.custom).toBe(custom);
		expect(saved.display.codegraph).toEqual(codegraph);
		expect(saved.behavior.codegraph).toEqual(codegraphBehavior);
		expect(saved.display.beads.visibility).toBe("always");
		expect(saved.behavior.beads.policy).toBe("off");
	}
	loaded = loadSettingsDraft(project, global);
	loaded.draft.projectIntegration!.beads.policy = "inherit";
	loaded.draft.projectIntegration!.beads.visibility = "inherit";
	persistSettingsDraft(loaded.draft, global);
	const savedProject = JSON.parse(readFileSync(file, "utf8"));
	expect(savedProject.display.beads).toEqual({ custom: "project display" });
	expect(savedProject.behavior.beads).toEqual({ custom: "project behavior" });
	const reloaded = loadSettingsDraft(project, global);
	expect(reloaded.draft.projectIntegration!.beads.policy).toBe("inherit");
	expect(reloaded.draft.projectIntegration!.beads.visibility).toBe("inherit");
});

test("invalid Beads configuration in either scope blocks all writes even when draft values are repaired", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	const file = projectIntegrationConfigPath(project);
	mkdirSync(path.dirname(file), { recursive: true });
	const valid = JSON.stringify({ version: 1, display: {}, behavior: {} });
	for (const invalidPath of [global, file]) {
		for (const invalid of [
			{ version: 1, display: {}, behavior: { beads: { policy: "invalid" } } },
			{ version: 1, display: { beads: { visibility: null } }, behavior: {} },
			{ version: 1, display: {}, behavior: { beads: false } },
		]) {
			writeFileSync(global, valid);
			writeFileSync(file, valid);
			const original = JSON.stringify(invalid);
			writeFileSync(invalidPath, original);
			const loaded = loadSettingsDraft(project, global);
			expect(loaded.errors.join("\n")).toContain(invalidPath);
			loaded.draft.behavior.beads.policy = "off";
			loaded.draft.display.beads.visibility = "always";
			loaded.draft.behavior.codegraph.policy = "off";
			loaded.draft.projectIntegration!.codegraph.policy = "off";
			loaded.draft.projectIntegration!.beads.policy = "off";
			expect(() => persistSettingsDraft(loaded.draft, global)).toThrow();
			expect(readFileSync(invalidPath, "utf8")).toBe(original);
			expect(readFileSync(invalidPath === global ? file : global, "utf8")).toBe(valid);
			if (invalidPath === global) {
				expect(() => persistDraftToRoot(loaded.draft, global)).toThrow();
				expect(readFileSync(global, "utf8")).toBe(original);
			}
		}
	}
});

test("Beads and CodeGraph project changes Apply together without overwriting either prepared edit", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	const loaded = loadSettingsDraft(project, global);
	loaded.draft.projectIntegration!.codegraph.policy = "off";
	loaded.draft.projectIntegration!.codegraph.visibility = "never";
	loaded.draft.projectIntegration!.beads.policy = "auto";
	loaded.draft.projectIntegration!.beads.visibility = "always";
	persistSettingsDraft(loaded.draft, global);
	expect(JSON.parse(readFileSync(projectIntegrationConfigPath(project), "utf8"))).toEqual({
		version: 1,
		display: { codegraph: { visibility: "never" }, beads: { visibility: "always" } },
		behavior: { codegraph: { policy: "off" }, beads: { policy: "auto" } },
	});
});

test("Beads presence follows optional standalone and umbrella lifecycle state independently of CodeGraph", () => {
	const enabled = parsePluginList({ npm: [{ name: "@codesook/omp-beads", enabled: true }, { name: "@codesook/omp-codegraph", enabled: false }] });
	expect(enabled.projectFeatures.beads).toBe(true);
	expect(enabled.projectFeatures.codegraph).toBe(false);
	const disabled = parsePluginList({ npm: [{ name: "@codesook/omp-beads", enabled: false }, { name: "@codesook/omp-codegraph", enabled: true }] });
	expect(disabled.projectFeatures.beads).toBe(false);
	expect(disabled.projectFeatures.codegraph).toBe(true);
	expect(parsePluginList({ npm: [{ name: "omp-plugins", enabledFeatures: ["beads"] }] }).projectFeatures.beads).toBe(true);
	expect(parsePluginList({ npm: [{ name: "omp-plugins" }] }).projectFeatures.beads).toBe(false);
});

test("Apply requires a visible confirmation in the settings overlay; Esc retains edits and only explicit Enter saves", async () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	const original = JSON.stringify({ version: 1, custom: "retain", display: { codegraph: { visibility: "never" } }, behavior: { codegraph: { policy: "off" }, beads: { policy: "auto", custom: 42 } } });
	writeFileSync(global, original);
	const events: unknown[] = [];
	const pi = {
		exec: async () => ({ code: 0, stdout: '{"npm":[]}', stderr: "" }),
		events: { emit: (_channel: string, value: unknown) => events.push(value) },
	} as unknown as Parameters<typeof openSettings>[0];
	const ctx = {
		cwd: project,
		hasUI: true,
		ui: {
			custom: async (builder: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => Component) => {
				let closed = false;
				const component = builder({ requestRender() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, {}, () => { closed = true; });
				const select = (label: string, occurrence = 1): void => {
					let found = 0;
					for (let index = 0; index < 150; index++) {
						if (component.render(140).join("\n").includes(`> ${label}`) && ++found === occurrence) return;
						component.handleInput?.("\x1b[B");
					}
					throw new Error(`Setting not reachable: ${label}`);
				};
				const unchanged = (): void => {
					expect(closed).toBe(false);
					expect(readFileSync(global, "utf8")).toBe(original);
					expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
					expect(events).toEqual([]);
				};
				select("Beads Integration");
				component.handleInput?.("\r");
				select("Global policy");
				component.handleInput?.("\r");
				component.handleInput?.("\x1b");
				select("Apply");
				component.handleInput?.("\r");
				unchanged();
				component.handleInput?.("\x1b");
				unchanged();
				component.handleInput?.("\r");
				component.handleInput?.("\x1b[B");
				unchanged();
				component.handleInput?.("\r");
				expect(closed).toBe(true);
			},
		},
	} as unknown as Parameters<typeof openSettings>[1];
	await openSettings(pi, ctx, global);
	const saved = JSON.parse(readFileSync(global, "utf8"));
	expect(saved.custom).toBe("retain");
	expect(saved.behavior.beads).toEqual({ policy: "off", custom: 42 });
	expect(saved.behavior.codegraph).toEqual({ policy: "off" });
	expect(saved.display.codegraph).toEqual({ visibility: "never" });
	expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
});

test("RTK settings default, persist, and block an invalid retention", () => {
	const file = path.join(temporary(), "global.json");
	const root = { version: 1, display: { rtk: { template: "{percent}%", custom: 1 } }, behavior: { rtk: { enabled: false } } };
	writeFileSync(file, JSON.stringify(root));
	const draft = draftFromRootConfig(root);
	expect(draft.behavior.rtk).toEqual({ enabled: false, retentionDays: 7 });
	expect(draft.display.rtk).toMatchObject({ visible: true, template: "{percent}%" });
	draft.behavior.rtk.retentionDays = 3;
	persistDraftToRoot(draft, file);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(saved.behavior.rtk).toEqual({ enabled: false, retentionDays: 3 });
	expect(saved.display.rtk).toMatchObject({ visible: true, template: "{percent}%", custom: 1 });
	expect(saved.display.rtk.glyphDirectory).toBe("~/.config/codesook-omp/rtk");

	draft.behavior.rtk.retentionDays = 0;
	expect(() => persistDraftToRoot(draft, file)).toThrow("RTK retention days");
});

test("pstack settings default, persist beside unknown keys, and block invalid values", () => {
	const file = path.join(temporary(), "global.json");
	const root = { version: 1, display: {}, behavior: { pstack: { suspendCaveman: false, maxPanelSize: 9, custom: 1 }, ponytail: { defaultMode: "lite" } } };
	writeFileSync(file, JSON.stringify(root));
	expect(draftFromRootConfig({ version: 1, display: {}, behavior: {} }).behavior.pstack).toEqual({ suspendCaveman: true, suspendPonytail: true, maxPanelSize: 5, guardStrictness: "block-and-warn", defaultThinking: "medium" });
	const draft = draftFromRootConfig(root);
	expect(draft.behavior.pstack).toEqual({ suspendCaveman: false, suspendPonytail: true, maxPanelSize: 5, guardStrictness: "block-and-warn", defaultThinking: "medium" });
	draft.behavior.pstack.maxPanelSize = 2;
	draft.behavior.pstack.guardStrictness = "warn-only";
	draft.behavior.pstack.defaultThinking = "high";
	persistDraftToRoot(draft, file);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(saved.behavior.pstack).toEqual({ suspendCaveman: false, suspendPonytail: true, maxPanelSize: 2, guardStrictness: "warn-only", defaultThinking: "high", custom: 1 });
	expect(saved.behavior.ponytail).toMatchObject({ defaultMode: "lite" });

	const before = readFileSync(file, "utf8");
	for (const size of [0, 6, 2.5, Number.NaN]) {
		draft.behavior.pstack.maxPanelSize = size;
		expect(() => persistDraftToRoot(draft, file)).toThrow("pstack maximum panel size");
	}
	draft.behavior.pstack.maxPanelSize = 3;
	draft.behavior.pstack.guardStrictness = "strict" as never;
	expect(() => persistDraftToRoot(draft, file)).toThrow("pstack guard strictness");
	draft.behavior.pstack.guardStrictness = "warn-only";
	for (const level of ["minimal", "max", "", "HIGH"]) {
		draft.behavior.pstack.defaultThinking = level as never;
		expect(() => persistDraftToRoot(draft, file)).toThrow("pstack default thinking");
	}
	expect(readFileSync(file, "utf8")).toBe(before);
	for (const level of ["low", "medium", "high", "xhigh"] as const) expect(draftFromRootConfig({ version: 1, display: {}, behavior: { pstack: { defaultThinking: level } } }).behavior.pstack.defaultThinking).toBe(level);
	expect(draftFromRootConfig({ version: 1, display: {}, behavior: { pstack: { defaultThinking: "max" } } }).behavior.pstack.defaultThinking).toBe("medium");
});

test("pstack presence is only the standalone package, enabled or not", () => {
	expect(parsePluginList({ npm: [{ name: "@codesook/omp-pstack", enabled: true }] }).projectFeatures.pstack).toBe(true);
	expect(parsePluginList({ npm: [{ name: "@codesook/omp-pstack", enabled: false }] }).projectFeatures.pstack).toBe(false);
	expect(parsePluginList({ npm: [{ name: "omp-plugins", enabledFeatures: ["pstack"] }] }).projectFeatures.pstack).toBe(false);
	expect(parsePluginList({ npm: [] }).projectFeatures.pstack).toBe(false);
});

async function openWithPstack(installed: boolean, drive: (page: { render(): string; press(key: string): void; goTo(label: string): void }) => void) {
	const project = temporary();
	const global = path.join(project, "global.json");
	writeFileSync(global, JSON.stringify({ version: 1, display: {}, behavior: { pstack: { custom: 1 } } }));
	const events: Array<{ config: { behavior: { pstack: Record<string, unknown> } } }> = [];
	const npm = installed ? [{ name: "@codesook/omp-pstack", enabled: true }] : [];
	const pi = {
		exec: async () => ({ code: 0, stdout: JSON.stringify({ npm }), stderr: "" }),
		events: { emit: (_channel: string, value: never) => events.push(value) },
	} as unknown as Parameters<typeof openSettings>[0];
	const ctx = {
		cwd: project,
		hasUI: true,
		ui: {
			custom: async (builder: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => Component) => {
				const component = builder({ requestRender() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, {}, () => {});
				const goTo = (label: string): void => {
					for (let index = 0; index < 150; index++) {
						if (component.render(140).join("\n").includes(`> ${label}`)) return;
						component.handleInput?.("\x1b[B");
					}
					throw new Error(`Setting not reachable: ${label}`);
				};
				drive({ render: () => component.render(140).join("\n"), press: key => component.handleInput?.(key), goTo });
			},
		},
	} as unknown as Parameters<typeof openSettings>[1];
	await openSettings(pi, ctx, global);
	return { global, events };
}

test("applying a pstack setting writes it and emits the config-changed event that running pstack reads live", async () => {
	const { global, events } = await openWithPstack(true, page => {
		page.goTo("pstack");
		page.press("\r");
		page.goTo("Suspend Caveman");
		page.press("\r");
		page.press("\x1b[13;2~");
	});
	const saved = JSON.parse(readFileSync(global, "utf8"));
	expect(saved.behavior.pstack).toMatchObject({ suspendCaveman: false, suspendPonytail: true, maxPanelSize: 5, guardStrictness: "block-and-warn", custom: 1 });
	expect(events).toHaveLength(1);
	expect(events[0]!.config.behavior.pstack).toEqual(saved.behavior.pstack);
});

test("the pstack page reports a missing plugin as not installed and points at /pstack setup", async () => {
	const pages: Record<string, string> = {};
	const lists: Record<string, string> = {};
	for (const installed of [false, true]) {
		await openWithPstack(installed, page => {
			page.goTo("pstack");
			lists[String(installed)] = page.render();
			page.press("\r");
			page.goTo("Model roles");
			pages[String(installed)] = page.render();
		});
	}
	expect(lists.false).toContain("not installed");
	expect(lists.true).not.toContain("not installed");
	expect(pages.false).toContain("not installed");
	expect(pages.true).not.toContain("not installed");
	for (const page of Object.values(pages)) expect(page).toContain("/pstack setup");
});
