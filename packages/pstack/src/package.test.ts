import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { MODEL_ROLES } from "./roles.ts";

const root = path.resolve(import.meta.dir, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function frontmatter(file: string): Record<string, string> {
	const match = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(file, "utf8"));
	if (!match) return {};
	return Object.fromEntries(
		match[1]!.split("\n").flatMap(line => {
			const pair = /^([\w-]+):\s*(.*)$/.exec(line);
			return pair ? [[pair[1]!, pair[2]!]] : [];
		}),
	);
}

describe("discovery contract", () => {
	it("carries an omp key so OMP does not skip the package root", () => {
		expect(manifest.omp.extensions).toEqual(["./src/index.ts"]);
	});

	it("ships no Agent Plugins manifest", () => {
		expect(fs.existsSync(path.join(root, "plugin.json"))).toBe(false);
		expect(fs.existsSync(path.join(root, ".claude-plugin"))).toBe(false);
	});

	it("publishes every discovery directory", () => {
		for (const dir of ["skills", "agents", "rules", "src"]) expect(manifest.files).toContain(dir);
	});

	it("every skill has a name matching its directory and a description", () => {
		const skills = fs.readdirSync(path.join(root, "skills"));
		expect(skills).toContain("bro");
		for (const skill of skills) {
			const meta = frontmatter(path.join(root, "skills", skill, "SKILL.md"));
			expect(meta.name).toBe(skill);
			expect(meta.description).toBeTruthy();
		}
	});

	it("every agent has a name matching its file and a description", () => {
		const agents = fs.readdirSync(path.join(root, "agents"));
		expect(agents).toContain("comment-sicko.md");
		for (const agent of agents) {
			const meta = frontmatter(path.join(root, "agents", agent));
			expect(meta.name).toBe(agent.replace(/\.md$/, ""));
			expect(meta.description).toBeTruthy();
		}
	});
});

describe("README", () => {
	const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

	it("documents every model role's what, when and recommended text", () => {
		for (const role of MODEL_ROLES) {
			if (role.kind === "work") expect(readme).toContain(role.what);
			expect(readme).toContain(role.when);
			expect(readme).toContain(role.recommended);
		}
	});

	it("names the tracked pstack version and Pinned Revision", () => {
		const pin = JSON.parse(fs.readFileSync(path.join(root, "upstream.json"), "utf8"));
		expect(readme).toContain(pin.revision);
		expect(readme).toContain(pin.version);
	});
});
