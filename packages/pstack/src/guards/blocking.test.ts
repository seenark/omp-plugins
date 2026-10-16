import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GUARD_STRICTNESS_LEVELS, type GuardStrictness } from "../behavior.ts";
import pstackExtension from "../index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Result = { block?: boolean; reason?: string; additionalContext?: string } | undefined;

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pstack-guards-")));
const repository = path.join(sandbox, "repo");
const outside = path.join(sandbox, "scratch");
{
	fs.mkdirSync(path.join(repository, "src"), { recursive: true });
	fs.mkdirSync(outside);
	fs.writeFileSync(path.join(repository, "src", "a.ts"), "const a = 1;\n");
	fs.writeFileSync(path.join(repository, ".gitignore"), "ignored.log\n");
	fs.writeFileSync(path.join(repository, "ignored.log"), "x\n");
	fs.writeFileSync(path.join(repository, "src", "untracked.ts"), "const u = 1;\n");
	fs.writeFileSync(path.join(outside, "note.txt"), "a\n");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "ignore" });
	git("init", "-q");
	git("add", ".gitignore", "src/a.ts");
}

afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));

interface Options {
	agent?: string;
	active?: boolean;
	strictness?: GuardStrictness;
	cwd?: string;
}

/** The extension behind a fake ExtensionAPI; `agent` is the lowercased `ctx.agent.name` the session runs as. */
async function createSession(options: Options = {}) {
	const handlers = new Map<string, Handler>();
	const home = fs.mkdtempSync(path.join(sandbox, "home-"));
	if (options.strictness !== undefined) {
		const file = path.join(home, ".config", "codesook-omp", "config.json");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ version: 1, display: {}, behavior: { pstack: { guardStrictness: options.strictness } } }));
	}
	const pi = {
		events: { on: () => () => {}, emit() {} },
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand() {},
		appendEntry() {},
		sendMessage() {},
		sendUserMessage() {},
		logger: { info() {}, warn() {}, error() {} },
	};
	const name = options.agent ?? "main";
	const ctx = {
		hasUI: false,
		cwd: options.cwd ?? repository,
		agent: { kind: name === "main" ? "main" : "sub", id: "a1", name, depth: 0 },
		sessionManager: { getBranch: () => [] },
		models: { resolve: () => ({ provider: "test", id: "model" }) },
	};
	pstackExtension(pi as never, { homeDirectory: home });
	const fire = (event: string, payload: unknown) => handlers.get(event)!(payload, ctx);
	await fire("session_start", { type: "session_start" });
	if (options.active) await fire("input", { type: "input", source: "user", text: "/skill:poteto-mode a task" });
	return {
		tool: (toolName: string, input: unknown) => fire("tool_call", { type: "tool_call", toolCallId: "t1", toolName, input }) as Promise<Result>,
		bash: (command: string) => fire("tool_call", { type: "tool_call", toolCallId: "t1", toolName: "bash", input: { command } }) as Promise<Result>,
		spawn: (agent: string) => fire("before_subagent_spawn", { type: "before_subagent_spawn", agent, invocationKind: "task", patterns: [] }) as Result,
	};
}

const outsideFile = () => path.join(outside, "note.txt");

describe("in-place edit guard", () => {
	const trips = [
		"sed -i 's/a/b/' src/a.ts",
		"sed -i '' 's/a/b/' src/a.ts",
		"sed -i'' 's/a/b/' src/a.ts",
		"sed -i.bak s/a/b/ src/a.ts",
		"sed --in-place s/a/b/ src/a.ts",
		"sed --in-place=.bak s/a/b/ src/a.ts",
		"sed -ni 's/a/b/p' src/a.ts",
		"sed -E -i -e s/a/b/ -e s/c/d/ src/a.ts",
		"gsed -i s/a/b/ src/a.ts",
		"perl -pi -e 's/a/b/' src/a.ts",
		"perl -i.bak -pe 's/a/b/' src/a.ts",
		"perl -pi.orig -e 's/a/b/' src/a.ts",
		"perl -i -pe 's/a/b/' src/a.ts",
		"bun test && sed -i s/a/b/ src/a.ts",
		"false || perl -pi -e s/a/b/ src/a.ts",
		"cd src && sed -i s/a/b/ a.ts",
		"sed -i s/a/b/ src/*.ts",
		"sed -i s/a/b/ src/untracked.ts",
		"bash -c \"sed -i s/a/b/ src/a.ts\"",
		"sudo sed -i s/a/b/ src/a.ts",
		"find src -name '*.ts' | xargs sed -i s/a/b/",
		"find src -name '*.ts' -exec sed -i s/a/b/ {} +",
		"echo x; (sed -i s/a/b/ src/a.ts)",
		`cd ${outside} && cd ${repository} && sed -i s/a/b/ src/a.ts`,
	];
	const passes = [
		"sed -n '1,5p' src/a.ts",
		"sed -n -e '/x/i hello' src/a.ts",
		"sed s/a/b/ src/a.ts > out.txt",
		"sed -e s/a/b/ src/a.ts 2>&1",
		"cat src/a.ts | sed s/a/b/",
		"perl -pe s/a/b/ src/a.ts",
		"perl -ne 'print if /i/' src/a.ts",
		"grep -i foo src/a.ts",
		"ls -i src",
		`sed -i s/a/b/ ${outsideFile()}`,
		`perl -pi -e s/a/b/ ${outsideFile()}`,
		`cd ${outside} && sed -i s/a/b/ note.txt`,
		"sed -i s/a/b/ ignored.log",
		"sed -i s/a/b/ \"$TMPDIR/x\"",
		"echo sed -i src/a.ts",
	];

	for (const command of trips) {
		it(`blocks ${command}`, async () => {
			const result = await (await createSession({ active: true })).bash(command);
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("edit");
		});
	}
	for (const command of passes) {
		it(`passes ${command}`, async () => {
			expect(await (await createSession({ active: true })).bash(command)).toBeUndefined();
		});
	}

	it("ignores a session where pstack is inactive", async () => {
		expect(await (await createSession()).bash("sed -i s/a/b/ src/a.ts")).toBeUndefined();
	});
	it("guards a write-capable pstack lane even when pstack is inactive", async () => {
		expect((await (await createSession({ agent: "pstack-build" })).bash("sed -i s/a/b/ src/a.ts"))?.block).toBe(true);
	});
	it("lets a lane edit a file outside the repository", async () => {
		expect(await (await createSession({ agent: "pstack-build" })).bash(`sed -i s/a/b/ ${outsideFile()}`)).toBeUndefined();
	});
	it("passes outside any repository", async () => {
		expect(await (await createSession({ active: true, cwd: outside })).bash("sed -i s/a/b/ note.txt")).toBeUndefined();
	});
	it("resolves a bash tool cwd argument", async () => {
		const session = await createSession({ active: true, cwd: outside });
		expect((await session.tool("bash", { command: "sed -i s/a/b/ a.ts", cwd: path.join(repository, "src") }))?.block).toBe(true);
	});
});

describe("read-only lane guard", () => {
	const readOnly = ["pstack-explore", "pstack-design", "pstack-judge", "pstack-security", "pstack-panel-a-critic", "pstack-panel-e-critic"];
	const mutations: Array<[string, unknown]> = [
		["edit", { path: "src/a.ts", edits: [] }],
		["write", { path: "src/a.ts", content: "x" }],
		["write", { path: "/tmp/elsewhere.txt", content: "x" }],
		["write", { path: "agent://0-Other", content: "x" }],
		["ast_edit", { ops: [] }],
		["bash", { command: "echo hi > src/a.ts" }],
		["bash", { command: "ls" }],
		["eval", { code: "1" }],
		["lsp", { action: "rename", file: "src/a.ts", new_name: "b" }],
		["lsp", { action: "code_actions", file: "src/a.ts", apply: true }],
	];
	const reads: Array<[string, unknown]> = [
		["read", { path: "src/a.ts" }],
		["grep", { pattern: "a" }],
		["glob", { pattern: "**/*.ts" }],
		["ast_grep", { pat: ["a"] }],
		["lsp", { action: "diagnostics", file: "src/a.ts" }],
		["write", { path: "local://notes/scratch.md", content: "x" }],
		["yield", { result: {} }],
	];

	for (const agent of readOnly) {
		for (const [tool, input] of mutations) {
			it(`${agent} cannot ${tool} ${JSON.stringify(input).slice(0, 40)}`, async () => {
				const result = await (await createSession({ agent })).tool(tool, input);
				expect(result?.block).toBe(true);
			});
		}
	}
	for (const [tool, input] of reads) {
		it(`${readOnly[0]} may ${tool} ${JSON.stringify(input).slice(0, 40)}`, async () => {
			expect(await (await createSession({ agent: readOnly[0]! })).tool(tool, input)).toBeUndefined();
		});
	}
	it("lets write-capable lanes and ordinary agents write", async () => {
		for (const agent of ["pstack-build", "pstack-mechanical", "pstack-panel-b-builder", "main", "explore"]) {
			const session = await createSession({ agent });
			expect(await session.tool("write", { path: "src/new.ts", content: "x" })).toBeUndefined();
			expect(await session.tool("edit", { path: "src/a.ts", edits: [] })).toBeUndefined();
		}
	});
	it("guards a read-only lane whether or not pstack is active", async () => {
		expect((await (await createSession({ agent: "pstack-explore", active: true })).tool("edit", {}))?.block).toBe(true);
	});
});

describe("lane spawn guard", () => {
	const lanes = ["pstack-build", "pstack-explore", "pstack-panel-c-critic", "pstack-panel-d-builder"];
	for (const agent of lanes) {
		it(`blocks ${agent} spawning through the task tool`, async () => {
			expect((await (await createSession({ agent })).tool("task", { agent: "task", tasks: [] }))?.block).toBe(true);
		});
		it(`blocks ${agent} on before_subagent_spawn`, () => {
			return createSession({ agent }).then(session => expect(session.spawn("task")?.block).toBe(true));
		});
	}
	it("lets an ordinary session spawn, active or not", async () => {
		for (const active of [false, true]) {
			const session = await createSession({ active });
			expect(await session.tool("task", { agent: "task", tasks: [] })).toBeUndefined();
			expect(session.spawn("pstack-build")).toBeUndefined();
		}
	});
	it("keeps refusing a panel seat that has no model", async () => {
		const session = await createSession();
		expect(session.spawn("pstack-panel-a-critic")).toBeUndefined();
	});
});

describe("strictness", () => {
	const attempts: Array<[string, Options, (session: Awaited<ReturnType<typeof createSession>>) => Promise<Result> | Result]> = [
		["in-place edit", { active: true }, session => session.bash("sed -i s/a/b/ src/a.ts")],
		["read-only lane", { agent: "pstack-explore" }, session => session.tool("write", { path: "src/a.ts", content: "x" })],
		["lane spawn (task tool)", { agent: "pstack-build" }, session => session.tool("task", { tasks: [] })],
	];
	for (const [name, options, attempt] of attempts) {
		it(`${name}: blocks by default and at block-and-warn`, async () => {
			expect((await attempt(await createSession(options)))?.block).toBe(true);
			expect((await attempt(await createSession({ ...options, strictness: "block-and-warn" })))?.block).toBe(true);
		});
		it(`${name}: warn-only lets the call run with a warning`, async () => {
			const result = await attempt(await createSession({ ...options, strictness: "warn-only" }));
			expect(result?.block).toBeUndefined();
			expect(result?.additionalContext).toBeTruthy();
		});
		it(`${name}: off disables the guard`, async () => {
			expect(await attempt(await createSession({ ...options, strictness: "off" }))).toBeUndefined();
		});
	}
	it("lane spawn on before_subagent_spawn follows strictness", async () => {
		expect((await createSession({ agent: "pstack-build", strictness: "warn-only" })).spawn("task")?.block).toBeUndefined();
		expect((await createSession({ agent: "pstack-build", strictness: "off" })).spawn("task")?.block).toBeUndefined();
	});
	it("covers every strictness level", () => {
		expect(GUARD_STRICTNESS_LEVELS).toEqual(["block-and-warn", "warn-only", "off"]);
	});
});
