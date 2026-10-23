import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { CHANNEL, type SharedDisplayEvents } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED } from "@codesook/omp-shared-display/config-store";
import rtkExtension from "./index.ts";

type Handler = (event: unknown, context: ExtensionContext) => unknown;
const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(rtkVersion: string | null = "rtk 0.51.0") {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-rtk-ext-"));
	directories.push(root);
	const sessionsRoot = path.join(root, "sessions");
	const handlers = new Map<string, Handler>();
	const listeners = new Set<(data: unknown) => void>();
	const events: SharedDisplayEvents = {
		on: (_channel, handler) => { listeners.add(handler); return () => { listeners.delete(handler); }; },
		emit: (_channel, data) => { for (const handler of [...listeners]) handler(data); },
	};
	const snapshots: (string | null)[] = [];
	events.on(CHANNEL, data => {
		const message = data as { kind?: string; source?: string; sequence?: { frames: string[][] } | null };
		if (message.kind === "snapshot" && message.source === "rtk") snapshots.push(message.sequence ? message.sequence.frames[0]![0]! : null);
	});
	const pi = {
		on: (name: string, handler: Handler) => { handlers.set(name, handler); },
		registerCommand: () => {},
		events,
		exec: async (_command: string, args: string[]) => {
			if (args[0] === "--version") {
				if (rtkVersion === null) throw new Error("ENOENT");
				return { code: 0, stdout: rtkVersion, stderr: "", killed: false };
			}
			const marker = /^(?:export OMP_PLUGINS_SESSION='[^']*'; )?/.exec(args[1]!)![0];
			return { code: 0, stdout: args[1]!.slice(marker.length).endsWith("git status") ? `${marker}rtk git status\n` : "", stderr: "", killed: false };
		},
	} as unknown as ExtensionAPI;
	const context = { hasUI: false, sessionManager: { getSessionId: () => "s1" }, ui: { notify: () => {} } } as unknown as ExtensionContext;
	rtkExtension(pi, { configPath: path.join(root, "config.json"), sessionsRoot });
	const fire = (name: string, event: unknown = {}) => handlers.get(name)!(event, context);
	const startSession = async () => {
		await fire("session_start");
		await fire("before_agent_start", { systemPrompt: [] }); // settles the rtk availability check
		events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "e", active: true });
		events.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "e" });
	};
	return { sessionsRoot, snapshots, events, fire, startSession };
}

test("rewrites bash commands with the session databases and publishes RTK Savings", async () => {
	const { sessionsRoot, snapshots, fire, startSession } = fixture();
	await startSession();
	expect(snapshots.at(-1)).toBe("✂ rtk 0 saved · 0 cmds");

	const call = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
	await fire("tool_call", call);
	const dir = path.join(sessionsRoot, "s1");
	expect(call.input.command).toBe(`export RTK_DB_PATH='${dir}/history.db'; export RTK_RECALL_DB='${dir}/recall.db'; rtk git status`);

	const db = new Database(path.join(dir, "history.db"));
	db.run("CREATE TABLE commands (id INTEGER PRIMARY KEY, input_tokens INTEGER, saved_tokens INTEGER)");
	db.run("INSERT INTO commands (input_tokens, saved_tokens) VALUES (1000, 800)");
	db.close();
	await fire("tool_execution_end", { toolCallId: "c1", toolName: "bash" });
	expect(snapshots.at(-1)).toBe("✂ rtk 800 saved · 1 cmds");

	await fire("tool_call", { type: "tool_call", toolName: "bash", toolCallId: "c2", input: { command: "git diff" } });
	await fire("tool_execution_end", { toolCallId: "c2", toolName: "bash" });
	expect(snapshots.at(-1)).toBe("✂ rtk 800 saved · 1 cmds");

	const prompt = (await fire("before_agent_start", { systemPrompt: ["base"] })) as { systemPrompt: string[] };
	expect(prompt.systemPrompt[0]).toBe("base");
	expect(prompt.systemPrompt).toHaveLength(2);
	expect(prompt.systemPrompt[1]).toContain("RTK_DISABLED=1");
});

test("commands that already run rtk keep their text and gain the session databases", async () => {
	const { fire, startSession } = fixture();
	await startSession();
	const call = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "rtk recall --list" } };
	await fire("tool_call", call);
	expect(call.input.command).toEndWith("; rtk recall --list");
	expect(call.input.command).toStartWith("export RTK_DB_PATH=");
});

test("a session marker in front of the command does not change which commands rtk rewrites", async () => {
	const { sessionsRoot, fire, startSession } = fixture();
	await startSession();
	const dir = path.join(sessionsRoot, "s1");
	const marker = "export OMP_PLUGINS_SESSION='s1'; ";
	const rewritten = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: `${marker}git status` } };
	await fire("tool_call", rewritten);
	expect(rewritten.input.command).toBe(`export RTK_DB_PATH='${dir}/history.db'; export RTK_RECALL_DB='${dir}/recall.db'; ${marker}rtk git status`);
	const disabled = { type: "tool_call", toolName: "bash", toolCallId: "c2", input: { command: `${marker}RTK_DISABLED=1 git status` } };
	await fire("tool_call", disabled);
	expect(disabled.input.command).toBe(`${marker}RTK_DISABLED=1 git status`);
});

test("missing rtk publishes the missing state and leaves commands and prompt alone", async () => {
	const { snapshots, fire, startSession } = fixture(null);
	await startSession();
	expect(snapshots.at(-1)).toBe("⚠ rtk missing");
	const call = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
	await fire("tool_call", call);
	expect(call.input.command).toBe("git status");
	expect(await fire("before_agent_start", { systemPrompt: ["base"] })).toBeUndefined();
});

test("old rtk versions count as missing", async () => {
	const { snapshots, startSession } = fixture("rtk 0.50.0");
	await startSession();
	expect(snapshots.at(-1)).toBe("⚠ rtk missing");
});

test("live config change turns RTK off and hides the segment", async () => {
	const { snapshots, events, fire, startSession } = fixture();
	await startSession();
	events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: { version: 1, display: {}, behavior: { rtk: { enabled: false } } } });
	expect(snapshots.at(-1)).toBe("○ rtk off");
	const call = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
	await fire("tool_call", call);
	expect(call.input.command).toBe("git status");
	expect(await fire("before_agent_start", { systemPrompt: [] })).toBeUndefined();

	events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: { version: 1, display: { rtk: { visible: false } }, behavior: {} } });
	expect(snapshots.at(-1)).toBeNull();
	await fire("session_shutdown");
});

test("session start prunes stale sessions but keeps the current one", async () => {
	const { sessionsRoot, fire } = fixture();
	const stale = path.join(sessionsRoot, "old");
	mkdirSync(stale, { recursive: true });
	const longAgo = new Date(Date.now() - 30 * 86_400_000);
	utimesSync(stale, longAgo, longAgo);
	await fire("session_start");
	expect(existsSync(stale)).toBe(false);
	expect(existsSync(path.join(sessionsRoot, "s1"))).toBe(true);
});
