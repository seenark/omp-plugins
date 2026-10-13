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

type Focus = "target" | "fps" | "frames";
type Theme = { fg(color: string, text: string): string; bold(text: string): string };

function frameWidth(frame: readonly string[]): number {
	return Math.max(0, ...frame.map(row => visibleWidth(row)));
}

export function createGlyphStudio(options: {
	tui: { requestRender(): void; terminal?: { rows?: number } };
	theme: Theme;
	targets: readonly GlyphTarget[];
	onSaved(target: GlyphTarget): string | undefined;
	onClose(): void;
}): Component & { dispose(): void } {
	const { tui, theme, targets } = options;
	let targetIndex = 0;
	let focus: Focus = "target";
	let notice = "";
	let noticeKind: "success" | "warning" = "warning";
	let state: "ok" | "missing" | "error" = "ok";
	let baseline = { framesText: "", fpsText: "" };
	let origin = Date.now();
	let confirmDiscard = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const fpsInput = new Input();
	fpsInput.prompt = "";
	fpsInput.onSubmit = () => {
		focus = "frames";
		syncFocus();
	};
	const rows = tui.terminal?.rows ?? 24;
	const framesEditor = new Editor(getEditorTheme());
	framesEditor.disableSubmit = true;
	framesEditor.setMaxHeight(Math.max(4, Math.min(12, rows - 14)));
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
		fpsInput.focused = focus === "fps";
		framesEditor.focused = focus === "frames";
	}

	const current = (): GlyphTarget => targets[targetIndex]!;
	const isDirty = (): boolean =>
		framesEditor.getText() !== baseline.framesText || fpsInput.getValue() !== baseline.fpsText;

	function setNotice(text: string, kind: "success" | "warning" = "warning"): void {
		notice = text;
		noticeKind = kind;
	}

	function loadTarget(target: GlyphTarget): void {
		let text = "";
		state = "ok";
		try {
			text = readFileSync(target.path, "utf8");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") state = "missing";
			else {
				state = "error";
				setNotice(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		let sequence: FrameSequence | undefined;
		if (target.surface === "context-rail") {
			const asset = parseContextRailGlyphAsset(text);
			sequence =
				asset.frames.length === 0
					? undefined
					: { frames: asset.frames.map(frame => frame.split("\n")), ...(asset.fps === undefined ? {} : { fps: asset.fps }) };
		} else {
			sequence = parseFrameSequenceAsset(text);
		}
		const framesText = sequence ? sequence.frames.map(frame => frame.join("\n")).join("\n\n") : "";
		const fpsText = sequence?.fps === undefined ? "" : String(sequence.fps);
		framesEditor.setText(framesText);
		fpsInput.setValue(fpsText);
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
		if (timer) return;
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

	function switchTarget(next: number): void {
		if (isDirty()) {
			setNotice("Unsaved changes: Ctrl+S save or Ctrl+R revert before switching.");
			return;
		}
		targetIndex = next;
		notice = "";
		loadTarget(current());
	}

	function jumpGroup(direction: 1 | -1): void {
		const groups: number[] = [];
		targets.forEach((t, i) => {
			if (i === 0 || targets[i - 1]!.group !== t.group) groups.push(i);
		});
		const currentGroup = groups.filter(start => start <= targetIndex).length - 1;
		switchTarget(groups[(currentGroup + direction + groups.length) % groups.length]!);
	}

	function cycleFocus(direction: 1 | -1): void {
		const order: Focus[] = ["target", "fps", "frames"];
		focus = order[(order.indexOf(focus) + direction + order.length) % order.length]!;
		syncFocus();
	}

	syncFocus();
	loadTarget(current());
	schedule();

	return {
		invalidate() {},
		dispose() {
			clearTimeout(timer);
			timer = undefined;
		},
		render(width: number): string[] {
			const target = current();
			const d = derive();
			const index = frameIndex(d);
			const marker = (field: Focus): string => (focus === field ? "› " : "  ");
			const out: string[] = [];
			out.push(
				theme.fg("accent", theme.bold("Glyph Studio")) +
					theme.fg("dim", " · Ctrl+S writes file now; independent of Apply"),
			);
			out.push(
				`${marker("target")}Target  ◀ ${target.group} › ${target.name} ▶  (${targetIndex + 1}/${targets.length})`,
			);
			const fileFlag = state === "missing" ? " (missing)" : state === "ok" && !baseline.framesText ? " (empty)" : "";
			out.push(`  File    ${target.path}${fileFlag}`);
			out.push(`${marker("fps")}FPS     ${fpsInput.render(Math.max(1, width - 10))[0] ?? ""}`);
			const frames = d.sequence?.frames;
			if (!frames) {
				out.push(`  Preview (no frames) — ${target.fallback}`);
			} else {
				const frame = frames[index]!;
				out.push(
					`  Preview ${frame[0]}   frame ${index + 1}/${frames.length} · ${d.fps ?? "no"} fps · width ${frameWidth(frame)}`,
				);
				for (const row of frame.slice(1)) out.push(`          ${row}`);
				const strip = frames
					.map((f, i) => (i === index ? theme.fg("accent", theme.bold(f[0]!)) : f[0]!))
					.join("  ");
				out.push(`  Frames  ${strip}`);
			}
			if (d.error) out.push(theme.fg("error", d.error));
			for (const warning of d.warnings) out.push(theme.fg("warning", warning));
			if (notice) out.push(theme.fg(noticeKind === "success" ? "success" : "warning", notice));
			out.push(theme.fg("dim", "Paste frames below: one frame per blank-line block, or frames separated by spaces."));
			out.push(...framesEditor.render(width));
			out.push(
				theme.fg("dim", "Tab/Shift+Tab field · ←→ target · ↑↓ group · Ctrl+S save · Ctrl+R revert · Esc close"),
			);
			return out.map(row => truncateToWidth(row, width));
		},
		handleInput(data: string): void {
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
				} else {
					options.onClose();
					return;
				}
			} else if (matchesKey(data, "tab")) cycleFocus(1);
			else if (matchesKey(data, "shift+tab")) cycleFocus(-1);
			else if (focus === "target") {
				if (matchesKey(data, "left")) switchTarget((targetIndex - 1 + targets.length) % targets.length);
				else if (matchesKey(data, "right")) switchTarget((targetIndex + 1) % targets.length);
				else if (matchesKey(data, "up")) jumpGroup(-1);
				else if (matchesKey(data, "down")) jumpGroup(1);
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
