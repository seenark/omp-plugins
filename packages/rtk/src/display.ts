import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrameSequenceAsset, type FrameSequence } from "@codesook/omp-shared-display/client";
import type { RtkConfig } from "./config.ts";
import type { Savings } from "./store.ts";

export type RtkState = "active" | "off" | "missing";

const GLYPHS: Record<RtkState, string> = { active: "✂", off: "○", missing: "⚠" };
const FIXED_TEMPLATES = { off: "{glyph} rtk off", missing: "{glyph} rtk missing" } as const;

/** 950, 1.2k, 3.4M. */
export function formatCompact(value: number): string {
	const scaled = (divisor: number, unit: string): string => `${(value / divisor).toFixed(1).replace(/\.0$/, "")}${unit}`;
	if (value < 1000) return String(value);
	return value < 999_950 ? scaled(1000, "k") : scaled(1_000_000, "M");
}

export function renderRtkFrames(state: RtkState, savings: Savings, display: RtkConfig["display"]): FrameSequence {
	const values: Record<string, string> = {
		percent: String(savings.tokensInput > 0 ? Math.round((savings.tokensSaved / savings.tokensInput) * 100) : 0),
		tokensSaved: formatCompact(savings.tokensSaved),
		tokensInput: formatCompact(savings.tokensInput),
		commands: String(savings.commands),
	};
	const template = state === "active" ? display.template : FIXED_TEMPLATES[state];
	const asset = readGlyphAsset(display.glyphDirectory, state);
	const frames = asset?.frames ?? [[GLYPHS[state]]];
	const render = (glyph: string): string[] =>
		template.replace(/\{(glyph|percent|tokensSaved|tokensInput|commands)\}/g, (_, key: string) => (key === "glyph" ? glyph : values[key]!)).split("\n");
	const rendered = frames.map(frame => render(frame.join("\n")));
	return asset?.fps === undefined ? { frames: rendered } : { frames: rendered, fps: asset.fps };
}

function readGlyphAsset(directory: string, state: RtkState): FrameSequence | undefined {
	const resolved = directory === "~" || directory.startsWith("~/") ? path.join(os.homedir(), directory.slice(1)) : directory;
	try {
		return parseFrameSequenceAsset(readFileSync(path.join(resolved, `${state}.txt`), "utf8"));
	} catch {
		return undefined;
	}
}
