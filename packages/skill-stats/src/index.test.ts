import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { SKILL_USE_EVENT } from "@codesook/omp-shared-display/skill-use";
import skillStatsExtension from "./index.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Handler = (event: unknown, ctx: unknown) => unknown;
type Overlay = { render(width: number): readonly string[]; handleInput(data: string): void };
type Use = { at: string; name: string; path: string; source: string; session: string };

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-skill-stats-"));
	roots.push(root);
	const home = path.join(root, "home");
	const project = path.join(root, "project");
	mkdirSync(home, { recursive: true });
	mkdirSync(project, { recursive: true });
	const globalDir = path.join(root, "global-store");
	const sessionsRoot = path.join(home, ".omp", "agent", "sessions");

	let clock = NOW;
	let projectRoot = project;
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const notices: Array<{ message: string; level: string }> = [];
	const confirms: boolean[] = [];
	const overlays: Overlay[] = [];
	const terminalWrites: string[] = [];
	const execCalls: Array<{ command: string; args: string[] }> = [];
	let skills: Array<{ name: string; path: string }> = [];
	let pbcopyExit = 0;

	const events = {
		on(channel: string, handler: (data: unknown) => void) {
			bus.set(channel, [...(bus.get(channel) ?? []), handler]);
			return () => bus.set(channel, (bus.get(channel) ?? []).filter(item => item !== handler));
		},
		emit(channel: string, data: unknown) {
			for (const handler of bus.get(channel) ?? []) handler(data);
		},
	};
	const pi = {
		events,
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => void commands.set(name, command),
		getCommands: () => skills.map(skill => ({ name: `skill:${skill.name}`, source: "skill", path: skill.path })),
		exec: async (command: string, args: string[]) => {
			execCalls.push({ command, args });
			return { code: pbcopyExit, stdout: "", stderr: "", killed: false };
		},
		logger: { warn: () => {}, info: () => {}, error: () => {} },
	};
	skillStatsExtension(pi as unknown as ExtensionAPI, {
		home,
		globalStoreDir: globalDir,
		sessionsRoot,
		now: () => new Date(clock),
		resolveProject: async () => projectRoot,
	});

	const tui = { requestRender: () => {}, terminal: { rows: 24, write: (data: string) => void terminalWrites.push(data) } };
	const makeContext = (options: { sub?: boolean; ui?: boolean; session?: string; legacyHost?: boolean } = {}) =>
		({
			hasUI: options.ui ?? false,
			cwd: project,
			...(options.legacyHost ? {} : { agent: { kind: options.sub ? "sub" : "main", id: options.sub ? "0-Worker" : "Main" } }),
			sessionManager: { getSessionId: () => options.session ?? "session-1" },
			ui: {
				notify: (message: string, level = "info") => void notices.push({ message, level }),
				confirm: async () => confirms.shift() ?? true,
				custom: (factory: (...args: unknown[]) => Overlay) => {
					const { promise, resolve } = Promise.withResolvers<void>();
					overlays.push(factory(tui, {}, {}, resolve));
					return promise;
				},
			},
		}) as unknown as ExtensionContext;
	const main = makeContext();
	const sub = makeContext({ sub: true, session: "sub-1" });

	const fire = (name: string, event: unknown, ctx: ExtensionContext = main) => handlers.get(name)!(event, ctx);
	const bash = (command: string, ctx: ExtensionContext = main) => fire("tool_call", { type: "tool_call", toolName: "bash", toolCallId: "c", input: { command } }, ctx);
	const prompt = (name: string, skillPath: string, attribution: string | undefined, ctx: ExtensionContext = main) =>
		fire("message_start", { type: "message_start", message: { role: "custom", customType: "skill-prompt", details: { name, path: skillPath }, attribution } }, ctx);
	const command = (args = "", ctx: ExtensionContext = main) => commands.get("skill-stats")!.handler(args, ctx);
	const output = async (args = "", ctx: ExtensionContext = main): Promise<string> => {
		notices.length = 0;
		await command(args, ctx);
		return notices.at(-1)!.message;
	};

	const writeSkill = (dir: string, name: string, mtimeMs?: number): string => {
		const file = path.join(dir, name, "SKILL.md");
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, `---\nname: ${name}\n---\n`);
		if (mtimeMs !== undefined) utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
		return file;
	};
	const homeSkill = (name: string, mtimeMs?: number) => writeSkill(path.join(home, ".claude", "skills"), name, mtimeMs);
	const projectSkill = (name: string, where = ".agents/skills", mtimeMs?: number) => writeSkill(path.join(project, where), name, mtimeMs);
	const readUses = (dir: string): Use[] => {
		const file = path.join(dir, "uses.jsonl");
		return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Use) : [];
	};
	const meta = (dir: string) => JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as Record<string, unknown>;
	const projectDir = path.join(project, ".omp", "skill-stats");

	return {
		root, home, project, globalDir, projectDir, sessionsRoot, notices, confirms, overlays, terminalWrites, execCalls,
		set clock(value: number) { clock = value; },
		set projectRoot(value: string) { projectRoot = value; },
		set skills(value: Array<{ name: string; path: string }>) { skills = value; },
		set pbcopyExit(value: number) { pbcopyExit = value; },
		events, main, sub, makeContext, fire, bash, prompt, command, output, homeSkill, projectSkill, writeSkill, readUses, meta,
		readTool: (text: string, ctx: ExtensionContext = main) => fire("tool_call", { type: "tool_call", toolName: "read", toolCallId: "c", input: { path: text } }, ctx),
	};
}

function table(text: string): string[][] {
	const lines = text.split("\n");
	const start = lines.findIndex(line => line.startsWith("SKILL"));
	const rows: string[][] = [];
	for (const line of lines.slice(start + 1)) {
		if (line === "") break;
		rows.push(line.split(/ {2,}/u));
	}
	return rows;
}
const rowOf = (text: string, name: string): string[] => table(text).find(cells => cells[0] === name)!;
const sourcesOf = (uses: Use[]): string[] => uses.map(use => `${use.name}:${use.source}`).sort();
const settle = async (condition: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 1000 && !condition(); attempt += 1) await Promise.resolve();
};

describe("live Skill Use recording", () => {
	test("attributes user, agent and subagent sources and records the loaded path", async () => {
		const f = fixture();
		const user = f.homeSkill("grill");
		const auto = f.homeSkill("auto");
		const fromMain = f.homeSkill("main-prompt");
		f.skills = [];
		await f.prompt("grill", user, "user");
		await f.prompt("auto", auto, "agent", f.sub);
		await f.prompt("auto", auto, undefined, f.sub);
		await f.prompt("main-prompt", fromMain, "agent");
		await f.prompt("grill", user, "user", f.sub);

		expect(f.readUses(f.globalDir).map(use => [use.name, use.source, use.path, use.session])).toEqual([
			["grill", "user", user, "session-1"],
			["auto", "subagent", auto, "sub-1"],
			["auto", "subagent", auto, "sub-1"],
			["main-prompt", "agent", fromMain, "session-1"],
			["grill", "user", user, "sub-1"],
		]);
		expect(f.readUses(f.globalDir)[0]!.at).toBe(new Date(NOW).toISOString());
	});

	test("a host without ctx.agent (older than OMP 18.3.2) counts every session as the main agent", async () => {
		const f = fixture();
		const legacy = f.makeContext({ legacyHost: true });
		const auto = f.homeSkill("auto");
		f.skills = [];
		await f.prompt("auto", auto, undefined, legacy);
		await f.prompt("auto", auto, "user", legacy);

		expect(sourcesOf(f.readUses(f.globalDir))).toEqual(["auto:agent", "auto:user"]);
	});

	test("counts every skill:// read: several listed paths, sub-files, repeats, bash, subagent reads", async () => {
		const f = fixture();
		const a = f.homeSkill("alpha");
		const b = f.homeSkill("beta");
		f.skills = [{ name: "alpha", path: a }, { name: "beta", path: b }];

		await f.readTool("skill://alpha/references/x.md;skill://beta, skill://alpha");
		await f.bash("cat skill://beta/notes.md && ls");
		await f.readTool("skill://alpha", f.sub);
		await f.fire("tool_call", { type: "tool_call", toolName: "grep", toolCallId: "g", input: { pattern: "skill://alpha" } });
		await f.readTool("skill://not-installed");
		await f.readTool("src/index.ts");

		expect(sourcesOf(f.readUses(f.globalDir))).toEqual(["alpha:agent", "alpha:agent", "alpha:subagent", "beta:agent", "beta:agent"]);
	});

	test("counts a Project Skill in its project store and a Global Skill in the global store", async () => {
		const f = fixture();
		const projectOwned = f.projectSkill("proj-skill");
		const claudeProject = f.projectSkill("claude-skill", ".claude/skills");
		const homeOwned = f.homeSkill("home-skill");
		const agentsHome = f.writeSkill(path.join(f.home, ".agents", "skills"), "agents-home");
		f.skills = [];
		for (const [name, file] of [["proj-skill", projectOwned], ["claude-skill", claudeProject], ["home-skill", homeOwned], ["agents-home", agentsHome]] as const) {
			await f.prompt(name, file, "user");
		}

		expect(f.readUses(f.projectDir).map(use => use.name)).toEqual(["proj-skill", "claude-skill"]);
		expect(f.readUses(f.globalDir).map(use => use.name)).toEqual(["home-skill", "agents-home"]);
	});

	test("keeps the project store out of Git and starts recording at its first use", async () => {
		const f = fixture();
		f.clock = Date.parse("2026-10-01T00:00:00.000Z");
		await f.prompt("proj-skill", f.projectSkill("proj-skill"), "user");
		f.clock = NOW;
		await f.prompt("proj-skill", f.projectSkill("proj-skill"), "user");

		expect(readFileSync(path.join(f.projectDir, ".gitignore"), "utf8")).toBe("*\n");
		expect(f.meta(f.projectDir).recordingStartedAt).toBe("2026-10-01T00:00:00.000Z");
		expect(existsSync(path.join(f.globalDir, ".gitignore"))).toBe(false);
	});

	test("counts a same-name Project Skill override at the path that was loaded", async () => {
		const f = fixture();
		const global = f.homeSkill("shared");
		const project = f.projectSkill("shared");
		f.skills = [{ name: "shared", path: project }];

		await f.prompt("shared", project, "user");
		await f.readTool("skill://shared");
		await f.prompt("shared", global, "user");

		expect(f.readUses(f.projectDir).map(use => use.source)).toEqual(["user", "agent"]);
		expect(f.readUses(f.globalDir).map(use => use.path)).toEqual([global]);
	});

	test("records a Skill Use event from another feature as a user use, only when valid", async () => {
		const f = fixture();
		const file = f.homeSkill("ponytail-review");
		f.events.emit(SKILL_USE_EVENT, { name: "ponytail-review", path: file, source: "user" });
		f.events.emit(SKILL_USE_EVENT, { name: "ponytail-review", path: file, source: "agent" });
		f.events.emit(SKILL_USE_EVENT, { name: "", path: file, source: "user" });
		f.events.emit(SKILL_USE_EVENT, "nonsense");

		expect(f.readUses(f.globalDir).map(use => [use.name, use.source, use.path])).toEqual([["ponytail-review", "user", file]]);
	});
});

describe("/skill-stats report", () => {
	test("windows are inclusive at 7, 30 and 60 days and split by source", async () => {
		const f = fixture();
		const file = f.homeSkill("edge", NOW - 200 * DAY);
		f.skills = [{ name: "edge", path: file }];
		for (const [age, ctx, attribution] of [[30 * DAY + 1, f.main, "user"], [30 * DAY, f.main, "user"], [7 * DAY + 1, f.main, "user"], [7 * DAY, f.sub, undefined], [1, f.main, "user"]] as const) {
			f.clock = NOW - age;
			await f.prompt("edge", file, attribution, ctx);
		}
		f.clock = NOW;

		const row = rowOf(await f.output(), "edge");
		expect(row.slice(2, 5)).toEqual(["2 (1/0/1)", "4 (3/0/1)", "5 (4/0/1)"]);
		expect(row[5]).toBe("u:2026-10-22 a:- s:2026-10-15");
	});

	test("lists never-used installed skills with zero counts, ordered by since-reset count then oldest last use", async () => {
		const f = fixture();
		const names = ["busy", "old-one", "new-one", "idle-b", "idle-a"];
		const files = Object.fromEntries(names.map(name => [name, f.homeSkill(name, NOW - 200 * DAY)]));
		f.skills = names.map(name => ({ name, path: files[name]! }));
		for (const [name, age, times] of [["busy", 1, 2], ["old-one", 40, 1], ["new-one", 3, 1]] as const) {
			f.clock = NOW - age * DAY;
			for (let i = 0; i < times; i += 1) await f.prompt(name, files[name]!, "user");
		}
		f.clock = NOW;

		const text = await f.output();
		expect(table(text).map(cells => cells[0])).toEqual(["idle-a", "idle-b", "old-one", "new-one", "busy"]);
		expect(rowOf(text, "idle-a").slice(2)).toEqual(["0 (0/0/0)", "0 (0/0/0)", "0 (0/0/0)", "never"]);
	});

	test("hides a recorded skill whose file is gone but keeps one that is only not discovered", async () => {
		const f = fixture();
		const gone = f.homeSkill("gone");
		const hidden = f.homeSkill("undiscovered");
		f.skills = [];
		await f.prompt("gone", gone, "user");
		await f.prompt("undiscovered", hidden, "user");
		rmSync(path.dirname(gone), { recursive: true });

		const names = table(await f.output()).map(cells => cells[0]);
		expect(names).toEqual(["undiscovered"]);
	});

	test("shows the origin: npx-skills lock, managed, plugin, home", async () => {
		const f = fixture();
		mkdirSync(path.join(f.home, ".agents"), { recursive: true });
		writeFileSync(path.join(f.home, ".agents", ".skill-lock.json"), JSON.stringify({ version: 3, skills: { locked: { installedAt: "2026-01-01T00:00:00.000Z" } } }));
		const locked = f.writeSkill(path.join(f.home, ".agents", "skills"), "locked");
		const managed = f.writeSkill(path.join(f.home, ".omp", "agent", "managed-skills"), "managed-one");
		const plugin = f.writeSkill(path.join(f.root, "plugin-checkout", "skills"), "plugin-one");
		const home = f.homeSkill("home-one");
		f.skills = [["locked", locked], ["managed-one", managed], ["plugin-one", plugin], ["home-one", home]].map(([name, file]) => ({ name: name!, path: file! }));

		const text = await f.output();
		expect(["locked", "managed-one", "plugin-one", "home-one"].map(name => rowOf(text, name)[1])).toEqual(["npx-skills", "managed", "plugin", "home"]);
	});

	test("project dashboard lists only the current project's skills", async () => {
		const f = fixture();
		const mine = f.projectSkill("mine");
		const other = f.writeSkill(path.join(f.root, "other-project", ".agents", "skills"), "theirs");
		const home = f.homeSkill("home-skill");
		f.skills = [{ name: "mine", path: mine }, { name: "theirs", path: other }, { name: "home-skill", path: home }];
		await f.prompt("mine", mine, "user");

		const text = await f.output("project");
		expect(text).toContain(`Project Skills of ${f.project}`);
		expect(table(text).map(cells => cells[0])).toEqual(["mine"]);
		expect(rowOf(text, "mine")[1]).toBe("npx-skills");
		expect(table(await f.output()).map(cells => cells[0])).toEqual(["home-skill"]);
	});

	describe("delete candidates", () => {
		test("need no use in 60 days and an install at least 60 days old; the command never has -y", async () => {
			const f = fixture();
			mkdirSync(path.join(f.home, ".agents"), { recursive: true });
			const iso = (age: number) => new Date(NOW - age).toISOString();
			writeFileSync(
				path.join(f.home, ".agents", ".skill-lock.json"),
				JSON.stringify({ skills: { stale: { installedAt: iso(100 * DAY) }, "exact-install": { installedAt: iso(60 * DAY) }, fresh: { installedAt: iso(59 * DAY) }, "used-at-60": { installedAt: iso(200 * DAY) }, "used-at-60-plus": { installedAt: iso(200 * DAY) } } }),
			);
			const skillsDir = path.join(f.home, ".agents", "skills");
			const files = Object.fromEntries(["stale", "exact-install", "fresh", "used-at-60", "used-at-60-plus"].map(name => [name, f.writeSkill(skillsDir, name)]));
			const bySelf = f.homeSkill("hand-made", NOW - 90 * DAY);
			f.skills = [...Object.entries(files).map(([name, file]) => ({ name, path: file })), { name: "hand-made", path: bySelf }];
			f.clock = NOW - 60 * DAY;
			await f.prompt("used-at-60", files["used-at-60"]!, "user");
			f.clock = NOW - 60 * DAY - 1;
			await f.prompt("used-at-60-plus", files["used-at-60-plus"]!, "user");
			f.clock = NOW;

			const text = await f.output();
			expect(text).toContain("\n  npx skills remove -g exact-install stale used-at-60-plus\n");
			expect(text).not.toContain(" -y");
			expect(text).toContain(`hand-made (home)  ${bySelf}`);
			expect(text).not.toMatch(/remove -g[^\n]*(fresh|used-at-60 |hand-made)/u);
		});

		test("the project dashboard command has no -g and names only .agents/skills skills", async () => {
			const f = fixture();
			const stale = f.projectSkill("stale-proj", ".agents/skills", NOW - 90 * DAY);
			const local = f.projectSkill("local-only", ".omp/skills", NOW - 90 * DAY);
			f.skills = [{ name: "stale-proj", path: stale }, { name: "local-only", path: local }];

			const text = await f.output("project");
			expect(text).toContain("\n  npx skills remove stale-proj\n");
			expect(text).not.toContain(" -g");
			expect(text).toContain(`local-only (project)  ${local}`);
		});
	});

	test("the overlay scrolls, copies the command with pbcopy and OSC 52, and closes", async () => {
		const f = fixture();
		for (let i = 0; i < 40; i += 1) f.projectSkill(`skill-${String(i).padStart(2, "0")}`, ".agents/skills", NOW - 90 * DAY);
		f.skills = Array.from({ length: 40 }, (_, i) => ({ name: `skill-${String(i).padStart(2, "0")}`, path: path.join(f.project, ".agents", "skills", `skill-${String(i).padStart(2, "0")}`, "SKILL.md") }));
		const ui = f.makeContext({ ui: true });

		const closed = f.command("project", ui);
		await settle(() => f.overlays.length > 0);
		const overlay = f.overlays[0]!;
		const render = () => overlay.render(400);
		const first = render();
		expect(first[0]).toBe(`Skill stats: Project Skills of ${f.project}`);
		expect(first.at(-1)).toContain("c copy command");
		overlay.handleInput("\x1b[6~");
		expect(render()[0]).not.toBe(first[0]);

		overlay.handleInput("c");
		await settle(() => render().at(-1) === "Copied with pbcopy.");
		const copied = f.execCalls.at(-1)!;
		expect(copied.args.at(-1)).toStartWith("npx skills remove skill-00 skill-01");
		expect(f.terminalWrites[0]).toBe(`\x1b]52;c;${Buffer.from(copied.args.at(-1)!).toString("base64")}\x07`);

		f.pbcopyExit = 1;
		overlay.handleInput("c");
		await settle(() => render().at(-1)?.startsWith("Sent to the terminal clipboard") === true);
		overlay.handleInput("\x1b");
		await closed;
	});
});

describe("/skill-stats reset", () => {
	test("global reset moves the Reset Point, keeps every record, and a use after it counts again", async () => {
		const f = fixture();
		const file = f.homeSkill("tracked");
		f.skills = [{ name: "tracked", path: file }];
		f.clock = NOW - 5 * DAY;
		await f.prompt("tracked", file, "user");
		f.clock = NOW - 1 * DAY;
		const before = readFileSync(path.join(f.globalDir, "uses.jsonl"), "utf8");
		await f.command("reset");
		expect(f.meta(f.globalDir).resetAll).toBe(new Date(NOW - DAY).toISOString());
		f.clock = NOW;
		await f.prompt("tracked", file, "agent");

		expect(readFileSync(path.join(f.globalDir, "uses.jsonl"), "utf8").startsWith(before)).toBe(true);
		expect(f.readUses(f.globalDir)).toHaveLength(2);
		const row = rowOf(await f.output(), "tracked");
		expect(row.slice(3, 5)).toEqual(["2 (1/1/0)", "1 (0/1/0)"]);
	});

	test("a per-skill reset only affects that skill", async () => {
		const f = fixture();
		const one = f.homeSkill("one");
		const two = f.homeSkill("two");
		f.skills = [{ name: "one", path: one }, { name: "two", path: two }];
		f.clock = NOW - 2 * DAY;
		await f.prompt("one", one, "user");
		await f.prompt("two", two, "user");
		f.clock = NOW - DAY;
		await f.command("reset one");
		f.clock = NOW;

		const text = await f.output();
		expect(rowOf(text, "one")[4]).toBe("0 (0/0/0)");
		expect(rowOf(text, "two")[4]).toBe("1 (1/0/0)");
		expect(f.meta(f.globalDir).resetBySkill).toEqual({ one: new Date(NOW - DAY).toISOString() });
		expect(f.readUses(f.globalDir)).toHaveLength(2);
	});

	test("a declined confirmation changes nothing; an unknown skill is refused", async () => {
		const f = fixture();
		const file = f.homeSkill("tracked");
		await f.prompt("tracked", file, "user");
		const before = f.meta(f.globalDir);
		f.confirms.push(false);

		expect(await f.output("reset")).toBe("Reset cancelled.");
		expect(f.meta(f.globalDir)).toEqual(before);
		expect(await f.output("reset nothing")).toContain('No Global Skill named "nothing"');
		expect(f.meta(f.globalDir)).toEqual(before);
	});

	test("`reset <skill>` resets in the scope of that installed skill; `project reset` in the project store", async () => {
		const f = fixture();
		const projectOwned = f.projectSkill("proj");
		f.skills = [{ name: "proj", path: projectOwned }];
		await f.command("reset proj");
		const { resetBySkill } = f.meta(f.projectDir);
		expect(isRecord(resetBySkill) ? Object.keys(resetBySkill) : resetBySkill).toEqual(["proj"]);
		expect(existsSync(path.join(f.globalDir, "meta.json"))).toBe(false);

		await f.command("project reset");
		expect(typeof f.meta(f.projectDir).resetAll).toBe("string");
	});
});

type HistoryEnv = { project: string; sessionsRoot: string; homeSkill(name: string): string; projectSkill(name: string): string };

describe("/skill-stats import", () => {
	const line = (value: unknown) => `${JSON.stringify(value)}\n`;
	const header = (id: string, cwd: string, parentSession?: string) => line({ type: "session", version: 3, id, timestamp: "2026-09-01T00:00:00.000Z", cwd, ...(parentSession ? { parentSession } : {}) });
	const prompt = (id: string, at: string, name: string, file: string, attribution?: string) =>
		line({ type: "custom_message", customType: "skill-prompt", timestamp: at, details: { name, path: file }, ...(attribution ? { attribution } : {}), id });
	const start = (id: string, at: string, toolName: string, args: unknown) =>
		line({ type: "custom", customType: "tool_execution_start", data: { toolCallId: id, toolName, args }, id, timestamp: at });
	const putSession = (f: HistoryEnv, relative: string, content: string) => {
		const file = path.join(f.sessionsRoot, relative);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, content);
		return file;
	};
	const readImported = (dir: string): Use[] => readFileSync(path.join(dir, "imported.jsonl"), "utf8").trim().split("\n").map(item => JSON.parse(item) as Use);

	function history(f: HistoryEnv) {
		const global = f.homeSkill("gskill");
		const proj = f.projectSkill("pskill");
		const main = putSession(
			f,
			"--proj--/2026-09-01T00-00-00-000Z_main.jsonl",
			line({ type: "title", title: "", pad: "x".repeat(100_000) }) +
				header("sess-main", f.project) +
				prompt("e1", "2026-09-01T00:01:00.000Z", "gskill", global, "user") +
				start("e2", "2026-09-01T00:02:00.000Z", "read", { path: "skill://pskill/ref.md;skill://gskill" }) +
				start("e3", "2026-09-01T00:03:00.000Z", "bash", { command: "cat skill://nowhere/x" }) +
				start("e4", "2026-09-01T00:03:30.000Z", "grep", { pattern: "skill://gskill" }) +
				"not json but mentions skill://gskill\n",
		);
		const subagent = putSession(
			f,
			"--proj--/2026-09-01T00-00-00-000Z_main/Worker.jsonl",
			header("sess-sub", f.project, main) + prompt("s1", "2026-09-01T00:04:00.000Z", "gskill", global, "agent") + start("s2", "2026-09-01T00:05:00.000Z", "read", { path: "skill://pskill" }),
		);
		mkdirSync(path.join(f.sessionsRoot, "--proj--/2026-09-01T00-00-00-000Z_fork"), { recursive: true });
		copyFileSync(subagent, path.join(f.sessionsRoot, "--proj--/2026-09-01T00-00-00-000Z_fork/Worker.jsonl"));
		return { global, proj };
	}

	test("imports user, agent and subagent uses once, resolving paths and skipping duplicates and unresolved reads", async () => {
		const f = fixture();
		const { global, proj } = history(f);
		await f.prompt("pskill", proj, "user");
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");

		const report = await f.output("import");
		expect(report).toContain("Imported 5 Skill Uses from 3 session files (3 global, 2 project).");
		expect(report).toContain("1 unresolved");

		expect(sourcesOf(readImported(f.globalDir))).toEqual(["gskill:agent", "gskill:subagent", "gskill:user"]);
		expect(readImported(f.globalDir).every(use => use.path === global)).toBe(true);
		expect(sourcesOf(readImported(f.projectDir))).toEqual(["pskill:agent", "pskill:subagent"]);
		expect(readImported(f.projectDir).every(use => use.path === proj)).toBe(true);
		expect(readImported(f.globalDir).find(use => use.source === "subagent")!.session).toBe("sess-sub");
		expect(typeof f.meta(f.globalDir).importedAt).toBe("string");
		expect(typeof f.meta(f.projectDir).importedAt).toBe("string");

		const text = await f.output();
		expect(rowOf(text, "gskill")[4]).toBe("3 (1/1/1)");
		expect(await f.output("import")).toContain("already imported on 2026-10-23");
		expect(readImported(f.globalDir)).toHaveLength(3);
	});

	test("only imports history older than recordingStartedAt", async () => {
		const f = fixture();
		const { global } = history(f);
		f.clock = Date.parse("2026-09-01T00:02:30.000Z");
		await f.prompt("gskill", global, "user");
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");

		await f.command("import");
		expect(readImported(f.globalDir).map(use => use.at)).toEqual(["2026-09-01T00:01:00.000Z", "2026-09-01T00:02:00.000Z"]);
		expect(f.notices.at(-1)!.message).toContain("skipped (after recording started)");
	});

	test("creates the project store for a project that never recorded live, then lists the imported uses in its dashboard", async () => {
		const f = fixture();
		const { proj } = history(f);
		f.skills = [{ name: "pskill", path: proj }];
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");
		expect(existsSync(f.projectDir)).toBe(false);

		const report = await f.output("import");
		expect(report).toContain("Imported 5 Skill Uses from 3 session files (3 global, 2 project).");
		expect(readFileSync(path.join(f.projectDir, ".gitignore"), "utf8")).toBe("*\n");
		expect(sourcesOf(readImported(f.projectDir))).toEqual(["pskill:agent", "pskill:subagent"]);
		expect(rowOf(await f.output("project"), "pskill")[4]).toBe("2 (0/1/1)");
	});

	test("imports a user prompt and an agent read of a project skill into a project that has no store yet", async () => {
		const f = fixture();
		const file = f.projectSkill("proj-skill");
		f.skills = [{ name: "proj-skill", path: file }];
		putSession(
			f,
			"--proj--/2026-10-01T10-00-00-000Z_fixture-sess.jsonl",
			header("fixture-sess", f.project) + prompt("p1", "2026-10-01T10:01:00.000Z", "proj-skill", file, "user") + start("p2", "2026-10-01T10:02:00.000Z", "read", { path: "skill://proj-skill" }),
		);
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");

		const report = await f.output("import");
		expect(report).toContain("Imported 2 Skill Uses from 1 session files (0 global, 2 project).");
		expect(report).toContain("Skipped: none.");
		expect(readFileSync(path.join(f.projectDir, ".gitignore"), "utf8")).toBe("*\n");
		expect(sourcesOf(readImported(f.projectDir))).toEqual(["proj-skill:agent", "proj-skill:user"]);
	});

	test("skips Project Skill prompts whose project folder no longer exists and counts a read with no SKILL.md as unresolved", async () => {
		const f = fixture();
		const global = f.homeSkill("gskill");
		const proj = f.projectSkill("pskill");
		putSession(
			f,
			"--proj--/2026-09-01T00-00-00-000Z_global.jsonl",
			header("sess-global", f.project) + prompt("g1", "2026-09-01T00:01:00.000Z", "gskill", global, "user") + start("g2", "2026-09-01T00:02:00.000Z", "read", { path: "skill://gskill" }),
		);
		putSession(
			f,
			"--proj--/2026-09-01T00-00-00-000Z_project.jsonl",
			header("sess-project", f.project) + prompt("p1", "2026-09-01T00:03:00.000Z", "pskill", proj, "user") + prompt("p2", "2026-09-01T00:04:00.000Z", "pskill", proj, "agent"),
		);
		putSession(
			f,
			"--proj--/2026-09-01T00-00-00-000Z_read-only.jsonl",
			header("sess-read", f.project) + start("r1", "2026-09-01T00:05:00.000Z", "read", { path: "skill://pskill" }),
		);
		rmSync(f.project, { recursive: true });
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");

		const report = await f.output("import");
		expect(report).toBe(
			[
				"Imported 2 Skill Uses from 3 session files (2 global, 0 project).",
				"Skipped: 2 skipped (project folder missing), 1 unresolved (skill:// read with no SKILL.md found).",
			].join("\n"),
		);
		expect(sourcesOf(readImported(f.globalDir))).toEqual(["gskill:agent", "gskill:user"]);
		expect(existsSync(f.project)).toBe(false);
	});

	test("is all-or-nothing: a failing store leaves no imported file and no importedAt", async () => {
		const f = fixture();
		const { proj } = history(f);
		await f.prompt("pskill", proj, "user");
		mkdirSync(path.join(f.projectDir, "imported.jsonl"));
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");

		const report = await f.output("import");
		expect(report).toContain("Import failed; nothing was imported");
		expect(existsSync(path.join(f.globalDir, "imported.jsonl"))).toBe(false);
		expect(f.meta(f.globalDir).importedAt).toBeUndefined();
		expect(f.meta(f.projectDir).importedAt).toBeUndefined();

		rmSync(path.join(f.projectDir, "imported.jsonl"), { recursive: true });
		expect(await f.output("import")).toContain("Imported 5 Skill Uses");
	});

	test("reports usage for unknown arguments", async () => {
		const f = fixture();
		expect(await f.output("project import")).toStartWith("Usage: /skill-stats");
		expect(await f.output("bogus")).toStartWith("Usage: /skill-stats");
	});
});

describe("a project reached through a symlinked folder", () => {
	const linkedProject = (f: { root: string; project: string }) => {
		const link = path.join(f.root, "project-link");
		symlinkSync(f.project, link, "dir");
		return link;
	};

	test.each([
		["skill path via the link, resolver returns the real folder", true],
		["skill path via the real folder, resolver returns the link", false],
	])("live recording lists the skill in /skill-stats project: %s", async (_label, skillViaLink) => {
		const f = fixture();
		const link = linkedProject(f);
		const file = f.writeSkill(path.join(skillViaLink ? link : f.project, ".agents", "skills"), "linked-skill");
		f.skills = [{ name: "linked-skill", path: file }];
		f.projectRoot = skillViaLink ? f.project : link;

		await f.prompt("linked-skill", file, "user");
		await f.prompt("linked-skill", file, "agent");

		const text = await f.output("project");
		expect(table(text).map(cells => cells[0])).toEqual(["linked-skill"]);
		expect(rowOf(text, "linked-skill")[1]).toBe("npx-skills");
		expect(rowOf(text, "linked-skill")[4]).toBe("2 (1/1/0)");
		expect(f.readUses(f.projectDir).map(use => use.path)).toEqual([file, file]);
		expect(existsSync(path.join(f.globalDir, "uses.jsonl"))).toBe(false);
	});

	test("import writes one project store that the dashboard lists, whichever spelling the resolver returns", async () => {
		const f = fixture();
		const link = linkedProject(f);
		const file = f.writeSkill(path.join(link, ".agents", "skills"), "proj-skill");
		f.projectRoot = f.project;
		f.skills = [{ name: "proj-skill", path: file }];
		const prompt = (id: string, at: string, skillFile: string, attribution: string) =>
			`${JSON.stringify({ type: "custom_message", customType: "skill-prompt", timestamp: at, details: { name: "proj-skill", path: skillFile }, attribution, id })}\n`;
		const sessionFile = path.join(f.sessionsRoot, "--proj--", "2026-10-01T10-00-00-000Z_linked.jsonl");
		mkdirSync(path.dirname(sessionFile), { recursive: true });
		writeFileSync(
			sessionFile,
			`${JSON.stringify({ type: "session", version: 3, id: "linked", timestamp: "2026-10-01T10:00:00.000Z", cwd: link })}\n` +
				prompt("p1", "2026-10-01T10:01:00.000Z", file, "user") +
				prompt("p2", "2026-10-01T10:02:00.000Z", file, "agent"),
		);
		f.clock = Date.parse("2026-10-23T00:00:00.000Z");

		expect(await f.output("import")).toContain("Imported 2 Skill Uses from 1 session files (0 global, 2 project).");
		expect(readFileSync(path.join(f.globalDir, "imported.jsonl"), "utf8")).toBe("");
		expect(typeof f.meta(f.globalDir).importedAt).toBe("string");
		const imported = readFileSync(path.join(f.projectDir, "imported.jsonl"), "utf8").trim().split("\n");
		expect(imported.map(line => (JSON.parse(line) as Use).path)).toEqual([file, file]);

		const text = await f.output("project");
		expect(table(text).map(cells => cells[0])).toEqual(["proj-skill"]);
		expect(rowOf(text, "proj-skill")[4]).toBe("2 (1/1/0)");

		f.projectRoot = link;
		expect(rowOf(await f.output("project"), "proj-skill")[4]).toBe("2 (1/1/0)");
	});
});
