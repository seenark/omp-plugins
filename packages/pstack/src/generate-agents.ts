import { agentDrift, writeAgents } from "./agents.ts";

if (process.argv.includes("--check")) {
	const problems = agentDrift();
	if (problems.length > 0) {
		console.error(`pstack agents drifted from the role table (run \`bun run generate:agents\`):\n${problems.join("\n")}`);
		process.exit(1);
	}
	console.log("pstack agents match the role table");
} else {
	const changed = writeAgents();
	console.log(changed.length === 0 ? "pstack agents already up to date" : `updated ${changed.join(", ")}`);
}
