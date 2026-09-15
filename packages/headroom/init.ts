import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	DEFAULT_HEADROOM_CONFIG,
	HEADROOM_CONFIG_FILE,
	isHeadroomRootConfigPath,
	serializeHeadroomConfig,
	writeHeadroomConfig,
} from "./config.ts";
import {
	DEFAULT_GLYPHS,
	DISPLAY_STATES,
	GLYPH_DIR,
	resolveThemeGlyph,
	type DisplayState,
} from "./display.ts";

export type HeadroomInitTarget = "config" | "glyphs" | "all";

export interface HeadroomInitPaths {
	config?: string;
	glyphs?: string;
}

export const defaultPaths = {
	config: HEADROOM_CONFIG_FILE,
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
	const configPath = paths.config ?? defaultPaths.config;
	const glyphDirectory = paths.glyphs ?? defaultPaths.glyphs;
	const configFile: HeadroomInitFile = {
		path: configPath,
		label: "config.json",
		content: `${JSON.stringify(serializeHeadroomConfig(DEFAULT_HEADROOM_CONFIG, configPath), null, 2)}\n`,
	};
	const glyphFiles = INIT_GLYPH_STATES.map((state) => ({
		path: path.join(glyphDirectory, `${state}.txt`),
		label: `${state}.txt`,
		content: `${resolveThemeGlyph(theme, state) || DEFAULT_GLYPHS[state]}\n`,
	}));

	switch (target) {
		case "config":
			return [configFile];
		case "glyphs":
			return glyphFiles;
		case "all":
			return [configFile, ...glyphFiles];
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
			if (isHeadroomRootConfigPath(file.path)) writeHeadroomConfig(DEFAULT_HEADROOM_CONFIG, file.path);
			else await Bun.write(file.path, file.content);
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

