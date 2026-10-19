import type { ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { MODEL_ROLES, type ModelRole } from "../roles.ts";
import { listChoices, type ModelChoice } from "./catalog.ts";
import { PRESET_DESCRIPTIONS, PRESET_NAMES, presetAssignment, specWithThinking, type Assignment, type ThinkingProfile } from "./presets.ts";
import { probeAll, type ModelProbe } from "./probe.ts";
import { checkPanel, seatModels, stripThinking } from "../panel-rules.ts";
import { readAssignment, saveAssignment, sameConfig, snapshot, targetSnapshot, type SetupSettings } from "./settings.ts";
import type { ThinkingLevel } from "../thinking.ts";

export interface SetupDeps {
	settings: SetupSettings;
	probe: ModelProbe;
	/** `behavior.pstack.defaultThinking`: the level every role is written at, before the judge and lean-seat steps. */
	defaultThinking: ThinkingLevel;
}

export type SetupNotify = (level: "info" | "warning" | "error", message: string) => void;
type SetupContext = Pick<ExtensionCommandContext, "hasUI" | "ui" | "models">;

export const SAVE = "Save";
export const CANCEL = "Cancel";
export const KEEP_CURRENT = "Current roles";
export const UNSET = "Unset";

function roleLabel(role: ModelRole, model: string | undefined): string {
	const unset = role.kind === "work" ? `unset, falls back to ${role.fallback}` : "unset, seat absent";
	return `${role.id}: ${model ?? unset}`;
}

function roleTitle(role: ModelRole): string {
	return `${role.id}\nWhat: ${role.what}\nWhen: ${role.when}\nRecommended: ${role.recommended}`;
}

async function chooseStart(ctx: SetupContext, deps: SetupDeps, choices: readonly ModelChoice[]): Promise<{ assignment: Assignment; profile: ThinkingProfile } | undefined> {
	const current = readAssignment(deps.settings);
	const presets = PRESET_NAMES.flatMap(name => {
		const assignment = presetAssignment(name, choices, current, deps.defaultThinking);
		return assignment ? [{ name, assignment }] : [];
	});
	const picked = await ctx.ui.select("pstack setup: start from a preset", [
		...presets.map(({ name }) => ({ label: name, description: PRESET_DESCRIPTIONS[name] })),
		{ label: KEEP_CURRENT, description: "Edit the pstack roles already in your config." },
		CANCEL,
	]);
	if (picked === KEEP_CURRENT) return { assignment: current, profile: "balanced" };
	const preset = presets.find(({ name }) => name === picked);
	return preset && { assignment: preset.assignment, profile: preset.name === "lean" ? "lean" : "balanced" };
}

async function chooseModel(
	ctx: SetupContext,
	deps: SetupDeps,
	role: ModelRole,
	choices: readonly ModelChoice[],
	profile: ThinkingProfile,
	currentSpec: string | undefined,
): Promise<{ model: string | undefined } | undefined> {
	const picked = await ctx.ui.select(roleTitle(role), [
		...choices.map(choice => ({ label: choice.spec, description: choice.name })),
		UNSET,
	]);
	if (picked === undefined) return undefined;
	const choice = choices.find(candidate => candidate.spec === picked);
	if (!choice) return { model: undefined };
	if (choice.efforts.length === 0) return { model: choice.spec };
	// Preselect what the role already runs when the model is unchanged, else what the preset rules give it.
	const suggested = currentSpec !== undefined && stripThinking(currentSpec) === choice.spec ? currentSpec : specWithThinking(role.id, choice, profile, deps.defaultThinking);
	const level = await ctx.ui.select(`${role.id} thinking level for ${choice.spec}`, [...choice.efforts], {
		initialIndex: Math.max(0, choice.efforts.indexOf(suggested.slice(choice.spec.length + 1))),
	});
	return level === undefined ? undefined : { model: `${choice.spec}:${level}` };
}

/** Validate, probe and write. Returns true when setup is finished, false to go back to the role menu. */
async function save(ctx: SetupContext, deps: SetupDeps, notify: SetupNotify, choices: readonly ModelChoice[], assignment: Assignment): Promise<boolean> {
	const vendorOf = (spec: string) => choices.find(choice => choice.spec === stripThinking(spec))?.vendor ?? spec.split("/")[0]!;
	const panel = checkPanel(seatModels(assignment), vendorOf);
	if (panel.errors.length > 0) {
		for (const error of panel.errors) notify("error", error);
		notify("error", "Nothing was written. Change a seat and save again.");
		return false;
	}
	for (const warning of panel.warnings) notify("warning", warning);

	// Roles that already match need no model call: a rerun costs nothing.
	const before = snapshot(deps.settings);
	if (!sameConfig(before, targetSnapshot(before, assignment, before.isolation))) {
		const specs = Object.values(assignment).filter((spec): spec is string => spec !== undefined).map(stripThinking);
		notify("info", `Probing ${new Set(specs).size} model(s) with one turn each.`);
		const failures = await probeAll(specs, deps.probe);
		if (failures.length > 0) {
			for (const { spec, reason } of failures) notify("error", `${spec} did not answer: ${reason}`);
			notify("error", "Nothing was written. Pick other models and save again.");
			return false;
		}
	}

	let isolation = deps.settings.taskIsolation();
	if (!isolation) {
		isolation = await ctx.ui.confirm(
			"Enable OMP task isolation?",
			"Panel builders and arena or swarm writers need task.isolation.enabled, which is off in your config. Enabling it changes how every task agent runs. Leave it off to keep your current setting.",
		);
	}

	const result = await saveAssignment(deps.settings, assignment, isolation);
	if (result.ok) {
		notify("info", result.changed ? "pstack model roles saved and read back." : "pstack model roles already match; nothing changed.");
	} else {
		notify(
			"error",
			`Saving failed: ${result.reason}. ${result.restored ? "Your previous config was restored." : "Restoring your previous config failed: check the model roles in your OMP config."}`,
		);
	}
	return true;
}

export async function runSetup(ctx: SetupContext, deps: SetupDeps, notify: SetupNotify): Promise<void> {
	if (!ctx.hasUI) return notify("warning", "/pstack setup is interactive and needs a UI session.");
	const choices = listChoices(ctx.models);
	if (choices.length === 0) return notify("error", "The OMP registry serves no models. Log in to a provider, then run /pstack setup again.");

	const start = await chooseStart(ctx, deps, choices);
	if (!start) return notify("info", "pstack setup cancelled. Nothing was written.");
	const { assignment, profile } = start;

	for (;;) {
		const picked = await ctx.ui.select("pstack setup: pick a role to change, or save", [
			...MODEL_ROLES.map(role => roleLabel(role, assignment[role.id])),
			SAVE,
			CANCEL,
		]);
		if (picked === undefined || picked === CANCEL) return notify("info", "pstack setup cancelled. Nothing was written.");
		if (picked === SAVE) {
			if (await save(ctx, deps, notify, choices, assignment)) return;
			continue;
		}
		const role = MODEL_ROLES.find(candidate => picked.startsWith(`${candidate.id}:`));
		const choice = role && (await chooseModel(ctx, deps, role, choices, profile, assignment[role.id]));
		if (role && choice) assignment[role.id] = choice.model;
	}
}

/** `/pstack preset <name>`: apply the preset (a delta on your roles for claude-codex), then validate, probe and write exactly as setup's Save does. */
export async function runPreset(ctx: SetupContext, deps: SetupDeps, notify: SetupNotify, name: string): Promise<void> {
	if (!ctx.hasUI) return notify("warning", "/pstack preset is interactive and needs a UI session.");
	const preset = PRESET_NAMES.find(candidate => candidate === name);
	if (!preset) return notify("warning", `Unknown preset "${name}". Presets: ${PRESET_NAMES.join(", ")}.`);
	const choices = listChoices(ctx.models);
	const assignment = presetAssignment(preset, choices, readAssignment(deps.settings), deps.defaultThinking);
	if (!assignment) return notify("error", `The OMP registry does not serve the models the ${preset} preset needs. Log in to the missing provider, or run /pstack setup.`);
	await save(ctx, deps, notify, choices, assignment);
}
