import { expect, test } from "bun:test";
import { RTK_INVOCATION, detectRtk, guardReason, rewriteCommand, withSessionEnv, type RtkExec } from "./rewrite.ts";

test("guards skip commands whose output rtk must not filter", () => {
	const table: [command: string, reason: string | undefined][] = [
		["git status", undefined],
		["cargo test", undefined],
		["cd app && git log -5", undefined],
		["rtk git status", "already-rtk"],
		["cd app; rtk git status", "already-rtk"],
		["RTK_DISABLED=1 git status", "rtk-disabled"],
		["git status | head", "pipe"],
		["git status\ngit log", "multiline"],
		["cat <<EOF > x", "heredoc"],
		["python - <<EOF", "heredoc"],
		["FOO=1 cargo test", "env-assignment"],
		["cat README.md", "read-like"],
		["head -n 5 file", "read-like"],
		["sed -n 1,5p file", "read-like"],
		["cd app && tail -f log", "read-like"],
		["git diff", "git-diff"],
		["git -C app show HEAD", "git-diff"],
		["npx vitest run", "js-test-runner"],
		["jest --ci", "js-test-runner"],
		["go test -v ./...", "test-detail"],
		["cargo test -- --list", "test-detail"],
		["go test -fuzz=FuzzX", "test-detail"],
		["pytest --verbose", "test-detail"],
		["ssh host", "long-lived"],
		["bun run dev", "long-lived"],
		["npm run dev", "long-lived"],
		["pnpm dev", "long-lived"],
		["bun test --watch", "long-lived"],
		["htop", "long-lived"],
		["vim file", "long-lived"],
		["ls -v", undefined],
	];
	for (const [command, reason] of table) expect([command, guardReason(command)]).toEqual([command, reason]);
});

test("RTK_INVOCATION matches the commands Headroom must not compress", () => {
	expect(RTK_INVOCATION.test("export RTK_DB_PATH='/x'; export RTK_RECALL_DB='/y'; rtk git status")).toBe(true);
	expect(RTK_INVOCATION.test("cd a && rtk cargo test")).toBe(true);
	expect(RTK_INVOCATION.test("echo rtkfoo")).toBe(false);
});

const exec = (code: number, stdout: string): RtkExec => async () => ({ code, stdout });

test("rewrite accepts exit 0 and 3 only with a single-line, changed result", async () => {
	expect(await rewriteCommand(exec(0, "rtk git status\n"), "git status")).toEqual({ kind: "rewritten", command: "rtk git status" });
	expect(await rewriteCommand(exec(3, "rtk cargo test\n"), "cargo test")).toEqual({ kind: "rewritten", command: "rtk cargo test" });
	for (const code of [1, 2, 4]) expect(await rewriteCommand(exec(code, "rtk git status\n"), "git status")).toEqual({ kind: "unchanged" });
	expect(await rewriteCommand(exec(0, ""), "git status")).toEqual({ kind: "unchanged" });
	expect(await rewriteCommand(exec(0, "git status\n"), "git status")).toEqual({ kind: "unchanged" });
	expect(await rewriteCommand(exec(0, "rtk a\nrtk b\n"), "a; b")).toEqual({ kind: "unchanged" });
	expect(await rewriteCommand(async () => { throw new Error("ENOENT"); }, "git status")).toEqual({ kind: "unchanged" });
});

test("guarded commands never reach rtk rewrite", async () => {
	let calls = 0;
	const counting: RtkExec = async () => { calls++; return { code: 0, stdout: "rtk x" }; };
	expect(await rewriteCommand(counting, "git diff")).toEqual({ kind: "skipped", reason: "git-diff" });
	expect(calls).toBe(0);
});

test("session env quotes paths and applies to every later segment", () => {
	expect(withSessionEnv("rtk a && rtk b", "/t/it's/history.db", "/t/recall.db")).toBe(
		"export RTK_DB_PATH='/t/it'\\''s/history.db'; export RTK_RECALL_DB='/t/recall.db'; rtk a && rtk b",
	);
});

test("detectRtk requires 0.51.0 or newer", async () => {
	expect(await detectRtk(exec(0, "rtk 0.51.0\n"))).toBe("0.51.0");
	expect(await detectRtk(exec(0, "rtk 0.60.2\n"))).toBe("0.60.2");
	expect(await detectRtk(exec(0, "rtk 1.0.0\n"))).toBe("1.0.0");
	expect(await detectRtk(exec(0, "rtk 0.50.9\n"))).toBeUndefined();
	expect(await detectRtk(exec(127, ""))).toBeUndefined();
	expect(await detectRtk(async () => { throw new Error("ENOENT"); })).toBeUndefined();
});
