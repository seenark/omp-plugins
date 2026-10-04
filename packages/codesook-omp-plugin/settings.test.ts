import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { draftFromRootConfig, loadSettingsDraft, openSettings, persistDraftToRoot, persistSettingsDraft } from "./index";
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
	loaded.draft.projectIntegration!.policy = "off";
	loaded.draft.projectIntegration!.visibility = "always";
	const reloaded = loadSettingsDraft(project, global);
	expect(reloaded.draft.projectIntegration!.policy).toBe("inherit");
	expect(reloaded.draft.projectIntegration!.visibility).toBe("inherit");
	expect(existsSync(file)).toBe(false);
	persistSettingsDraft(loaded.draft, global);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, display: { codegraph: { visibility: "always" } }, behavior: { codegraph: { policy: "off" } } });
	loaded = loadSettingsDraft(project, global);
	loaded.draft.projectIntegration!.policy = "inherit";
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
	expect(events).toEqual([{ config: JSON.parse(readFileSync(global, "utf8")) }]);
	expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
	mode = "reload";
	await openSettings(pi, ctx, global);
	expect(JSON.parse(readFileSync(global, "utf8")).behavior.codegraph.policy).toBe("off");
	expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
	expect(events).toHaveLength(2);
});

test("failed second persistence reports saved root and unsaved project explicitly", () => {
	const project = temporary();
	const global = path.join(project, ".omp");
	const loaded = loadSettingsDraft(project, global);
	loaded.draft.projectIntegration!.policy = "off";
	expect(() => persistSettingsDraft(loaded.draft, global)).toThrow("Root settings saved");
	expect(JSON.parse(readFileSync(global, "utf8")).behavior.codegraph.policy).toBe("auto");
	expect(existsSync(projectIntegrationConfigPath(project))).toBe(false);
});
