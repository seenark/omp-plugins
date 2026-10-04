import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { projectIntegrationConfigPath, readIntegrationSettings, resolveIntegrationProject, setProjectIntegrationPolicy } from "./project-integrations";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temporary(): string { const directory = mkdtempSync(path.join(os.tmpdir(), "integration-settings-")); directories.push(directory); return directory; }
function document(file: string, value: unknown): void { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value)); }

test("project overrides global independently and absent policy permits automatic guidance", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	document(global, { version: 1, display: { codegraph: { visibility: "always" } }, behavior: { codegraph: { policy: "off" } } });
	document(projectIntegrationConfigPath(project), { version: 1, display: {}, behavior: { codegraph: { policy: "auto" }, beads: { policy: "off" } } });
	const settings = readIntegrationSettings("codegraph", project, global);
	expect(settings.policy).toBe("auto");
	expect(settings.policySource).toBe("project");
	expect(settings.visibility).toBe("always");
	expect(settings.visibilitySource).toBe("global");
	expect(settings.errors).toEqual([]);
	expect(readIntegrationSettings("beads", temporary(), global).policy).toBe("auto");
});

test("Git working trees own policy, including nested repositories; outside Git uses cwd", async () => {
	const outside = temporary();
	const repository = path.join(outside, "repository");
	const child = path.join(repository, "child");
	const nested = path.join(repository, "nested");
	mkdirSync(child, { recursive: true });
	mkdirSync(nested);
	execFileSync("git", ["init", "-q", repository]);
	expect(await resolveIntegrationProject(child)).toBe(await resolveIntegrationProject(repository));
	execFileSync("git", ["init", "-q", nested]);
	expect(await resolveIntegrationProject(nested)).not.toBe(await resolveIntegrationProject(repository));
	expect(await resolveIntegrationProject(outside)).toBe(outside);
	const spacedRepository = path.join(outside, "workspace ");
	mkdirSync(spacedRepository);
	execFileSync("git", ["init", "-q", spacedRepository]);
	expect(await resolveIntegrationProject(spacedRepository)).toBe(realpathSync(spacedRepository));
});

test("invalid global permission fails closed despite valid project override and survives writes", () => {
	const project = temporary();
	const global = path.join(project, "global.json");
	document(global, { version: 1, display: {}, behavior: { codegraph: { policy: "yes" } } });
	document(projectIntegrationConfigPath(project), { version: 1, display: {}, behavior: { codegraph: { policy: "auto" } } });
	const original = readFileSync(global, "utf8");
	const settings = readIntegrationSettings("codegraph", project, global);
	expect(settings.policy).toBeUndefined();
	expect(settings.errors.join("\n")).toContain(global);
	expect(readFileSync(global, "utf8")).toBe(original);
});

test("project policy edits retain unrelated and unknown fields and refuse invalid documents", () => {
	const project = temporary();
	const file = projectIntegrationConfigPath(project);
	const global = path.join(project, "absent-global.json");
	document(file, { version: 1, custom: { retain: 42 }, display: { codegraph: { visibility: "never", custom: true }, unrelated: "invalid-but-not-ours" }, behavior: { beads: { policy: "off" }, codegraph: { policy: "auto", custom: "retained" } } });
	setProjectIntegrationPolicy("codegraph", project, "off");
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(saved.custom).toEqual({ retain: 42 });
	expect(saved.behavior).toEqual({ beads: { policy: "off" }, codegraph: { policy: "off", custom: "retained" } });
	expect(saved.display).toEqual({ codegraph: { visibility: "never", custom: true }, unrelated: "invalid-but-not-ours" });
	for (const invalid of [
		"{broken",
		JSON.stringify({ version: 2, display: {}, behavior: {} }),
		JSON.stringify({ version: 1, display: {}, behavior: { codegraph: { policy: "invalid" } } }),
		JSON.stringify({ version: 1, display: { codegraph: { visibility: "invalid" } }, behavior: {} }),
	]) {
		writeFileSync(file, invalid);
		expect(readIntegrationSettings("codegraph", project, global).policy).toBeUndefined();
		expect(() => setProjectIntegrationPolicy("codegraph", project, "auto")).toThrow();
		expect(readFileSync(file, "utf8")).toBe(invalid);
	}
});
