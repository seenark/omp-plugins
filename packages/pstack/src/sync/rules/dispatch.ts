import type { Group, Rule } from "../types.ts";

/**
 * Cursor's Task / subagent_type / generalPurpose, AskQuestion, cloud agents,
 * per-role model sheet (`pstack-models.mdc`, model slugs) and the provider runner become OMP `task` lanes,
 * `ask`, isolated background tasks and the `pstack-*` model roles. Rules that cut a paragraph run before the
 * phrase rules that would otherwise shadow them; generic phrase rules come last.
 */

const REFERENCE = "skills/poteto-mode/references/provider-dispatch.md";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole line (paragraph) that starts with `start`. */
function line(start: string): RegExp {
	return new RegExp(`^${escapeRegExp(start)}[^\\n]*$`, "m");
}

/** Everything from `from` through `to`, across lines. */
function span(from: string, to: string): RegExp {
	return new RegExp(`${escapeRegExp(from)}[\\s\\S]*?${escapeRegExp(to)}`);
}

const POTETO = "skills/poteto-mode/SKILL.md";
const PLAYBOOKS = "skills/poteto-mode/playbooks/";
const REF_FROM_SKILL = "../poteto-mode/references/provider-dispatch.md";
const REF_FROM_PLAYBOOK = "../references/provider-dispatch.md";

const rules: Rule[] = [
	// poteto-mode: the Subagents section
	{
		id: "dispatch/poteto-subagent-type",
		reason: "Cursor's `subagent_type` is OMP's `agent` field on the `task` tool.",
		files: POTETO,
		pattern: line('**Use `subagent_type: "poteto-agent"`'),
		replacement:
			'**Use `agent: "poteto-agent"` for any subagent you spawn inside a playbook step** (code-writing delegates, ad-hoc helpers). The chat that receives `/poteto <task>` runs the playbook. Never spawn a `poteto-agent` to run the playbook itself. Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) name their own lane agents for diverse-model review. Respect what the skill prescribes, don\'t override to `poteto-agent`.',
	},
	{
		id: "dispatch/poteto-task-defaults",
		reason:
			"OMP's `task` has no per-call model: the lane agent carries a model role, and spawns return at once for `wait`. The per-role model sheet becomes the lane table in the dispatch reference.",
		files: POTETO,
		pattern: line("**Defaults for every `Task` call.**"),
		replacement:
			"**Defaults for every `task` call.** Spawn every independent task in one `tasks[]` call and collect the results with `wait`. Tasks run in the background. Give file pointers, not inlined context. The model comes from the lane agent, never from the call: `task` has no `model` field. Pick the lane by the job: `pstack-explore` maps code, `pstack-build` writes it (through `poteto-agent`), `pstack-mechanical` applies fully specified edits, `pstack-design` proposes or critiques a design, `pstack-judge` merges verdicts and writes judgment and prose, and `pstack-security` reviews for security flaws. `references/provider-dispatch.md` has the full role table, the panel seats and the dropout policy. Code delegates tier by difficulty. The hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms) run on `pstack-build` at a higher `effort`, whether the task needs judgment on vague intent or is a precisely specified sequence of steps to execute to the letter. Trivial mechanical edits go to `pstack-mechanical`. The user sets the model behind each role with `/pstack setup`. A work role the user never set uses its built-in fallback, so every lane still runs.",
	},
	{
		id: "dispatch/poteto-effort",
		reason: "OMP's `task` takes `effort` (`lo`, `med`, `hi`) instead of a model slug with a reasoning suffix and a fast mode.",
		files: POTETO,
		pattern: line("**Match the model to the job.**"),
		replacement:
			"**Match the effort to the job.** Before each spawn, start from the lane's default and set `effort` (`lo`, `med`, `hi`) when the `task` schema offers it. Raise it one step, up to `hi`, for the hardest or subtlest work. Lower it one step for judgment and two or more steps for routine work. Verification keeps the lane and effort the plan set. Change only the effort, never the lane, because the lane is the role and a diverse panel stays diverse only while every seat keeps its own agent. If `task` rejects a call, fix the call and say so. Do not switch lanes to get around the rejection.",
	},
	{
		id: "dispatch/poteto-create-skill",
		reason: "Cursor's built-in `create-skill` does not exist on OMP; the skill applies only where the session lists one.",
		files: POTETO,
		pattern: "(Cursor's built-in for authoring SKILL.md files)",
		replacement: "when the session lists one",
	},
	{
		id: "dispatch/poteto-session-pickup-entry",
		reason: "Session pickup no longer accepts cloud-agent URLs: OMP has no cloud agents.",
		files: POTETO,
		pattern: "from a transcript, cloud-agent URL, or pushed branch.",
		replacement: "from a transcript or a pushed branch.",
	},

	// playbooks: delegation to the code lanes
	{
		id: "dispatch/playbook-code-delegate",
		reason: "A configured per-playbook model becomes the `poteto-agent` delegate, which runs on the `pstack-build` model role.",
		files: `${PLAYBOOKS}*.md`,
		pattern: /a subagent using your configured (?:feature|bug-fix|perf-issue|hillclimb) model \(default `grok-4\.7-xhigh-fast`\)/,
		replacement: "a `poteto-agent` subagent (the `pstack-build` model role)",
	},
	{
		id: "dispatch/playbook-refactoring-delegate",
		reason: "Refactoring delegates mechanical edits, which is the `pstack-mechanical` lane.",
		files: `${PLAYBOOKS}refactoring.md`,
		pattern: "a subagent using your configured refactoring model (default `grok-4.7-xhigh-fast`)",
		replacement: "a `pstack-mechanical` lane",
	},
	{
		id: "dispatch/playbook-explore-agent",
		reason: "The explicit model per Subagents section is carried by the lane agent, so only the agent is named.",
		files: `${PLAYBOOKS}multi-phase-plan.md`,
		pattern: ' and an explicit model per the Subagents section (the **guard-the-context-window** principle skill).',
		replacement: ' per the Subagents section (the **guard-the-context-window** principle skill).',
	},
	{
		id: "dispatch/playbook-verification-lanes",
		reason: "Verification lanes were swarm workers on a configured model; they are isolated `pstack-build` tasks.",
		files: `${PLAYBOOKS}multi-phase-plan.md`,
		pattern: "on the `swarm workers` model (default `grok-4.7-xhigh-fast`).",
		replacement: "as isolated background tasks on the `pstack-build` lane.",
	},
	{
		id: "dispatch/playbook-live-lane-vm",
		reason: "A live lane's cloud VM becomes an isolated background task.",
		files: `${PLAYBOOKS}multi-phase-plan.md`,
		pattern: "Each live lane runs on its own cloud VM at the PR head.",
		replacement: "Each live lane runs as its own isolated background task at the PR head.",
	},
	{
		id: "dispatch/playbook-lane-video",
		reason: "A lane VM does not exist; the video is recorded by the lane's isolated task.",
		files: `${PLAYBOOKS}multi-phase-plan.md`,
		pattern: "on a lane VM.",
		replacement: "in its lane.",
	},
	{
		id: "dispatch/playbook-worktree-tasks",
		reason: "OMP gives each `task` its own worktree through `isolated: true`.",
		files: `${PLAYBOOKS}opening-a-pr.md`,
		pattern: "Multiple `Task` calls on the same branch each get their own worktree,",
		replacement: "Multiple `task` calls on the same branch each run with `isolated: true`, which gives each its own worktree,",
	},
	{
		id: "dispatch/playbook-shipping-verifier",
		reason: "Each PR's verifier was a Cursor cloud agent; it is an isolated background task.",
		files: `${PLAYBOOKS}shipping.md`,
		pattern: "each a Cursor cloud agent,",
		replacement: "each an isolated background task,",
	},
	{
		id: "dispatch/playbook-autopilot-owner",
		reason: "Each PR owner was a Cursor cloud agent; it is an isolated background task.",
		files: `${PLAYBOOKS}autopilot-full.md`,
		pattern: "Each owner is a Cursor cloud agent that builds,",
		replacement: "Each owner is an isolated background task (`isolated: true`) that builds,",
	},
	{
		id: "dispatch/playbook-autopilot-vm",
		reason: "No VM exists to die; an isolated task's worktree is discarded when the task ends, so unpushed work is lost.",
		files: `${PLAYBOOKS}autopilot-full.md`,
		pattern: "Assume the VM dies.",
		replacement: "Assume the isolated task's worktree is discarded when it ends.",
	},
	{
		id: "dispatch/playbook-pickup-no-cloud-url",
		reason: "Session pickup no longer accepts cloud-agent URLs: OMP has no cloud agents.",
		files: `${PLAYBOOKS}session-pickup.md`,
		pattern: ", a cloud-agent URL, or a pushed branch.",
		replacement: ", or a pushed branch.",
	},
	{
		id: "dispatch/playbook-pickup-isolated",
		reason: "Work resumed from a prior trail runs as an isolated background task, so the resumed agent has its own worktree.",
		files: `${PLAYBOOKS}session-pickup.md`,
		pattern: "Resist the bias to re-derive it.",
		replacement:
			"Resist the bias to re-derive it. Run any agent that continues the prior work as an isolated background `task` on the pushed branch, so it has its own worktree.",
	},
	{
		id: "dispatch/playbook-pickup-transcript-task",
		reason: "Parsing a long transcript is read-only background work: a `pstack-explore` task.",
		files: `${PLAYBOOKS}session-pickup.md`,
		pattern: "Parse a long transcript in a subagent",
		replacement: "Parse a long transcript in a read-only `pstack-explore` task",
	},
	{
		id: "dispatch/playbook-orchestrate-task-tools",
		reason: "Agents are spawned and drained through `task` and `wait`.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "only through the Task tool.",
		replacement: "only through the `task` and `wait` tools.",
	},
	{
		id: "dispatch/playbook-orchestrate-nesting",
		reason: "Nesting depth is OMP's `task.maxRecursionDepth`, and a nested spawn carries `isolated` instead of `environment`.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "(nesting works to depth 3, and a nested spawn has the full Task schema including `environment`)",
		replacement: "(nesting is bounded by OMP's `task.maxRecursionDepth`, 2 by default, and a nested spawn has the full `task` schema including `isolated`)",
	},
	{
		id: "dispatch/playbook-orchestrate-worker-isolation",
		reason: "Workers and verifiers defaulted to the cloud; they default to isolated background tasks.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: 'Always `environment: "cloud"` unless the task needs this machine:',
		replacement: "Always a background `task` with `isolated: true`, so each gets its own worktree. Run one without isolation only when it needs this machine's live state:",
	},
	{
		id: "dispatch/playbook-orchestrate-local-store",
		reason: "An isolated task cannot read the coordinator's local store, as a cloud agent could not.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "Cloud agents cannot read the local store, so their briefs inline what they need or point at repo paths.",
		replacement: "An isolated task cannot read this chat's local store, so its brief inlines what it needs or points at repo paths.",
	},
	{
		id: "dispatch/playbook-orchestrate-verbatim",
		reason: "Cloud spawns become isolated spawns.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "Verbatim paste is for cloud spawns and every resume.",
		replacement: "Verbatim paste is for isolated spawns and every resume.",
	},
	{
		id: "dispatch/playbook-orchestrate-budget",
		reason: "The cloud default and local exception list become the isolated default and the non-isolated exception list.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "its spawn budget with the cloud default and the local exception list",
		replacement: "its spawn budget with the isolated default and the non-isolated exception list",
	},
	{
		id: "dispatch/playbook-orchestrate-rebase",
		reason: "Chain rebases run in an isolated task, not in the coordinator's checkout.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "Chain rebases run in cloud. A local rebase at this scale takes the laptop down.",
		replacement: "Chain rebases run in an isolated task, so a rebase at this scale never touches the coordinator's checkout.",
	},
	{
		id: "dispatch/playbook-orchestrate-externalize",
		reason: "Work that lives only in one isolated worktree is lost when the session ends.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "Work that exists only on one VM when that VM dies was never done.",
		replacement: "Work that exists only in one isolated worktree when the session ends was never done.",
	},
	{
		id: "dispatch/playbook-orchestrate-probe",
		reason: "There is no cloud dashboard; a task is probed through its entry under `history://`.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "the cloud agent's status in the Cursor dashboard.",
		replacement: "the task's entry under `history://`.",
	},
	{
		id: "dispatch/playbook-orchestrate-restart",
		reason: "After an OMP restart every running task is dead; only pushed branches and PRs survive.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "After a Cursor restart: local agents are dead, cloud work is not.",
		replacement: "After an OMP restart: running tasks are dead, pushed branches and PRs are not.",
	},
	{
		id: "dispatch/playbook-orchestrate-reattach",
		reason: "Work is reattached by PR and branch, not by cloud agent.",
		files: `${PLAYBOOKS}orchestrate.md`,
		pattern: "reattach cloud work by PR and branch rather than agent id",
		replacement: "reattach work by PR and branch rather than agent id",
	},
	{
		id: "dispatch/playbook-pause-restart",
		reason: "The host restart that interrupts work is OMP's.",
		files: POTETO,
		pattern: "a Cursor restart,",
		replacement: "an OMP restart,",
	},
	{
		id: "dispatch/playbook-cleanup-editor-state",
		reason: "The Cursor editor's application-support folder is not part of an OMP machine.",
		files: `${PLAYBOOKS}worktree-cleanup.md`,
		pattern:
			"`~/Library/Application Support/Cursor` (`state.vscdb.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons), ",
		replacement: "",
	},
	{
		id: "dispatch/playbook-authoring-create-skill",
		reason: "Cursor's built-in `create-skill` does not exist on OMP; write the SKILL.md directly when the session lists no skill-authoring skill.",
		files: `${PLAYBOOKS}authoring-a-skill.md`,
		pattern: "Use the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).",
		replacement:
			"Use the **create-skill** skill when the session lists one. Otherwise write the SKILL.md directly: YAML frontmatter with `name` and a one-scalar `description`, then the body.",
	},

	// routed workflow skills
	{
		id: "dispatch/interrogate-reviewers",
		reason:
			"Interrogate's reviewers are the critics of the configured panel seats, not Cursor models from a rule file. Unset seats are absent and diversity is stated.",
		files: "skills/interrogate/SKILL.md",
		pattern: span(
			"Launch all reviewers in a single message",
			"Never treat an alias entry as a rejected slug or apply either fallback to it.",
		),
		replacement: `Launch all reviewers in a single \`task\` call, one critic per configured panel seat (see \`${REF_FROM_SKILL}\`), labeled Reviewer A for seat A, Reviewer B for seat B, and so on. A seat with no model is skipped, not an error. At most \`maxPanelSize\` seats run, and never more than five. With no seat configured, stop and tell the user to run \`/pstack setup\`.

| Subagent | Agent |
|----------|-------|
| Reviewer A | \`pstack-panel-a-critic\` |
| Reviewer B | \`pstack-panel-b-critic\` |
| Reviewer C | \`pstack-panel-c-critic\` |
| Reviewer D | \`pstack-panel-d-critic\` |
| Reviewer E | \`pstack-panel-e-critic\` |

Each critic is read-only and returns a structured verdict with findings. Report any seat whose run fell back to another model as a dropout. When every seat that ran resolves to one vendor, the verdict states \`diversity reduced: single vendor\`.`,
	},
	{
		id: "dispatch/arena-runners",
		reason: "Arena runners are the builder agents of the configured panel seats, each in its own isolated worktree.",
		files: "skills/arena/SKILL.md",
		pattern: line("3. Pick the runners."),
		replacement: `3. Pick the runners. Each runner is the builder agent of one configured panel seat, \`pstack-panel-a-builder\` through \`pstack-panel-e-builder\`, so each candidate runs on its seat's model (see \`${REF_FROM_SKILL}\`). Skip a seat with no model. Cover multiple design directions by running a seat's builder more than once. Run the same seat N times when the work is generation-bound rather than judgment-sensitive. Pick each subagent's lane and \`effort\` for the job, per the Subagents section of the **poteto-mode** skill.`,
	},
	{
		id: "dispatch/arena-fan-out",
		reason: "Arena candidates write, so each runs as an isolated background task.",
		files: "skills/arena/SKILL.md",
		pattern: "in one message with `run_in_background: true`,",
		replacement: "in one `task` call with `isolated: true`,",
	},
	{
		id: "dispatch/arena-cross-judge",
		reason: "The cross-judge is the `pstack-judge` lane, which is read-only, instead of a model picked from a pool.",
		files: "skills/arena/SKILL.md",
		pattern: span("After all Phase B candidates complete, choose one model", "Spawn one readonly judge subagent on that model."),
		replacement: "After all Phase B candidates complete, spawn one `pstack-judge` lane as the cross-judge. It is read-only.",
	},
	{
		id: "dispatch/architect-runners",
		reason: "Architect runs on the same configured panel seats as arena.",
		files: "skills/architect/SKILL.md",
		pattern: line("Take the runners from the `architect runners` line"),
		replacement: "Take the runners from the configured panel seats, exactly as the **arena** skill's Phase A does.",
	},
	{
		id: "dispatch/how-lanes",
		reason: "How's explorers are `pstack-explore` lanes and its explainers are `pstack-judge` lanes.",
		files: "skills/how/SKILL.md",
		pattern: line("Every spawn is a Task subagent with"),
		replacement: `Every spawn is a read-only \`task\`. Explorers are \`pstack-explore\` agents and every explainer is a \`pstack-judge\` agent. The lane's model role sets the model, so there is no \`model\` to set (see \`${REF_FROM_SKILL}\`). Pick each subagent's \`effort\` for the job, per the Subagents section of the **poteto-mode** skill.`,
	},
	{
		id: "dispatch/why-lanes",
		reason: "Why's investigators are `pstack-explore` lanes and its synthesizer is a `pstack-judge` lane.",
		files: "skills/why/SKILL.md",
		pattern: line("Each spawn below names a role line"),
		replacement: `Each spawn below names a lane agent (see \`${REF_FROM_SKILL}\`). The lane's model role sets the model, so there is no \`model\` to set. Pick each subagent's \`effort\` for the job, per the Subagents section of the **poteto-mode** skill.`,
	},
	{
		id: "dispatch/why-read-only",
		reason: "Why's lanes are read-only; the Cursor readonly/MCP trade-off does not exist on OMP.",
		files: "skills/why/SKILL.md",
		pattern: line("Every spawn is `generalPurpose` with `readonly: false`"),
		replacement:
			"Every spawn is a read-only lane: `pstack-explore` for investigators and `pstack-judge` for the synthesizer. Neither writes anything. If a lane cannot reach an MCP server its investigator needs, the investigator reports that gap. Do not move the work to a write-capable agent to get access.",
	},
	{
		id: "dispatch/why-discovery",
		reason: "MCP servers are discovered from the OMP session's tool list and `mcp://` resources, not a Cursor directory.",
		files: "skills/why/SKILL.md",
		pattern: line("Before spawning investigators, list the available MCPs from the Cursor environment."),
		replacement:
			"Before spawning investigators, list the MCP servers connected to this session. MCP tool names start with `mcp__`, and each server's resources are readable under `mcp://`.",
	},
	{
		id: "dispatch/why-investigator-agent",
		reason: "The investigators' model line becomes their lane agent.",
		files: "skills/why/SKILL.md",
		pattern: "`model`: the `why investigators` line, default `grok-4.7-xhigh-fast`.",
		replacement: "`agent`: `pstack-explore`.",
	},
	{
		id: "dispatch/why-synthesizer-agent",
		reason: "The synthesizer's model line becomes its lane agent.",
		files: "skills/why/SKILL.md",
		pattern: "`model`: the `why synthesizer` line, default `claude-opus-5-5-xhigh`.",
		replacement: "`agent`: `pstack-judge`.",
	},
	{
		id: "dispatch/reflect-spawn",
		reason: "Reflect's three reviewers are read-only lanes in one `task` call.",
		files: "skills/reflect/SKILL.md",
		pattern: line("One message, three `Task` calls,"),
		replacement:
			"One `task` call with three read-only lanes. Reviewers look up the tickets, chat threads, and observability traces the transcript references through the MCP tools the session exposes.",
	},
	{
		id: "dispatch/reflect-lanes",
		reason: "Reflect's role lines become lane agents.",
		files: "skills/reflect/SKILL.md",
		pattern: line("Each reviewer and the synthesizer name a role line"),
		replacement: `Each reviewer and the synthesizer name a lane agent (see \`${REF_FROM_SKILL}\`). The lane's model role sets the model, so there is no \`model\` to set. Pick each subagent's \`effort\` for the job, per the Subagents section of the **poteto-mode** skill.`,
	},
	{
		id: "dispatch/reflect-table",
		reason: "The role-line and default-model columns become one lane-agent column.",
		files: "skills/reflect/SKILL.md",
		pattern: span("| Lens | Role line |", "| Divergent | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-xhigh` | `references/divergent-reviewer.md` |"),
		replacement: `| Lens | Agent | Prompt template |
|---|---|---|
| Judgment | \`pstack-judge\` | \`references/judgment-reviewer.md\` |
| Tooling | \`pstack-explore\` | \`references/tooling-reviewer.md\` |
| Divergent | \`pstack-judge\` | \`references/divergent-reviewer.md\` |`,
	},
	{
		id: "dispatch/reflect-synthesizer",
		reason: "Reflect's synthesizer is a `pstack-judge` lane.",
		files: "skills/reflect/SKILL.md",
		pattern: line("One `Task` call, `subagent_type: generalPurpose`, `model` from the"),
		replacement:
			"One `task` call to `pstack-judge`. It spot-verifies citations through MCP. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.",
	},
	{
		id: "dispatch/reflect-create-skill",
		reason: "Cursor's built-in `create-skill` does not exist on OMP; use it only when the session lists one, else the authoring playbook.",
		files: "skills/reflect/SKILL.md",
		pattern: "hand to Cursor's built-in `create-skill` skill and run its draft / test / iterate loop.",
		replacement:
			"hand to the `create-skill` skill when the session lists one, otherwise to the Authoring or modifying a skill playbook, and run its draft / test / iterate loop.",
	},
	{
		id: "dispatch/reflect-example-slug",
		reason: "The synthesizer's example of a drifting fact used a model slug; a neutral rename keeps the example and drops the Cursor model name.",
		files: "skills/reflect/references/synthesizer.md",
		pattern: "we renamed `gpt-4` to `gpt-4o` in `encodingForModel`",
		replacement: "we renamed `fetchUser` to `loadUser` in `sessionStore`",
	},
	{
		id: "dispatch/automate-me-create-skill-intro",
		reason: "Cursor's built-in `create-skill` does not exist on OMP; automate-me uses it only when the session lists one.",
		files: "skills/automate-me/SKILL.md",
		pattern: "Cursor's built-in `create-skill` (authoring)",
		replacement: "the `create-skill` skill when the session lists one (authoring)",
	},
	{
		id: "dispatch/automate-me-create-skill-use",
		reason: "Cursor's built-in `create-skill` does not exist on OMP; fall back to the authoring playbook.",
		files: "skills/automate-me/SKILL.md",
		pattern: "Use Cursor's built-in `create-skill` skill to author the skill.",
		replacement: "Use the `create-skill` skill, when the session lists one, to author the skill. Otherwise follow the Authoring or modifying a skill playbook.",
	},
	{
		id: "dispatch/swarm-worker-lane",
		reason: "Swarm workers are `pstack-build` or `pstack-explore` lanes, not a model from a rule file.",
		files: "skills/swarm/SKILL.md",
		pattern: line("4. Pick the worker model from the `swarm workers` line"),
		replacement: `4. Pick the worker lane: \`pstack-build\` when a worker writes or runs commands, \`pstack-explore\` when it only reads. Workers on one lane share one model, so race different panel seats' builders (\`pstack-panel-<seat>-builder\`) when a model race is the point, and name each arm's agent up front (see \`${REF_FROM_SKILL}\`). Pick each subagent's lane and \`effort\` for the job, per the Subagents section of the **poteto-mode** skill.`,
	},
	{
		id: "dispatch/swarm-fan-out",
		reason: "Swarm workers were Cursor cloud agents; they are isolated background tasks.",
		files: "skills/swarm/SKILL.md",
		pattern: line("Spawn all N workers in one message with `subagent_type: generalPurpose`"),
		replacement: `Spawn all N workers in one \`task\` call, each with \`agent\` set to the step 4 lane and \`isolated: true\`, so each runs as a background task in its own worktree. Run a worker without isolation only when it needs state that lives in this checkout, such as uncommitted files or a service running here. If the \`task\` schema has no \`isolated\` field, isolation is off: read the Isolation section of \`${REF_FROM_SKILL}\` and do not fan out writers.`,
	},
	{
		id: "dispatch/swarm-base-branch",
		reason: "OMP has no `cloud_base_branch`; a worker starts from a named branch by checking it out in its own worktree.",
		files: "skills/swarm/SKILL.md",
		pattern: "When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.",
		replacement: "When a worker must start from a non-default branch, name the branch and its SHA in the brief and have the worker check it out inside its worktree.",
	},
	{
		id: "dispatch/no-comments-agent",
		reason: "The comment-sicko agent is spawned with `task` and `agent`.",
		files: "skills/no-comments/SKILL.md",
		pattern: 'Spawn `Task` with `subagent_type: "comment-sicko"`.',
		replacement: 'Spawn a `task` with `agent: "comment-sicko"`.',
	},

	// poteto-help: setup, install and how pstack runs on OMP
	{
		id: "dispatch/help-custom-mode",
		reason: "Custom Modes are a Cursor feature; `/poteto <task>` starts poteto-mode directly.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "and mention once that a Custom Mode keeps it on.",
		replacement: "and mention once that `/poteto <task>` starts it directly.",
	},
	{
		id: "dispatch/help-no-model-rule",
		reason: "The `pstack-models.mdc` rule is replaced by the `pstack-*` model roles that `/pstack setup` writes.",
		files: "skills/poteto-help/SKILL.md",
		pattern: line("- No `~/.cursor/rules/pstack-models.mdc` means"),
		replacement:
			"- No `pstack-*` model roles in the user's OMP config means `/pstack setup` hasn't run for this user, so every work role uses its built-in fallback and every panel seat is absent.",
	},
	{
		id: "dispatch/help-missing-roles",
		reason: "The question offered when the model rule is missing now concerns the unset model roles and drops the reasoning budget.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "When the model rule is missing and it matters, ask whether the user wants to pick a model for each role and a reasoning budget now.",
		replacement: "When no `pstack-*` model roles are set and it matters, ask whether the user wants to pick a model for each role now.",
	},
	{
		id: "dispatch/help-later-roles",
		reason: "Without `/pstack setup`, work roles use their built-in fallbacks and panel seats stay absent.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "every role keeps its default model until they run `/setup-pstack`.",
		replacement: "every work role keeps its built-in fallback and every panel seat stays absent until they run `/setup-pstack`.",
	},
	{
		id: "dispatch/help-install",
		reason: "pstack installs as an OMP package, not a Cursor plugin.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "1. Install with `/add-plugin pstack` in chat, or from Customize in the sidebar.",
		replacement: "1. Install with `omp plugin install github:seenark/omp-plugins#release/pstack`.",
	},
	{
		id: "dispatch/help-setup-step",
		reason: "Setup picks per-role models and writes `pstack-*` model roles, not a Cursor rule or a reasoning budget.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "2. Run [`/setup-pstack`](../setup-pstack/SKILL.md). It asks for a reasoning budget, maps a model to each role, and writes a rule. The rule applies to new chats.",
		replacement:
			"2. Run [`/setup-pstack`](../setup-pstack/SKILL.md). It offers presets, then a menu per role, probes each model it picks, and writes only the `pstack-*` model roles. The next subagent you spawn uses them.",
	},
	{
		id: "dispatch/help-loads",
		reason: "pstack does nothing until the user starts it; setup is a command, not a skill that loads from the user's words.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "Installing changes nothing until the user invokes a skill. Only `/setup-pstack` loads from the user's words.",
		replacement: "Installing changes nothing until the user starts a run with `/poteto <task>` or `/skill:poteto-mode`.",
	},
	{
		id: "dispatch/help-cost",
		reason: "Cost control is cheaper model roles and fewer panel seats, not a reasoning budget or `auto` aliases.",
		files: "skills/poteto-help/SKILL.md",
		pattern: span("Rerun `/setup-pstack` and pick a smaller budget", "one for each entry."),
		replacement:
			"Rerun `/setup-pstack` and pick cheaper models for the roles. Leave a panel seat unset to drop it: each configured seat is one lane per panel review, and `maxPanelSize` caps the panel.",
	},
	{
		id: "dispatch/help-built-for",
		reason: "pstack on OMP is built for OMP's `task` lanes, not for Cursor.",
		files: "skills/poteto-help/SKILL.md",
		pattern: line("pstack is built for Cursor."),
		replacement:
			"pstack is built for OMP. Its skills use the Agent Skills format, so other tools can read them. But the workflow skills, including `/poteto-mode`, `/how`, `/why`, and `/pstack-teach`, spawn OMP `task` subagents on `pstack-*` model roles, so those parts may not work elsewhere.",
	},
	{
		id: "dispatch/help-stays-on",
		reason: "Cursor's Custom Modes and Enter shortcuts do not exist on OMP; `/poteto <task>` activates pstack for the Agent Session.",
		files: "skills/poteto-help/SKILL.md",
		pattern: span("Whether `/poteto-mode` stays on depends on how the user starts it:", 'spawn it with `subagent_type: "poteto-agent"`.'),
		replacement:
			'`/poteto <task>` starts the skill on the task and marks pstack active for the Agent Session. Invoking `/skill:poteto-mode` activates it too. Mid-chat, "new task" makes the mode match a fresh playbook. `/poteto-mode` already uses `poteto-agent` for the subagents its playbook steps spawn. To get the same style from a subagent of your own, spawn it with `agent: "poteto-agent"`.',
	},
	{
		id: "dispatch/help-swarm-row",
		reason: "Swarm workers are isolated background tasks, not cloud agents.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "or race workers, as cloud agents |",
		replacement: "or race workers, as isolated background tasks |",
	},
	{
		id: "dispatch/help-setup-row",
		reason: "Setup no longer picks a reasoning budget.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "Pick a model for each role and a reasoning budget",
		replacement: "Pick a model for each role",
	},
	{
		id: "dispatch/help-plan-mode",
		reason: "The plan mode that works alongside pstack is OMP's.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "Cursor's Plan Mode works alongside it.",
		replacement: "OMP's plan mode works alongside it.",
	},
	{
		id: "dispatch/help-mode-stopped",
		reason: "Custom Modes do not exist on OMP; each task starts with `/poteto <task>`.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "It was started with Enter. Start it as a Custom Mode, or start each task with `/poteto-mode`.",
		replacement: "Start each task with `/poteto <task>`.",
	},
	{
		id: "dispatch/help-new-model",
		reason: "Model roles apply to the next lane spawn, and `/pstack doctor` shows which are set.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "The rule from `/setup-pstack` applies to new chats. Start one.",
		replacement: "The roles apply to lanes spawned after `/setup-pstack` finishes. `/pstack doctor` shows which roles are set.",
	},
	{
		id: "dispatch/help-skill-not-loading",
		reason: "Skills marked `disable-model-invocation` do not load from the user's words; setup is a command.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "Only `/setup-pstack` loads from the user's words. The others load when",
		replacement: "Skills marked `disable-model-invocation` do not load from the user's words. They load when",
	},
	{
		id: "dispatch/help-parallel-overwrite",
		reason: "Cloud agents each got their own machine; isolated background tasks each get their own worktree.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "or run them as cloud agents, which each get their own machine.",
		replacement: "or run them as isolated background tasks, which each get their own worktree.",
	},

	// generic phrases, after the paragraph rules that contain them
	{
		id: "dispatch/ask-tool",
		reason: "Cursor's AskQuestion is OMP's `ask` tool.",
		pattern: /`AskQuestion`/,
		replacement: "`ask`",
	},
	{
		id: "dispatch/agent-field",
		reason: "Cursor's `subagent_type` is the `agent` field on OMP's `task`.",
		pattern: /subagent_type: ("[\w-]+")/,
		replacement: "agent: $1",
	},
	{
		id: "dispatch/effort-phrase",
		reason: "OMP's `task` sets `effort` and a lane, not a reasoning level and a fast or standard model speed.",
		pattern: "Pick each subagent's reasoning level and fast or standard speed for the job",
		replacement: "Pick each subagent's lane and `effort` for the job",
	},
	{
		id: "dispatch/task-prompt",
		reason: "A subagent prompt, call or response is a `task` one in OMP.",
		pattern: /`Task` (prompt|calls?|response)/,
		replacement: "`task` $1",
	},
	{
		id: "dispatch/setup-command",
		reason: "Cursor's `/setup-pstack` skill is the `/pstack setup` command, which writes the `pstack-*` model roles.",
		pattern: /(?<![\w/.:-])\/setup-pstack(?![\w-])/,
		replacement: "/pstack setup",
	},
];

export const dispatch: Group = {
	name: "dispatch",
	rules,
	exclusions: [],
	forks: [
		{
			path: REFERENCE,
			kind: "rewritten",
			reason:
				"Upstream's provider runner shells out to other vendors' CLIs, which pstack Excludes. The reference is rewritten for the real pstack model roles, panel seats and dropout policy, and states that no external CLI runner exists. Upstream at this pin has no such file, so it is ours alone.",
			since: "0.15.25",
		},
		{
			path: "agents/poteto-agent.md",
			kind: "patched",
			reason:
				"Runs on the `pstack-build` role with `@task` as fallback, autoloads the poteto-mode skill (OMP `autoloadSkills`) instead of searching a Cursor plugin directory for it, and drops Cursor's `is_background`.",
			since: "0.15.25",
		},
		{
			path: "skills/setup-pstack/SKILL.md",
			kind: "rewritten",
			reason:
				"Upstream writes a Cursor rules file of model slugs. On OMP the `/pstack setup` command writes the `pstack-*` model roles. The skill is kept so that asking an agent to configure pstack models points at the command, and every reference to `setup-pstack` still resolves.",
			since: "0.15.25",
		},
	],
	terms: [
		{
			id: "dispatch",
			patterns: {
				"Task tool": /`Task`|\bTask(?: tool| subagent| call| spawn| `)/,
				subagent_type: /subagent_type/,
				generalPurpose: /generalPurpose/,
				AskQuestion: /AskQuestion/,
				"cloud agent": /cloud[- ](?:agent|VM)s?|environment: "cloud"/i,
				"external provider CLI": /\b[Gg]rok\b/,
			},
		},
		{
			id: "cursor-other",
			patterns: {
				Cursor: /\bCursor\b/,
				".mdc rule": /\.mdc\b/,
				"model slug": /\b(?:claude-(?:opus|sonnet|haiku)|gpt-\d)[\w.-]*|\bxhigh\b/,
				"pstack-models": /pstack-models/,
			},
		},
	],
};
