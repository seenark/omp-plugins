import { readFileSync } from "node:fs";
import { getEditorTheme, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Editor, matchesKey, truncateToWidth, visibleWidth, type Component } from "@oh-my-pi/pi-tui";
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

// list: pick a target. frames: navigate/reorder frames. edit: type one frame's rows.
type View = "list" | "frames" | "edit";
type Theme = { fg(color: string, text: string): string; bold(text: string): string };
type Loaded = { state: "ok" | "missing" | "error"; sequence: FrameSequence | undefined; readError?: string };

const MAX_LIST_PREVIEW_ROWS = 8;
// The TUI delivers a whole bracketed paste as one input chunk (pi-tui terminal.ts).
const PASTE = /^\x1b\[200~([\s\S]*?)\x1b\[201~/u;

function frameWidth(frame: readonly string[]): number {
	return Math.max(0, ...frame.map(row => visibleWidth(row)));
}

function pad(text: string, width: number): string {
	return text + " ".repeat(Math.max(1, width - visibleWidth(text)));
}

/** Index the live display would show now; non-animated sequences stay on frame 1. */
function playingIndex(sequence: FrameSequence, surface: GlyphSurface, origin: number): number {
	const count = sequence.frames.length;
	if (count < 2 || sequence.fps === undefined) return 0;
	const elapsed = Date.now() - origin;
	if (surface === "prompt-spinner") {
		const host = buildTimedSpinnerFrames(
			sequence.frames.map((_, i) => String(i)),
			1000 / sequence.fps,
		).map(Number);
		return host[Math.floor(elapsed / HOST_SPINNER_FRAME_MS) % host.length] ?? 0;
	}
	return Math.floor((elapsed * sequence.fps) / 1000) % count;
}

/** Fixed-height block so the overlay never jumps as frames of different heights play. */
function previewRows(frame: readonly string[] | undefined, height: number): string[] {
	return Array.from({ length: height }, (_, row) => `    ${frame?.[row] ?? ""}`);
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
	const termRows = tui.terminal?.rows ?? 24;
	const dim = (text: string): string => theme.fg("dim", text);
	let view: View = "list";
	let targetIndex = 0;
	let frames: string[][] = [];
	let fps: number | undefined;
	let sel = 0;
	let playing = true;
	let state: Loaded["state"] = "ok";
	let baseline = "";
	let notice = "";
	let noticeKind: "success" | "warning" = "warning";
	let origin = Date.now();
	let confirmDiscard = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const summaries = new Map<GlyphTarget, Loaded>();

	const editor = new Editor(getEditorTheme());
	editor.disableSubmit = true;
	editor.setMaxHeight(Math.max(4, Math.min(12, termRows - 16)));
	editor.onChange = text => {
		// Blank rows cannot be stored inside a frame: a blank line separates frames in the file.
		if (view === "edit") frames[sel] = text.split("\n").filter(row => row.trim().length > 0);
	};

	const current = (): GlyphTarget => targets[targetIndex]!;
	const oneRow = (): boolean => current().surface !== "shared-display";
	const sequence = (): FrameSequence | undefined => {
		const kept = frames.filter(frame => frame.length > 0);
		if (kept.length === 0) return undefined;
		return fps === undefined ? { frames: kept } : { frames: kept, fps };
	};
	const isDirty = (): boolean => view !== "list" && serializeFrameSequence(sequence()) !== baseline;

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
		frames = loaded.sequence?.frames.map(frame => [...frame]) ?? [];
		fps = loaded.sequence?.fps;
		sel = Math.max(0, Math.min(sel, frames.length - 1));
		baseline = serializeFrameSequence(sequence());
		origin = Date.now();
	}

	function problems(): { error: string | undefined; warnings: string[] } {
		const target = current();
		const seq = sequence();
		const warnings: string[] = [];
		if (!seq) return { error: undefined, warnings };
		let error: string | undefined;
		if (seq.fps !== undefined && seq.fps > MAX_GLYPH_FPS) error = `FPS must be at most ${MAX_GLYPH_FPS}; press ↓ to lower it.`;
		else if (oneRow() && seq.frames.some(frame => frame.length > 1))
			error = `${target.group} frames must be one row; remove line breaks inside a frame.`;
		else {
			const round = parseFrameSequenceAsset(serializeFrameSequence(seq));
			if (!round || !Bun.deepEquals(round, seq))
				error =
					"A single frame with spaces or line breaks would be split into several frames; add a second frame or remove the spaces.";
		}
		if (seq.frames.length > 1 && seq.fps === undefined) warnings.push("No FPS: only frame 1 will show. Press ↑ to animate.");
		const widths = seq.frames.map(frameWidth);
		const min = Math.min(...widths);
		const max = Math.max(...widths);
		if (min !== max) warnings.push(`Frame widths differ (${min}–${max} columns); neighbouring text may shift.`);
		if (target.surface === "prompt-spinner" && seq.fps !== undefined && seq.fps > 1000 / HOST_SPINNER_FRAME_MS)
			warnings.push(`Spinner host ticks every ${HOST_SPINNER_FRAME_MS} ms; frames above ${1000 / HOST_SPINNER_FRAME_MS} fps are skipped.`);
		return { error, warnings };
	}

	/** Sequence the preview is currently animating, if any. */
	function animatedSequence(): FrameSequence | undefined {
		if (view === "list") return summary(current()).sequence;
		if (view === "frames" && playing && !problems().error) return sequence();
		return undefined;
	}

	function schedule(): void {
		if (timer) return;
		const seq = animatedSequence();
		if (!seq || seq.frames.length < 2 || seq.fps === undefined) return;
		const previewFps = current().surface === "prompt-spinner" ? 1000 / HOST_SPINNER_FRAME_MS : seq.fps;
		timer = setTimeout(
			() => {
				timer = undefined;
				tui.requestRender();
				schedule();
			},
			Math.max(16, Math.round(1000 / previewFps)),
		);
	}

	function stopTimer(): void {
		clearTimeout(timer);
		timer = undefined;
	}

	function save(): void {
		const { error } = problems();
		if (error) {
			setNotice(error);
			return;
		}
		const target = current();
		try {
			writeTextFileAtomically(target.path, serializeFrameSequence(sequence()));
		} catch (error) {
			setNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const message = options.onSaved(target);
		loadTarget(target);
		if (message) setNotice(message);
		else setNotice(`Saved ${target.path}`, "success");
	}

	function openTarget(): void {
		view = "frames";
		sel = 0;
		playing = true;
		notice = "";
		confirmDiscard = false;
		stopTimer();
		loadTarget(current());
	}

	function backToList(): void {
		view = "list";
		notice = "";
		editor.focused = false;
		stopTimer();
		origin = Date.now();
	}

	function startEdit(): void {
		view = "edit";
		playing = false;
		stopTimer();
		editor.setText(frames[sel]!.join("\n"));
		editor.focused = true;
	}

	function finishEdit(): void {
		view = "frames";
		editor.focused = false;
		if (frames[sel]?.length === 0) {
			frames.splice(sel, 1);
			sel--;
		}
		sel = Math.max(0, Math.min(sel, frames.length - 1));
	}

	function addFrame(): void {
		const at = frames.length === 0 ? 0 : sel + 1;
		frames.splice(at, 0, []);
		sel = at;
		startEdit();
	}

	function select(index: number): void {
		sel = Math.max(0, Math.min(frames.length - 1, index));
		playing = false;
	}

	function moveFrame(delta: number): void {
		const to = sel + delta;
		if (to < 0 || to >= frames.length) return;
		[frames[sel], frames[to]] = [frames[to]!, frames[sel]!];
		sel = to;
	}

	function stepFps(delta: 1 | -1): void {
		if (delta > 0) fps = fps === undefined ? 1 : Math.min(MAX_GLYPH_FPS, Math.floor(fps) + 1);
		else if (fps !== undefined) fps = fps <= 1 ? undefined : Math.min(MAX_GLYPH_FPS, Math.ceil(fps) - 1);
		playing = true;
		origin = Date.now();
	}

	function paste(text: string): void {
		const parsed = parseFrameSequenceAsset(text);
		if (!parsed) return;
		if (view === "edit" && parsed.frames.length === 1 && parsed.fps === undefined) {
			editor.insertText(parsed.frames[0]!.join("\n"));
			return;
		}
		frames = parsed.frames.map(frame => [...frame]);
		if (parsed.fps !== undefined) fps = parsed.fps;
		view = "frames";
		editor.focused = false;
		sel = 0;
		playing = true;
		origin = Date.now();
		setNotice(`Pasted ${frames.length} frame${frames.length === 1 ? "" : "s"}.`, "success");
	}

	function describe(loaded: Loaded): string {
		if (loaded.state === "missing") return theme.fg("warning", "missing file");
		if (loaded.state === "error") return theme.fg("error", "unreadable");
		const seq = loaded.sequence;
		if (!seq) return dim("empty · uses default");
		const n = seq.frames.length;
		return dim(`${n} frame${n === 1 ? "" : "s"} · ${seq.fps === undefined ? "static" : `${seq.fps} fps`}`);
	}

	function renderList(): string[] {
		const out: string[] = [
			theme.fg("accent", theme.bold("Glyph Studio")) + dim(" · pick a glyph to edit"),
			dim("Saves write straight to the glyph file and reload live displays; independent of Apply."),
			"",
		];
		const loadedAll = targets.map(summary);
		const previewHeight = Math.min(
			MAX_LIST_PREVIEW_ROWS,
			Math.max(1, ...loadedAll.flatMap(loaded => loaded.sequence?.frames.map(frame => frame.length) ?? [])),
		);
		const lines: { text: string; target?: number }[] = [];
		targets.forEach((target, i) => {
			if (i === 0 || targets[i - 1]!.group !== target.group) lines.push({ text: theme.bold(target.group) });
			const name = i === targetIndex ? theme.fg("accent", theme.bold(`› ${target.name}`)) : `  ${target.name}`;
			const sample = loadedAll[i]!.sequence?.frames[0]?.[0];
			const sampleText = sample === undefined ? dim("—") : truncateToWidth(sample, 12);
			lines.push({ text: `  ${pad(name, 22)}${pad(sampleText, 14)}${describe(loadedAll[i]!)}`, target: i });
		});
		const visible = Math.max(6, termRows - 11 - previewHeight);
		if (lines.length <= visible) out.push(...lines.map(line => line.text));
		else {
			// Both scroll-hint rows are always reserved so the list height never changes while moving.
			const selectedLine = lines.findIndex(line => line.target === targetIndex);
			const start = Math.max(0, Math.min(lines.length - visible, selectedLine - Math.floor(visible / 2)));
			const below = lines.length - start - visible;
			out.push(start > 0 ? dim(`  ↑ ${start} more`) : "");
			out.push(...lines.slice(start, start + visible).map(line => line.text));
			out.push(below > 0 ? dim(`  ↓ ${below} more`) : "");
		}
		out.push("");
		const target = current();
		const loaded = loadedAll[targetIndex]!;
		const seq = loaded.sequence;
		out.push(`  ${theme.bold("Preview")}  ${describe(loaded)}${seq ? "" : dim(` — ${target.fallback}`)}`);
		out.push(...previewRows(seq?.frames[playingIndex(seq, target.surface, origin)], previewHeight));
		out.push("");
		out.push(dim("↑↓ move · Enter edit · Esc close"));
		return out;
	}

	function frameStrip(available: number): string {
		if (frames.length === 0) return dim("none yet — press a to add one");
		const items = frames.map((frame, i) => {
			const text = `${i + 1} ${truncateToWidth(frame[0] ?? "", 8)}`.trimEnd();
			return i === sel ? theme.fg("accent", theme.bold(`[${text}]`)) : ` ${text} `;
		});
		const fits = (from: number, to: number): boolean =>
			items.slice(from, to + 1).reduce((width, item) => width + visibleWidth(item) + 1, 4) <= available;
		let start = 0;
		while (start < sel && !fits(start, sel)) start++;
		let end = sel;
		while (end + 1 < items.length && fits(start, end + 1)) end++;
		return (start > 0 ? "‹ " : "") + items.slice(start, end + 1).join(" ") + (end < items.length - 1 ? " ›" : "");
	}

	function renderFrames(width: number): string[] {
		const target = current();
		const { error, warnings } = problems();
		const seq = sequence();
		const height = Math.max(1, ...frames.map(frame => frame.length));
		const speed = fps === undefined ? "static" : `${fps} fps`;
		const animating = view === "frames" && playing && !error && seq !== undefined && seq.frames.length > 1 && seq.fps !== undefined;
		const index = animating ? playingIndex(seq, target.surface, origin) : sel;
		const frame = frames[index];
		const out: string[] = [
			theme.fg("accent", theme.bold("Glyph Studio")) +
				` › ${target.group} › ${theme.bold(target.name)}` +
				(isDirty() ? theme.fg("warning", "  ● unsaved") : ""),
			dim(`  ${target.path}${state === "missing" ? " (new file)" : state === "ok" && !baseline ? " (empty)" : ""}`),
			"",
		];
		let status: string;
		if (frames.length === 0) status = dim(`no frames — ${target.fallback}`);
		else {
			const mode =
				view === "edit"
					? theme.fg("accent", "✎ editing  ")
					: animating
						? "▶ playing  "
						: frames.length > 1 && fps !== undefined
							? "⏸ paused  "
							: "";
			status = `${mode}frame ${index + 1}/${frames.length} · ${speed} · width ${frameWidth(frame ?? [])}`;
		}
		out.push(`  ${theme.bold("Preview")}  ${status}`);
		if (view === "edit") {
			const rows = editor.render(Math.max(1, width - 4)).map(row => `  ${row}`);
			out.push(...rows, ...Array.from({ length: Math.max(0, height + 2 - rows.length) }, () => ""));
		} else out.push("", ...previewRows(frame, height), "");
		out.push(`  ${theme.bold("Frames")}   ${frameStrip(width - 11)}`);
		out.push(`  ${theme.bold("Speed")}    ${speed}${view === "frames" ? dim("  ↑↓ to change") : ""}`);
		const messages = [
			...(error ? [theme.fg("error", `  ✗ ${error}`)] : []),
			...(notice ? [theme.fg(noticeKind, `  ${notice}`)] : []),
			...warnings.map(warning => theme.fg("warning", `  ! ${warning}`)),
		];
		out.push("", messages[0] ?? "", messages[1] ?? "", "");
		if (view === "edit") {
			out.push(dim(oneRow() ? "Type the frame (one row) · Enter or Esc done" : "Type the frame rows · Enter new row · Esc done"));
			out.push(dim("Ctrl+S save · an emptied frame is removed"));
		} else {
			out.push(dim("←→ select · Enter edit · a add · d duplicate · x delete · [ ] reorder · Space play/pause"));
			out.push(dim("↑↓ speed · Ctrl+S save · Ctrl+R revert · Esc back · paste a glyph file to replace all frames"));
		}
		return out;
	}

	function handleFrameKey(data: string): boolean {
		if (matchesKey(data, "escape")) {
			if (isDirty() && !confirmDiscard) {
				confirmDiscard = true;
				setNotice("Unsaved changes: Esc again to discard, Ctrl+S to save.");
				return true;
			}
			backToList();
		} else if (matchesKey(data, "left")) select(sel - 1);
		else if (matchesKey(data, "right")) select(sel + 1);
		else if (matchesKey(data, "enter") || data === "\r") {
			if (frames.length === 0) addFrame();
			else startEdit();
		} else if (matchesKey(data, "a")) addFrame();
		else if (matchesKey(data, "d") && frames.length > 0) {
			frames.splice(sel + 1, 0, [...frames[sel]!]);
			sel++;
		} else if (matchesKey(data, "x") || matchesKey(data, "delete") || matchesKey(data, "backspace")) {
			frames.splice(sel, 1);
			sel = Math.max(0, Math.min(sel, frames.length - 1));
		} else if (matchesKey(data, "[")) moveFrame(-1);
		else if (matchesKey(data, "]")) moveFrame(1);
		else if (matchesKey(data, "up") || matchesKey(data, "+") || matchesKey(data, "=")) stepFps(1);
		else if (matchesKey(data, "down") || matchesKey(data, "-")) stepFps(-1);
		else if (matchesKey(data, "space")) {
			playing = !playing;
			origin = Date.now();
		}
		return false;
	}

	schedule();

	return {
		invalidate() {},
		dispose: stopTimer,
		render(width: number): string[] {
			const out = view === "list" ? renderList() : renderFrames(width);
			return out.map(row => truncateToWidth(row, width));
		},
		handleInput(data: string): void {
			if (view === "list") {
				if (matchesKey(data, "escape")) {
					options.onClose();
					return;
				}
				const before = targetIndex;
				if (matchesKey(data, "up")) targetIndex--;
				else if (matchesKey(data, "down")) targetIndex++;
				else if (matchesKey(data, "pageUp")) targetIndex -= 5;
				else if (matchesKey(data, "pageDown")) targetIndex += 5;
				else if (matchesKey(data, "enter") || data === "\r") openTarget();
				targetIndex = Math.min(targets.length - 1, Math.max(0, targetIndex));
				if (view === "list" && targetIndex !== before) {
					stopTimer();
					origin = Date.now();
				}
				schedule();
				tui.requestRender();
				return;
			}
			let keepDiscard = false;
			const pasted = PASTE.exec(data);
			if (pasted) paste(pasted[1]!);
			else if (matchesKey(data, "ctrl+s")) {
				if (view === "edit") finishEdit();
				save();
			} else if (matchesKey(data, "ctrl+r")) {
				if (view === "edit") finishEdit();
				loadTarget(current());
				setNotice("Reverted to file.");
			} else if (view === "edit") {
				if (matchesKey(data, "escape") || (oneRow() && (matchesKey(data, "enter") || data === "\r"))) finishEdit();
				else if (matchesKey(data, "enter") || data === "\r") editor.insertText("\n");
				else editor.handleInput(data);
			} else keepDiscard = handleFrameKey(data);
			if (!keepDiscard) confirmDiscard = false;
			if (view === "frames" && !playing) stopTimer();
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
