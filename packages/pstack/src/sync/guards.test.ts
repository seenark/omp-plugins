import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSync } from "./engine.ts";
import { guards } from "./rules/guards.ts";
import { loadTree } from "./source.ts";

const temporary: string[] = [];
afterEach(() => {
	for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-guards-test-"));
	temporary.push(directory);
	return directory;
}

const PLAYBOOK = "pstack/skills/poteto-mode/playbooks/multi-phase-plan.md";
const upstream = {
	"pstack/LICENSE": "l\n",
	"cursor-team-kit/LICENSE": "l\n",
	"pstack/plugin.json": '{"version":"9.9.9"}',
	"pstack/skills/poteto-mode/scripts/check-plan.mjs": "// plan checker\n",
	"pstack/skills/poteto-mode/scripts/check-plan.test.ts": "// plan checker test\n",
	[PLAYBOOK]:
		"6. Run `node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix every line it prints (a principle).\n7. Hand back. Post the plan path and the script's output, then stop.\n\n**Reply:** the plan, and the check script's output.\n",
};

function sync() {
	const root = scratch();
	for (const [file, content] of Object.entries(upstream)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	}
	const packageRoot = scratch();
	const result = runSync({ packageRoot, upstream: loadTree(root), repository: "https://example.test/repo", revision: "rev-1", groups: [guards], write: true });
	return { packageRoot, result };
}

describe("guards adaptations", () => {
	it("drops the plan checker and leaves no check-plan term behind", () => {
		const { packageRoot, result } = sync();
		expect(fs.existsSync(path.join(packageRoot, "skills/poteto-mode/scripts/check-plan.mjs"))).toBe(false);
		expect(fs.existsSync(path.join(packageRoot, "skills/poteto-mode/scripts/check-plan.test.ts"))).toBe(false);
		expect(result.findings.filter(finding => finding.category === "guards")).toEqual([]);
		expect(result.unusedRules).toEqual([]);
	});

	it("keeps the playbook's step numbering while it stops calling the script", () => {
		const { packageRoot } = sync();
		const playbook = fs.readFileSync(path.join(packageRoot, "skills/poteto-mode/playbooks/multi-phase-plan.md"), "utf8");
		expect(playbook).toMatch(/^6\. /m);
		expect(playbook).toMatch(/^7\. /m);
		expect(playbook).not.toContain("check-plan");
		expect(playbook).not.toContain("script's output");
	});
});
