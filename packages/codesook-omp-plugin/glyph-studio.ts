import { readFileSync } from "node:fs";
import { getEditorTheme, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Editor, Input, matchesKey, truncateToWidth, visibleWidth, type Component } from "@oh-my-pi/pi-tui";
import { parseFrameSequenceAsset, type FrameSequence } from "@codesook/omp-shared-display/client";
import {
	CODESOOK_OMP_CONFIG_CHANGED,
	readCodesookOmpConfig,
	writeTextFileAtomically,
} from "@codesook/omp-shared-display/config-store";
import { buildTimedSpinnerFrames, HOST_SPINNER_FRAME_MS } from "@codesook/omp-prompt-border-style/src/main.ts";
import { parseContextRailGlyphAsset } from "@codesook/omp-prompt-border-style/src/context-rail.ts";

export type GlyphSurface = "prompt-glyph" | "prompt-spinner" | "context-rail" | "shared-display";
export type GlyphTarget = { group: string; name: string; path: string; surface: GlyphSurface; fallback: string };
export const MAX_GLYPH_FPS = 60;

export function serializeFrameSequence(sequence: FrameSequence | undefined): string {
	if (!sequence || sequence.frames.length === 0) return "";
	const head = sequence.fps === undefined ? "" : `fps=${sequence.fps}\n`;
	return `${head}${sequence.frames.map(frame => frame.join("\n")).join("\n\n")}\n`;
}

type View = "list" | "edit";
type Focus = "frames" | "fps";
type Theme = { fg(color: string, text: string): string; bold(text: string): string };
type Loaded = { state: "ok" | "missing" | "error"; sequence: FrameSequence | undefined; readError?: string };

function frameWidth(frame: readonly string[]): number {
	return Math.max(0, ...frame.map(row => visibleWidth(row)));
}

function readTarget(target: GlyphTarget): Loaded {
	let text = "";
	let state: Loaded["state"] = "ok";
	let readError: string | undefined;
	try {
		text = readFileSync(target.path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") state = "missing";
		else {
			state = "error";
			readError = `Read failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	if (target.surface === "context-rail") {
		const asset = parseContextRailGlyphAsset(text);
		const sequence: FrameSequence | undefined =
			asset.frames.length === 0
				? undefined
				: { frames: asset.frames.map(frame => frame.split("\n")), ...(asset.fps === undefined ? {} : { fps: asset.fps }) };
		return { state, sequence, readError };
	}
	return { state, sequence: parseFrameSequenceAsset(text), readError };
}

export function createGlyphStudio(options: {
	tui: { requestRender(): void; terminal?: { rows?: number } };
	theme: Theme;
	targets: readonly GlyphTarget[];
	onSaved(target: GlyphTarget): string | undefined;
	onClose(): void;
}): Component & { dispose(): void } {
	const { tui, theme, targets } = options;
	let view: View = "list";
	let targetIndex = 0;
	let focus: Focus = "frames";
	let notice = "";
	let noticeKind: "success" | "warning" = "warning";
	let state: Loaded["state"] = "ok";
	let baseline = { framesText: "", fpsText: "" };
	let origin = Date.now();
	let confirmDiscard = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const summaries = new Map<GlyphTarget, Loaded>();

	const fpsInput = new Input();
	fpsInput.prompt = "";
	fpsInput.onSubmit = () => {
		focus = "frames";
		syncFocus();
	};
	const rows = tui.terminal?.rows ?? 24;
	const framesEditor = new Editor(getEditorTheme());
	framesEditor.disableSubmit = true;
	framesEditor.setMaxHeight(Math.max(4, Math.min(12, rows - 16)));
	framesEditor.onLargePaste = text => {
		framesEditor.insertText(text);
		return true;
	};
	framesEditor.onChange = text => {
		const match = /^(?:[ \t]*\n)*[ \t]*fps=([^\n]*)(?:\n|$)/u.exec(text);
		if (!match) return;
		fpsInput.setValue(match[1]!.trim());
		framesEditor.setText(text.slice(match[0].length));
	};

	function syncFocus(): void {
		fpsInput.focused = view === "edit" && focus === "fps";
		framesEditor.focused = view === "edit" && focus === "frames";
	}

	const current = (): GlyphTarget => targets[targetIndex]!;
	const isDirty = (): boolean =>
		view === "edit" && (framesEditor.getText() !== baseline.framesText || fpsInput.getValue() !== baseline.fpsText);

	function setNotice(text: string, kind: "success" | "warning" = "warning"): void {
		notice = text;
		noticeKind = kind;
	}

	function summary(target: GlyphTarget): Loaded {
		let cached = summaries.get(target);
		if (!cached) {
			cached = readTarget(target);
			summaries.set(target, cached);
		}
		return cached;
	}

	function loadTarget(target: GlyphTarget): void {
		const loaded = readTarget(target);
		summaries.set(target, loaded);
		state = loaded.state;
		if (loaded.readError) setNotice(loaded.readError);
		const sequence = loaded.sequence;
		framesEditor.setText(sequence ? sequence.frames.map(frame => frame.join("\n")).join("\n\n") : "");
		fpsInput.setValue(sequence?.fps === undefined ? "" : String(sequence.fps));
		// setText may fire onChange; baseline records the settled values.
		baseline = { framesText: framesEditor.getText(), fpsText: fpsInput.getValue() };
		origin = Date.now();
	}

	type Derived = {
		sequence: FrameSequence | undefined;
		fps: number | undefined;
		error: string | undefined;
		warnings: string[];
	};

	function derive(): Derived {
		const target = current();
		const parsed = parseFrameSequenceAsset(framesEditor.getText());
		const fpsText = fpsInput.getValue().trim();
		const fps = fpsText === "" ? undefined : Number(fpsText);
		const fpsValid = fps === undefined || (Number.isFinite(fps) && fps > 0 && fps <= MAX_GLYPH_FPS);
		const sequence: FrameSequence | undefined = parsed
			? { frames: parsed.frames, ...(fps !== undefined && fpsValid ? { fps } : {}) }
			: undefined;
		let error: string | undefined;
		if (!fpsValid) error = `FPS must be a number above 0 and at most ${MAX_GLYPH_FPS}.`;
		else if (target.surface !== "shared-display" && sequence?.frames.some(frame => frame.length > 1))
			error = `${target.group} frames must be one row; remove line breaks inside a frame.`;
		else if (sequence) {
			const round = parseFrameSequenceAsset(serializeFrameSequence(sequence));
			if (!round || !Bun.deepEquals(round, sequence))
				error =
					"A single frame with spaces or line breaks would be split into several frames; add a second frame or remove the spaces.";
		}
		const warnings: string[] = [];
		if (sequence) {
			const count = sequence.frames.length;
			if (count > 1 && sequence.fps === undefined) warnings.push("No FPS: only frame 1 will show.");
			const widths = sequence.frames.map(frameWidth);
			const min = Math.min(...widths);
			const max = Math.max(...widths);
			if (min !== max) warnings.push(`Frame widths differ (${min}–${max} columns); neighbouring text may shift.`);
			if (target.surface === "prompt-spinner" && sequence.fps !== undefined && sequence.fps > 1000 / HOST_SPINNER_FRAME_MS)
				warnings.push(`Spinner host ticks every ${HOST_SPINNER_FRAME_MS} ms; frames above ${1000 / HOST_SPINNER_FRAME_MS} fps are skipped.`);
		}
		return { sequence, fps: sequence?.fps, error, warnings };
	}

	function frameIndex(d: Derived): number {
		const count = d.sequence?.frames.length ?? 0;
		if (count < 2 || d.fps === undefined) return 0;
		const elapsed = Date.now() - origin;
		if (current().surface === "prompt-spinner") {
			const host = buildTimedSpinnerFrames(
				d.sequence!.frames.map((_, i) => String(i)),
				1000 / d.fps,
			).map(Number);
			return host[Math.floor(elapsed / HOST_SPINNER_FRAME_MS) % host.length] ?? 0;
		}
		return Math.floor((elapsed * d.fps) / 1000) % count;
	}

	function schedule(): void {
		if (timer || view !== "edit") return;
		const d = derive();
		if (!d.sequence || d.sequence.frames.length < 2 || d.fps === undefined || d.error) return;
		const previewFps = current().surface === "prompt-spinner" ? 1000 / HOST_SPINNER_FRAME_MS : d.fps;
		timer = setTimeout(
			() => {
				timer = undefined;
				tui.requestRender();
				schedule();
			},
			Math.max(16, Math.round(1000 / previewFps)),
		);
	}

	function save(): void {
		const d = derive();
		if (d.error) {
			setNotice(d.error);
			return;
		}
		const target = current();
		try {
			writeTextFileAtomically(target.path, serializeFrameSequence(d.sequence));
		} catch (error) {
			setNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const message = options.onSaved(target);
		loadTarget(target);
		if (message) setNotice(message);
		else setNotice(`Saved ${target.path}`, "success");
	}

	function openEditor(): void {
		view = "edit";
		focus = "frames";
		notice = "";
		confirmDiscard = false;
		loadTarget(current());
		syncFocus();
	}

	function backToList(): void {
		view = "list";
		notice = "";
		clearTimeout(timer);
		timer = undefined;
		syncFocus();
	}

	function move(delta: number): void {
		targetIndex = Math.min(targets.length - 1, Math.max(0, targetIndex + delta));
	}

	function describe(target: GlyphTarget): string {
		const loaded = summary(target);
		if (loaded.state === "missing") return theme.fg("warning", "missing file");
		if (loaded.state === "error") return theme.fg("error", "unreadable");
		const sequence = loaded.sequence;
		if (!sequence) return theme.fg("dim", "empty · uses default");
		const n = sequence.frames.length;
		const speed = sequence.fps === undefined ? "static" : `${sequence.fps} fps`;
		return theme.fg("dim", `${n} frame${n === 1 ? "" : "s"} · ${speed}`);
	}

	function renderList(width: number): string[] {
		const out: string[] = [];
		out.push(theme.fg("accent", theme.bold("Glyph Studio")) + theme.fg("dim", " · choose a glyph file to edit"));
		out.push(theme.fg("dim", "Edits are written straight to the glyph file and reload live displays; independent of Apply."));
		out.push("");
		const lines: { text: string; target?: number }[] = [];
		targets.forEach((target, i) => {
			if (i === 0 || targets[i - 1]!.group !== target.group) lines.push({ text: theme.bold(target.group) });
			const label = `${i === targetIndex ? theme.fg("accent", "›") : " "} ${target.name}`;
			const pad = " ".repeat(Math.max(2, 20 - visibleWidth(label)));
			lines.push({ text: `  ${label}${pad}${describe(target)}`, target: i });
		});
		const visible = Math.max(6, (tui.terminal?.rows ?? 24) - 8);
		const selectedLine = lines.findIndex(line => line.target === targetIndex);
		const start = Math.max(0, Math.min(lines.length - visible, selectedLine - Math.floor(visible / 2)));
		if (start > 0) out.push(theme.fg("dim", `  ↑ ${start} more`));
		out.push(...lines.slice(start, start + visible).map(line => line.text));
		if (start + visible < lines.length) out.push(theme.fg("dim", `  ↓ ${lines.length - start - visible} more`));
		out.push("");
		out.push(theme.fg("dim", "↑↓ move · Enter edit · Esc close"));
		return out;
	}

	function renderEditor(width: number): string[] {
		const target = current();
		const d = derive();
		const index = frameIndex(d);
		const label = (field: Focus, text: string): string =>
			focus === field ? theme.fg("accent", theme.bold(`› ${text}`)) : `  ${text}`;
		const out: string[] = [];
		out.push(
			theme.fg("accent", theme.bold("Glyph Studio")) +
				` › ${target.group} › ${theme.bold(target.name)}` +
				(isDirty() ? theme.fg("warning", "  ● unsaved") : ""),
		);
		const fileFlag = state === "missing" ? " (new file)" : state === "ok" && !baseline.framesText ? " (empty)" : "";
		out.push(theme.fg("dim", `  ${target.path}${fileFlag}`));
		out.push("");
		const frames = d.sequence?.frames;
		if (!frames) {
			out.push(`  Preview (no frames) — falls back to ${target.fallback}`);
		} else {
			const frame = frames[index]!;
			out.push(
				`  Preview ${frame[0]}   frame ${index + 1}/${frames.length} · ${d.fps ?? "no"} fps · width ${frameWidth(frame)}`,
			);
			for (const row of frame.slice(1)) out.push(`          ${row}`);
			if (frames.length > 1) {
				out.push(
					"  All     " +
						frames.map((f, i) => (i === index ? theme.fg("accent", theme.bold(f[0]!)) : f[0]!)).join("  "),
				);
			}
		}
		if (d.error) out.push(theme.fg("error", `  ✗ ${d.error}`));
		for (const warning of d.warnings) out.push(theme.fg("warning", `  ! ${warning}`));
		if (notice) out.push(theme.fg(noticeKind === "success" ? "success" : "warning", `  ${notice}`));
		out.push("");
		out.push(`${label("fps", "Speed (fps, optional)")}  ${fpsInput.render(Math.max(1, width - 30))[0] ?? ""}`);
		out.push(label("frames", "Frames"));
		out.push(
			theme.fg(
				"dim",
				target.surface === "shared-display"
					? "  One frame per blank-line block (rows may be several lines)."
					: "  One row per frame: separate frames with a blank line or a space.",
			),
		);
		out.push(...framesEditor.render(width));
		out.push("");
		out.push(theme.fg("dim", "Tab fps ⇄ frames · Ctrl+S save · Ctrl+R revert · Esc back to list"));
		return out;
	}

	syncFocus();

	return {
		invalidate() {},
		dispose() {
			clearTimeout(timer);
			timer = undefined;
		},
		render(width: number): string[] {
			const out = view === "list" ? renderList(width) : renderEditor(width);
			return out.map(row => truncateToWidth(row, width));
		},
		handleInput(data: string): void {
			if (view === "list") {
				if (matchesKey(data, "escape")) {
					options.onClose();
					return;
				}
				if (matchesKey(data, "up")) move(-1);
				else if (matchesKey(data, "down")) move(1);
				else if (matchesKey(data, "pageUp")) move(-5);
				else if (matchesKey(data, "pageDown")) move(5);
				else if (matchesKey(data, "enter") || data === "\r") openEditor();
				schedule();
				tui.requestRender();
				return;
			}
			let keepDiscard = false;
			if (matchesKey(data, "ctrl+s")) save();
			else if (matchesKey(data, "ctrl+r")) {
				loadTarget(current());
				setNotice("Reverted to file.");
			} else if (matchesKey(data, "escape")) {
				if (isDirty() && !confirmDiscard) {
					confirmDiscard = true;
					keepDiscard = true;
					setNotice("Unsaved changes: Esc again to discard, Ctrl+S to save.");
				} else backToList();
			} else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
				focus = focus === "frames" ? "fps" : "frames";
				syncFocus();
			} else if (focus === "fps") fpsInput.handleInput(data);
			else if (matchesKey(data, "enter") || data === "\r") framesEditor.insertText("\n");
			else framesEditor.handleInput(data);
			if (!keepDiscard) confirmDiscard = false;
			schedule();
			tui.requestRender();
		},
	};
}

function emitLiveReload(pi: ExtensionAPI, configPath: string): string | undefined {
	const root = readCodesookOmpConfig(configPath);
	if (!root.exists || !root.valid)
		return "Saved. Live reload skipped: root config missing or invalid; restart OMP to see the change.";
	try {
		pi.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: root.value });
		return undefined;
	} catch (error) {
		return `Saved, but live-change event failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export async function openGlyphStudio(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	targets: readonly GlyphTarget[],
	configPath: string,
): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) =>
			createGlyphStudio({
				tui,
				theme,
				targets,
				onSaved: () => emitLiveReload(pi, configPath),
				onClose: () => done(undefined),
			}),
		{ overlay: true },
	);
}
