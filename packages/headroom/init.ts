import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	DEFAULT_DISPLAY_CONFIG,
	DISPLAY_CONFIG_PATH,
	DISPLAY_STATES,
	GLYPH_DIR,
	resolveThemeGlyph,
	type DisplayState,
} from "./display.ts";
import {
	DEFAULT_HEADROOM_SETTINGS,
	HEADROOM_SETTINGS_FILE,
} from "./config.ts";

export type HeadroomInitTarget = "config" | "display" | "glyphs" | "all";

export interface HeadroomInitPaths {
	config?: string;
	display?: string;
	glyphs?: string;
}

export const defaultPaths = {
	config: HEADROOM_SETTINGS_FILE,
	display: DISPLAY_CONFIG_PATH,
	glyphs: GLYPH_DIR,
} as const;

export interface HeadroomInitFile {
	path: string;
	label: string;
	content: string;
}

export interface HeadroomInitFailure {
	path: string;
	message: string;
}

export interface HeadroomInitResult {
	created: string[];
	overwritten: string[];
	skipped: string[];
	failed: HeadroomInitFailure[];
}

const INIT_GLYPH_STATES: readonly DisplayState[] = DISPLAY_STATES;

export function buildHeadroomInitFiles(
	target: HeadroomInitTarget,
	theme: unknown,
	paths: HeadroomInitPaths = defaultPaths,
): HeadroomInitFile[] {
	const resolvedPaths = {
		config: paths.config ?? defaultPaths.config,
		display: paths.display ?? defaultPaths.display,
		glyphs: paths.glyphs ?? defaultPaths.glyphs,
	};
	const configFile: HeadroomInitFile = {
		path: resolvedPaths.config,
		label: "settings.json",
		content: `${JSON.stringify(DEFAULT_HEADROOM_SETTINGS, null, 2)}\n`,
	};
	const displayFile: HeadroomInitFile = {
		path: resolvedPaths.display,
		label: "display-config.json",
		content: `${JSON.stringify(DEFAULT_DISPLAY_CONFIG, null, 2)}\n`,
	};
	const glyphFiles = INIT_GLYPH_STATES.map((state) => ({
		path: path.join(resolvedPaths.glyphs, `${state}.txt`),
		label: `${state}.txt`,
		content: `${resolveThemeGlyph(theme, state)}\n`,
	}));

	switch (target) {
		case "config":
			return [configFile];
		case "display":
			return [displayFile];
		case "glyphs":
			return glyphFiles;
		case "all":
			return [configFile, displayFile, ...glyphFiles];
	}
}

export async function writeHeadroomInitFiles(
	files: readonly HeadroomInitFile[],
	confirmOverwrite: (file: HeadroomInitFile) => boolean | Promise<boolean>,
): Promise<HeadroomInitResult> {
	const result: HeadroomInitResult = {
		created: [],
		overwritten: [],
		skipped: [],
		failed: [],
	};

	for (const file of files) {
		try {
			await fs.mkdir(path.dirname(file.path), { recursive: true });
			const exists = await Bun.file(file.path).exists();
			if (exists && !(await confirmOverwrite(file))) {
				result.skipped.push(file.path);
				continue;
			}
			await Bun.write(file.path, file.content);
			(exists ? result.overwritten : result.created).push(file.path);
		} catch (error) {
			result.failed.push({
				path: file.path,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return result;
}
