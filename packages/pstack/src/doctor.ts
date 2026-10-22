import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { SUSPENDABLE_INSTRUCTION_MODES } from "@codesook/omp-shared-display/instruction-mode";
import { suspendsMode, type PstackBehavior } from "./behavior.ts";
import { resolveSeats } from "./panel.ts";
import { MODEL_ROLES, WORK_ROLES, roleAlias } from "./roles.ts";
import { checkPanel } from "./panel-rules.ts";
import type { SetupSettings } from "./setup/settings.ts";
import { POTETO_SKILL } from "./activation.ts";

export type Severity = "ok" | "warning" | "error";

export interface Finding {
	check: "roles" | "panel" | "skills" | "instruction-modes" | "display-host" | "task-isolation";
	severity: Severity;
	message: string;
}

type SlashCommand = ReturnType<ExtensionAPI["getCommands"]>[number];

export interface DoctorInput {
	models: Pick<ExtensionContext["models"], "resolve" | "family">;
	settings: Pick<SetupSettings, "modelRoles" | "taskIsolation">;
	behavior: PstackBehavior;
	commands: readonly SlashCommand[];
	/** The package's `skills/` directory: skills found under it are pstack's own. */
	skillsRoot: string;
	displayHostAvailable: boolean;
}

const realpath = (target: string): string => {
	try {
		return fs.realpathSync(target);
	} catch {
		return path.resolve(target);
	}
};

function listFiles(directory: string): string[] {
	return fs.readdirSync(directory, { recursive: true, withFileTypes: true }).flatMap(entry => (entry.isFile() ? [path.join(entry.parentPath, entry.name)] : []));
}

/** Skills a workflow calls: poteto-mode and every vendored skill its SKILL.md, playbooks or references name as `**name**`, `` `name` ``, `/skill:name` or `skill://name`. */
export function workflowCalledSkills(skillsRoot: string): string[] {
	const names = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md"))).map(entry => entry.name);
	const text = listFiles(path.join(skillsRoot, POTETO_SKILL))
		.filter(file => file.endsWith(".md"))
		.map(file => fs.readFileSync(file, "utf8"))
		.join("\n");
	return names.filter(name => name === POTETO_SKILL || new RegExp(`(?:\\*\\*|\`|/skill:|skill://)${name}(?![\\w-])`).test(text));
}

function checkRoles({ models, settings }: Pick<DoctorInput, "models" | "settings">): Finding[] {
	const configured = settings.modelRoles();
	const findings: Finding[] = [];
	for (const role of MODEL_ROLES) {
		const spec = configured[role.id];
		if (spec !== undefined && !models.resolve(roleAlias(role))) {
			findings.push({ check: "roles", severity: "error", message: `${role.id} is set to ${spec}, which the OMP registry does not serve. Run /pstack setup.` });
		}
	}
	const seats = resolveSeats(models).filter(seat => seat.model !== undefined).map(seat => seat.seat.toUpperCase());
	if (seats.length === 0) {
		findings.push({ check: "roles", severity: "warning", message: "No panel seat has a model, so panel workflows run without a panel. Run /pstack setup." });
	}
	const fallbacks = WORK_ROLES.filter(role => configured[role.id] === undefined);
	if (findings.length === 0) {
		const set = WORK_ROLES.length - fallbacks.length;
		findings.push({
			check: "roles",
			severity: "ok",
			message: `${set}/${WORK_ROLES.length} work roles set${fallbacks.length > 0 ? ` (${fallbacks.map(role => `${role.id} falls back to ${role.fallback}`).join(", ")})` : ""}; panel seats with a model: ${seats.join(", ")}.`,
		});
	}
	return findings;
}

function checkPanelRules(models: DoctorInput["models"]): Finding[] {
	const seats = resolveSeats(models);
	const vendors = new Map(seats.flatMap(seat => (seat.model && seat.vendor ? [[seat.model, seat.vendor] as const] : [])));
	const { errors, warnings } = checkPanel(seats.map(({ seat, model }) => ({ seat, model })), spec => vendors.get(spec) ?? spec);
	const findings: Finding[] = [
		...errors.map((message): Finding => ({ check: "panel", severity: "error", message })),
		...warnings.map((message): Finding => ({ check: "panel", severity: "warning", message })),
	];
	const configured = seats.filter(seat => seat.model !== undefined);
	if (configured.length > 0) {
		findings.push({ check: "panel", severity: "ok", message: `seats: ${configured.map(seat => `${seat.seat.toUpperCase()} ${seat.model} (vendor ${seat.vendor})`).join(", ")}.` });
	}
	return findings;
}

function checkSkills({ commands, skillsRoot }: Pick<DoctorInput, "commands" | "skillsRoot">): Finding[] {
	const called = workflowCalledSkills(skillsRoot);
	const skillCommands = new Map(commands.filter(command => command.source === "skill").map(command => [command.name, command] as const));
	if (skillCommands.size === 0) {
		return [{ check: "skills", severity: "warning", message: "OMP lists no skill commands (skills.enableSkillCommands off?), so ownership of the workflow-called skills cannot be checked." }];
	}
	const root = realpath(skillsRoot) + path.sep;
	const findings: Finding[] = [];
	for (const name of called) {
		const owner = skillCommands.get(`skill:${name}`);
		if (!owner) findings.push({ check: "skills", severity: "error", message: `Skill ${name} is called by a workflow but OMP does not list it. Check the package is installed and the skill is not disabled.` });
		else if (!owner.path || !realpath(owner.path).startsWith(root)) {
			findings.push({ check: "skills", severity: "error", message: `Skill ${name} resolves to ${owner.path ?? "another source"}, not pstack's copy, so workflows load that one instead.` });
		}
	}
	if (findings.length === 0) findings.push({ check: "skills", severity: "ok", message: `All ${called.length} workflow-called skills resolve to pstack's own copy.` });
	return findings;
}

function checkInstructionModes({ behavior, commands }: Pick<DoctorInput, "behavior" | "commands">): Finding[] {
	return SUSPENDABLE_INSTRUCTION_MODES.map((mode): Finding => {
		const suspend = suspendsMode(behavior, mode);
		const loaded = commands.some(command => command.source === "extension" && command.name === mode);
		const message = !loaded
			? `${mode} is not loaded, so there is nothing to suspend.`
			: suspend
				? `${mode} is loaded and switches off while pstack is active.`
				: `${mode} is loaded and keeps running while pstack is active (suspend setting is off).`;
		return { check: "instruction-modes", severity: "ok", message };
	});
}

/** Read-only health checks; each finding names what is wrong and the command that fixes it. */
export function diagnose(input: DoctorInput): Finding[] {
	const display: Finding = input.displayHostAvailable
		? { check: "display-host", severity: "ok", message: "A Display Host is running." }
		: { check: "display-host", severity: "warning", message: "No Display Host is running, so the pstack Status Segment is not shown. Enable @codesook/omp-shared-display." };
	const isolation: Finding = input.settings.taskIsolation()
		? { check: "task-isolation", severity: "ok", message: "task.isolation.enabled is on." }
		: { check: "task-isolation", severity: "warning", message: "task.isolation.enabled is off. Panel builders and arena or swarm writers need it; /pstack setup offers to turn it on." };
	return [...checkRoles(input), ...checkPanelRules(input.models), ...checkSkills(input), ...checkInstructionModes(input), display, isolation];
}

export function doctorLevel(findings: readonly Finding[]): "info" | "warning" | "error" {
	if (findings.some(finding => finding.severity === "error")) return "error";
	return findings.some(finding => finding.severity === "warning") ? "warning" : "info";
}

export function doctorReport(findings: readonly Finding[]): string {
	const problems = findings.filter(finding => finding.severity !== "ok").length;
	return [
		problems === 0 ? "pstack doctor: healthy" : `pstack doctor: ${problems} problem(s)`,
		...findings.map(finding => `${finding.severity === "ok" ? "ok     " : finding.severity === "warning" ? "warning" : "error  "} ${finding.check}: ${finding.message}`),
	].join("\n");
}
