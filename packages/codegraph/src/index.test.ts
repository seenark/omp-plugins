import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import codegraphExtension from "./index";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("turn refresh preserves prior prompt entries and switches to suppressed project without stale guidance", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "omp-codegraph-test-"));
	directories.push(directory);
	const first = path.join(directory, "first");
	const second = path.join(directory, "second");
	mkdirSync(first);
	mkdirSync(path.join(second, ".omp"), { recursive: true });
	writeFileSync(path.join(second, ".omp", "codesook-omp.json"), JSON.stringify({ version: 1, display: {}, behavior: { codegraph: { policy: "off" } } }));
	type Handler = (event: { systemPrompt?: string[] }, context: ExtensionContext) => Promise<{ systemPrompt: string[] } | undefined | void> | void;
	const handlers = new Map<string, Handler>();
	const footer = new Map<string, string | undefined>();
	// The fixture supplies only extension capabilities exercised through these lifecycle hooks.
	const pi = {
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		registerCommand: () => {},
		events: { on: () => () => {}, emit: () => {} },
		exec: async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ initialized: true, projectPath: first, indexPath: path.join(first, ".codegraph") }) }),
		getAllTools: () => [{ name: "mcp__codegraph_explore", sourceInfo: { source: "mcp" } }],
		getActiveTools: () => ["mcp__codegraph_explore"],
	} as unknown as ExtensionAPI;
	// This public-hook fixture needs only cwd and the native status surface.
	const context = { cwd: first, hasUI: true, ui: { setStatus: (key: string, text?: string) => footer.set(key, text) } } as unknown as ExtensionContext;
	codegraphExtension(pi, { globalConfigPath: path.join(directory, "global.json") });
	await handlers.get("session_start")!({}, context);
	const previous = ["Repository instruction", "Other plugin instruction"];
	const ready = await handlers.get("before_agent_start")!({ systemPrompt: previous }, context);
	expect(ready?.systemPrompt.slice(0, 2)).toEqual(previous);
	expect(ready?.systemPrompt[2]).toContain(first);
	expect(footer.get("codegraph")).toBe("CodeGraph: ready");
	context.cwd = second;
	const suppressed = await handlers.get("before_agent_start")!({ systemPrompt: previous }, context);
	expect(suppressed).toBeUndefined();
	expect(footer.get("codegraph")).toBeUndefined();
	await handlers.get("session_shutdown")!({}, context);
});
