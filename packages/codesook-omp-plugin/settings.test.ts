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
				select("Global policy");
				component.handleInput?.("\r");
				if (mode !== "apply") {
					select("Project policy");
					component.handleInput?.("\r");
					component.handleInput?.("\r");
				}
				component.handleInput?.("\x1b[B");
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
				if (mode === "reload") {
					select("Reload from disk");
					component.handleInput?.("\r");
				}
				component.handleInput?.(mode === "cancel" ? "\x1b" : "\x1b[13;2u");
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
				select("Global policy", 2);
				component.handleInput?.("\r");
				select("Apply");
				component.handleInput?.("\r");
				unchanged();
				const confirmation = component.render(140).join("\n");
				expect(confirmation).toContain("Enter");
				expect(confirmation).toContain("Esc");
				component.handleInput?.("\x1b");
				unchanged();
				expect(component.render(140).join("\n")).toContain("> Apply");
				component.handleInput?.("\r");
				component.handleInput?.("\x1b[B");
				expect(component.render(140).join("\n")).toBe(confirmation);
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
	expect(events).toHaveLength(1);
	expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
});
