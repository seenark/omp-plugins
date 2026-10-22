import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PACKAGE_ROOT, buildRelease, decideRelease, releasedVersions } from "./build.ts";

function files(root: string, dir = ""): string[] {
	return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
		const relative = path.posix.join(dir, entry.name);
		return entry.isDirectory() ? files(root, relative) : [relative];
	});
}

describe("decideRelease", () => {
	it("releases a version that is not tagged yet", () => {
		expect(decideRelease("1.2.0", ["1.0.0", "1.1.0"])).toEqual({
			release: true,
			version: "1.2.0",
			reason: "v1.2.0 is not released yet",
		});
	});

	it("skips a version already tagged, so a re-run does nothing", () => {
		expect(decideRelease("1.1.0", ["1.0.0", "1.1.0"]).release).toBe(false);
	});

	it("matches the whole version, not a prefix of it", () => {
		expect(decideRelease("1.1.0", ["1.1.0-rc.1", "1.1.01", "v1.1.0"]).release).toBe(true);
	});

	it("rejects a version that is not semver", () => {
		for (const bad of ["", "1.0", "v1.0.0", "1.0.0 ", "latest"]) expect(() => decideRelease(bad, [])).toThrow();
	});
});

describe("releasedVersions", () => {
	it("reads v-tags from ls-remote, folding peeled annotated tags and ignoring other refs", () => {
		const lsRemote = [
			"aaa\trefs/tags/v1.0.0",
			"bbb\trefs/tags/v1.0.0^{}",
			"ccc\trefs/tags/v1.1.0-rc.1",
			"ddd\trefs/tags/latest",
			"eee\trefs/heads/v9.9.9",
			"",
		].join("\n");
		expect(releasedVersions(lsRemote)).toEqual(["1.0.0", "1.1.0-rc.1"]);
	});

	it("returns nothing for an empty repo", () => {
		expect(releasedVersions("")).toEqual([]);
	});
});

describe("release build", () => {
	let work: string;
	let first: string;
	let second: string;

	beforeAll(async () => {
		work = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-release-"));
		first = path.join(work, "first");
		second = path.join(work, "second");
		await buildRelease(first);
		await buildRelease(second);
	});
	afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

	it("lays out the plugin tree", () => {
		for (const entry of ["package.json", "README.md", "THIRD-PARTY-NOTICES.txt", "src/index.js", "src/verdict.ts", "skills/bro/SKILL.md", "agents/pstack-judge.md", "assets/cover.jpg"]) {
			expect(fs.existsSync(path.join(first, entry))).toBe(true);
		}
		expect(fs.existsSync(path.join(first, "plugin.json"))).toBe(false);
	});

	it("leaves out the sync engine, tests and dev tooling", () => {
		const all = files(first);
		expect(all.filter(file => /\.test\.[cm]?[jt]sx?$/.test(file) || file.startsWith("src/sync/") || file.includes("node_modules/"))).toEqual([]);
		expect(all.filter(file => file.startsWith("src/") && file !== "src/index.js" && file !== "src/verdict.ts")).toEqual([]);
		expect(fs.existsSync(path.join(first, "tsconfig.json"))).toBe(false);
	});

	it("has no @codesook/ import in any shipped script", () => {
		const importOfCodesook = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*["']@codesook\//;
		const scripts = files(first).filter(file => /\.[cm]?[jt]s$/.test(file));
		expect(scripts).toContain("src/index.js");
		for (const file of scripts) expect({ file, matches: importOfCodesook.test(fs.readFileSync(path.join(first, file), "utf8")) }).toEqual({ file, matches: false });
	});

	it("keeps @oh-my-pi/* external", () => {
		const bundle = fs.readFileSync(path.join(first, "src/index.js"), "utf8");
		expect(bundle).toMatch(/from "@oh-my-pi\/pi-coding-agent\//);
		expect(bundle).not.toMatch(/\/node_modules\/@oh-my-pi\//);
	});

	it("has a package.json without dependencies, keeping the omp key and the peers", () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(first, "package.json"), "utf8"));
		const source = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
		expect(manifest).not.toHaveProperty("dependencies");
		expect(manifest).not.toHaveProperty("devDependencies");
		expect(manifest.version).toBe(source.version);
		expect(manifest.peerDependencies).toEqual(source.peerDependencies);
		expect(manifest.omp.extensions).toEqual(["./src/index.js"]);
		for (const extension of manifest.omp.extensions) expect(fs.existsSync(path.join(first, extension))).toBe(true);
	});

	it("builds the same bytes twice", () => {
		const names = files(first).sort();
		expect(files(second).sort()).toEqual(names);
		for (const name of names) {
			expect({ name, same: fs.readFileSync(path.join(first, name)).equals(fs.readFileSync(path.join(second, name))) }).toEqual({ name, same: true });
		}
	});

	it("resolves the verdict helper from every skill directory, as panel-verdicts.md imports it", async () => {
		const doc = fs.readFileSync(path.join(first, "skills/poteto-mode/references/panel-verdicts.md"), "utf8");
		expect(doc).toContain("<skill dir>/../../src/verdict.ts");
		for (const skill of fs.readdirSync(path.join(first, "skills"))) {
			expect(fs.existsSync(path.join(first, "skills", skill, "..", "..", "src", "verdict.ts"))).toBe(true);
		}
		// The path is built at runtime inside a temp tree, so a static import cannot name it.
		const helper = await import(path.join(first, "skills", "poteto-mode", "..", "..", "src", "verdict.ts"));
		expect(Object.keys(helper)).toEqual(expect.arrayContaining(["duplicateCandidates", "mergeVerdicts", "reviewerLines", "SAME_ISSUE"]));
	});

	it("keeps the bundle's skills directory at the path the extension resolves", () => {
		const bundle = fs.readFileSync(path.join(first, "src/index.js"), "utf8");
		expect(bundle).toContain('path2.join(import.meta.dirname, "..", "skills"');
	});
});
