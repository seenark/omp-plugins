import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { isGeneratedAgent } from "../agents.ts";
import { failsGate, PIN_FILE, runSync, SyncConfigError } from "./engine.ts";
import { groups } from "./rules/index.ts";
import { resolveTree, UPSTREAM_REPOSITORY } from "./source.ts";
import type { Pin } from "./types.ts";

const USAGE = `Usage: bun run sync [--rev <sha>] [--upstream <git checkout>] [--check] [--report <file>] [--skill-dir <dir>]...
  --rev        Upstream revision to sync to (default: the Pinned Revision in ${PIN_FILE})
  --upstream   Local cursor/plugins checkout holding the revision; otherwise it is fetched
  --check      Write nothing; exit 1 on drift, stale files, conflicts, or a Cursor-specific term no allowance covers
  (env PSTACK_UPSTREAM is the default for --upstream)
  --report     Also write the report to this file
  --skill-dir  Directory of other discovered skills to check for name collisions (repeatable)`;

const packageRoot = path.resolve(import.meta.dir, "../..");

function readPin(): Pin | undefined {
	const file = path.join(packageRoot, PIN_FILE);
	return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Pin) : undefined;
}

function main(): number {
	const { values } = parseArgs({
		options: {
			rev: { type: "string" },
			upstream: { type: "string" },
			check: { type: "boolean", default: false },
			report: { type: "string" },
			"skill-dir": { type: "string", multiple: true },
			help: { type: "boolean", default: false },
		},
	});
	if (values.help) {
		console.log(USAGE);
		return 0;
	}
	const pin = readPin();
	const revision = values.rev ?? pin?.revision;
	if (revision === undefined) throw new SyncConfigError(`No ${PIN_FILE} yet: pass --rev <sha>`);

	const checkout = values.upstream ?? process.env.PSTACK_UPSTREAM;
	const upstream = resolveTree(revision, checkout);
	const base = pin !== undefined && pin.revision !== revision ? resolveTree(pin.revision, checkout) : undefined;
	const result = runSync({
		packageRoot,
		upstream,
		base,
		repository: pin?.repository ?? UPSTREAM_REPOSITORY,
		revision,
		groups,
		skillDirectories: values["skill-dir"],
		ownedElsewhere: isGeneratedAgent,
		write: !values.check,
	});

	const failed = result.conflicts.length > 0 || (values.check && failsGate(result));
	if (failed || !values.check) console.log(result.report);
	else console.log(`pstack matches the sync output at ${revision}`);
	if (values.report !== undefined) fs.writeFileSync(values.report, result.report);
	return failed ? 1 : 0;
}

try {
	process.exitCode = main();
} catch (error) {
	if (!(error instanceof SyncConfigError)) throw error;
	console.error(error.message);
	process.exitCode = 1;
}
