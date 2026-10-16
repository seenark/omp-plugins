import { afterEach, describe, expect, it } from "bun:test";
import { CODESOOK_OMP_CONFIG_CHANGED } from "@codesook/omp-shared-display/config-store";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pstackExtension from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Strictness = "block-and-warn" | "warn-only" | "off";
type Warning = { additionalContext?: string; continue?: boolean } | undefined;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDirectory(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-warn-test-"));
	roots.push(root);
	return root;
}

/** A poteto-mode skill directory holding two playbooks: one with steps only, one that asks for the throughput checkpoint. */
function skillFixture(): string {
	const directory = path.join(tempDirectory(), "poteto-mode");
	fs.mkdirSync(path.join(directory, "playbooks"), { recursive: true });
	fs.writeFileSync(
		path.join(directory, "playbooks", "demo.md"),
		"### Demo\n\n1. Read the design notes carefully.\n2. Delegate implementation to a subagent.\n3. Verify on the matching surface.\n   - A sub-bullet is not a step.\n\n**Reply:** done.\n",
	);
	fs.writeFileSync(path.join(directory, "playbooks", "ckpt.md"), "### Ckpt\n\n1. Write the throughput checkpoint.\n2. Build it.\n");
	return directory;
}

/** `vendored` runs against the package's real poteto-mode skill instead of the fixture. */
function createHarness(options: { agentName?: string; vendored?: boolean } = {}) {
	const handlers = new Map<string, Handler>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const events = {
		on: (channel: string, handler: (data: unknown) => void) => {
			bus.set(channel, [...(bus.get(channel) ?? []), handler]);
			return () => void bus.set(channel, (bus.get(channel) ?? []).filter(other => other !== handler));
		},
		emit: (channel: string, data: unknown) => void (bus.get(channel) ?? []).forEach(handler => handler(data)),
	};
	const branch: unknown[] = [];
	const pi = {
		events,
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: () => undefined,
		appendEntry: (customType: string, data: unknown) => void branch.push({ type: "custom", customType, data }),
		sendMessage: () => undefined,
		logger: { info() {}, warn() {}, error() {} },
	};
	const ctx = {
		hasUI: true,
		agent: options.agentName === undefined ? { kind: "main", id: "main" } : { kind: "sub", id: "x", name: options.agentName },
		ui: { notify() {} },
		sessionManager: { getBranch: () => branch },
		models: { resolve: () => undefined },
	};
	pstackExtension(pi as never, { homeDirectory: tempDirectory(), ...(options.vendored ? {} : { skillDirectory: skillFixture() }) });
	const fire = (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx);
	return {
		branch,
		fire,
		activate: () => fire("input", { text: "/skill:poteto-mode try it", source: "interactive" }),
		openPlaybook: (name: string) =>
			fire("tool_result", { toolName: "read", input: { path: `skills/poteto-mode/playbooks/${name}.md` }, isError: false, details: undefined, content: [] }),
		setStrictness: (guardStrictness: Strictness) =>
			events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: { version: 1, display: {}, behavior: { pstack: { guardStrictness } } } }),
		result: (toolName: string, input: Record<string, unknown>, isError = false) =>
			fire("tool_result", { toolName, input, isError, details: undefined, content: [] }) as Promise<Warning>,
		stop: (messages: unknown[], extra: object = {}) => fire("session_stop", { messages, stop_hook_active: false, ...extra }) as Promise<Warning>,
	};
}

const edit = (path: string, body: string) => ({ path, new_string: body, old_string: "x" });

describe("narrating comment warning", () => {
	const narrating = "// loop over the items\nfor (const item of items) run(item);";
	const shapes: Record<string, [string, Record<string, unknown>]> = {
		"replace edit": ["edit", edit("src/a.ts", narrating)],
		write: ["write", { path: "src/a.ts", content: narrating }],
		"hashline edit": ["edit", { input: `[src/a.ts#A1B2]\nPUT 1:\n+${narrating.split("\n").join("\n+")}` }],
		"apply_patch edit": ["edit", { input: `*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+${narrating.split("\n").join("\n+")}\n*** End Patch` }],
		"patch edit": ["edit", { path: "src/a.ts", edits: [{ op: "update", diff: `@@\n-old\n+${narrating.split("\n").join("\n+")}` }] }],
	};

	for (const [name, [tool, input]] of Object.entries(shapes)) {
		it(`trips on ${name}`, async () => {
			const h = createHarness();
			await h.activate();
			expect((await h.result(tool, input))?.additionalContext).toBeTruthy();
		});
	}

	it("passes comments that say why, directive comments, and code without comments", async () => {
		const h = createHarness();
		await h.activate();
		const quiet = [
			"// shortcut: O(n^2) scan, upgrade past 1k rows\nscan();",
			"// Retry-After is seconds, not milliseconds (RFC 9110)\nwait(seconds * 1000);",
			"// @ts-expect-error upstream types lack this field\nuse(x);",
			"run(item);",
		];
		for (const body of quiet) expect(await h.result("edit", edit("src/a.ts", body))).toBeUndefined();
	});

	it("passes narration in files that are not code, and text the edit removes", async () => {
		const h = createHarness();
		await h.activate();
		expect(await h.result("write", { path: "README.md", content: "# Set up the project\n" })).toBeUndefined();
		expect(await h.result("edit", { path: "src/a.ts", old_string: "// loop over the items", new_string: "run();" })).toBeUndefined();
		expect(await h.result("edit", { input: "[src/a.ts#A1B2]\nPUT 1:\n-// loop over the items\n+run();" })).toBeUndefined();
	});

	it("passes a failed edit and tools that are not edits", async () => {
		const h = createHarness();
		await h.activate();
		expect(await h.result("edit", edit("src/a.ts", narrating), true)).toBeUndefined();
		expect(await h.result("bash", { command: "echo '// loop over the items' > a.ts" })).toBeUndefined();
	});

	it("stays silent while pstack is inactive, and speaks to a pstack lane without a run", async () => {
		const quiet = createHarness();
		expect(await quiet.result("edit", edit("src/a.ts", narrating))).toBeUndefined();
		const lane = createHarness({ agentName: "pstack-panel-a-builder" });
		expect((await lane.result("edit", edit("src/a.ts", narrating)))?.additionalContext).toBeTruthy();
		const other = createHarness({ agentName: "task" });
		expect(await other.result("edit", edit("src/a.ts", narrating))).toBeUndefined();
	});

	it("follows guard strictness: warn-only still speaks, off is silent", async () => {
		const h = createHarness();
		await h.activate();
		h.setStrictness("warn-only");
		expect((await h.result("edit", edit("src/a.ts", narrating)))?.additionalContext).toBeTruthy();
		h.setStrictness("off");
		expect(await h.result("edit", edit("src/a.ts", narrating))).toBeUndefined();
	});
});

describe("todo playbook-step check", () => {
	const init = (items: string[]) => ({ op: "init", list: [{ phase: "Run", items }] });

	it("names the step a todo init leaves out", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("demo");
		const warning = await h.result("todo", init(["Read the design notes", "Delegate implementation to subagent"]));
		expect(warning?.additionalContext).toContain("step 3");
		expect(warning?.additionalContext).not.toContain("step 1");
		expect(warning?.additionalContext).not.toContain("step 2");
	});

	it("names every missing step, for a flat init as well", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("demo");
		const warning = await h.result("todo", { op: "init", items: ["Unrelated chore"] });
		for (const step of ["step 1", "step 2", "step 3"]) expect(warning?.additionalContext).toContain(step);
	});

	it("passes a todo init that copies every step, paraphrased or verbatim", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("demo");
		expect(await h.result("todo", init(["Read design notes", "Delegate the implementation to a subagent", "Verify on matching surface"]))).toBeUndefined();
		expect(
			await h.result("todo", init(["Read the design notes carefully.", "Delegate implementation to a subagent.", "Verify on the matching surface."])),
		).toBeUndefined();
	});

	it("checks only init: append, start and view pass", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("demo");
		for (const input of [{ op: "append", items: ["Unrelated"] }, { op: "start", task: "Unrelated" }, { op: "view" }]) {
			expect(await h.result("todo", input)).toBeUndefined();
		}
	});

	it("has nothing to check without an active playbook or an active run, and passes a failed call", async () => {
		const noPlaybook = createHarness();
		await noPlaybook.activate();
		expect(await noPlaybook.result("todo", init(["Unrelated"]))).toBeUndefined();
		const inactive = createHarness();
		await inactive.openPlaybook("demo");
		expect(await inactive.result("todo", init(["Unrelated"]))).toBeUndefined();
		const failed = createHarness();
		await failed.activate();
		await failed.openPlaybook("demo");
		expect(await failed.result("todo", init(["Unrelated"]), true)).toBeUndefined();
	});

	it("reads the vendored feature playbook: its own steps pass, an empty plan fails", async () => {
		const feature = fs.readFileSync(path.join(import.meta.dirname, "../skills/poteto-mode/playbooks/feature.md"), "utf8");
		const steps = feature.split("\n").filter(line => /^\d+\. /.test(line));
		expect(steps.length).toBeGreaterThan(3);
		const h = createHarness({ vendored: true });
		await h.activate();
		await h.openPlaybook("feature");
		expect(await h.result("todo", init(steps.map(step => step.replace(/^\d+\. /, ""))))).toBeUndefined();
		expect((await h.result("todo", init(["Do the thing"])))?.additionalContext).toContain("step 1");
	});

	it("is silent at strictness off", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("demo");
		h.setStrictness("off");
		expect(await h.result("todo", init(["Unrelated"]))).toBeUndefined();
	});
});

const user = { role: "user", content: "build it" };
const say = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (name: string, args: object = {}) => ({ role: "assistant", content: [{ type: "toolCall", id: "c", name, arguments: args }] });
const finished = (toolName: string, isError = false) => ({ role: "toolResult", toolCallId: "c", toolName, content: [], isError });

describe("throughput checkpoint stop warning", () => {
	it("asks for the checkpoint once, as a continuation", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("ckpt");
		const result = await h.stop([user, say("All built.")]);
		expect(result?.continue).toBe(true);
		expect(result?.additionalContext).toBeTruthy();
		expect(await h.stop([user, say("All built.")])).toBeUndefined();
	});

	it("passes once the assistant wrote the checkpoint in prose or in todo items", async () => {
		const prose = createHarness();
		await prose.activate();
		await prose.openPlaybook("ckpt");
		expect(await prose.stop([user, say("throughput checkpoint: one worker, single file."), say("Built.")])).toBeUndefined();

		const todo = createHarness();
		await todo.activate();
		await todo.openPlaybook("ckpt");
		const items = call("todo", { op: "init", items: ["Blocking first steps: none", "Independent workstreams: n/a"] });
		expect(await todo.stop([user, items, finished("todo"), say("Built.")])).toBeUndefined();
	});

	it("counts a checkpoint written before the last user prompt, from the session branch", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("ckpt");
		h.branch.push({ type: "message", message: say("throughput checkpoint: n/a, one file") });
		expect(await h.stop([user, say("Built.")])).toBeUndefined();
	});

	it("does not count a tool result that quotes the playbook", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("ckpt");
		const quoted = { role: "toolResult", toolName: "read", isError: false, content: [{ type: "text", text: "Write the throughput checkpoint." }] };
		expect((await h.stop([user, call("read"), quoted, say("Built.")]))?.continue).toBe(true);
	});

	it("never continues a continuation, so OMP's cap of 8 is never approached", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("ckpt");
		expect(await h.stop([user, say("Built.")], { stop_hook_active: true })).toBeUndefined();
	});

	it("has nothing to ask when the playbook has no checkpoint, no playbook is open, or pstack is inactive", async () => {
		const demo = createHarness();
		await demo.activate();
		await demo.openPlaybook("demo");
		expect(await demo.stop([user, say("Built.")])).toBeUndefined();
		const none = createHarness();
		await none.activate();
		expect(await none.stop([user, say("Built.")])).toBeUndefined();
		const inactive = createHarness();
		await inactive.openPlaybook("ckpt");
		expect(await inactive.stop([user, say("Built.")])).toBeUndefined();
	});

	it("is silent at strictness off", async () => {
		const h = createHarness();
		await h.activate();
		await h.openPlaybook("ckpt");
		h.setStrictness("off");
		expect(await h.stop([user, say("Built.")])).toBeUndefined();
	});
});

describe("done claim without runtime proof", () => {
	const editedThenClaims = [user, call("edit"), finished("edit"), say("Done. The feature is implemented.")];

	it("trips when files changed and nothing ran afterwards", async () => {
		const h = createHarness();
		await h.activate();
		const result = await h.stop(editedThenClaims);
		expect(result?.continue).toBe(true);
		expect(result?.additionalContext).toBeTruthy();
	});

	it("passes when a command, eval or browser run came after the last edit", async () => {
		for (const runner of ["bash", "eval", "browser"]) {
			const h = createHarness();
			await h.activate();
			expect(await h.stop([user, call("edit"), finished("edit"), call(runner), finished(runner), say("Done.")])).toBeUndefined();
		}
	});

	it("trips when the only run came before the last edit", async () => {
		const h = createHarness();
		await h.activate();
		const messages = [user, call("bash"), finished("bash"), call("edit"), finished("edit"), say("All done.")];
		expect((await h.stop(messages))?.continue).toBe(true);
	});

	it("passes a failed run as no proof only when the edit stays unproven, and ignores failed edits", async () => {
		const failedRun = createHarness();
		await failedRun.activate();
		expect((await failedRun.stop([user, call("edit"), finished("edit"), call("bash"), finished("bash", true), say("Done.")]))?.continue).toBe(true);
		const failedEdit = createHarness();
		await failedEdit.activate();
		expect(await failedEdit.stop([user, call("edit"), finished("edit", true), say("Done.")])).toBeUndefined();
	});

	it("passes replies that claim nothing, negate the claim, or follow a turn that changed nothing", async () => {
		const h = createHarness();
		await h.activate();
		expect(await h.stop([user, call("edit"), finished("edit"), say("I changed the parser. Please run the tests.")])).toBeUndefined();
		expect(await h.stop([user, call("edit"), finished("edit"), say("This is not done yet.")])).toBeUndefined();
		expect(await h.stop([user, call("read"), finished("read"), say("Done reading.")])).toBeUndefined();
	});

	it("looks only at the current turn", async () => {
		const h = createHarness();
		await h.activate();
		const earlier = [user, call("edit"), finished("edit"), say("Edited.")];
		expect(await h.stop([...earlier, { role: "user", content: "thanks" }, say("Done.")])).toBeUndefined();
	});

	it("is silent while inactive, on a continuation, and at strictness off", async () => {
		const inactive = createHarness();
		expect(await inactive.stop(editedThenClaims)).toBeUndefined();
		const h = createHarness();
		await h.activate();
		expect(await h.stop(editedThenClaims, { stop_hook_active: true })).toBeUndefined();
		h.setStrictness("off");
		expect(await h.stop(editedThenClaims)).toBeUndefined();
	});
});
