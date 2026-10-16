import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CODESOOK_OMP_CONFIG_CHANGED } from "@codesook/omp-shared-display/config-store";
import { DEFAULT_PSTACK_BEHAVIOR, createBehaviorStore } from "./behavior.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function configFile(content?: unknown): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-behavior-"));
	roots.push(root);
	const file = path.join(root, "config.json");
	if (content !== undefined) fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
	return file;
}

function bus() {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on: (channel: string, handler: (data: unknown) => void) => {
			handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
			return () => void handlers.set(channel, (handlers.get(channel) ?? []).filter(other => other !== handler));
		},
		emit: (channel: string, data: unknown) => void (handlers.get(channel) ?? []).forEach(handler => handler(data)),
	};
}

const root = (pstack?: unknown) => ({ version: 1, display: {}, behavior: pstack === undefined ? {} : { pstack } });

describe("Behavior Configuration reader", () => {
	it("defaults every field when the root config does not exist", () => {
		const store = createBehaviorStore(bus(), { configPath: configFile() });
		expect(store.current()).toEqual({
			suspendCaveman: true,
			suspendPonytail: true,
			maxPanelSize: 5,
			guardStrictness: "block-and-warn",
		});
	});

	it("defaults every field when the root config has no pstack section", () => {
		const store = createBehaviorStore(bus(), { configPath: configFile(root()) });
		expect(store.current()).toEqual(DEFAULT_PSTACK_BEHAVIOR);
	});

	it("reads each saved field", () => {
		const saved = { suspendCaveman: false, suspendPonytail: false, maxPanelSize: 2, guardStrictness: "warn-only" as const };
		const store = createBehaviorStore(bus(), { configPath: configFile(root(saved)) });
		expect(store.current()).toEqual(saved);
	});

	it("falls back per field: one invalid value keeps the others", () => {
		const saved = { suspendCaveman: false, suspendPonytail: "yes", maxPanelSize: 3, guardStrictness: "loud" };
		const store = createBehaviorStore(bus(), { configPath: configFile(root(saved)) });
		expect(store.current()).toEqual({ ...DEFAULT_PSTACK_BEHAVIOR, suspendCaveman: false, maxPanelSize: 3 });
	});

	it("rejects panel sizes outside 1 to 5 and non-integers, accepts the bounds", () => {
		for (const bad of [0, 6, -1, 2.5, "3", null, Number.NaN]) {
			const store = createBehaviorStore(bus(), { configPath: configFile(root({ maxPanelSize: bad })) });
			expect(store.current().maxPanelSize).toBe(5);
		}
		for (const good of [1, 5]) {
			const store = createBehaviorStore(bus(), { configPath: configFile(root({ maxPanelSize: good })) });
			expect(store.current().maxPanelSize).toBe(good);
		}
	});

	it("accepts every guard strictness level", () => {
		for (const level of ["block-and-warn", "warn-only", "off"] as const) {
			const store = createBehaviorStore(bus(), { configPath: configFile(root({ guardStrictness: level })) });
			expect(store.current().guardStrictness).toBe(level);
		}
	});

	it("uses defaults and warns when the file is unparseable", () => {
		const warnings: string[] = [];
		const store = createBehaviorStore(bus(), { configPath: configFile("{ nope"), onWarning: message => warnings.push(message) });
		expect(store.current()).toEqual(DEFAULT_PSTACK_BEHAVIOR);
		expect(warnings).toHaveLength(1);
	});

	it("does not warn when the file is missing", () => {
		const warnings: string[] = [];
		createBehaviorStore(bus(), { configPath: configFile(), onWarning: message => warnings.push(message) });
		expect(warnings).toEqual([]);
	});

	it("returns a copy: callers cannot mutate the live settings", () => {
		const store = createBehaviorStore(bus(), { configPath: configFile() });
		store.current().maxPanelSize = 1;
		expect(store.current().maxPanelSize).toBe(5);
	});

	it("updates live on the config-changed event", () => {
		const events = bus();
		const store = createBehaviorStore(events, { configPath: configFile() });
		events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: root({ maxPanelSize: 2, guardStrictness: "off" }) });
		expect(store.current()).toEqual({ ...DEFAULT_PSTACK_BEHAVIOR, maxPanelSize: 2, guardStrictness: "off" });
	});

	it("resets a field removed from the saved config to its default on the next event", () => {
		const events = bus();
		const store = createBehaviorStore(events, { configPath: configFile(root({ suspendCaveman: false })) });
		events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: root() });
		expect(store.current().suspendCaveman).toBe(true);
	});

	it("ignores a config-changed payload that is not a root document", () => {
		const events = bus();
		const store = createBehaviorStore(events, { configPath: configFile(root({ maxPanelSize: 2 })) });
		for (const payload of [undefined, "x", {}, { config: null }, { config: { version: 2, display: {}, behavior: {} } }]) {
			events.emit(CODESOOK_OMP_CONFIG_CHANGED, payload);
		}
		expect(store.current().maxPanelSize).toBe(2);
	});

	it("stops listening after dispose", () => {
		const events = bus();
		const store = createBehaviorStore(events, { configPath: configFile() });
		store.dispose();
		events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: root({ maxPanelSize: 1 }) });
		expect(store.current().maxPanelSize).toBe(5);
	});

	it("reload picks up a file changed on disk", () => {
		const file = configFile(root({ maxPanelSize: 4 }));
		const store = createBehaviorStore(bus(), { configPath: file });
		fs.writeFileSync(file, JSON.stringify(root({ maxPanelSize: 1 })));
		store.reload();
		expect(store.current().maxPanelSize).toBe(1);
	});
});
