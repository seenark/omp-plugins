import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import {
	Input,
	SettingsList,
	ScrollView,
	Text,
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
	integrationConfigErrors,
	prepareProjectIntegrationSettings,
	projectIntegrationConfigPath,
	readIntegrationSettings,
	resolveIntegrationProject,
	type IntegrationPolicy,
	type IntegrationVisibility,
} from "@codesook/omp-shared-display/project-integrations";
import {
	isDisplaySource,
	normalizeSharedDisplayConfig,
	validateSharedDisplayConfig,
	type SharedDisplayConfig,
	type SharedDisplayLayout,
	type SharedDisplayStyle,
	type SharedDisplayPlacement,
} from "@codesook/omp-shared-display";
import {
	CAVEMAN_ACTIVE_MODES,
	CAVEMAN_MODES,
	PACKAGE_ASSET_DIRECTORY,
	normalizeCavemanConfig,
	normalizeLegacyCavemanConfig,
	validateCavemanConfig,
	type CavemanConfig,
	type CavemanMode,
} from "@codesook/omp-caveman";
import {
	PACKAGE_ASSET_DIRECTORY as PONYTAIL_ASSET_DIRECTORY,
	PONYTAIL_MODES,
	PONYTAIL_RUNTIME_MODES,
	normalizePonytailConfig,
	validatePonytailConfig,
	type PonytailConfig,
} from "@codesook/omp-ponytail";
import {
	normalizeHeadroomConfig,
	type HeadroomConfig,
} from "@codesook/omp-headroom/config";
import { HEADROOM_PROXY_TOKEN_FILE } from "@codesook/omp-headroom/client";
import { DEFAULT_GLYPHS, DISPLAY_STATES, resolveThemeGlyph } from "@codesook/omp-headroom/display";
import { normalizeRtkConfig, type RtkConfig } from "@codesook/omp-rtk/config";
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
	getGlyphTextPath,
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
import { openGlyphStudio, type GlyphTarget } from "./glyph-studio.ts";

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

const PROJECT_FEATURES = ["shared-display", "ponytail", "caveman", "headroom", "rtk", "prompt-border-style", "codegraph", "beads", "pstack"] as const;
type ProjectFeature = (typeof PROJECT_FEATURES)[number];

const DEFAULT_PROJECT_FEATURES: Record<ProjectFeature, boolean> = {
	"shared-display": false,
	ponytail: false,
	caveman: false,
	headroom: true,
	rtk: false,
	"prompt-border-style": true,
	codegraph: false,
	beads: false,
	pstack: false,
};

const STANDALONE_FEATURE_PACKAGES: Record<ProjectFeature, string> = {
	"shared-display": "@codesook/omp-shared-display",
	ponytail: "@codesook/omp-ponytail",
	caveman: "@codesook/omp-caveman",
	headroom: "@codesook/omp-headroom",
	rtk: "@codesook/omp-rtk",
	"prompt-border-style": "@codesook/omp-prompt-border-style",
	codegraph: "@codesook/omp-codegraph",
	beads: "@codesook/omp-beads",
	pstack: "@codesook/omp-pstack",
};

/** Features the omp-plugins umbrella does not carry: they exist only as their own package, so a missing one is "not installed" and an umbrella feature list never enables it. */
const STANDALONE_ONLY_FEATURES: readonly ProjectFeature[] = ["pstack"];
const isStandaloneOnly = (feature: ProjectFeature): boolean => STANDALONE_ONLY_FEATURES.includes(feature);
const absentLabel = (feature: ProjectFeature): "not installed" | "not enabled" => (isStandaloneOnly(feature) ? "not installed" : "not enabled");
const sectionAbsentLabel = (sectionId: string): "not installed" | "not loaded" => {
	const feature = PROJECT_FEATURES.find(candidate => `section:${candidate}` === sectionId);
	return feature !== undefined && isStandaloneOnly(feature) ? "not installed" : "not loaded";
};

const PSTACK_GUARD_STRICTNESS = ["block-and-warn", "warn-only", "off"] as const;
const PSTACK_PANEL_SIZE = { min: 1, max: 5 } as const;
const PSTACK_THINKING = ["low", "medium", "high", "xhigh"] as const;

/** `behavior.pstack`. Read raw like CodeGraph and Beads: pstack is optional, so settings never import it. Defaults match pstack's own reader. */
type PstackDraft = {
	suspendCaveman: boolean;
	suspendPonytail: boolean;
	maxPanelSize: number;
	guardStrictness: (typeof PSTACK_GUARD_STRICTNESS)[number];
	defaultThinking: (typeof PSTACK_THINKING)[number];
};

function pstackDraft(raw: unknown): PstackDraft {
	const source = asRecord(raw);
	const size = source.maxPanelSize;
	return {
		suspendCaveman: typeof source.suspendCaveman === "boolean" ? source.suspendCaveman : true,
		suspendPonytail: typeof source.suspendPonytail === "boolean" ? source.suspendPonytail : true,
		maxPanelSize: Number.isInteger(size) && (size as number) >= PSTACK_PANEL_SIZE.min && (size as number) <= PSTACK_PANEL_SIZE.max ? (size as number) : PSTACK_PANEL_SIZE.max,
		guardStrictness: (PSTACK_GUARD_STRICTNESS as readonly unknown[]).includes(source.guardStrictness) ? (source.guardStrictness as PstackDraft["guardStrictness"]) : "block-and-warn",
		defaultThinking: (PSTACK_THINKING as readonly unknown[]).includes(source.defaultThinking) ? (source.defaultThinking as PstackDraft["defaultThinking"]) : "medium",
	};
}

const SHARED_LAYOUTS = ["horizontal", "vertical"] as const satisfies readonly SharedDisplayLayout[];
const SHARED_STYLES = ["plain", "powerline"] as const satisfies readonly SharedDisplayStyle[];
const SHARED_PLACEMENTS = ["aboveEditor", "belowEditor"] as const satisfies readonly SharedDisplayPlacement[];
const RAIL_PLACEMENTS = ["inside", "above", "below"] as const satisfies readonly ContextRailPlacement[];
const RAIL_VISIBILITIES = ["always", "toggle", "collapse-while-typing"] as const satisfies readonly ContextRailVisibility[];
const RAIL_MODES = ["compact", "full", "custom"] as const satisfies readonly ContextRailMode[];
const RAIL_LABELS = ["auto", "bar-only", "always"] as const satisfies readonly ContextRailLabels[];
const RAIL_LABEL_POSITIONS = ["left", "center", "right"] as const satisfies readonly ContextRailLabelPosition[];
const RAIL_POINTERS = ["auto", "visible", "hidden"] as const satisfies readonly ContextRailPointer[];
const RAIL_MEANING_PLACEMENTS = ["top", "below", "beside"] as const satisfies readonly ContextRailMeaningPlacement[];

const COMMAND_USAGE = "Usage: /omp-plugins [status|init config]";
const STATUS_ACTION_ID = "action:status";
const GLYPH_STUDIO_ACTION_ID = "action:glyph-studio";
const INIT_ACTION_ID = "action:init";
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
	ompPlugins: boolean;
	ompPluginsEnabled: boolean;
	ompPluginsVersion?: string;
	projectFeatures: Record<ProjectFeature, boolean>;
};

type ProjectIntegrationDraft = {
	policy: IntegrationPolicy | "inherit";
	visibility: IntegrationVisibility | "inherit";
	initialPolicy: IntegrationPolicy | "inherit";
	initialVisibility: IntegrationVisibility | "inherit";
};

export type UnifiedSettingsDraft = {
	display: {
		codegraph: { visibility: IntegrationVisibility };
		beads: { visibility: IntegrationVisibility };
		sharedDisplay: SharedDisplayConfig;
		caveman: Pick<CavemanConfig, "nativeVisible" | "display">;
		ponytail: Pick<PonytailConfig, "nativeVisible" | "display">;
		headroom: HeadroomConfig["display"];
		rtk: RtkConfig["display"];
		promptBorder: {
			style: BorderStyleName;
			layout: BorderLayoutName;
		};
		contextRail: ContextRailConfig;
	};
	behavior: {
		codegraph: { policy: IntegrationPolicy | undefined };
		beads: { policy: IntegrationPolicy | undefined };
		pstack: PstackDraft;
		caveman: Pick<CavemanConfig, "defaultMode">;
		ponytail: Pick<PonytailConfig, "defaultMode">;
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
		rtk: Pick<RtkConfig, "enabled" | "retentionDays">;
	};
	projectIntegration?: {
		path: string;
		codegraph: ProjectIntegrationDraft;
		beads: ProjectIntegrationDraft;
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
	const ompEntry = npm.find(entry => entry.name === "omp-plugins");
	const projectFeatures = { ...DEFAULT_PROJECT_FEATURES };
	if (!ompEntry || ompEntry.enabled === false) {
		for (const feature of PROJECT_FEATURES) projectFeatures[feature] = false;
	} else if (Array.isArray(ompEntry.enabledFeatures)) {
		for (const feature of PROJECT_FEATURES.filter(candidate => !isStandaloneOnly(candidate))) projectFeatures[feature] = ompEntry.enabledFeatures.includes(feature);
	}
	for (const feature of PROJECT_FEATURES) {
		const standalone = npm.find(entry => entry.name === STANDALONE_FEATURE_PACKAGES[feature]);
		if (standalone?.enabled !== false && standalone !== undefined) projectFeatures[feature] = true;
	}
	return {
		npm,
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

/** pstack ships only as its own package, so a missing one is not installed rather than not enabled. */
function featureWarning(presence: PluginPresence, feature: ProjectFeature): string | undefined {
	if (featureEnabled(presence, feature)) return undefined;
	return isStandaloneOnly(feature)
		? `${feature} is not installed; install ${STANDALONE_FEATURE_PACKAGES[feature]}. Settings apply when the extension loads (usually next start).`
		: "Feature is not enabled in omp-plugins; setting applies when extension loads (usually next start).";
}


function createDraft(raw: unknown, legacy: LegacySources = {}): UnifiedSettingsDraft {
	const source = asRecord(raw);
	const display = asRecord(source.display);
	const behavior = asRecord(source.behavior);
	const codegraphPolicy = asRecord(behavior.codegraph).policy;
	const beadsPolicy = asRecord(behavior.beads).policy;
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
		...rootCavemanBehavior,
		nativeVisible: rootCavemanDisplay.nativeVisible ?? legacyCaveman.nativeVisible,
		display: display.caveman === undefined ? legacyCaveman.display ?? cavemanDisplay : cavemanDisplay,
	});
	const rootPonytailDisplay = asRecord(display.ponytail);
	const rootPonytailBehavior = asRecord(behavior.ponytail);
	const ponytail = normalizePonytailConfig({
		...rootPonytailBehavior,
		nativeVisible: rootPonytailDisplay.nativeVisible,
		display: rootPonytailDisplay,
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
	const rtk = normalizeRtkConfig(source);

	return {
		display: {
			codegraph: { visibility: (asRecord(display.codegraph).visibility ?? "ready") as IntegrationVisibility },
			beads: { visibility: (asRecord(display.beads).visibility ?? "ready") as IntegrationVisibility },
			sharedDisplay,
			caveman: { nativeVisible: caveman.nativeVisible, display: clone(caveman.display) },
			ponytail: { nativeVisible: ponytail.nativeVisible, display: clone(ponytail.display) },
			headroom: clone(headroom.display),
			rtk: clone(rtk.display),
			promptBorder: {
				style: prompt.style,
				layout: prompt.layout,
			},
			contextRail: clone(prompt.contextRail),
		},
		behavior: {
			codegraph: { policy: behavior.codegraph !== undefined && !isRecord(behavior.codegraph) ? undefined : codegraphPolicy === undefined ? "auto" : codegraphPolicy === "auto" || codegraphPolicy === "off" ? codegraphPolicy : undefined },
			beads: { policy: behavior.beads !== undefined && !isRecord(behavior.beads) ? undefined : beadsPolicy === undefined ? "auto" : beadsPolicy === "auto" || beadsPolicy === "off" ? beadsPolicy : undefined },
			pstack: pstackDraft(behavior.pstack),
			caveman: { defaultMode: caveman.defaultMode },
			ponytail: { defaultMode: ponytail.defaultMode },
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
			rtk: { enabled: rtk.enabled, retentionDays: rtk.retentionDays },
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
			codegraph: { ...draft.display.codegraph },
			beads: { ...draft.display.beads },
			sharedDisplay: {
				enabled: shared.enabled,
				layout: shared.layout,
				style: shared.style,
				order: [...shared.order],
				widgetPlacement: shared.widgetPlacement,
				horizontalSeparator: shared.horizontalSeparator,
				verticalGapRows: shared.verticalGapRows,
			},
			caveman: {
				...draft.display.caveman.display,
				nativeVisible: draft.display.caveman.nativeVisible,
			},
			ponytail: {
				...draft.display.ponytail.display,
				nativeVisible: draft.display.ponytail.nativeVisible,
			},
			headroom: {
				visible: headroomDisplay.visible,
				glyphDirectory: headroomDisplay.glyphDirectory,
				template: headroomDisplay.template,
				status: { ...headroomDisplay.status },
			},
			rtk: { ...draft.display.rtk },
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
			codegraph: { ...draft.behavior.codegraph },
			beads: { ...draft.behavior.beads },
			pstack: { ...draft.behavior.pstack },
			caveman: { defaultMode: draft.behavior.caveman.defaultMode },
			ponytail: { defaultMode: draft.behavior.ponytail.defaultMode },
			headroom: { ...draft.behavior.headroom, autoStart: false },
			rtk: { ...draft.behavior.rtk },
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
	const legacy = config.valid && configPath === CODESOOK_OMP_CONFIG_PATH ? loadLegacySources(config.value) : { sources: {}, migrated: [] };
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
	const validation = validateDraft(draft);
	if (validation) throw new Error(validation);
	const current = readCodesookOmpConfig(configPath);
	if (current.exists && !current.valid) throw new Error(`Invalid Codesook OMP config: ${configPath}`);
	const integrationErrors = (["codegraph", "beads"] as const).flatMap(integration => integrationConfigErrors(integration, current, configPath));
	if (integrationErrors.length) throw new Error(integrationErrors.join("\n"));
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

/** Load a staged draft for one Integration Project; reading never creates project defaults. */
export function loadSettingsDraft(projectPath: string, configPath = CODESOOK_OMP_CONFIG_PATH) {
	const loaded = loadDraftFromDisk(configPath);
	const projectDraft = (integration: "codegraph" | "beads"): { draft: ProjectIntegrationDraft; errors: readonly string[] } => {
		const settings = readIntegrationSettings(integration, projectPath, configPath);
		const policy = asRecord(settings.project.value.behavior[integration]).policy;
		const visibility = asRecord(settings.project.value.display[integration]).visibility;
		const projectPolicy = policy === "auto" || policy === "off" ? policy : "inherit";
		const projectVisibility = visibility === "ready" || visibility === "always" || visibility === "never" ? visibility : "inherit";
		return {
			draft: { policy: projectPolicy, visibility: projectVisibility, initialPolicy: projectPolicy, initialVisibility: projectVisibility },
			errors: settings.errors,
		};
	};
	const codegraph = projectDraft("codegraph");
	const beads = projectDraft("beads");
	loaded.draft.projectIntegration = { path: projectPath, codegraph: codegraph.draft, beads: beads.draft };
	return { ...loaded, errors: [...new Set([...codegraph.errors, ...beads.errors])] };
}

/** Preflight both documents before the first write; only edited project fields are persisted. */
export function persistSettingsDraft(
	draft: UnifiedSettingsDraft,
	configPath = CODESOOK_OMP_CONFIG_PATH,
	legacySources: readonly LegacySource[] = [],
): CodesookOmpConfig {
	const validation = validateDraft(draft);
	if (validation) throw new Error(validation);
	const project = draft.projectIntegration;
	let projectConfig: CodesookOmpConfig | undefined;
	if (project) {
		for (const integration of ["codegraph", "beads"] as const) {
			const settings = readIntegrationSettings(integration, project.path, configPath);
			if (settings.errors.length) throw new Error(settings.errors.join("\n"));
			const staged = project[integration];
			if (staged.policy !== staged.initialPolicy || staged.visibility !== staged.initialVisibility) {
				const prepared = prepareProjectIntegrationSettings(integration, project.path, {
					policy: staged.policy !== staged.initialPolicy ? staged.policy : undefined,
					visibility: staged.visibility !== staged.initialVisibility ? staged.visibility : undefined,
				});
				projectConfig ??= clone(settings.project.value);
				projectConfig.display[integration] = prepared.display[integration];
				projectConfig.behavior[integration] = prepared.behavior[integration];
			}
		}
	}
	const config = persistDraftToRoot(draft, configPath, legacySources);
	if (project && projectConfig) {
		const projectConfigPath = projectIntegrationConfigPath(project.path);
		try {
			writeCodesookOmpConfig(projectConfig, projectConfigPath);
		} catch (error) {
			throw new Error(`Root settings saved to ${configPath}, but project settings were not saved to ${projectConfigPath}: ${error instanceof Error ? error.message : String(error)}. Live-change event was not emitted. Repair the project path and Reload before applying again.`);
		}
	}
	return config;
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

function glyphTargets(draft: UnifiedSettingsDraft, configPath: string): GlyphTarget[] {
	const targets: GlyphTarget[] = [
		{ group: "Prompt Border", name: "left", path: getGlyphTextPath(configPath, "left"), surface: "prompt-glyph", fallback: "missing: built-in left glyph; empty: no glyph" },
		{ group: "Prompt Border", name: "right", path: getGlyphTextPath(configPath, "right"), surface: "prompt-glyph", fallback: "missing or empty: no glyph" },
		{ group: "Prompt Border", name: "status spinner", path: getGlyphTextPath(configPath, "status"), surface: "prompt-spinner", fallback: "missing or empty: OMP default spinner" },
		{ group: "Prompt Border", name: "activity spinner", path: getGlyphTextPath(configPath, "activity"), surface: "prompt-spinner", fallback: "missing or empty: OMP default spinner" },
	];
	const rail = draft.display.contextRail;
	const railDirectory = resolveGlyphDirectory(rail.glyphDirectory);
	for (const role of CONTEXT_RAIL_ROLES) {
		targets.push({ group: "Context Rail", name: role, path: path.join(railDirectory, rail[role].framesFile), surface: "context-rail", fallback: "missing or empty: theme symbol" });
	}
	const cavemanDirectory = resolveGlyphDirectory(draft.display.caveman.display.glyphDirectory);
	for (const mode of CAVEMAN_ACTIVE_MODES) {
		targets.push({ group: "Caveman", name: mode, path: path.join(cavemanDirectory, `${mode}.txt`), surface: "shared-display", fallback: "missing or empty: packaged Caveman glyph" });
	}
	const headroomDirectory = resolveGlyphDirectory(draft.display.headroom.glyphDirectory);
	for (const state of DISPLAY_STATES) {
		targets.push({ group: "Headroom", name: state, path: path.join(headroomDirectory, `${state}.txt`), surface: "shared-display", fallback: "missing or empty: theme glyph" });
	}
	const ponytailDirectory = resolveGlyphDirectory(draft.display.ponytail.display.glyphDirectory);
	for (const mode of PONYTAIL_MODES) {
		targets.push({ group: "Ponytail", name: mode, path: path.join(ponytailDirectory, `${mode}.txt`), surface: "shared-display", fallback: "missing or empty: packaged Ponytail glyph" });
	}
	return targets;
}

function configuredInitAssets(draft: UnifiedSettingsDraft, theme: unknown): InitAsset[] {
	const assets: InitAsset[] = [];
	const ponytailDirectory = resolveGlyphDirectory(draft.display.ponytail.display.glyphDirectory);
	for (const mode of PONYTAIL_MODES) {
		const source = readFileSync(path.join(PONYTAIL_ASSET_DIRECTORY, `${mode}.txt`), "utf8");
		assets.push({
			path: path.join(ponytailDirectory, `${mode}.txt`),
			content: staticAssetContent(source),
		});
	}
	const cavemanDirectory = resolveGlyphDirectory(draft.display.caveman.display.glyphDirectory);
	for (const mode of CAVEMAN_ACTIVE_MODES) {
		const source = readFileSync(path.join(PACKAGE_ASSET_DIRECTORY, `${mode}.txt`), "utf8");
		assets.push({
			path: path.join(cavemanDirectory, `${mode}.txt`),
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

function initializePluginConfig(ctx: ExtensionContext, configPath = CODESOOK_OMP_CONFIG_PATH): { message: string; type: "info" | "error" } {
	const created: string[] = [];
	const existed: string[] = [];
	const failed: string[] = [];
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

	return {
		message: [
			`Created (${created.length}):`,
			...(created.length > 0 ? created : ["none"]),
			`Already existed (${existed.length}):`,
			...(existed.length > 0 ? existed : ["none"]),
			...(failed.length > 0 ? [`Failed (${failed.length}):`, ...failed] : []),
		].join("\n"),
		type: failed.length > 0 ? "error" : "info",
	};
}


function validateDraft(draft: UnifiedSettingsDraft): string | undefined {
	for (const integration of ["codegraph", "beads"] as const) {
		const label = integration === "codegraph" ? "CodeGraph" : "Beads";
		if (draft.behavior[integration].policy !== "auto" && draft.behavior[integration].policy !== "off") return `${label} policy must be auto or off. Repair invalid configuration before Apply.`;
		if (!["ready", "always", "never"].includes(draft.display[integration].visibility)) return `${label} visibility must be ready, always, or never.`;
	}
	const pstack = draft.behavior.pstack;
	if (typeof pstack.suspendCaveman !== "boolean" || typeof pstack.suspendPonytail !== "boolean") return "pstack suspend settings must be true or false.";
	if (!Number.isInteger(pstack.maxPanelSize) || pstack.maxPanelSize < PSTACK_PANEL_SIZE.min || pstack.maxPanelSize > PSTACK_PANEL_SIZE.max) return `pstack maximum panel size must be an integer from ${PSTACK_PANEL_SIZE.min} through ${PSTACK_PANEL_SIZE.max}.`;
	if (!PSTACK_GUARD_STRICTNESS.includes(pstack.guardStrictness)) return "pstack guard strictness must be block-and-warn, warn-only, or off.";
	if (!PSTACK_THINKING.includes(pstack.defaultThinking)) return "pstack default thinking must be low, medium, high, or xhigh.";
	const sharedErrors = validateSharedDisplayConfig(clone(draft.display.sharedDisplay));
	if (sharedErrors.length > 0) return sharedErrors[0];
	const cavemanError = validateCavemanConfig({
		defaultMode: draft.behavior.caveman.defaultMode,
		nativeVisible: draft.display.caveman.nativeVisible,
		display: draft.display.caveman.display,
	});
	if (cavemanError) return cavemanError;
	const ponytailError = validatePonytailConfig({
		defaultMode: draft.behavior.ponytail.defaultMode,
		nativeVisible: draft.display.ponytail.nativeVisible,
		display: draft.display.ponytail.display,
	});
	if (ponytailError) return ponytailError;
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
	if (!Number.isSafeInteger(draft.behavior.rtk.retentionDays) || draft.behavior.rtk.retentionDays < 1) return "RTK retention days must be an integer of at least 1.";
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
	if (!SHARED_STYLES.includes(shared.style)) return "Shared Display style is invalid.";
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
	const headroomWarning = featureWarning(presence, "headroom");
	const rtkWarning = featureWarning(presence, "rtk");
	const cavemanWarning = featureWarning(presence, "caveman");
	const ponytailWarning = featureWarning(presence, "ponytail");
	const sharedWarning = featureWarning(presence, "shared-display");
	const promptWarning = featureWarning(presence, "prompt-border-style");
	const pstackWarning = featureWarning(presence, "pstack");
	const shared = draft.display.sharedDisplay;
	const caveman = draft.display.caveman;
	const ponytail = draft.display.ponytail;
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
		...PROJECT_FEATURES.map(feature => ({
			id: `presence.${feature}`,
			label: feature,
			currentValue: featureEnabled(presence, feature) ? "enabled (next start)" : absentLabel(feature),
			warning: featureWarning(presence, feature),
			description: "OMP lifecycle state is informational; this surface does not unload or load extensions.",
		})),
		...(["codegraph", "beads"] as const).flatMap(integration => [
			{ id: `section:${integration}`, label: `${integration === "codegraph" ? "CodeGraph" : "Beads"} Integration`, currentValue: "", heading: true },
			selectItem(`${integration}.policy`, "Global policy", behavior[integration].policy ?? "invalid", ["auto", "off"], "Allow automatic runtime guidance, or suppress it. Never initializes a project.", featureWarning(presence, integration)),
			selectItem(`${integration}.visibility`, "Global visibility", draft.display[integration].visibility, ["ready", "always", "never"], "Visibility is independent of policy and plugin lifecycle."),
			...(draft.projectIntegration ? [
				{ id: `${integration}.project`, label: "Integration Project", currentValue: draft.projectIntegration.path, description: "Nearest Git working tree; outside Git, current directory. Project overrides affect integrations only." },
				selectItem(`${integration}.projectPolicy`, "Project policy", draft.projectIntegration[integration].policy, ["inherit", "auto", "off"], "Shared override in .omp/codesook-omp.json; inherit uses global policy."),
				selectItem(`${integration}.projectVisibility`, "Project visibility", draft.projectIntegration[integration].visibility, ["inherit", "ready", "always", "never"], "Shared override; inherit uses global visibility."),
			] : []),
		]),
		{ id: "section:shared", label: "Shared Display", currentValue: "", heading: true },
		boolItem("shared.enabled", "Enabled", shared.enabled, "Enable shared host composition and widget.", sharedWarning),
		selectItem("shared.layout", "Layout", shared.layout, SHARED_LAYOUTS, "Horizontal or vertical source composition.", sharedWarning),
		selectItem("shared.style", "Style", shared.style, SHARED_STYLES, "Plain text or theme-colored Starship-style powerline segments (needs a Nerd Font).", sharedWarning),
		textItem("shared.order", "Source order", shared.order.join(","), "Comma-separated ponytail,caveman,headroom,rtk,codegraph,beads,pstack order.", sharedWarning),
		selectItem("shared.placement", "Placement", shared.widgetPlacement, SHARED_PLACEMENTS, "Widget placement relative to editor.", sharedWarning),
		textItem("shared.separator", "Separator", shared.horizontalSeparator, "One-line separator for horizontal layout.", sharedWarning),
		numberItem("shared.gap", "Vertical gap", shared.verticalGapRows, "Blank rows between vertical sources, 0-10.", sharedWarning),
		{ id: "section:ponytail", label: "Ponytail", currentValue: "", heading: true },
		selectItem("ponytail.defaultMode", "Default mode", behavior.ponytail.defaultMode, PONYTAIL_RUNTIME_MODES, "Mode Level new Agent Sessions start at; session entries and /ponytail override per session. Unparseable config fails closed to off.", ponytailWarning),
		boolItem("ponytail.nativeVisible", "Native status", ponytail.nativeVisible, "Show Ponytail in OMP native footer status.", ponytailWarning),
		boolItem("ponytail.visible", "Display visible", ponytail.display.visible, "Include Ponytail frames in Shared Display. Independent of native footer status.", ponytailWarning),
		textItem("ponytail.template", "Display template", ponytail.display.template, "Tokens: {activity}, {glyph}, {mode}, {modeIcon}.", ponytailWarning),
		textItem("ponytail.glyphDirectory", "Glyph directory", ponytail.display.glyphDirectory, "External Ponytail glyph directory; frame contents stay in files.", ponytailWarning),
		{ id: "section:caveman", label: "Caveman", currentValue: "", heading: true },
		selectItem("caveman.defaultMode", "Default mode", behavior.caveman.defaultMode, CAVEMAN_MODES, "Caveman Mode Level a new Agent Session starts at; off sends no Caveman instructions.", cavemanWarning),
		boolItem("caveman.nativeVisible", "Native status", caveman.nativeVisible, "Show Caveman in OMP native footer.", cavemanWarning),
		boolItem("caveman.visible", "Display visible", caveman.display.visible, "Publish Caveman segment to Shared Display.", cavemanWarning),
		textItem("caveman.template", "Display template", caveman.display.template, "Tokens: {activity}, {glyph}, {mode}.", cavemanWarning),
		textItem("caveman.glyphDirectory", "Glyph directory", caveman.display.glyphDirectory, "External Caveman glyph directory; frame contents stay in files.", cavemanWarning),
		{ id: "section:pstack", label: "pstack", currentValue: "", heading: true },
		boolItem("pstack.suspendCaveman", "Suspend Caveman", behavior.pstack.suspendCaveman, "Switch Caveman off for the rest of an Agent Session once pstack is activated.", pstackWarning),
		boolItem("pstack.suspendPonytail", "Suspend Ponytail", behavior.pstack.suspendPonytail, "Switch Ponytail off for the rest of an Agent Session once pstack is activated.", pstackWarning),
		numberItem("pstack.maxPanelSize", "Maximum panel size", behavior.pstack.maxPanelSize, `Cap on panel seats a review uses, ${PSTACK_PANEL_SIZE.min}-${PSTACK_PANEL_SIZE.max}; unset seats are never counted.`, pstackWarning),
		selectItem("pstack.guardStrictness", "Guard strictness", behavior.pstack.guardStrictness, PSTACK_GUARD_STRICTNESS, "block-and-warn stops damaging commands and warns on style; warn-only never blocks; off silences every guard.", pstackWarning),
		selectItem("pstack.defaultThinking", "Default thinking", behavior.pstack.defaultThinking, PSTACK_THINKING, "Thinking level /pstack setup and presets write on every role (the judge one above it; lean seats one below), clamped to what each model supports. Unset means medium.", pstackWarning),
		{ id: "pstack.setup", label: "Model roles", currentValue: "/pstack setup", description: "Choose the models for pstack's roles and panel seats with /pstack setup in an Agent Session. Not edited here.", warning: pstackWarning },
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
		{ id: "section:rtk", label: "RTK", currentValue: "", heading: true },
		boolItem("rtk.enabled", "Enabled", behavior.rtk.enabled, "Rewrite bash commands through RTK; live only when RTK extension is loaded.", rtkWarning),
		numberItem("rtk.retentionDays", "Retention (days)", behavior.rtk.retentionDays, "Delete RTK session history untouched for this many days.", rtkWarning),
		boolItem("rtk.visible", "Display visible", draft.display.rtk.visible, "Publish RTK Savings to Shared Display.", rtkWarning),
		textItem("rtk.template", "Display template", draft.display.rtk.template, "Placeholders {glyph} {percent} {tokensSaved} {tokensInput} {commands}.", rtkWarning),
		textItem("rtk.glyphDirectory", "Glyph directory", draft.display.rtk.glyphDirectory, "External RTK glyph directory with active/off/missing .txt files.", rtkWarning),
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
		case "codegraph.policy": if (value === "auto" || value === "off") draft.behavior.codegraph.policy = value; return;
		case "codegraph.visibility": if (value === "ready" || value === "always" || value === "never") draft.display.codegraph.visibility = value; return;
		case "codegraph.projectPolicy": if (draft.projectIntegration && (value === "inherit" || value === "auto" || value === "off")) draft.projectIntegration.codegraph.policy = value; return;
		case "codegraph.projectVisibility": if (draft.projectIntegration && (value === "inherit" || value === "ready" || value === "always" || value === "never")) draft.projectIntegration.codegraph.visibility = value; return;
		case "beads.policy": if (value === "auto" || value === "off") draft.behavior.beads.policy = value; return;
		case "beads.visibility": if (value === "ready" || value === "always" || value === "never") draft.display.beads.visibility = value; return;
		case "beads.projectPolicy": if (draft.projectIntegration && (value === "inherit" || value === "auto" || value === "off")) draft.projectIntegration.beads.policy = value; return;
		case "beads.projectVisibility": if (draft.projectIntegration && (value === "inherit" || value === "ready" || value === "always" || value === "never")) draft.projectIntegration.beads.visibility = value; return;
		case "shared.enabled": draft.display.sharedDisplay.enabled = bool; return;
		case "shared.layout": if (SHARED_LAYOUTS.includes(value as SharedDisplayLayout)) draft.display.sharedDisplay.layout = value as SharedDisplayLayout; return;
		case "shared.style": if (SHARED_STYLES.includes(value as SharedDisplayStyle)) draft.display.sharedDisplay.style = value as SharedDisplayStyle; return;
		case "shared.order": draft.display.sharedDisplay.order = value.split(",").map(item => item.trim()).filter(isDisplaySource); return;
		case "shared.placement": if (SHARED_PLACEMENTS.includes(value as SharedDisplayPlacement)) draft.display.sharedDisplay.widgetPlacement = value as SharedDisplayPlacement; return;
		case "shared.separator": draft.display.sharedDisplay.horizontalSeparator = value; return;
		case "shared.gap": draft.display.sharedDisplay.verticalGapRows = Number(value); return;
		case "ponytail.defaultMode": if ((PONYTAIL_RUNTIME_MODES as readonly string[]).includes(value)) draft.behavior.ponytail.defaultMode = value as PonytailConfig["defaultMode"]; return;
		case "ponytail.nativeVisible": draft.display.ponytail.nativeVisible = bool; return;
		case "ponytail.visible": draft.display.ponytail.display.visible = bool; return;
		case "ponytail.template": draft.display.ponytail.display.template = value; return;
		case "ponytail.glyphDirectory": draft.display.ponytail.display.glyphDirectory = value; return;
		case "caveman.defaultMode": if ((CAVEMAN_MODES as readonly string[]).includes(value)) draft.behavior.caveman.defaultMode = value as CavemanMode; return;
		case "caveman.nativeVisible": draft.display.caveman.nativeVisible = bool; return;
		case "caveman.visible": draft.display.caveman.display.visible = bool; return;
		case "caveman.template": draft.display.caveman.display.template = value; return;
		case "caveman.glyphDirectory": draft.display.caveman.display.glyphDirectory = value; return;
		case "pstack.suspendCaveman": draft.behavior.pstack.suspendCaveman = bool; return;
		case "pstack.suspendPonytail": draft.behavior.pstack.suspendPonytail = bool; return;
		case "pstack.maxPanelSize": draft.behavior.pstack.maxPanelSize = Number(value); return;
		case "pstack.defaultThinking": if ((PSTACK_THINKING as readonly string[]).includes(value)) draft.behavior.pstack.defaultThinking = value as PstackDraft["defaultThinking"]; return;
		case "pstack.guardStrictness": if ((PSTACK_GUARD_STRICTNESS as readonly string[]).includes(value)) draft.behavior.pstack.guardStrictness = value as PstackDraft["guardStrictness"]; return;
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
		case "rtk.enabled": draft.behavior.rtk.enabled = bool; return;
		case "rtk.retentionDays": draft.behavior.rtk.retentionDays = Number(value); return;
		case "rtk.visible": draft.display.rtk.visible = bool; return;
		case "rtk.template": draft.display.rtk.template = value; return;
		case "rtk.glyphDirectory": draft.display.rtk.glyphDirectory = value; return;
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
		`omp-plugins: ${presence.ompPlugins ? `installed${presence.ompPluginsEnabled ? ", enabled" : ", disabled"}` : "not installed"}`,
		...PROJECT_FEATURES.map(feature => `  ${feature}: ${featureEnabled(presence, feature) ? "enabled for next start" : absentLabel(feature)}`),
		"",
		"Lifecycle toggles are informational; this extension does not unload or load plugins.",
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

type SettingsSection = { id: string; label: string; items: SettingItem[] };

/** Group the flat item list into sections at each `section:` heading; role headings stay inside their section. */
function settingsSections(draft: UnifiedSettingsDraft, presence: PluginPresence): SettingsSection[] {
	const sections: SettingsSection[] = [];
	for (const item of settingsItems(draft, presence)) {
		if (item.heading && item.id.startsWith("section:")) sections.push({ id: item.id, label: item.label, items: [] });
		else sections.at(-1)?.items.push(item);
	}
	return sections;
}

const SETTINGS_ACTIONS = [
	{ id: GLYPH_STUDIO_ACTION_ID, label: "Edit glyph frames", description: "Pick a glyph from a list with a live preview, then edit it one frame at a time: add, duplicate, delete, reorder frames; ↑↓ sets FPS. Ctrl+S writes the file immediately to the SAVED settings paths and reloads live displays; independent of Apply." },
	{ id: STATUS_ACTION_ID, label: "Show status", description: "Open focused read-only status overlay; Enter/Esc closes without affecting prompt input." },
	{ id: INIT_ACTION_ID, label: "Create missing files", description: "Create configuration and glyphs now from SAVED settings, not this draft. Keep existing files." },
	{ id: RELOAD_ACTION_ID, label: "Reload from disk", description: "Discard draft edits and reread root config; live settings stay unchanged." },
	{ id: APPLY_ACTION_ID, label: "Apply changes", description: "Shift+Enter applies from anywhere. Bare Enter asks confirmation, then atomically writes root config and emits live-change event." },
	{ id: CANCEL_ACTION_ID, label: "Cancel", description: "Close without saving draft or changing live settings." },
] as const;

export async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext, configPath = CODESOOK_OMP_CONFIG_PATH): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
		ctx.ui.notify("Codesook OMP Plugin settings require an interactive UI.", "warning");
		return;
	}
	const projectPath = await resolveIntegrationProject(ctx.cwd);
	const [{ presence, error: presenceError }, loaded] = await Promise.all([detectPresence(pi), Promise.resolve(loadSettingsDraft(projectPath, configPath))]);
	let draft = loaded.draft;
	let legacySources = loaded.legacySources;
	let error = loaded.errors.join("\n") || presenceError;
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			let closed = false;
			let textSubmenuOpen = false;
			let confirmingApply = false;
			let confirmingDiscard = false;
			let initializationResult: ScrollView | undefined;
			let openSectionId: string | undefined;
			let sectionList: SettingsList | undefined;
			let menuIndex = 0;
			const snapshot = (): Map<string, string> => new Map(settingsItems(draft, presence).map(item => [item.id, item.currentValue]));
			let baseline = snapshot();
			const changedIn = (items: readonly SettingItem[]): number =>
				items.filter(item => !item.heading && baseline.get(item.id) !== item.currentValue).length;
			const totalChanged = (): number => settingsSections(draft, presence).reduce((sum, section) => sum + changedIn(section.items), 0);
			const currentSection = (): SettingsSection | undefined => settingsSections(draft, presence).find(section => section.id === openSectionId);
			const trackedItems = (items: SettingItem[]): SettingItem[] =>
				trackTextSubmenus(
					items,
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
				initializationResult?.dispose();
				done(undefined);
			};
			const refresh = (): void => {
				const section = currentSection();
				if (section) sectionList?.setItems(trackedItems(section.items));
			};
			const openSection = (section: SettingsSection): void => {
				openSectionId = section.id;
				const items = trackedItems(section.items);
				sectionList = new SettingsList(
					items,
					Math.min(18, items.length),
					getSettingsListTheme(),
					(id, value) => {
						updateDraft(draft, id, value);
						error = undefined;
						refresh();
						tui.requestRender();
					},
					() => {
						openSectionId = undefined;
						sectionList = undefined;
						tui.requestRender();
					},
					{ layout: "auto", typeToSearch: false, hint: "↑↓ navigate · Enter edit · Esc back · Shift+Enter apply" },
				);
			};
			const apply = async (): Promise<void> => {
				if (closed) return;
				const validation = validateDraft(draft);
				if (validation) {
					error = validation;
					tui.requestRender();
					return;
				}
				try {
					const config = persistSettingsDraft(draft, configPath, legacySources);
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
				const next = loadSettingsDraft(projectPath, configPath);
				draft = next.draft;
				legacySources = next.legacySources;
				error = next.errors.join("\n") || undefined;
				baseline = snapshot();
				openSectionId = undefined;
				sectionList = undefined;
				tui.requestRender();
			};
			const menuEntries = (): { id: string; label: string; detail: string; description?: string }[] => [
				...settingsSections(draft, presence).map(section => {
					const changed = changedIn(section.items);
					const unloaded = section.id !== "section:presence" && section.items.some(item => item.warning);
					return {
						id: section.id,
						label: section.label,
						detail: [changed > 0 ? `${changed} changed` : "", unloaded ? sectionAbsentLabel(section.id) : ""].filter(Boolean).join(" · "),
					};
				}),
				...SETTINGS_ACTIONS.map(action => ({
					id: action.id,
					label: action.label,
					detail: action.id === APPLY_ACTION_ID && totalChanged() > 0 ? `${totalChanged()} changed` : "",
					description: action.description,
				})),
			];
			const cancel = (): void => {
				if (totalChanged() === 0) {
					finish();
					return;
				}
				confirmingDiscard = true;
				tui.requestRender();
			};
			const activate = (id: string): void => {
				const section = settingsSections(draft, presence).find(candidate => candidate.id === id);
				if (section) {
					openSection(section);
				} else if (id === APPLY_ACTION_ID) {
					confirmingApply = true;
				} else if (id === INIT_ACTION_ID) {
					const result = initializePluginConfig(ctx, configPath);
					initializationResult = new ScrollView(new Text(theme.fg(result.type === "error" ? "error" : "text", result.message), 0, 0), {
						height: 18,
						theme: { track: text => theme.fg("dim", text), thumb: text => theme.fg("accent", text) },
					});
				} else if (id === STATUS_ACTION_ID) {
					void showStatus(pi, ctx).then(() => tui.requestRender());
					return;
				} else if (id === GLYPH_STUDIO_ACTION_ID) {
					const root = readCodesookOmpConfig(configPath);
					void openGlyphStudio(pi, ctx, glyphTargets(draftFromRootConfig(root.valid ? root.value : undefined), configPath), configPath).then(() => tui.requestRender());
					return;
				} else if (id === RELOAD_ACTION_ID) {
					reload();
					return;
				} else if (id === CANCEL_ACTION_ID) {
					cancel();
					return;
				}
				tui.requestRender();
			};
			const component: Component = {
				render(width: number): readonly string[] {
					if (initializationResult) {
						initializationResult.setHeight(Math.max(4, Math.min(18, (tui.terminal?.rows ?? 24) - 6)));
						return [
							theme.fg("accent", theme.bold("Configuration initialization result")),
							...initializationResult.render(width),
							"",
							theme.fg("dim", "↑↓ scroll · Enter/Esc keep editing"),
						];
					}
					const changed = totalChanged();
					const section = currentSection();
					const heading = theme.fg("accent", theme.bold("Codesook OMP Plugin Settings"));
					const title = section ? `${heading} ${theme.fg("dim", "›")} ${theme.fg("accent", theme.bold(section.label))}` : heading;
					const header = [
						title + (changed > 0 ? `  ${theme.fg("warning", `${changed} unsaved`)}` : ""),
						theme.fg("dim", `Root: ${configPath}`),
						theme.fg("dim", `Project: ${projectIntegrationConfigPath(projectPath)}`),
						...(error ? [theme.fg("error", `Error: ${error}`)] : []),
					];
					if (confirmingDiscard) {
						return [
							...header,
							"",
							theme.fg("warning", theme.bold(`Discard ${changed} unsaved change${changed === 1 ? "" : "s"}?`)),
							"Nothing is written; live settings stay unchanged.",
							"",
							theme.fg("dim", "Enter discard · Esc keep editing · Shift+Enter apply instead"),
						];
					}
					if (confirmingApply) {
						return [
							...header,
							"",
							theme.fg("accent", theme.bold("Apply Codesook OMP settings?")),
							"Write root and edited project settings; notify loaded extensions.",
							"",
							theme.fg("dim", "Enter apply · Esc keep editing"),
						];
					}
					if (sectionList) return [...header, "", ...sectionList.render(width)];
					const entries = menuEntries();
					const sectionCount = entries.length - SETTINGS_ACTIONS.length;
					const labelWidth = Math.max(...entries.map(entry => entry.label.length)) + 2;
					const row = (entry: (typeof entries)[number], index: number): string => {
						const selected = index === menuIndex;
						const text = `${selected ? "> " : "  "}${entry.label.padEnd(labelWidth)}`;
						return (selected ? theme.fg("accent", text) : text) + (entry.detail ? theme.fg("warning", entry.detail) : "");
					};
					return [
						...header,
						"",
						theme.fg("dim", "Settings"),
						...entries.slice(0, sectionCount).map((entry, index) => row(entry, index)),
						"",
						theme.fg("dim", "Actions"),
						...entries.slice(sectionCount).map((entry, index) => row(entry, sectionCount + index)),
						"",
						...(entries[menuIndex]?.description ? [theme.fg("dim", entries[menuIndex]!.description!)] : []),
						theme.fg("dim", "↑↓ navigate · Enter open · Shift+Enter apply · Esc cancel"),
					];
				},
				handleInput(data: string): void {
					if (initializationResult) {
						if (isEnter(data) || isEscape(data)) {
							initializationResult.dispose();
							initializationResult = undefined;
						} else {
							initializationResult.handleScrollKey(data);
						}
						tui.requestRender();
						return;
					}
					if (confirmingDiscard) {
						if (isEscape(data)) {
							confirmingDiscard = false;
							tui.requestRender();
						} else if (isShiftEnter(data)) {
							confirmingDiscard = false;
							void apply();
						} else if (isEnter(data)) {
							finish();
						}
						return;
					}
					if (confirmingApply) {
						if (isEscape(data)) {
							confirmingApply = false;
							tui.requestRender();
						} else if (isEnter(data) || isShiftEnter(data)) {
							confirmingApply = false;
							void apply();
						}
						return;
					}
					if (isShiftEnter(data) && !textSubmenuOpen) {
						void apply();
						return;
					}
					if (sectionList) {
						sectionList.handleInput(data);
						tui.requestRender();
						return;
					}
					const entries = menuEntries();
					if (matchesKey(data, "up")) menuIndex = (menuIndex + entries.length - 1) % entries.length;
					else if (matchesKey(data, "down")) menuIndex = (menuIndex + 1) % entries.length;
					else if (isEnter(data)) {
						activate(entries[menuIndex]!.id);
						return;
					} else if (isEscape(data)) {
						cancel();
						return;
					}
					tui.requestRender();
				},
				invalidate(): void {
					sectionList?.invalidate();
					initializationResult?.invalidate();
				},
			};
			return component;
		},
		{ overlay: true },
	);
}

export default function codesookOmpPluginSettings(pi: ExtensionAPI): void {
	pi.setLabel("Codesook OMP Plugin Settings");
	pi.registerCommand("omp-plugins", {
		description: `Unified Codesook OMP plugin settings. ${COMMAND_USAGE}`,
		getArgumentCompletions(argumentPrefix) {
			const prefix = argumentPrefix.trim().toLowerCase();
			return ["status", "init config"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			let argument = args.trim().toLowerCase();
			if ((argument === "" || argument === "init") && (!ctx.hasUI || (argument === "init" ? typeof ctx.ui.select !== "function" : typeof ctx.ui.custom !== "function"))) {
				ctx.ui.notify("Codesook OMP settings require an interactive UI.\n/omp-plugins status — Show plugin and configuration status.\n/omp-plugins init config — Create missing configuration and glyphs from saved settings; preserve existing files.", "info");
				return;
			}
			if (argument === "init") {
				const choice = await ctx.ui.select("Initialize Codesook OMP configuration", [{
					label: "Create missing files",
					description: "Create missing configuration and glyphs now from saved settings. Keep existing files; do not apply a settings draft.",
				}]);
				if (choice !== "Create missing files") return;
				argument = "init config";
			}
			if (argument === "status") {
				await showStatus(pi, ctx);
				return;
			}
			if (argument === "init config") {
				const result = initializePluginConfig(ctx);
				ctx.ui.notify(result.message, result.type);
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
