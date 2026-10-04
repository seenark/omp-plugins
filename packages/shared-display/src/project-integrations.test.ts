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

test("Git inspection failures cannot bypass a repository's shared off policy", () => {
	const root = realpathSync(temporary());
	const source = `
		import { strict as assert } from "node:assert";
		import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
		import * as os from "node:os";
		import * as path from "node:path";
		import { execFileSync } from "node:child_process";
		import { CODESOOK_OMP_CONFIG_PATH } from ${JSON.stringify(path.resolve(import.meta.dir, "config-store.ts"))};
		import { resolveIntegrationProject, readIntegrationSettings, projectIntegrationConfigPath } from ${JSON.stringify(path.resolve(import.meta.dir, "project-integrations.ts"))};
		const root = ${JSON.stringify(root)};
		assert.equal(os.homedir(), path.join(root, "home"));
		for (const location of [CODESOOK_OMP_CONFIG_PATH, process.env.PI_CODING_AGENT_DIR, path.join(os.homedir(), ".pi", "agent")]) {
			assert.ok(location.startsWith(root + path.sep), location);
		}
		const repository = path.join(root, "repository with spaces");
		const child = path.join(repository, "child");
		mkdirSync(child, { recursive: true });
		execFileSync(${JSON.stringify(Bun.which("git"))}, ["init", "-q", repository]);
		const policyPath = projectIntegrationConfigPath(repository);
		mkdirSync(path.dirname(policyPath));
		const bytes = JSON.stringify({version:1,display:{},behavior:{beads:{policy:"off"},codegraph:{policy:"off"}}});
		writeFileSync(policyPath, bytes);
		const outside = path.join(root, "outside");
		mkdirSync(outside);
		const probe = \`
			import { resolveIntegrationProject, readIntegrationSettings } from ${JSON.stringify(path.resolve(import.meta.dir, "project-integrations.ts"))};
			try {
				const project = await resolveIntegrationProject(process.argv[1]);
				console.log(JSON.stringify({ project, policy: readIntegrationSettings("beads", project).policy }));
			} catch (error) {
				console.log(JSON.stringify({ error: error.message }));
			}
		\`;
		for (const scenario of [
			{ cwd: child, extra: { PATH: path.join(root, "no-git") }, failure: true },
			{ cwd: child, extra: { GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" }, failure: true },
			{ cwd: outside, extra: {}, failure: false },
		]) {
			const process = Bun.spawnSync([${JSON.stringify(process.execPath)}, "-e", probe, scenario.cwd], { cwd: root, env: { ...processEnvironment, ...scenario.extra } });
			assert.equal(process.exitCode, 0, process.stderr.toString());
			const result = JSON.parse(process.stdout.toString());
			if (scenario.failure) {
				assert.ok(result.error, "Git failure fell back to " + result.project + " and enabled policy " + result.policy);
			} else {
				assert.equal(result.project, outside);
				assert.equal(result.policy, "auto");
			}
		}
		assert.equal(readFileSync(policyPath, "utf8"), bytes);
		console.log("Git failures reject; confirmed outside-Git scope remains supported");
	`;
	const home = path.join(root, "home");
	const processEnvironment = {
		HOME: home,
		PI_CODING_AGENT_DIR: path.join(home, ".omp", "agent"),
		XDG_CONFIG_HOME: path.join(home, ".config"),
		PATH: "/usr/bin:/bin",
		LC_ALL: "C",
	};
	const child = Bun.spawnSync([process.execPath, "-e", `const processEnvironment = ${JSON.stringify(processEnvironment)};${source}`], {
		cwd: root,
		env: processEnvironment,
	});
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	expect(child.exitCode).toBe(0);
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
