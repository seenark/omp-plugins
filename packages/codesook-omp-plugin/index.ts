import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import {
	Input,
	SettingsList,
	matchesKey,
	type Component,
	type SettingItem,
} from "@oh-my-pi/pi-tui";
import {
	defaultCodesookOmpConfig,
	CODESOOK_OMP_CONFIG_CHANGED,
	CODESOOK_OMP_CONFIG_PATH,
	isRecord,
	readCodesookOmpConfig,
	writeCodesookOmpConfig,
	type CodesookOmpConfig,
	type CodesookOmpConfigReadResult,
} from "@codesook/omp-shared-display/config-store";
import { parseFrameSequenceAsset } from "@codesook/omp-shared-display/client";
import {
	loadPackagedPonytailSequence,
	isDisplaySource,
	normalizeSharedDisplayConfig,
	validateSharedDisplayConfig,
	type SharedDisplayConfig,
	type SharedDisplayLayout,
	type SharedDisplayPlacement,
} from "@codesook/omp-shared-display";
import {
	CAVEMAN_ACTIVE_LEVELS,
	PACKAGE_ASSET_DIRECTORY,
	normalizeLegacyCavemanConfig,
} from "@codesook/omp-caveman";
import {
	normalizeHeadroomConfig,
	type HeadroomConfig,
} from "@codesook/omp-headroom/config";
import { HEADROOM_PROXY_TOKEN_FILE } from "@codesook/omp-headroom/client";
import { DEFAULT_GLYPHS, DISPLAY_STATES, resolveThemeGlyph } from "@codesook/omp-headroom/display";
import {
	DEFAULT_LEFT_GLYPH_TEXT,
	DEFAULT_LEFT_GLYPH_TEXT_PATH,
	DEFAULT_RIGHT_GLYPH_TEXT_PATH,
	DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH,
	DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH,
	borderStyles,
	isBorderLayoutName,
	isBorderStyleName,
	normalizePromptBorderConfig,
	type BorderLayoutName,
	type BorderStyleName,
} from "@codesook/omp-prompt-border-style/src/main.ts";
import {
	CONTEXT_RAIL_ROLES,
	type ContextRailConfig,
	type ContextRailLabelPosition,
	type ContextRailLabels,
	type ContextRailMode,
	type ContextRailMeaningPlacement,
	type ContextRailPlacement,
	type ContextRailPointer,
	type ContextRailVisibility,
} from "@codesook/omp-prompt-border-style/src/context-rail.ts";
type CavemanLevel = (typeof CAVEMAN_LEVELS)[number];
type CavemanConfig = {
	defaultLevel: CavemanLevel;
	nativeVisible: boolean;
	display: { visible: boolean; template: string; glyphDirectory: string };
};

const CAVEMAN_LEVELS = [
	"off",
	"lite",
	"full",
	"ultra",
	"wenyan-lite",
	"wenyan-full",
	"wenyan-ultra",
] as const;
const DEFAULT_CAVEMAN_CONFIG: CavemanConfig = {
	defaultLevel: "full",
	nativeVisible: false,
	display: {
		visible: true,
		template: "{activity} {glyph} caveman: {level}",
		glyphDirectory: "~/.config/codesook-omp/caveman/glyphs",
	},
};
function normalizeCavemanConfig(raw: unknown): CavemanConfig {
	const source = asRecord(raw);
	const displaySource = asRecord(source.display);
	const defaultLevel = CAVEMAN_LEVELS.includes(source.defaultLevel as CavemanLevel)
		? (source.defaultLevel as CavemanLevel)
		: "full";
	return {
		defaultLevel,
		nativeVisible: typeof source.nativeVisible === "boolean" ? source.nativeVisible : DEFAULT_CAVEMAN_CONFIG.nativeVisible,
		display: {
			visible: typeof displaySource.visible === "boolean" ? displaySource.visible : true,
			template:
				typeof displaySource.template === "string" && displaySource.template.trim()
					? displaySource.template
					: DEFAULT_CAVEMAN_CONFIG.display.template,
			glyphDirectory:
				typeof displaySource.glyphDirectory === "string" && displaySource.glyphDirectory.trim()
					? displaySource.glyphDirectory.trim()
					: DEFAULT_CAVEMAN_CONFIG.display.glyphDirectory,
		},
	};
}

function validateCavemanConfig(config: unknown): string | undefined {
	const source = asRecord(config);
	if (!CAVEMAN_LEVELS.includes(source.defaultLevel as CavemanLevel)) return "Default level must be canonical Caveman level or off.";
	if (typeof source.nativeVisible !== "boolean") return "Native visibility must be on or off.";
	const display = asRecord(source.display);
	if (typeof display.visible !== "boolean") return "Display visibility must be on or off.";
	if (typeof display.template !== "string" || !display.template.trim() || /[\r\n]/.test(display.template)) {
		return "Display template must be nonempty and single-line.";
	}
	if (typeof display.glyphDirectory !== "string" || !display.glyphDirectory.trim() || /[\r\n]/.test(display.glyphDirectory)) {
		return "Glyph directory must be nonempty and single-line.";
	}
	return undefined;
}

const LEGACY_SHARED_DISPLAY_CONFIG_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	"shared-display",
	"config.json",
);
const LEGACY_CAVEMAN_CONFIG_PATH = path.join(os.homedir(), ".config", "codesook-omp", "caveman", "config.json");
const LEGACY_HEADROOM_CONFIG_PATH = path.join(os.homedir(), ".config", "codesook-omp", "headroom", "config.json");
const LEGACY_PROMPT_BORDER_CONFIG_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	"prompt-border",
	"config.json",
);

const PROJECT_FEATURES = ["shared-display", "caveman", "headroom", "prompt-border-style"] as const;
type ProjectFeature = (typeof PROJECT_FEATURES)[number];

const DEFAULT_PROJECT_FEATURES: Record<ProjectFeature, boolean> = {
	"shared-display": false,
	caveman: false,
	headroom: true,
	"prompt-border-style": true,
};

const STANDALONE_FEATURE_PACKAGES: Record<ProjectFeature, string> = {
	"shared-display": "@codesook/omp-shared-display",
	caveman: "@codesook/omp-caveman",
	headroom: "@codesook/omp-headroom",
	"prompt-border-style": "@codesook/omp-prompt-border-style",
};

const SHARED_LAYOUTS = ["horizontal", "vertical"] as const satisfies readonly SharedDisplayLayout[];
const SHARED_PLACEMENTS = ["aboveEditor", "belowEditor"] as const satisfies readonly SharedDisplayPlacement[];
const RAIL_PLACEMENTS = ["inside", "above", "below"] as const satisfies readonly ContextRailPlacement[];
const RAIL_VISIBILITIES = ["always", "toggle", "collapse-while-typing"] as const satisfies readonly ContextRailVisibility[];
const RAIL_MODES = ["compact", "full", "custom"] as const satisfies readonly ContextRailMode[];
const RAIL_LABELS = ["auto", "bar-only", "always"] as const satisfies readonly ContextRailLabels[];
const RAIL_LABEL_POSITIONS = ["left", "center", "right"] as const satisfies readonly ContextRailLabelPosition[];
const RAIL_POINTERS = ["auto", "visible", "hidden"] as const satisfies readonly ContextRailPointer[];
const RAIL_MEANING_PLACEMENTS = ["top", "below", "beside"] as const satisfies readonly ContextRailMeaningPlacement[];

const COMMAND_USAGE = "Usage: /codesook-omp-plugin [status|init config]";
const STATUS_ACTION_ID = "action:status";
const APPLY_ACTION_ID = "action:apply";
const CANCEL_ACTION_ID = "action:cancel";
const RELOAD_ACTION_ID = "action:reload";

export type PluginListEntry = {
	name: string;
	version?: string;
	enabled?: boolean;
	enabledFeatures?: readonly string[] | null;
	manifest?: Record<string, unknown>;
};

export type PluginPresence = {
	npm: readonly PluginListEntry[];
	ponytail: boolean;
	ponytailEnabled: boolean;
	ponytailVersion?: string;
	ompPlugins: boolean;
	ompPluginsEnabled: boolean;
	ompPluginsVersion?: string;
	projectFeatures: Record<ProjectFeature, boolean>;
};

export type UnifiedSettingsDraft = {
	display: {
		sharedDisplay: SharedDisplayConfig;
		caveman: Pick<CavemanConfig, "nativeVisible" | "display">;
		headroom: HeadroomConfig["display"];
		promptBorder: {
			style: BorderStyleName;
			layout: BorderLayoutName;
		};
		contextRail: ContextRailConfig;
	};
	behavior: {
		caveman: Pick<CavemanConfig, "defaultLevel">;
		headroom: {
			enabled: boolean;
			baseUrl: string;
			allowRemote: boolean;
			autoStart: boolean;
			command: string;
			minContextTokens: number;
			minMessageChars: number;
			timeoutMs: number;
			proxyTokenFile: string;
		};
	};
};

type LegacySources = {
	sharedDisplay?: unknown;
	caveman?: unknown;
	headroom?: unknown;
	promptBorder?: unknown;
};
type StatusSnapshot = {
	presence?: PluginPresence;
	root?: CodesookOmpConfigReadResult;
	error?: string;
};

function clone<T>(value: T): T {
	return structuredClone(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function readLegacySource(filePath: string): LegacySource | undefined {
	try {
		const raw = readFileSync(filePath, "utf8");
		const value = JSON.parse(raw) as unknown;
		return isRecord(value) ? { path: filePath, value, raw } : undefined;
	} catch {
		return undefined;
	}
}

function mergeRecords(base: unknown, patch: unknown): Record<string, unknown> {
	const result: Record<string, unknown> = isRecord(base) ? clone(base) : {};
	if (!isRecord(patch)) return result;
	for (const [key, value] of Object.entries(patch)) {
		result[key] = isRecord(value) && isRecord(result[key]) ? mergeRecords(result[key], value) : clone(value);
	}
	return result;
}

function parseJsonOutput(raw: unknown): unknown {
	if (typeof raw !== "string") return raw;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}

function pluginEntries(raw: unknown): PluginListEntry[] {
	const parsed = parseJsonOutput(raw);
	const root = asRecord(parsed);
	const values = Array.isArray(root.npm) ? root.npm : Array.isArray(parsed) ? parsed : [];
	return values.flatMap(value => {
		if (!isRecord(value) || typeof value.name !== "string") return [];
		return [
			{
				name: value.name,
				version: typeof value.version === "string" ? value.version : undefined,
				enabled: value.enabled !== false,
				enabledFeatures:
					value.enabledFeatures === null
						? null
						: Array.isArray(value.enabledFeatures)
							? value.enabledFeatures.filter((feature): feature is string => typeof feature === "string")
							: undefined,
				manifest: isRecord(value.manifest) ? value.manifest : undefined,
			},
		];
	});
}
/** Parse `omp plugin list --json` and project npm feature state into settings status. */
export function parsePluginList(raw: unknown): PluginPresence {
	const npm = pluginEntries(raw);
	const ponytailEntry = npm.find(entry => entry.name === "@dietrichgebert/ponytail");
	const ompEntry = npm.find(entry => entry.name === "omp-plugins");
	const projectFeatures = { ...DEFAULT_PROJECT_FEATURES };
	if (!ompEntry || ompEntry.enabled === false) {
		for (const feature of PROJECT_FEATURES) projectFeatures[feature] = false;
	} else if (Array.isArray(ompEntry.enabledFeatures)) {
		for (const feature of PROJECT_FEATURES) projectFeatures[feature] = ompEntry.enabledFeatures.includes(feature);
	}
	for (const feature of PROJECT_FEATURES) {
		const standalone = npm.find(entry => entry.name === STANDALONE_FEATURE_PACKAGES[feature]);
		if (standalone?.enabled !== false && standalone !== undefined) projectFeatures[feature] = true;
	}
	return {
		npm,
		ponytail: ponytailEntry !== undefined,
		ponytailEnabled: ponytailEntry?.enabled !== false && ponytailEntry !== undefined,
		ponytailVersion: ponytailEntry?.version,
		ompPlugins: ompEntry !== undefined,
		ompPluginsEnabled: ompEntry?.enabled !== false && ompEntry !== undefined,
		ompPluginsVersion: ompEntry?.version,
		projectFeatures,
	};
}

/** Match both Kitty and legacy terminal encodings for Shift+Enter. */
export function isShiftEnter(data: string): boolean {
	return (
		matchesKey(data, "shift+enter") ||
		matchesKey(data, "shift+return") ||
		data === "\u001b[13;2~" ||
		data === "\u001b[27;2;13~"
	);
}

function isEnter(data: string): boolean {
	return matchesKey(data, "enter") || data === "\r" || data === "\n";
}

function isEscape(data: string): boolean {
	return matchesKey(data, "escape") || matchesKey(data, "esc");
}

function featureEnabled(presence: PluginPresence, feature: ProjectFeature): boolean {
	return presence.projectFeatures[feature] === true;
}

function featureWarning(presence: PluginPresence, feature: ProjectFeature): string | undefined {
	return featureEnabled(presence, feature)
		? undefined
		: "Feature is not enabled in omp-plugins; setting applies when extension loads (usually next start).";
}


function createDraft(raw: unknown, legacy: LegacySources = {}): UnifiedSettingsDraft {
	const source = asRecord(raw);
	const display = asRecord(source.display);
	const behavior = asRecord(source.behavior);
	const legacyShared = display.sharedDisplay === undefined ? asRecord(legacy.sharedDisplay) : {};
	const sharedRaw = mergeRecords(legacyShared, display.sharedDisplay);
	const sharedDisplay = normalizeSharedDisplayConfig(sharedRaw);

	const legacyCaveman =
		display.caveman === undefined || behavior.caveman === undefined ? asRecord(legacy.caveman) : {};
	const rootCavemanDisplay = asRecord(display.caveman);
	const rootCavemanBehavior = asRecord(behavior.caveman);
	const cavemanDisplay = isRecord(rootCavemanDisplay.display) ? rootCavemanDisplay.display : rootCavemanDisplay;
	const caveman = normalizeCavemanConfig({
		...legacyCaveman,
		...rootCavemanDisplay,
		defaultLevel: rootCavemanBehavior.defaultLevel ?? legacyCaveman.defaultLevel,
		nativeVisible: rootCavemanDisplay.nativeVisible ?? legacyCaveman.nativeVisible,
		display: display.caveman === undefined ? legacyCaveman.display ?? cavemanDisplay : cavemanDisplay,
	});

	const legacyHeadroom =
		behavior.headroom === undefined || display.headroom === undefined ? asRecord(legacy.headroom) : {};
	const rootHeadroomDisplay = asRecord(display.headroom);
	const rootHeadroomBehavior = asRecord(behavior.headroom);
	const headroomDisplay =
		display.headroom === undefined ? asRecord(legacyHeadroom.display) : rootHeadroomDisplay;
	const headroom = normalizeHeadroomConfig({
		...legacyHeadroom,
		...rootHeadroomBehavior,
		display: headroomDisplay,
	});
	const proxyTokenFile =
		typeof rootHeadroomBehavior.proxyTokenFile === "string"
			? rootHeadroomBehavior.proxyTokenFile
			: typeof rootHeadroomBehavior.tokenFile === "string"
				? rootHeadroomBehavior.tokenFile
				: typeof legacyHeadroom.proxyTokenFile === "string"
					? legacyHeadroom.proxyTokenFile
					: HEADROOM_PROXY_TOKEN_FILE;

	const legacyPrompt =
		display.promptBorder === undefined || display.contextRail === undefined ? asRecord(legacy.promptBorder) : {};
	const rootPrompt = asRecord(display.promptBorder);
	const rootRail = display.contextRail;
	const prompt = normalizePromptBorderConfig({
		...legacyPrompt,
		promptBorder: mergeRecords(legacyPrompt.promptBorder, rootPrompt),
		contextRail: rootRail ?? legacyPrompt.contextRail,
	});

	return {
		display: {
			sharedDisplay,
			caveman: { nativeVisible: caveman.nativeVisible, display: clone(caveman.display) },
			headroom: clone(headroom.display),
			promptBorder: {
				style: prompt.style,
				layout: prompt.layout,
			},
			contextRail: clone(prompt.contextRail),
		},
		behavior: {
			caveman: { defaultLevel: caveman.defaultLevel },
			headroom: {
				enabled: headroom.enabled,
				baseUrl: headroom.baseUrl,
				allowRemote: headroom.allowRemote,
				autoStart: headroom.autoStart,
				command: headroom.command,
				minContextTokens: headroom.minContextTokens,
				minMessageChars: headroom.minMessageChars,
				timeoutMs: headroom.timeoutMs,
				proxyTokenFile,
			},
		},
	};
}

/** Build normalized settings draft from root v1 config only. Pure and filesystem-free. */
export function draftFromRootConfig(raw: unknown): UnifiedSettingsDraft {
	return createDraft(raw);
}

/** Map staged draft into root v1 display/behavior sections. Glyph bytes stay external. */
export function draftToRootSections(draft: UnifiedSettingsDraft): {
	display: Record<string, unknown>;
	behavior: Record<string, unknown>;
} {
	const shared = draft.display.sharedDisplay;
	const headroomDisplay = draft.display.headroom;
	const promptBorder = draft.display.promptBorder;
	const rail = draft.display.contextRail;
	const serializeRole = (role: (typeof CONTEXT_RAIL_ROLES)[number]): Record<string, unknown> => {
		const value = rail[role];
		const serialized: Record<string, unknown> = {
			framesFile: value.framesFile,
			meaning: value.meaning,
		};
		if (role === "pointer") serialized.visibility = rail.pointer.visibility;
		return serialized;
	};
	return {
		display: {
			sharedDisplay: {
				enabled: shared.enabled,
				layout: shared.layout,
				order: [...shared.order],
				widgetPlacement: shared.widgetPlacement,
				horizontalSeparator: shared.horizontalSeparator,
				verticalGapRows: shared.verticalGapRows,
				ponytail: { ...shared.ponytail },
			},
			caveman: {
				...draft.display.caveman.display,
				nativeVisible: draft.display.caveman.nativeVisible,
			},
			headroom: {
				visible: headroomDisplay.visible,
				glyphDirectory: headroomDisplay.glyphDirectory,
				template: headroomDisplay.template,
				status: { ...headroomDisplay.status },
			},
			promptBorder: {
				style: promptBorder.style,
				layout: promptBorder.layout,
			},
			contextRail: {
				enabled: rail.enabled,
				placement: rail.placement,
				visibility: rail.visibility,
				mode: rail.mode,
				speculation: serializeRole("speculation"),
				pointer: serializeRole("pointer"),
				compaction: serializeRole("compaction"),
				maximum: serializeRole("maximum"),
				custom: {
					meaningPlacement: rail.custom.meaningPlacement,
					items: rail.custom.items.map(item => ({ role: item.role, template: item.template })),
				},
				labels: rail.labels,
				labelPosition: rail.labelPosition,
				showLabelGlyph: rail.showLabelGlyph !== false,
				glyphDirectory: rail.glyphDirectory,
			},
		},
		behavior: {
			caveman: { defaultLevel: draft.behavior.caveman.defaultLevel },
			headroom: { ...draft.behavior.headroom, autoStart: false },
		},
	};
}

export const mapDraftToRootSections = draftToRootSections;
export const rootSectionsFromDraft = draftToRootSections;

type LegacySource = { path: string; value: Record<string, unknown>; raw: string };

function legacyAgentDirectory(): string {
	if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
	if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "pi", "agent");
	return path.join(os.homedir(), ".pi", "agent");
}

function firstLegacySource(paths: readonly string[]): LegacySource | undefined {
	for (const filePath of new Set(paths)) {
		const source = readLegacySource(filePath);
		if (source) return source;
	}
	return undefined;
}

const LEGACY_PROMPT_BORDER_KEYS = ["style", "layout", "leftGlyph", "rightGlyph", "spinnerGlyphs"] as const;

function firstLegacyPromptBorderSource(paths: readonly string[]): LegacySource | undefined {
	for (const filePath of new Set(paths)) {
		const source = readLegacySource(filePath);
		if (
			source &&
			(isRecord(source.value.promptBorder) ||
				isRecord(source.value.contextRail) ||
				LEGACY_PROMPT_BORDER_KEYS.some(key => key in source.value))
		) {
			return source;
		}
	}
	return undefined;
}

function loadLegacySources(root: CodesookOmpConfig): { sources: LegacySources; migrated: LegacySource[] } {
	const display = asRecord(root.display);
	const behavior = asRecord(root.behavior);
	const sources: LegacySources = {};
	const migrated: LegacySource[] = [];
	const agentDirectory = legacyAgentDirectory();
	const codesookConfigDirectory = path.dirname(path.dirname(LEGACY_SHARED_DISPLAY_CONFIG_PATH));

	if (display.sharedDisplay === undefined) {
		const source = firstLegacySource([LEGACY_SHARED_DISPLAY_CONFIG_PATH]);
		if (source) {
			sources.sharedDisplay = source.value;
			migrated.push(source);
		}
	}
	if (display.caveman === undefined || behavior.caveman === undefined) {
		const packageSource = firstLegacySource([LEGACY_CAVEMAN_CONFIG_PATH]);
		const source = packageSource ?? firstLegacySource([path.join(agentDirectory, "caveman.json")]);
		if (source) {
			sources.caveman =
				source.path === LEGACY_CAVEMAN_CONFIG_PATH ? source.value : normalizeLegacyCavemanConfig(source.value);
			migrated.push(source);
		}
	}
	if (display.headroom === undefined || behavior.headroom === undefined) {
		const operational = firstLegacySource([
			LEGACY_HEADROOM_CONFIG_PATH,
			path.join(codesookConfigDirectory, "headroom", "settings.json"),
			path.join(os.homedir(), ".pi", "agent", "headroom", "settings.json"),
			path.join(agentDirectory, "headroom", "settings.json"),
		]);
		const displaySource = firstLegacySource([
			path.join(codesookConfigDirectory, "headroom", "display-config.json"),
		]);
		if (operational) {
			sources.headroom = {
				...operational.value,
				...(displaySource ? { display: displaySource.value } : {}),
			};
			migrated.push(operational);
		} else if (displaySource) {
			sources.headroom = { display: displaySource.value };
		}
		if (displaySource) migrated.push(displaySource);
	}
	if (display.promptBorder === undefined || display.contextRail === undefined) {
		const source = firstLegacyPromptBorderSource([LEGACY_PROMPT_BORDER_CONFIG_PATH]);
		if (source) {
			sources.promptBorder = source.value;
			migrated.push(source);
		}
	}
	return { sources, migrated };
}

function loadDraftFromDisk(configPath = CODESOOK_OMP_CONFIG_PATH): {
	config: CodesookOmpConfigReadResult;
	draft: UnifiedSettingsDraft;
	legacySources: readonly LegacySource[];
} {
	const config = readCodesookOmpConfig(configPath);
	const legacy = config.valid ? loadLegacySources(config.value) : { sources: {}, migrated: [] };
	return {
		config,
		draft: createDraft(config.valid ? config.value : undefined, legacy.sources),
		legacySources: legacy.migrated,
	};
}

function removeMigratedLegacySources(sources: readonly LegacySource[]): void {
	for (const source of sources) {
		let raw: string;
		try {
			raw = readFileSync(source.path, "utf8");
		} catch {
			continue;
		}
		if (raw !== source.raw) continue;
		try {
			unlinkSync(source.path);
		} catch {
			// Keep valid legacy settings when cleanup cannot complete.
		}
	}
}

/** Persist staged settings atomically while retaining unknown root and nested keys. */
export function persistDraftToRoot(
	draft: UnifiedSettingsDraft,
	configPath = CODESOOK_OMP_CONFIG_PATH,
	legacySources: readonly LegacySource[] = [],
): CodesookOmpConfig {
	const current = readCodesookOmpConfig(configPath);
	if (current.exists && !current.valid) throw new Error(`Invalid Codesook OMP config: ${configPath}`);
	const sections = draftToRootSections(draft);
	const next = clone(current.value) as CodesookOmpConfig & Record<string, unknown>;
	next.display = mergeRecords(next.display, sections.display);
	next.behavior = mergeRecords(next.behavior, sections.behavior);
	const promptBorder = asRecord(next.display.promptBorder);
	delete promptBorder.frameMs;
	delete asRecord(promptBorder.leftGlyph).frameMs;
	delete asRecord(promptBorder.rightGlyph).frameMs;
	const spinnerGlyphs = asRecord(promptBorder.spinnerGlyphs);
	delete asRecord(spinnerGlyphs.status).frameMs;
	delete asRecord(spinnerGlyphs.activity).frameMs;
	const contextRail = asRecord(next.display.contextRail);
	for (const role of CONTEXT_RAIL_ROLES) delete asRecord(contextRail[role]).fps;
	writeCodesookOmpConfig(next, configPath);
	removeMigratedLegacySources(legacySources);
	return next;
}
type InitAsset = { path: string; content: string };

function staticAssetContent(source: string): string {
	const frame = parseFrameSequenceAsset(source)?.frames[0];
	return frame === undefined ? "" : `${frame.join("\n")}\n`;
}

function resolveGlyphDirectory(directory: string): string {
	if (directory === "~") return os.homedir();
	if (directory.startsWith("~/")) return path.join(os.homedir(), directory.slice(2));
	return directory;
}

function themeSymbol(theme: unknown, name: string, fallback: string): string {
	try {
		const symbol = isRecord(theme) ? theme.symbol : undefined;
		if (typeof symbol !== "function") return fallback;
		const value = symbol.call(theme, name);
		return typeof value === "string" && value.trim().length > 0 ? value : fallback;
	} catch {
		return fallback;
	}
}

function writeMissingFile(filePath: string, content: string): boolean {
	mkdirSync(path.dirname(filePath), { recursive: true });
	try {
		writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
		return true;
	} catch (error) {
		if (isRecord(error) && error.code === "EEXIST") return false;
		throw error;
	}
}

function configuredInitAssets(draft: UnifiedSettingsDraft, theme: unknown): InitAsset[] {
	const assets: InitAsset[] = [];
	const ponytailDirectory = resolveGlyphDirectory(draft.display.sharedDisplay.ponytail.glyphDirectory);
	for (const mode of ["off", "lite", "full", "ultra", "review"] as const) {
		const frame = loadPackagedPonytailSequence(mode)?.frames[0];
		assets.push({
			path: path.join(ponytailDirectory, `${mode}.txt`),
			content: frame === undefined ? "" : `${frame.join("\n")}\n`,
		});
	}
	const cavemanDirectory = resolveGlyphDirectory(draft.display.caveman.display.glyphDirectory);
	for (const level of CAVEMAN_ACTIVE_LEVELS) {
		const source = readFileSync(path.join(PACKAGE_ASSET_DIRECTORY, `${level}.txt`), "utf8");
		assets.push({
			path: path.join(cavemanDirectory, `${level}.txt`),
			content: staticAssetContent(source),
		});
	}

	const headroomDirectory = resolveGlyphDirectory(draft.display.headroom.glyphDirectory);
	for (const state of DISPLAY_STATES) {
		assets.push({
			path: path.join(headroomDirectory, `${state}.txt`),
			content: `${resolveThemeGlyph(theme, state) || DEFAULT_GLYPHS[state]}\n`,
		});
	}

	const promptDefaults = [
		{ path: DEFAULT_LEFT_GLYPH_TEXT_PATH, content: staticAssetContent(DEFAULT_LEFT_GLYPH_TEXT) },
		{ path: DEFAULT_RIGHT_GLYPH_TEXT_PATH, content: "" },
		{ path: DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, content: "" },
		{ path: DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH, content: "" },
	];
	assets.push(...promptDefaults);

	const rail = draft.display.contextRail;
	const railDirectory = resolveGlyphDirectory(rail.glyphDirectory);
	const roleGlyphs: Record<(typeof CONTEXT_RAIL_ROLES)[number], string> = {
		speculation: themeSymbol(theme, "context.speculation", "╎"),
		pointer: themeSymbol(theme, "context.pointer", "●"),
		compaction: themeSymbol(theme, "context.compaction", "┃"),
		maximum: themeSymbol(theme, "boxRound.vertical", "│"),
	};
	assets.push(
		{ path: path.join(railDirectory, "label.txt"), content: `${themeSymbol(theme, "status.success", "✓")}\n` },
		{ path: path.join(railDirectory, "pointer.txt"), content: `${roleGlyphs.pointer}\n` },
		...CONTEXT_RAIL_ROLES.map(role => ({
			path: path.join(railDirectory, rail[role].framesFile),
			content: `${roleGlyphs[role]}\n`,
		})),
	);
	return assets;
}

function initializePluginConfig(ctx: ExtensionContext): void {
	const created: string[] = [];
	const existed: string[] = [];
	const failed: string[] = [];
	const configPath = CODESOOK_OMP_CONFIG_PATH;
	const configBefore = readCodesookOmpConfig(configPath);
	if (configBefore.exists) {
		existed.push(`${configPath} (config)`);
	} else {
		try {
			const config = defaultCodesookOmpConfig();
			const sections = draftToRootSections(createDraft(undefined));
			config.display = sections.display;
			config.behavior = sections.behavior;
			const wroteConfig = writeMissingFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
			(wroteConfig ? created : existed).push(`${configPath} (config)`);
		} catch (error) {
			failed.push(`${configPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const root = readCodesookOmpConfig(configPath);
	const draft = draftFromRootConfig(root.valid ? root.value : undefined);
	try {
		const uniqueAssets = new Map<string, InitAsset>();
		for (const asset of configuredInitAssets(draft, ctx.ui.theme)) {
			uniqueAssets.set(path.resolve(asset.path), asset);
		}
		for (const asset of uniqueAssets.values()) {
			try {
				(writeMissingFile(asset.path, asset.content) ? created : existed).push(asset.path);
			} catch (error) {
				failed.push(`${asset.path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	} catch (error) {
		failed.push(`Could not load packaged glyph defaults: ${error instanceof Error ? error.message : String(error)}`);
	}

	ctx.ui.notify(
		[
			`Created (${created.length}):`,
			...(created.length > 0 ? created : ["none"]),
			`Already existed (${existed.length}):`,
			...(existed.length > 0 ? existed : ["none"]),
			...(failed.length > 0 ? [`Failed (${failed.length}):`, ...failed] : []),
		].join("\n"),
		failed.length > 0 ? "error" : "info",
	);
}


function validateDraft(draft: UnifiedSettingsDraft): string | undefined {
	const sharedErrors = validateSharedDisplayConfig(clone(draft.display.sharedDisplay));
	if (sharedErrors.length > 0) return sharedErrors[0];
	const cavemanError = validateCavemanConfig({
		defaultLevel: draft.behavior.caveman.defaultLevel,
		nativeVisible: draft.display.caveman.nativeVisible,
		display: draft.display.caveman.display,
	});
	if (cavemanError) return cavemanError;
	const headroom = draft.behavior.headroom;
	try {
		const url = new URL(headroom.baseUrl);
		if (!/^https?:$/u.test(url.protocol) || !url.hostname) return "Headroom Base URL must be an HTTP(S) URL with hostname.";
	} catch {
		return "Headroom Base URL must be an HTTP(S) URL with hostname.";
	}
	if (!headroom.command.trim()) return "Headroom command must not be empty.";
	if (!headroom.proxyTokenFile.trim()) return "Headroom proxy token file must not be empty.";
	if (!Number.isSafeInteger(headroom.minContextTokens) || headroom.minContextTokens < 0) return "Headroom minimum context tokens must be a non-negative integer.";
	if (!Number.isSafeInteger(headroom.minMessageChars) || headroom.minMessageChars < 1) return "Headroom minimum message chars must be at least 1.";
	if (!Number.isSafeInteger(headroom.timeoutMs) || headroom.timeoutMs < 100) return "Headroom timeout must be an integer of at least 100 ms.";
	if (!isBorderStyleName(draft.display.promptBorder.style)) return "Prompt Border style is invalid.";
	if (!isBorderLayoutName(draft.display.promptBorder.layout)) return "Prompt Border layout is invalid.";
	const rail = draft.display.contextRail;
	if (typeof rail.enabled !== "boolean") return "Context Rail enabled must be boolean.";
	if (!RAIL_PLACEMENTS.includes(rail.placement)) return "Context Rail placement is invalid.";
	if (!RAIL_VISIBILITIES.includes(rail.visibility)) return "Context Rail visibility is invalid.";
	if (!RAIL_MODES.includes(rail.mode)) return "Context Rail mode is invalid.";
	if (!RAIL_LABELS.includes(rail.labels)) return "Context Rail labels are invalid.";
	if (!RAIL_LABEL_POSITIONS.includes(rail.labelPosition)) return "Context Rail label position is invalid.";
	if (!RAIL_POINTERS.includes(rail.pointer.visibility)) return "Context Rail pointer visibility is invalid.";
	if (!RAIL_MEANING_PLACEMENTS.includes(rail.custom.meaningPlacement)) return "Context Rail meaning placement is invalid.";
	if (!rail.glyphDirectory.trim()) return "Context Rail glyph directory must not be empty.";
	for (const role of CONTEXT_RAIL_ROLES) {
		const config = rail[role];
		if (!config.framesFile.trim() || !config.meaning.trim()) return `Context Rail ${role} files and meaning must not be empty.`;
	}
	const shared = draft.display.sharedDisplay;
	if (!SHARED_LAYOUTS.includes(shared.layout) || !SHARED_PLACEMENTS.includes(shared.widgetPlacement)) return "Shared Display layout or placement is invalid.";
	if (!Number.isSafeInteger(shared.verticalGapRows) || shared.verticalGapRows < 0 || shared.verticalGapRows > 10) return "Shared Display gap must be an integer from 0 through 10.";
	if (/\r|\n/u.test(shared.horizontalSeparator)) return "Shared Display separator must be single-line.";
	return undefined;
}

function inputSubmenu(current: string, done: (value?: string) => void): Component {
	const input = new Input();
	input.prompt = "> ";
	input.setValue(current);
	input.onSubmit = value => done(value);
	input.onEscape = () => done(undefined);
	return input;
}

function boolItem(
	id: string,
	label: string,
	value: boolean,
	description: string,
	warning?: string,
	readOnly = false,
): SettingItem {
	return {
		id,
		label,
		currentValue: String(value),
		description,
		warning,
		...(readOnly ? {} : { values: ["true", "false"] }),
	};
}

function selectItem(
	id: string,
	label: string,
	value: string,
	values: readonly string[],
	description: string,
	warning?: string,
	readOnly = false,
): SettingItem {
	return {
		id,
		label,
		currentValue: value,
		description,
		warning,
		...(readOnly ? {} : { values: [...values] }),
	};
}

function textItem(
	id: string,
	label: string,
	value: string,
	description: string,
	warning?: string,
	readOnly = false,
): SettingItem {
	return {
		id,
		label,
		currentValue: value,
		description,
		warning,
		...(readOnly ? {} : { submenu: (current, done) => inputSubmenu(current, done) }),
	};
}

function numberItem(
	id: string,
	label: string,
	value: number,
	description: string,
	warning?: string,
): SettingItem {
	return textItem(id, label, String(value), description, warning);
}

function settingsItems(
	draft: UnifiedSettingsDraft,
	presence: PluginPresence,
): SettingItem[] {
	const ponytailWarning = presence.ponytail
		? undefined
		: "Ponytail is not installed; rows are read-only. Install @dietrichgebert/ponytail to edit these controls.";
	const headroomWarning = featureWarning(presence, "headroom");
	const cavemanWarning = featureWarning(presence, "caveman");
	const sharedWarning = featureWarning(presence, "shared-display");
	const promptWarning = featureWarning(presence, "prompt-border-style");
	const shared = draft.display.sharedDisplay;
	const caveman = draft.display.caveman;
	const headroom = draft.display.headroom;
	const behavior = draft.behavior;
	const rail = draft.display.contextRail;
	const roleItems = CONTEXT_RAIL_ROLES.flatMap(role => {
		const roleConfig = rail[role];
		return [
			{ id: `rail.${role}.heading`, label: role, currentValue: "", heading: true } satisfies SettingItem,
			textItem(`rail.${role}.framesFile`, "Frames file", roleConfig.framesFile, "External frame asset file name; frame bytes never enter root config.", promptWarning),
			textItem(`rail.${role}.meaning`, "Meaning", roleConfig.meaning, "Meaning text used by full/custom rail modes.", promptWarning),
			...(role === "pointer"
				? [selectItem("rail.pointer.visibility", "Pointer visibility", rail.pointer.visibility, RAIL_POINTERS, "Visibility policy for current-usage pointer.", promptWarning)]
				: []),
		];
	});
	return [
		{ id: "section:presence", label: "Presence (read-only)", currentValue: "", heading: true },
		{
			id: "presence.ponytail",
			label: "Ponytail",
			currentValue: presence.ponytail ? `installed${presence.ponytailEnabled ? ", enabled" : ", disabled"}` : "not installed",
			warning: ponytailWarning,
			description: presence.ponytail
				? "External lifecycle is informational. Use /ponytail off|lite|full for current-session mode; settings apply on next start."
				: "No editable values until external Ponytail package is installed.",
		},
		...PROJECT_FEATURES.map(feature => ({
			id: `presence.${feature}`,
			label: feature,
			currentValue: featureEnabled(presence, feature) ? "enabled (next start)" : "not enabled",
			warning: featureWarning(presence, feature),
			description: "OMP lifecycle state is informational; this surface does not unload or load extensions.",
		})),
		{ id: "section:shared", label: "Shared Display", currentValue: "", heading: true },
		boolItem("shared.enabled", "Enabled", shared.enabled, "Enable shared host composition and widget.", sharedWarning),
		selectItem("shared.layout", "Layout", shared.layout, SHARED_LAYOUTS, "Horizontal or vertical source composition.", sharedWarning),
		textItem("shared.order", "Source order", shared.order.join(","), "Comma-separated ponytail,caveman,headroom order.", sharedWarning),
		selectItem("shared.placement", "Placement", shared.widgetPlacement, SHARED_PLACEMENTS, "Widget placement relative to editor.", sharedWarning),
		textItem("shared.separator", "Separator", shared.horizontalSeparator, "One-line separator for horizontal layout.", sharedWarning),
		numberItem("shared.gap", "Vertical gap", shared.verticalGapRows, "Blank rows between vertical sources, 0-10.", sharedWarning),
		{ id: "section:ponytail", label: "Ponytail Display", currentValue: "", heading: true },
		boolItem("ponytail.visible", "Visible", shared.ponytail.visible, "Include Ponytail segment in Shared Display.", ponytailWarning, !presence.ponytail),
		boolItem("ponytail.nativeVisible", "Native status", shared.ponytail.nativeVisible, "Show captured Ponytail text in OMP native footer.", ponytailWarning, !presence.ponytail),
		textItem("ponytail.template", "Template", shared.ponytail.template, "Tokens: {activity}, {glyph}, {modeIcon}, {mode}.", ponytailWarning, !presence.ponytail),
		textItem("ponytail.glyphDirectory", "Glyph directory", shared.ponytail.glyphDirectory, "External Ponytail glyph directory; frame contents stay in files.", ponytailWarning, !presence.ponytail),
		{ id: "section:caveman", label: "Caveman", currentValue: "", heading: true },
		selectItem("caveman.defaultLevel", "Default level", behavior.caveman.defaultLevel, CAVEMAN_LEVELS, "Behavior default. Live only when Caveman extension is loaded.", cavemanWarning),
		boolItem("caveman.nativeVisible", "Native status", caveman.nativeVisible, "Show Caveman in OMP native footer.", cavemanWarning),
		boolItem("caveman.visible", "Display visible", caveman.display.visible, "Publish Caveman segment to Shared Display.", cavemanWarning),
		textItem("caveman.template", "Display template", caveman.display.template, "Tokens: {activity}, {glyph}, {level}.", cavemanWarning),
		textItem("caveman.glyphDirectory", "Glyph directory", caveman.display.glyphDirectory, "External Caveman glyph directory; frame contents stay in files.", cavemanWarning),
		{ id: "section:headroom", label: "Headroom", currentValue: "", heading: true },
		boolItem("headroom.enabled", "Enabled", behavior.headroom.enabled, "Compression behavior; live only when Headroom extension is loaded.", headroomWarning),
		textItem("headroom.baseUrl", "Base URL", behavior.headroom.baseUrl, "HTTP(S) proxy URL; remote hosts require Allow remote.", headroomWarning),
		boolItem("headroom.allowRemote", "Allow remote", behavior.headroom.allowRemote, "Allow sending context to non-local proxy.", headroomWarning),
		boolItem("headroom.autoStart", "Auto-start", false, "Disabled: Headroom proxy lifecycle is external.", headroomWarning, true),
		textItem("headroom.command", "Command", behavior.headroom.command, "Command shown in manual proxy hint; OMP never starts it.", headroomWarning),
		numberItem("headroom.minContextTokens", "Minimum context tokens", behavior.headroom.minContextTokens, "Compression threshold.", headroomWarning),
		numberItem("headroom.minMessageChars", "Minimum message chars", behavior.headroom.minMessageChars, "Minimum toolResult size.", headroomWarning),
		numberItem("headroom.timeoutMs", "Timeout (ms)", behavior.headroom.timeoutMs, "Health, stats, and compression request timeout.", headroomWarning),
		textItem("headroom.proxyTokenFile", "Token file", behavior.headroom.proxyTokenFile, "External proxy token file path; token contents never enter root config.", headroomWarning),
		boolItem("headroom.visible", "Display visible", headroom.visible, "Publish Headroom status to Shared Display.", headroomWarning),
		textItem("headroom.template", "Display template", headroom.template, "Outer template; state templates supply {status}.", headroomWarning),
		textItem("headroom.glyphDirectory", "Glyph directory", headroom.glyphDirectory, "External Headroom state glyph directory; frame contents stay in files.", headroomWarning),
		...Object.keys(headroom.status).map(state =>
			textItem(`headroom.status.${state}`, `${state} template`, headroom.status[state as keyof typeof headroom.status], "Single-line Headroom state template.", headroomWarning),
		),
		{ id: "section:prompt", label: "Prompt Border", currentValue: "", heading: true },
		selectItem("prompt.style", "Style", draft.display.promptBorder.style, Object.keys(borderStyles) as BorderStyleName[], "Prompt border style.", promptWarning),
		selectItem("prompt.layout", "Layout", draft.display.promptBorder.layout, ["full", "bottom", "sides", "top-bottom", "default"], "Prompt border layout.", promptWarning),
		{ id: "section:rail", label: "Context Rail", currentValue: "", heading: true },
		boolItem("rail.enabled", "Enabled", rail.enabled, "Render plugin Context Rail; native context gauge remains independent.", promptWarning),
		selectItem("rail.placement", "Placement", rail.placement, RAIL_PLACEMENTS, "Place rail inside, above, or below prompt editor.", promptWarning),
		selectItem("rail.visibility", "Visibility", rail.visibility, RAIL_VISIBILITIES, "Always, toggle, or collapse while typing.", promptWarning),
		selectItem("rail.mode", "Mode", rail.mode, RAIL_MODES, "Compact, full, or custom presentation.", promptWarning),
		selectItem("rail.labels", "Labels", rail.labels, RAIL_LABELS, "Label policy for rail annotations.", promptWarning),
		selectItem("rail.labelPosition", "Label position", rail.labelPosition, RAIL_LABEL_POSITIONS, "Label/art alignment position.", promptWarning),
		textItem("rail.glyphDirectory", "Glyph directory", rail.glyphDirectory, "External label/pointer/role asset directory; frame contents stay in files.", promptWarning),
		selectItem("rail.meaningPlacement", "Meaning placement", rail.custom.meaningPlacement, RAIL_MEANING_PLACEMENTS, "Custom mode meaning placement.", promptWarning),
		...roleItems,
		{ id: "section:actions", label: "Actions", currentValue: "", heading: true },
		{ id: STATUS_ACTION_ID, label: "Show status", currentValue: "Enter", description: "Open focused read-only status overlay; Enter/Esc closes without affecting prompt input." },
		{ id: RELOAD_ACTION_ID, label: "Reload from disk", currentValue: "Enter", description: "Discard draft edits and reread root config; live settings stay unchanged." },
		{ id: APPLY_ACTION_ID, label: "Apply changes", currentValue: "Enter", description: "Shift+Enter applies directly. Bare Enter asks confirmation, then atomically writes root config and emits live-change event." },
		{ id: CANCEL_ACTION_ID, label: "Cancel", currentValue: "Enter", description: "Close without saving draft or changing live settings." },
	];
}

function trackTextSubmenus(
	items: SettingItem[],
	onOpen: () => void,
	onClose: () => void,
): SettingItem[] {
	return items.map(item => {
		const submenu = item.submenu;
		if (!submenu) return item;
		return {
			...item,
			submenu: (current, done) => {
				onOpen();
				let closed = false;
				const finish = (value?: string): void => {
					if (closed) return;
					closed = true;
					onClose();
					done(value);
				};
				return submenu(current, finish);
			},
		};
	});
}

function updateDraft(draft: UnifiedSettingsDraft, id: string, value: string): void {
	const bool = value === "true";
	switch (id) {
		case "shared.enabled": draft.display.sharedDisplay.enabled = bool; return;
		case "shared.layout": if (SHARED_LAYOUTS.includes(value as SharedDisplayLayout)) draft.display.sharedDisplay.layout = value as SharedDisplayLayout; return;
		case "shared.order": draft.display.sharedDisplay.order = value.split(",").map(item => item.trim()).filter(isDisplaySource); return;
		case "shared.placement": if (SHARED_PLACEMENTS.includes(value as SharedDisplayPlacement)) draft.display.sharedDisplay.widgetPlacement = value as SharedDisplayPlacement; return;
		case "shared.separator": draft.display.sharedDisplay.horizontalSeparator = value; return;
		case "shared.gap": draft.display.sharedDisplay.verticalGapRows = Number(value); return;
		case "ponytail.visible": draft.display.sharedDisplay.ponytail.visible = bool; return;
		case "ponytail.nativeVisible": draft.display.sharedDisplay.ponytail.nativeVisible = bool; return;
		case "ponytail.template": draft.display.sharedDisplay.ponytail.template = value; return;
		case "ponytail.glyphDirectory": draft.display.sharedDisplay.ponytail.glyphDirectory = value; return;
		case "caveman.defaultLevel": if (CAVEMAN_LEVELS.includes(value as CavemanLevel)) draft.behavior.caveman.defaultLevel = value as CavemanLevel; return;
		case "caveman.nativeVisible": draft.display.caveman.nativeVisible = bool; return;
		case "caveman.visible": draft.display.caveman.display.visible = bool; return;
		case "caveman.template": draft.display.caveman.display.template = value; return;
		case "caveman.glyphDirectory": draft.display.caveman.display.glyphDirectory = value; return;
		case "headroom.enabled": draft.behavior.headroom.enabled = bool; return;
		case "headroom.baseUrl": draft.behavior.headroom.baseUrl = value; return;
		case "headroom.allowRemote": draft.behavior.headroom.allowRemote = bool; return;
		case "headroom.autoStart": return;
		case "headroom.command": draft.behavior.headroom.command = value; return;
		case "headroom.minContextTokens": draft.behavior.headroom.minContextTokens = Number(value); return;
		case "headroom.minMessageChars": draft.behavior.headroom.minMessageChars = Number(value); return;
		case "headroom.timeoutMs": draft.behavior.headroom.timeoutMs = Number(value); return;
		case "headroom.proxyTokenFile": draft.behavior.headroom.proxyTokenFile = value; return;
		case "headroom.visible": draft.display.headroom.visible = bool; return;
		case "headroom.template": draft.display.headroom.template = value; return;
		case "headroom.glyphDirectory": draft.display.headroom.glyphDirectory = value; return;
		case "prompt.style": if (isBorderStyleName(value)) draft.display.promptBorder.style = value; return;
		case "prompt.layout": if (isBorderLayoutName(value)) draft.display.promptBorder.layout = value; return;
		case "rail.enabled": draft.display.contextRail.enabled = bool; return;
		case "rail.placement": if (RAIL_PLACEMENTS.includes(value as ContextRailPlacement)) draft.display.contextRail.placement = value as ContextRailPlacement; return;
		case "rail.visibility": if (RAIL_VISIBILITIES.includes(value as ContextRailVisibility)) draft.display.contextRail.visibility = value as ContextRailVisibility; return;
		case "rail.mode": if (RAIL_MODES.includes(value as ContextRailMode)) draft.display.contextRail.mode = value as ContextRailMode; return;
		case "rail.labels": if (RAIL_LABELS.includes(value as ContextRailLabels)) draft.display.contextRail.labels = value as ContextRailLabels; return;
		case "rail.labelPosition": if (RAIL_LABEL_POSITIONS.includes(value as ContextRailLabelPosition)) draft.display.contextRail.labelPosition = value as ContextRailLabelPosition; return;
		case "rail.glyphDirectory": draft.display.contextRail.glyphDirectory = value; return;
		case "rail.meaningPlacement": if (RAIL_MEANING_PLACEMENTS.includes(value as ContextRailMeaningPlacement)) draft.display.contextRail.custom.meaningPlacement = value as ContextRailMeaningPlacement; return;
	}
	if (id.startsWith("headroom.status.")) {
		const state = id.slice("headroom.status.".length) as keyof typeof draft.display.headroom.status;
		if (state in draft.display.headroom.status) draft.display.headroom.status[state] = value;
		return;
	}
	if (id.startsWith("rail.") && id.endsWith(".framesFile")) {
		const role = id.split(".")[1] as (typeof CONTEXT_RAIL_ROLES)[number];
		draft.display.contextRail[role].framesFile = value;
	} else if (id.startsWith("rail.") && id.endsWith(".meaning")) {
		const role = id.split(".")[1] as (typeof CONTEXT_RAIL_ROLES)[number];
		draft.display.contextRail[role].meaning = value;
	}
}

async function detectPresence(pi: ExtensionAPI): Promise<{ presence: PluginPresence; error?: string }> {
	try {
		const result = await pi.exec("omp", ["plugin", "list", "--json"], { timeout: 5000 });
		const presence = parsePluginList(result.stdout);
		return result.code === 0
			? { presence }
			: { presence, error: result.stderr.trim() || `omp plugin list exited with ${result.code}` };
	} catch (error) {
		return { presence: parsePluginList(undefined), error: error instanceof Error ? error.message : String(error) };
	}
}

function statusText(snapshot: StatusSnapshot): string {
	if (!snapshot.presence) return "Loading…";
	const presence = snapshot.presence;
	const root = snapshot.root;
	const lines = [
		"Codesook OMP Plugin",
		`Root config: ${CODESOOK_OMP_CONFIG_PATH}${root?.exists ? (root.valid ? " (valid)" : " (invalid)") : " (not created)"}`,
		`Ponytail: ${presence.ponytail ? `installed${presence.ponytailEnabled ? ", enabled" : ", disabled"}` : "not installed"}`,
		`omp-plugins: ${presence.ompPlugins ? `installed${presence.ompPluginsEnabled ? ", enabled" : ", disabled"}` : "not installed"}`,
		...PROJECT_FEATURES.map(feature => `  ${feature}: ${featureEnabled(presence, feature) ? "enabled for next start" : "not enabled"}`),
		"",
		"Lifecycle toggles are informational; this extension does not unload or load plugins.",
		"Ponytail live mode: /ponytail off|lite|full.",
	];
	if (snapshot.error) lines.push(`Plugin detection warning: ${snapshot.error}`);
	return lines.join("\n");
}

async function showStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
		const [detected] = await Promise.all([detectPresence(pi)]);
		ctx.ui.notify(statusText({ presence: detected.presence, root: readCodesookOmpConfig() }), "info");
		return;
	}
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			let snapshot: StatusSnapshot = {};
			let closed = false;
			void Promise.all([detectPresence(pi)]).then(([detected]) => {
				if (closed) return;
				snapshot = { presence: detected.presence, error: detected.error, root: readCodesookOmpConfig() };
				tui.requestRender();
			});
			const component: Component = {
				render(width: number): readonly string[] {
					const body = statusText(snapshot).split("\n");
					return [theme.fg("accent", theme.bold("Codesook OMP Plugin Status")), ...body.map(line => line.length > width ? line.slice(0, width) : line), "", theme.fg("dim", "Enter/Esc close")];
				},
				handleInput(data: string): void {
					if (isEnter(data) || isEscape(data)) {
						closed = true;
						done(undefined);
					}
				},
				invalidate(): void {},
			};
			return component;
		},
		{ overlay: true },
	);
}

async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
		ctx.ui.notify("Codesook OMP Plugin settings require an interactive UI.", "warning");
		return;
	}
	const [{ presence, error: presenceError }, loaded] = await Promise.all([detectPresence(pi), Promise.resolve(loadDraftFromDisk())]);
	let draft = loaded.draft;
	let legacySources = loaded.legacySources;
	let error = loaded.config.exists && !loaded.config.valid ? `Invalid root config: ${CODESOOK_OMP_CONFIG_PATH}` : presenceError;
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			let list: SettingsList;
			let closed = false;
			let textSubmenuOpen = false;
			let valueSubmenuOpen = false;
			const trackedItems = (): SettingItem[] =>
				trackTextSubmenus(
					settingsItems(draft, presence),
					() => {
						textSubmenuOpen = true;
					},
					() => {
						textSubmenuOpen = false;
					},
				);
			const finish = (): void => {
				if (closed) return;
				closed = true;
				done(undefined);
			};
			const refresh = (): void => list.setItems(trackedItems());
			const apply = async (confirmed: boolean): Promise<void> => {
				if (closed || !confirmed) return;
				const validation = validateDraft(draft);
				if (validation) {
					error = validation;
					tui.requestRender();
					return;
				}
				try {
					const config = persistDraftToRoot(draft, CODESOOK_OMP_CONFIG_PATH, legacySources);
					try {
						pi.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config });
					} catch (eventError) {
						error = `Saved, but live-change event failed: ${eventError instanceof Error ? eventError.message : String(eventError)}`;
						tui.requestRender();
						return;
					}
					finish();
				} catch (applyError) {
					error = applyError instanceof Error ? applyError.message : String(applyError);
					tui.requestRender();
				}
			};
			const reload = (): void => {
				const next = loadDraftFromDisk();
				draft = next.draft;
				legacySources = next.legacySources;
				error = next.config.exists && !next.config.valid ? `Invalid root config: ${CODESOOK_OMP_CONFIG_PATH}` : undefined;
				refresh();
				tui.requestRender();
			};
			const component: Component = {
				render(width: number): readonly string[] {
					const rows = [
						theme.fg("accent", theme.bold("Codesook OMP Plugin Settings")),
						theme.fg("dim", `Root: ${CODESOOK_OMP_CONFIG_PATH}`),
						...(error ? [theme.fg("error", `Error: ${error}`)] : []),
						...list.render(width),
					];
					return rows;
				},
				handleInput(data: string): void {
					const selected = list.getSelectedItem();
					if (valueSubmenuOpen) {
						list.handleInput(data);
						if (isEnter(data) || isEscape(data)) valueSubmenuOpen = false;
						tui.requestRender();
						return;
					}
					if (isShiftEnter(data) && !textSubmenuOpen) {
						void apply(true);
						return;
					}
					if (selected?.values !== undefined && isEnter(data)) {
						valueSubmenuOpen = true;
						list.handleInput(data);
						tui.requestRender();
						return;
					}
					if (selected?.id === APPLY_ACTION_ID && isEnter(data)) {
						if (typeof ctx.ui.confirm === "function") {
							void ctx.ui.confirm("Apply Codesook OMP settings?", "Write root config atomically and notify loaded extensions of live changes.").then(confirmed => apply(confirmed));
						} else {
							void apply(true);
						}
						return;
					}
					if (selected?.id === STATUS_ACTION_ID && isEnter(data)) {
						void showStatus(pi, ctx).then(() => tui.requestRender());
						return;
					}
					if (selected?.id === RELOAD_ACTION_ID && isEnter(data)) {
						reload();
						return;
					}
					if (selected?.id === CANCEL_ACTION_ID && isEnter(data)) {
						finish();
						return;
					}
					list.handleInput(data);
					tui.requestRender();
				},
				invalidate(): void {
					list.invalidate();
				},
			};
			const initialItems = trackedItems();
			list = new SettingsList(
				initialItems,
				Math.min(18, initialItems.length),
				getSettingsListTheme(),
				(id, value) => {
					updateDraft(draft, id, value);
					error = undefined;
					refresh();
					tui.requestRender();
				},
				() => finish(),
				{ layout: "auto", typeToSearch: false, hint: "↑↓ navigate · Enter edit · Shift+Enter apply · Esc cancel" },
			);
			return component;
		},
		{ overlay: true },
	);
}

export default function codesookOmpPluginSettings(pi: ExtensionAPI): void {
	pi.setLabel("Codesook OMP Plugin Settings");
	pi.registerCommand("codesook-omp-plugin", {
		description: `Unified Codesook OMP plugin settings. ${COMMAND_USAGE}`,
		getArgumentCompletions(argumentPrefix) {
			const prefix = argumentPrefix.trim().toLowerCase();
			return ["status", "init config"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			if (argument === "status") {
				await showStatus(pi, ctx);
				return;
			}
			if (argument === "init config") {
				initializePluginConfig(ctx);
				return;
			}
			if (argument !== "") {
				ctx.ui.notify(COMMAND_USAGE, "warning");
				return;
			}
			await openSettings(pi, ctx);
		},
	});
}

export const __test__ = {
	parsePluginList,
	isShiftEnter,
	draftFromRootConfig,
	draftToRootSections,
	mapDraftToRootSections,
	validateDraft,
	loadDraftFromDisk,
};
