import { describe, expect, it } from "bun:test";
import pstackExtension from "./index.ts";

type Command = { description?: string; handler: (args: string, ctx: unknown) => unknown };

function createHarness(options: { hasUI?: boolean } = {}) {
	const commands = new Map<string, Command>();
	const notices: Array<{ level: string; message: string }> = [];
	const logs: Array<{ level: string; message: string }> = [];
	const log = (level: string) => (message: string) => void logs.push({ level, message });
	const pi = {
		registerCommand: (name: string, command: Command) => void commands.set(name, command),
		logger: { info: log("info"), warn: log("warn"), error: log("error") },
	};
	const ctx = {
		hasUI: options.hasUI ?? true,
		ui: { notify: (message: string, level: string) => void notices.push({ level, message }) },
	};
	pstackExtension(pi as never);
	return { commands, notices, logs, command: (args = "") => commands.get("pstack")!.handler(args, ctx) };
}

describe("/pstack", () => {
	it("is registered with a description", () => {
		expect(createHarness().commands.get("pstack")?.description).toBeTruthy();
	});

	it("status reports pstack inactive", async () => {
		const h = createHarness();
		await h.command("status");
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]?.level).toBe("info");
		expect(h.notices[0]?.message).toContain("inactive");
	});

	it("bare /pstack is status", async () => {
		const h = createHarness();
		await h.command("");
		expect(h.notices[0]?.message).toContain("inactive");
	});

	it("falls back to the logger without a UI", async () => {
		const h = createHarness({ hasUI: false });
		await h.command("status");
		expect(h.notices).toEqual([]);
		expect(h.logs[0]?.level).toBe("info");
		expect(h.logs[0]?.message).toContain("inactive");
	});

	it("rejects an unknown subcommand with a warning and no status", async () => {
		const h = createHarness();
		await h.command("bogus");
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]?.level).toBe("warning");
		expect(h.notices[0]?.message).not.toContain("inactive");
	});
});
