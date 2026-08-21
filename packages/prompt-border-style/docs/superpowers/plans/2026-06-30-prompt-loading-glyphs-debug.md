# Prompt Loading Glyphs Debug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/prompt-loading-glyphs` debug command that explains adapted spinner frames, runs a local no-token spinner demo, and provides a session-only loading-glyph debug toggle.

**Architecture:** Keep all loading-glyph debug behavior in `src/main.ts`, next to the existing spinner adaptation logic and slash-command registration. Reuse `buildTimedSpinnerFrames()` as the single source of truth, add pure helper functions for debug snapshots/formatting/parsing, and mount the demo as a session-local widget so normal prompt editing remains intact.

**Tech Stack:** Bun test runner, TypeScript, `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-tui`

## Global Constraints

- Keep `/prompt-border` focused on border styling; the new debug surface must be `/prompt-loading-glyphs`.
- Do not change the `buildTimedSpinnerFrames()` adaptation algorithm or Oh My Pi’s fixed 80ms host tick assumption.
- Keep all debug state session-local; do not persist debug flags to `~/.config/codesook-omp/config.json`.
- Cover both spinner groups: `status` and `activity`.
- Prefer deterministic unit tests over timing-heavy animation assertions.
- Verify implementation with `bun test src/main.test.ts` and `bun run check`.

---

## File Structure

- `src/main.ts`
  - Owns spinner frame adaptation, command parsing, command registration, widget lifecycle, and session state.
  - Add pure debug-report helpers, `/prompt-loading-glyphs` argument parsing/completions, and session-local debug/demo runtime.
- `src/main.test.ts`
  - Add parser/completion/report tests plus session runtime tests for widget/debug cleanup.
- `README.md`
  - Document the new `/prompt-loading-glyphs` command family and how to use it to debug frame skipping/jumping.

### Task 1: Add pure loading-glyph debug helpers and command parsing

**Files:**
- Modify: `src/main.ts:83-145,495-520`
- Test: `src/main.test.ts:88-141`

**Interfaces:**
- Consumes: `buildTimedSpinnerFrames(frames: readonly string[], frameMs: number, hostFrameMs?: number): string[]`
- Produces:
  - `type PromptLoadingGlyphDebugAction = { kind: "frames" } | { kind: "demo" } | { kind: "on" } | { kind: "off" } | { kind: "invalid" }`
  - `type SpinnerFrameDebugMode = "empty" | "unchanged" | "repeated" | "skipped"`
  - `type SpinnerFrameDebugReport = { type: SpinnerType; frameMs: number; sourceFrames: readonly string[]; visibleFrames: readonly string[]; mode: SpinnerFrameDebugMode }`
  - `parsePromptLoadingGlyphArgs(args: string): PromptLoadingGlyphDebugAction`
  - `getPromptLoadingGlyphArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null`
  - `createSpinnerFrameDebugReport(type: SpinnerType, config: SpinnerGlyphFrameOverride): SpinnerFrameDebugReport`
  - `formatSpinnerFrameDebugReport(report: SpinnerFrameDebugReport): string`

- [ ] **Step 1: Write the failing tests for the new parser and report helpers**

```ts
// src/main.test.ts
import promptBorderStyle, {
	buildTimedSpinnerFrames,
	createSpinnerFrameDebugReport,
	formatSpinnerFrameDebugReport,
	getPromptLoadingGlyphArgumentCompletions,
	parseGlyphFrames,
	parsePromptBorderArgs,
	parsePromptLoadingGlyphArgs,
} from "./main";

describe("parsePromptLoadingGlyphArgs", () => {
	test("accepts debug frames", () => {
		expect(parsePromptLoadingGlyphArgs("debug frames")).toEqual({ kind: "frames" });
	});

	test("accepts debug demo", () => {
		expect(parsePromptLoadingGlyphArgs("debug demo")).toEqual({ kind: "demo" });
	});

	test("accepts debug on and off", () => {
		expect(parsePromptLoadingGlyphArgs("debug on")).toEqual({ kind: "on" });
		expect(parsePromptLoadingGlyphArgs("debug off")).toEqual({ kind: "off" });
	});

	test("rejects unknown loading glyph commands", () => {
		expect(parsePromptLoadingGlyphArgs("debug wobble")).toEqual({ kind: "invalid" });
	});
});

describe("getPromptLoadingGlyphArgumentCompletions", () => {
	test("offers the debug subcommand at the root", () => {
		expect(getPromptLoadingGlyphArgumentCompletions("")).toEqual([
			{ value: "debug", label: "debug" },
		]);
	});

	test("offers debug actions after the subcommand", () => {
		expect(getPromptLoadingGlyphArgumentCompletions("debug ")).toEqual([
			{ value: "debug frames", label: "frames" },
			{ value: "debug demo", label: "demo" },
			{ value: "debug on", label: "on" },
			{ value: "debug off", label: "off" },
		]);
	});
});

test("reports skipped frames for a 20ms activity spinner", () => {
	const report = createSpinnerFrameDebugReport("activity", {
		frames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"],
		frameMs: 20,
	});

	expect(report).toEqual({
		type: "activity",
		frameMs: 20,
		sourceFrames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"],
		visibleFrames: ["F0", "F4"],
		mode: "skipped",
	});
});

test("formats a frame debug report with the visible subsequence note", () => {
	const formatted = formatSpinnerFrameDebugReport({
		type: "activity",
		frameMs: 20,
		sourceFrames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"],
		visibleFrames: ["F0", "F4"],
		mode: "skipped",
	});

	expect(formatted).toContain("Prompt loading glyphs: activity");
	expect(formatted).toContain("visible (2): F0 F4");
	expect(formatted).toContain("mode: skips source frames to match 80ms host tick");
	expect(formatted).toContain("visible subsequence");
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail for the expected reason**

Run: `bun test src/main.test.ts --test-name-pattern "PromptLoadingGlyph|reports skipped frames|formats a frame debug report"`

Expected: FAIL with missing exports or missing functions such as `parsePromptLoadingGlyphArgs` / `createSpinnerFrameDebugReport`.

- [ ] **Step 3: Add the minimal helper and parser implementations in `src/main.ts`**

```ts
// src/main.ts
const LOADING_GLYPH_DEBUG_ROOT_OPTIONS = ["debug"] as const;
const LOADING_GLYPH_DEBUG_ACTIONS = ["frames", "demo", "on", "off"] as const;

export type PromptLoadingGlyphDebugAction =
	| { kind: "frames" }
	| { kind: "demo" }
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "invalid" };

export type SpinnerFrameDebugMode = "empty" | "unchanged" | "repeated" | "skipped";

export type SpinnerFrameDebugReport = {
	type: SpinnerType;
	frameMs: number;
	sourceFrames: readonly string[];
	visibleFrames: readonly string[];
	mode: SpinnerFrameDebugMode;
};

export function parsePromptLoadingGlyphArgs(args: string): PromptLoadingGlyphDebugAction {
	const parts = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (parts.length === 2 && parts[0] === "debug") {
		if (parts[1] === "frames") return { kind: "frames" };
		if (parts[1] === "demo") return { kind: "demo" };
		if (parts[1] === "on") return { kind: "on" };
		if (parts[1] === "off") return { kind: "off" };
	}
	return { kind: "invalid" };
}

export function getPromptLoadingGlyphArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.toLowerCase();
	const hasTrailingSpace = /\s$/.test(normalized);
	const parts = normalized.trim().split(/\s+/u).filter(Boolean);
	const tokenPrefix = hasTrailingSpace ? "" : (parts.at(-1) ?? "");
	if (parts.length === 0) return [{ value: "debug", label: "debug" }];
	if (parts.length === 1) {
		if (!hasTrailingSpace) {
			return LOADING_GLYPH_DEBUG_ROOT_OPTIONS
				.filter(option => option.startsWith(tokenPrefix))
				.map(option => ({ value: option, label: option }));
		}
		if (parts[0] === "debug") {
			return LOADING_GLYPH_DEBUG_ACTIONS.map(action => ({ value: `debug ${action}`, label: action }));
		}
	}
	if (parts[0] === "debug" && parts.length === 2 && !hasTrailingSpace) {
		return LOADING_GLYPH_DEBUG_ACTIONS
			.filter(action => action.startsWith(tokenPrefix))
			.map(action => ({ value: `debug ${action}`, label: action }));
	}
	return null;
}

export function createSpinnerFrameDebugReport(type: SpinnerType, config: SpinnerGlyphFrameOverride): SpinnerFrameDebugReport {
	const visibleFrames = buildTimedSpinnerFrames(config.frames, config.frameMs);
	const mode: SpinnerFrameDebugMode =
		config.frames.length === 0 ? "empty"
		: visibleFrames.length === 0 || visibleFrames.length === config.frames.length && visibleFrames.every((frame, index) => frame === config.frames[index]) ? "unchanged"
		: visibleFrames.length > config.frames.length ? "repeated"
		: "skipped";
	return {
		type,
		frameMs: config.frameMs,
		sourceFrames: Array.from(config.frames),
		visibleFrames,
		mode,
	};
}

export function formatSpinnerFrameDebugReport(report: SpinnerFrameDebugReport): string {
	const modeLine =
		report.mode === "repeated" ? "mode: repeats frames to match 80ms host tick"
		: report.mode === "skipped" ? "mode: skips source frames to match 80ms host tick"
		: report.mode === "empty" ? "mode: no configured frames; host defaults will render"
		: "mode: keeps frames unchanged at 80ms host tick";
	const note = report.mode === "skipped"
		? "note: smooth looping must hold on the visible subsequence, not only the full source list"
		: undefined;
	return [
		`Prompt loading glyphs: ${report.type}`,
		`frameMs: ${report.frameMs}`,
		`source (${report.sourceFrames.length}): ${report.sourceFrames.join(" ") || "<empty>"}`,
		`visible (${report.visibleFrames.length}): ${report.visibleFrames.join(" ") || "<host defaults>"}`,
		modeLine,
		note,
	].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `bun test src/main.test.ts --test-name-pattern "PromptLoadingGlyph|reports skipped frames|formats a frame debug report"`

Expected: PASS.

- [ ] **Step 5: Commit the helper/parser slice**

Run:

```bash
git add src/main.ts src/main.test.ts
git commit -m ":sparkles: feat(debug): add loading glyph debug helpers"
```

### Task 2: Add `/prompt-loading-glyphs debug frames`

**Files:**
- Modify: `src/main.ts:989-1035`
- Test: `src/main.test.ts:705-820`

**Interfaces:**
- Consumes:
  - `parsePromptLoadingGlyphArgs(args: string): PromptLoadingGlyphDebugAction`
  - `createSpinnerFrameDebugReport(type: SpinnerType, config: SpinnerGlyphFrameOverride): SpinnerFrameDebugReport`
  - `formatSpinnerFrameDebugReport(report: SpinnerFrameDebugReport): string`
- Produces:
  - registered command `prompt-loading-glyphs`
  - handler path for `{ kind: "frames" }` that uses `ctx.ui.notify()` with a multi-line report for both spinner groups

- [ ] **Step 1: Write the failing runtime test for the `debug frames` command**

```ts
// src/main.test.ts

test("prompt-loading-glyphs debug frames reports adapted status and activity frames", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-loading-glyphs-"));
	const configPath = path.join(dir, "config.json");
	await Bun.write(configPath, JSON.stringify({
		promptBorder: {
			style: "double",
			layout: "full",
			spinnerGlyphs: {
				status: { frameMs: 80 },
				activity: { frameMs: 20 },
			},
		},
	}, null, 2));
	await Bun.write(path.join(dir, "prompt-border-left-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-right-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-status-spinner-glyphs.txt"), "S0  S1");
	await Bun.write(path.join(dir, "prompt-border-activity-spinner-glyphs.txt"), "F0  F1  F2  F3  F4  F5  F6  F7");

	let commandHandler: ((args: string, ctx: { hasUI: true; ui: { theme: { getSpinnerFrames: (type?: string) => string[] }; notify: (message: string, level?: string) => void; setEditorComponent: (value: unknown) => void } }) => Promise<void>) | undefined;
	const notifications: string[] = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;

	promptBorderStyle(pi, configPath);
	await commandHandler?.("debug frames", {
		hasUI: true,
		ui: {
			theme: { getSpinnerFrames: () => ["unused"] },
			notify: message => notifications.push(message),
			setEditorComponent: () => {},
		},
	});

	expect(notifications.at(-1)).toContain("Prompt loading glyphs: status");
	expect(notifications.at(-1)).toContain("Prompt loading glyphs: activity");
	expect(notifications.at(-1)).toContain("visible (2): F0 F4");
});
```

- [ ] **Step 2: Run the targeted command test and confirm it fails**

Run: `bun test src/main.test.ts --test-name-pattern "debug frames reports adapted"`

Expected: FAIL because the `prompt-loading-glyphs` command is not yet registered or because `debug frames` is treated as invalid.

- [ ] **Step 3: Register the new command and implement the `frames` branch minimally**

```ts
// src/main.ts
const PROMPT_LOADING_GLYPHS_USAGE = "Usage: /prompt-loading-glyphs debug <frames|demo|on|off>";

function formatAllSpinnerFrameDebugReports(config: PromptBorderConfig): string {
	return [
		formatSpinnerFrameDebugReport(createSpinnerFrameDebugReport("status", config.spinnerGlyphs.status)),
		formatSpinnerFrameDebugReport(createSpinnerFrameDebugReport("activity", config.spinnerGlyphs.activity)),
	].join("\n\n");
}

// inside promptBorderStyle()
pi.registerCommand("prompt-loading-glyphs", {
	description: "Debug prompt loading glyph adaptation",
	getArgumentCompletions: getPromptLoadingGlyphArgumentCompletions,
	handler: async (args, ctx) => {
		if (!ctx.hasUI) return;
		activeConfig = await ensurePromptBorderConfigFile(configPath);
		applySpinnerGlyphFrames(ctx.ui.theme, activeConfig);
		notifyInvalidConfig(ctx);
		const action = parsePromptLoadingGlyphArgs(args);
		if (action.kind === "invalid") {
			ctx.ui.notify(PROMPT_LOADING_GLYPHS_USAGE, "warning");
			return;
		}
		if (action.kind === "frames") {
			ctx.ui.notify(formatAllSpinnerFrameDebugReports(activeConfig), "info");
			return;
		}
		ctx.ui.notify("Loading glyph debug action not implemented yet", "warning");
	},
});
```

- [ ] **Step 4: Run the targeted command test again to verify it passes**

Run: `bun test src/main.test.ts --test-name-pattern "debug frames reports adapted"`

Expected: PASS.

- [ ] **Step 5: Commit the command/report slice**

Run:

```bash
git add src/main.ts src/main.test.ts
git commit -m ":sparkles: feat(debug): add loading glyph frame report command"
```

### Task 3: Add the no-token demo widget and session-only debug toggle

**Files:**
- Modify: `src/main.ts:1-13,480-493,989-1035`
- Test: `src/main.test.ts:705-822`

**Interfaces:**
- Consumes:
  - `createSpinnerFrameDebugReport(type: SpinnerType, config: SpinnerGlyphFrameOverride): SpinnerFrameDebugReport`
  - `parsePromptLoadingGlyphArgs(args: string): PromptLoadingGlyphDebugAction`
- Produces:
  - session-local booleans and cleanup for loading glyph debug state
  - `renderPromptLoadingGlyphDebugWidget(...)` mounted via `ctx.ui.setWidget("prompt-loading-glyphs-debug", ...)`
  - command branches for `debug demo`, `debug on`, and `debug off`

- [ ] **Step 1: Write the failing tests for demo mount, toggle, and shutdown cleanup**

```ts
// src/main.test.ts

test("prompt-loading-glyphs debug demo mounts a widget without calling the model", async () => {
	let commandHandler: ((args: string, ctx: {
		hasUI: true;
		ui: {
			theme: { getSpinnerFrames: (type?: string) => string[] };
			notify: (message: string, level?: string) => void;
			setEditorComponent: (value: unknown) => void;
			setWidget: (key: string, value: unknown) => void;
			setWorkingMessage: (message?: string) => void;
		};
	}) => Promise<void>) | undefined;
	const widgetCalls: Array<{ key: string; value: unknown }> = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;

	promptBorderStyle(pi);
	await commandHandler?.("debug demo", {
		hasUI: true,
		ui: {
			theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
			notify: () => {},
			setEditorComponent: () => {},
			setWidget: (key, value) => widgetCalls.push({ key, value }),
			setWorkingMessage: () => {},
		},
	});

	expect(widgetCalls.at(-1)?.key).toBe("prompt-loading-glyphs-debug");
	expect(widgetCalls.at(-1)?.value).toBeTruthy();
});

test("prompt-loading-glyphs debug on and off set and clear the working message", async () => {
	let commandHandler: ((args: string, ctx: {
		hasUI: true;
		ui: {
			theme: { getSpinnerFrames: (type?: string) => string[] };
			notify: (message: string, level?: string) => void;
			setEditorComponent: (value: unknown) => void;
			setWidget: (key: string, value: unknown) => void;
			setWorkingMessage: (message?: string) => void;
		};
	}) => Promise<void>) | undefined;
	const workingMessages: Array<string | undefined> = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;

	promptBorderStyle(pi);
	const ui = {
		theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
		notify: () => {},
		setEditorComponent: () => {},
		setWidget: () => {},
		setWorkingMessage: (message?: string) => workingMessages.push(message),
	};

	await commandHandler?.("debug on", { hasUI: true, ui });
	await commandHandler?.("debug off", { hasUI: true, ui });

	expect(workingMessages.at(0)).toContain("[");
	expect(workingMessages.at(-1)).toBeUndefined();
});
```

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `bun test src/main.test.ts --test-name-pattern "debug demo mounts|debug on and off"`

Expected: FAIL because the demo widget and debug toggle branches do not yet exist.

- [ ] **Step 3: Implement session-local widget and debug toggle with explicit cleanup**

```ts
// src/main.ts
import { Box, Loader, Text } from "@oh-my-pi/pi-tui";

let promptLoadingGlyphDebugEnabled = false;
let promptLoadingGlyphDebugMounted = false;

function buildPromptLoadingGlyphDebugMessage(config: PromptBorderConfig): string {
	const statusReport = createSpinnerFrameDebugReport("status", config.spinnerGlyphs.status);
	const activityReport = createSpinnerFrameDebugReport("activity", config.spinnerGlyphs.activity);
	return `[status ${statusReport.visibleFrames.length}/${statusReport.sourceFrames.length}] [activity ${activityReport.visibleFrames.length}/${activityReport.sourceFrames.length}] Working…`;
}

function clearPromptLoadingGlyphDebugUi(ctx: { ui: Pick<ExtensionUIContext, "setWidget" | "setWorkingMessage"> }): void {
	ctx.ui.setWidget("prompt-loading-glyphs-debug", undefined);
	ctx.ui.setWorkingMessage();
	promptLoadingGlyphDebugMounted = false;
}

function mountPromptLoadingGlyphDebugWidget(ctx: { ui: Pick<ExtensionUIContext, "setWidget" | "theme"> }, config: PromptBorderConfig): void {
	ctx.ui.setWidget("prompt-loading-glyphs-debug", (_tui, theme) => {
		const box = new Box(1, 0);
		box.addChild(new Text("Prompt loading glyphs demo", 0, 0));
		box.addChild(new Loader(_tui, value => value, value => value, "Working…", buildTimedSpinnerFrames(config.spinnerGlyphs.status.frames, config.spinnerGlyphs.status.frameMs)));
		box.addChild(new Loader(_tui, value => value, value => value, "Working…", buildTimedSpinnerFrames(config.spinnerGlyphs.activity.frames, config.spinnerGlyphs.activity.frameMs)));
		return box;
	});
	promptLoadingGlyphDebugMounted = true;
}

// inside session_shutdown
clearPromptLoadingGlyphDebugUi(ctx);
promptLoadingGlyphDebugEnabled = false;

// inside prompt-loading-glyphs handler
if (action.kind === "demo") {
	mountPromptLoadingGlyphDebugWidget(ctx, activeConfig);
	ctx.ui.notify("Prompt loading glyph demo enabled", "info");
	return;
}
if (action.kind === "on") {
	promptLoadingGlyphDebugEnabled = true;
	ctx.ui.setWorkingMessage(buildPromptLoadingGlyphDebugMessage(activeConfig));
	ctx.ui.notify("Prompt loading glyph debug enabled", "info");
	return;
}
if (action.kind === "off") {
	promptLoadingGlyphDebugEnabled = false;
	clearPromptLoadingGlyphDebugUi(ctx);
	ctx.ui.notify("Prompt loading glyph debug disabled", "info");
	return;
}
```

- [ ] **Step 4: Re-run the targeted tests for the demo/toggle behavior**

Run: `bun test src/main.test.ts --test-name-pattern "debug demo mounts|debug on and off"`

Expected: PASS.

- [ ] **Step 5: Run the full project test and typecheck gates for the runtime slice**

Run:
- `bun test src/main.test.ts`
- `bun run check`

Expected: both PASS.

- [ ] **Step 6: Commit the demo/toggle slice**

Run:

```bash
git add src/main.ts src/main.test.ts
git commit -m ":sparkles: feat(debug): add loading glyph demo and toggle"
```

### Task 4: Document the command and finish verification

**Files:**
- Modify: `README.md:49-55,138-154`
- Test: `src/main.test.ts` (no new test file)

**Interfaces:**
- Consumes:
  - `/prompt-loading-glyphs debug frames`
  - `/prompt-loading-glyphs debug demo`
  - `/prompt-loading-glyphs debug on`
  - `/prompt-loading-glyphs debug off`
- Produces:
  - updated README command docs and debugging guidance for frame jumps at fast `frameMs`

- [ ] **Step 1: Add a README example for debugging jumps at 20ms**

```md
## Debugging loading glyphs

Use the dedicated loading-glyph debug command instead of spending model tokens:

```text
/prompt-loading-glyphs debug frames
/prompt-loading-glyphs debug demo
/prompt-loading-glyphs debug on
/prompt-loading-glyphs debug off
```

`debug frames` shows the visible subsequence after `frameMs` adaptation. For example, with `frameMs = 20` a source list such as `F0 F1 F2 F3 F4 F5 F6 F7` may render as `F0 F4`, so the loop must stay smooth on that visible subsequence rather than only on the full source list.
```

- [ ] **Step 2: Run the existing project verification commands after the README update**

Run:
- `bun test src/main.test.ts`
- `bun run check`

Expected: both PASS.

- [ ] **Step 3: Perform the manual OMP verification for all four subcommands**

Run from the repo root:

```bash
omp plugin install /Users/atiwatseenark/Documents/codesook/omp-prompt-border-style
```

Then in OMP:
- set `promptBorder.spinnerGlyphs.activity.frameMs` to `20`
- set `prompt-border-activity-spinner-glyphs.txt` to a known sequence such as `F0 F1 F2 F3 F4 F5 F6 F7`
- run `/prompt-loading-glyphs debug frames`
  - expect the report to show a visible subsequence such as `F0 F4`
- run `/prompt-loading-glyphs debug demo`
  - expect a local animation widget to appear without sending a model prompt
- run `/prompt-loading-glyphs debug on`
  - expect the active session’s loading message to include compact debug labels
- run `/prompt-loading-glyphs debug off`
  - expect the widget and debug labels to disappear

- [ ] **Step 4: Commit the docs/verification slice**

Run:

```bash
git add README.md
git commit -m ":memo: docs(debug): document loading glyph debugging"
```

## Self-Review

- Spec coverage: the plan covers all four required subcommands, the `/prompt-loading-glyphs` namespace decision, session-only state, no-token demo, frame-jump explanation, automated tests, and manual OMP verification.
- Placeholder scan: no `TODO`, `TBD`, or undefined helper names remain; every referenced helper is introduced in Task 1 or Task 3.
- Type consistency: the plan uses one command action union (`PromptLoadingGlyphDebugAction`) and one debug report type (`SpinnerFrameDebugReport`) across parsing, reporting, command handling, and testing.
