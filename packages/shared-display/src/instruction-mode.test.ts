import { describe, expect, it } from "bun:test";
import { INSTRUCTION_MODE_SUSPENSION_CHANNEL, isSuspensionFor, onInstructionModeSuspension, suspendInstructionModes } from "./instruction-mode.ts";

function bus() {
	const handlers: Array<(data: unknown) => void> = [];
	return {
		emit: (_channel: string, data: unknown) => handlers.forEach(handler => handler(data)),
		on: (_channel: string, handler: (data: unknown) => void) => {
			handlers.push(handler);
			return () => void handlers.splice(handlers.indexOf(handler), 1);
		},
	};
}

describe("instruction mode suspension", () => {
	it("reaches only the modes it names", () => {
		const events = bus();
		const seen: string[] = [];
		onInstructionModeSuspension(events, "caveman", () => seen.push("caveman"));
		onInstructionModeSuspension(events, "ponytail", () => seen.push("ponytail"));
		suspendInstructionModes(events, "pstack", ["ponytail"]);
		expect(seen).toEqual(["ponytail"]);
	});

	it("emits nothing for an empty list", () => {
		const emitted: unknown[] = [];
		suspendInstructionModes({ emit: (_channel, data) => void emitted.push(data) }, "pstack", []);
		expect(emitted).toEqual([]);
	});

	it("carries the source of the plugin that asked", () => {
		const emitted: unknown[] = [];
		suspendInstructionModes({ emit: (_channel, data) => void emitted.push(data) }, "workflow-x", ["caveman"]);
		expect(emitted).toEqual([{ protocol: 1, source: "workflow-x", modes: ["caveman"] }]);
	});

	it("ignores unknown protocol versions and malformed payloads", () => {
		expect(isSuspensionFor({ protocol: 1, modes: ["caveman"] }, "caveman")).toBe(true);
		for (const data of [{ protocol: 2, modes: ["caveman"] }, { protocol: 1, modes: "caveman" }, { protocol: 1 }, null, "caveman"]) {
			expect(isSuspensionFor(data, "caveman")).toBe(false);
		}
	});

	it("stops after unsubscribe", () => {
		const events = bus();
		let calls = 0;
		const stop = onInstructionModeSuspension(events, "caveman", () => void calls++);
		stop();
		suspendInstructionModes(events, "pstack", ["caveman"]);
		expect(calls).toBe(0);
		expect(INSTRUCTION_MODE_SUSPENSION_CHANNEL).toContain("/v1");
	});
});
