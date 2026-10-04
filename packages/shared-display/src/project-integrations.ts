import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import {
	CODESOOK_OMP_CONFIG_PATH,
	isRecord,
	readCodesookOmpConfig,
	writeCodesookOmpConfig,
	type CodesookOmpConfig,
	type CodesookOmpConfigReadResult,
} from "./config-store";

export type IntegrationName = "codegraph" | "beads";
export type IntegrationPolicy = "auto" | "off";
export type IntegrationVisibility = "ready" | "always" | "never";
type SettingsSource = "project" | "global" | "default";
const git = promisify(execFile);

export async function resolveIntegrationProject(cwd: string): Promise<string> {
	try {
		const result = await git("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000, env: { ...process.env, LC_ALL: "C", LANG: "C" } });
		const project = result.stdout.replace(/\r?\n$/u, "");
		if (!path.isAbsolute(project)) throw new Error("Git did not return an absolute working-tree root.");
		return project;
	} catch (error) {
		const diagnostic = (isRecord(error) && typeof error.stderr === "string" ? error.stderr.trim() : "") || (error instanceof Error ? error.message : String(error));
		if (isRecord(error) && error.code === 128 && (
			/^fatal: not a git repository \(or any of the parent directories\): \.git$/u.test(diagnostic) ||
			/^fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.$/u.test(diagnostic)
		)) return path.resolve(cwd);
		throw new Error(`Cannot resolve Integration Project for ${cwd}: ${diagnostic}. Check Git availability, permissions, and repository ownership before enabling integration guidance.`);
	}
}

export function projectIntegrationConfigPath(projectPath: string): string {
	return path.join(projectPath, ".omp", "codesook-omp.json");
}

/** Validate only the selected integration; retain unknown settings for their owners. */
export function integrationConfigErrors(
	integration: IntegrationName,
	config: CodesookOmpConfigReadResult,
	configPath: string,
): string[] {
	if (!config.valid) return [`Invalid Codesook OMP config: ${configPath}. Repair its version: 1, display, and behavior envelope before applying settings.`];
	const errors: string[] = [];
	for (const [group, field, allowed] of [
		["behavior", "policy", ["auto", "off"]],
		["display", "visibility", ["ready", "always", "never"]],
	] as const) {
		const section = config.value[group][integration];
		if (section === undefined) continue;
		if (!isRecord(section) || (section[field] !== undefined && !allowed.some(value => value === section[field]))) {
			errors.push(`Invalid ${group}.${integration}.${field} in ${configPath}; use ${allowed.join(" or ")} (or remove the override).`);
		}
	}
	return errors;
}

export function readIntegrationSettings(
	integration: IntegrationName,
	projectPath: string,
	globalConfigPath = CODESOOK_OMP_CONFIG_PATH,
): {
	policy: IntegrationPolicy | undefined;
	visibility: IntegrationVisibility;
	policySource: SettingsSource;
	visibilitySource: SettingsSource;
	errors: readonly string[];
	global: CodesookOmpConfigReadResult;
	project: CodesookOmpConfigReadResult;
} {
	const projectPathConfig = projectIntegrationConfigPath(projectPath);
	const global = readCodesookOmpConfig(globalConfigPath);
	const project = readCodesookOmpConfig(projectPathConfig);
	const errors = [...integrationConfigErrors(integration, global, globalConfigPath), ...integrationConfigErrors(integration, project, projectPathConfig)];
	const globalPolicy = isRecord(global.value.behavior[integration]) ? global.value.behavior[integration].policy : undefined;
	const projectPolicy = isRecord(project.value.behavior[integration]) ? project.value.behavior[integration].policy : undefined;
	const globalVisibility = isRecord(global.value.display[integration]) ? global.value.display[integration].visibility : undefined;
	const projectVisibility = isRecord(project.value.display[integration]) ? project.value.display[integration].visibility : undefined;
	const visibility = projectVisibility ?? globalVisibility ?? "ready";
	return {
		policy: errors.length ? undefined : (projectPolicy ?? globalPolicy ?? "auto") as IntegrationPolicy,
		visibility: ["ready", "always", "never"].includes(String(visibility)) ? visibility as IntegrationVisibility : "ready",
		policySource: projectPolicy !== undefined ? "project" : globalPolicy !== undefined ? "global" : "default",
		visibilitySource: projectVisibility !== undefined ? "project" : globalVisibility !== undefined ? "global" : "default",
		errors,
		global,
		project,
	};
}

/** Prepare staged edits without writing; undefined leaves a field untouched, inherit removes it. */
export function prepareProjectIntegrationSettings(
	integration: IntegrationName,
	projectPath: string,
	edits: { policy?: IntegrationPolicy | "inherit"; visibility?: IntegrationVisibility | "inherit" },
): CodesookOmpConfig {
	const configPath = projectIntegrationConfigPath(projectPath);
	const current = readCodesookOmpConfig(configPath);
	const errors = integrationConfigErrors(integration, current, configPath);
	if (errors.length) throw new Error(errors.join("\n"));
	const next = structuredClone(current.value);
	for (const [group, field, value, allowed] of [
		["behavior", "policy", edits.policy, ["auto", "off", "inherit"]],
		["display", "visibility", edits.visibility, ["ready", "always", "never", "inherit"]],
	] as const) {
		if (value === undefined) continue;
		if (!allowed.some(candidate => candidate === value)) throw new Error(`Invalid ${integration} ${field}: ${String(value)}`);
		const section = next[group][integration];
		if (value === "inherit") {
			if (isRecord(section)) delete section[field];
		} else {
			next[group][integration] = { ...(isRecord(section) ? section : {}), [field]: value };
		}
	}
	return next;
}

export function setProjectIntegrationPolicy(integration: IntegrationName, projectPath: string, policy: IntegrationPolicy): void {
	writeCodesookOmpConfig(prepareProjectIntegrationSettings(integration, projectPath, { policy }), projectIntegrationConfigPath(projectPath));
}
