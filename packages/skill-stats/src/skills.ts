import { isRecord } from "@codesook/omp-shared-display/config-store";
import { canonicalPath } from "@codesook/omp-shared-display/project-integrations";
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import type { Origin, Scope, SkillInfo } from "./types.ts";

const PROJECT_SKILL_DIRECTORIES: readonly (readonly [string, string])[] = [
	[".omp", "skills"],
	[".agents", "skills"],
	[".claude", "skills"],
];
const GLOBAL: Scope = { kind: "global" };

/** The only constructor of a Project Scope, so a root from any source (skill path, Integration Project) is canonical. */
export function projectScope(root: string): Extract<Scope, { kind: "project" }> {
	return { kind: "project", root: canonicalPath(root) };
}

/** Index of the `{.omp,.agents,.claude}/skills` pair that owns this path, or -1 when it is not under one. */
function projectDirectoryIndex(parts: readonly string[]): number {
	for (let index = parts.length - 3; index >= 0; index -= 1) {
		if (PROJECT_SKILL_DIRECTORIES.some(([dot, skills]) => parts[index] === dot && parts[index + 1] === skills)) return index;
	}
	return -1;
}

/** The one place that decides Project versus Global: the skill sits under `<root>/{.omp,.agents,.claude}/skills/` and `<root>` is not the home directory. */
export function classifySkillPath(skillPath: string, home: string): Scope {
	const parts = path.resolve(skillPath).split(path.sep);
	const index = projectDirectoryIndex(parts);
	if (index < 0) return GLOBAL;
	const scope = projectScope(parts.slice(0, index).join(path.sep) || path.sep);
	return scope.root === canonicalPath(home) ? GLOBAL : scope;
}

export function sameScope(a: Scope, b: Scope): boolean {
	return a.kind === b.kind && (a.kind === "global" || (b.kind === "project" && a.root === b.root));
}

export type SkillEnv = {
	home: string;
	/** `npx skills` global lock: skill name to `installedAt` (epoch ms, undefined when unparseable). */
	lock: ReadonlyMap<string, number | undefined>;
};

export function skillEnv(home: string): SkillEnv {
	const lock = new Map<string, number | undefined>();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(home, ".agents", ".skill-lock.json"), "utf8"));
		if (isRecord(parsed) && isRecord(parsed.skills)) {
			for (const [name, entry] of Object.entries(parsed.skills)) {
				const installed = isRecord(entry) ? entry.installedAt : undefined;
				const at = typeof installed === "string" ? Date.parse(installed) : Number.NaN;
				lock.set(name, Number.isFinite(at) ? at : undefined);
			}
		}
	} catch {
		// No lock file means no skill is managed by `npx skills`.
	}
	return { home, lock };
}

export function skillFileExists(skillPath: string): boolean {
	try {
		return statSync(skillPath).isFile();
	} catch {
		return false;
	}
}

function within(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function originOf(name: string, skillPath: string, scope: Scope, env: SkillEnv): Origin {
	if (scope.kind === "project") {
		const parts = skillPath.split(path.sep);
		return parts[projectDirectoryIndex(parts)] === ".agents" ? "npx-skills" : "project";
	}
	if (env.lock.has(name)) return "npx-skills";
	if (within(skillPath, path.join(env.home, ".omp", "agent", "managed-skills"))) return "managed";
	const pluginLike = skillPath.split(path.sep).some(segment => segment === "plugins" || segment === "node_modules");
	return !within(skillPath, env.home) || pluginLike ? "plugin" : "home";
}

function mtimeMs(skillPath: string): number | undefined {
	try {
		return statSync(skillPath).mtimeMs;
	} catch {
		return undefined;
	}
}

export function describeSkill(name: string, skillPath: string, env: SkillEnv): SkillInfo {
	const resolved = path.resolve(skillPath);
	const scope = classifySkillPath(resolved, env.home);
	const origin = originOf(name, resolved, scope, env);
	const lockedAt = scope.kind === "global" && origin === "npx-skills" ? env.lock.get(name) : undefined;
	return { name, path: resolved, scope, origin, installedAt: lockedAt ?? mtimeMs(resolved) };
}
