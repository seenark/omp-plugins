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
			'**Use `agent: "poteto-agent"` for any subagent you spawn directly inside a playbook step.** The chat that receives `/poteto <task>` runs the playbook itself. Routed workflow skills (`interrogate`, `swarm`) name their own lane agents. Respect them.',
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
		id: "dispatch/poteto-model-list",
		reason: "Upstream's per-role model bullets name Cursor slugs; the lane table in the dispatch reference carries the same roles, so the three bullets go.",
		files: POTETO,
		pattern: /- Code, prose, and judgment: `claude-opus-5-5-xhigh-fast`\.\n- Trivial mechanical edits: `claude-opus-5-5-high-fast`\.\n- Diverse review and design panels: [^\n]*\n\n/,
		replacement: "",
	},
	{
		id: "dispatch/poteto-fable-exception",
		reason: "Fable 5.2 is a Cursor model slug; OMP picks the model behind each lane with `/pstack setup`, never per call.",
		files: POTETO,
		pattern: /\*\*Fable 5\.2 is an exception\.\*\*[^\n]*\n\n/,
		replacement: "",
	},
	{
		id: "dispatch/poteto-worker-kickoff",
		reason: "A Project worker is a Cursor primitive; an OMP `task` subagent covers every agent poteto-mode starts, so the phrase goes.",
		files: POTETO,
		pattern: "Starting any agent, whether a Task subagent or a Project worker → the first line",
		replacement: "Starting any `task` subagent → the first line",
	},
	{
		id: "dispatch/worker-ask",
		reason: "The tool that shows a person a question is OMP's `ask`.",
		files: "skills/poteto-mode/worker.md",
		pattern: "Never call a tool that shows a person a question.",
		replacement: "Never call the `ask` tool.",
	},

	// playbooks: delegation to the code lanes
	{
		id: "dispatch/playbook-code-delegate",
		reason: "A configured per-playbook model becomes the `poteto-agent` delegate, which runs on the `pstack-build` model role.",
		files: `${PLAYBOOKS}*.md`,
		pattern: /a subagent using your configured (?:feature|bug-fix|perf-issue|hillclimb) model \(default `claude-opus-5-5-xhigh-fast`\)/,
		replacement: "a `poteto-agent` subagent (the `pstack-build` model role)",
	},
	{
		id: "dispatch/playbook-refactoring-delegate",
		reason: "Refactoring delegates mechanical edits, which is the `pstack-mechanical` lane.",
		files: `${PLAYBOOKS}refactoring.md`,
		pattern: "a subagent using your configured refactoring model (default `claude-opus-5-5-xhigh-fast`)",
		replacement: "a `pstack-mechanical` lane",
	},
	{
		id: "dispatch/playbook-eval-dispatcher",
		reason: "An agent that only dispatches, polls or packs results needs the cheap lane at low effort, not a named Cursor slug.",
		files: `${PLAYBOOKS}eval.md`,
		pattern: "runs on `claude-opus-5-5-medium-fast`.",
		replacement: "runs on the `pstack-mechanical` lane at low `effort`.",
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
			"Interrogate's adversaries are the builder agents of the configured panel seats, each in an isolated worktree, not `generalPurpose` models from a rule file. Unset seats are absent and diversity is stated.",
		files: "skills/interrogate/SKILL.md",
		pattern: line("Run Phase A steps 3 and 4 and Phase B of the **arena** skill"),
		replacement:
			"Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with these changes. Send one adversary per seat on the roster, the hidden note of configured panel seats, already capped by `maxPanelSize`. Each adversary is that seat's builder agent, `pstack-panel-<seat>-builder`, so it runs on its seat's model. Run each seat once and never repeat a seat. An unset seat is absent, not an error. With no seat configured, stop and tell the user to run `/pstack setup`. Run every adversary as an isolated `task` under the isolation checks of arena Phase A step 4, including the `task.isolation.apply` check, and do not fan out until they pass. Copy the scope's uncommitted changes into each worktree. In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:",
	},
	{
		id: "dispatch/arena-runners",
		reason: "Arena runners are the builder agents of the configured panel seats, each in its own isolated worktree.",
		files: "skills/arena/SKILL.md",
		pattern: line("3. Pick the runners from the `arena runners` line"),
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
		reason:
			"The cross-judge is the critic agent of a roster seat whose vendor differs from the session model's vendor, and the judge is skipped when no seat qualifies, instead of a model picked from a pool by family prefix.",
		files: "skills/arena/SKILL.md",
		pattern: line("After all Phase B candidates complete, spawn one readonly judge"),
		replacement:
			"After all Phase B candidates complete, pick the cross-judge from the roster. It is `pstack-panel-<seat>-critic` of the first roster seat, in roster order, whose vendor differs from the vendor of the model this session runs on. A seat of the session model's vendor never judges. If no roster seat has another vendor, or you do not know the session model's vendor, skip the judge, pick the base alone in Phase D, and say so. Spawn the judge as a read-only `task`. It sees the rubric and the candidates by path label (the patch path or branch of each), scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.",
	},
	{
		id: "dispatch/how-explainer",
		reason: "How's single read-only explainer is one read-only `pstack-explore` `task`; Cursor's `generalPurpose` and `readonly` flag do not exist on OMP.",
		files: "skills/how/SKILL.md",
		pattern: "Spawn one Task subagent with `subagent_type: generalPurpose` and `readonly: true` that explores and explains in one pass.",
		replacement: `Spawn one read-only \`task\` with \`agent: "pstack-explore"\` that explores and explains in one pass. The lane's model role sets the model, so there is no \`model\` to set (see \`${REF_FROM_SKILL}\`).`,
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
		reason: "Swarm workers are `pstack-build` or `pstack-explore` lanes, or the roster's panel-seat agents for a model race, not a model from a rule file.",
		files: "skills/swarm/SKILL.md",
		pattern: line("3. Pick the worker model from the `swarm workers` line"),
		replacement: `3. Pick the worker lane: \`pstack-build\` when a worker writes or runs commands, \`pstack-explore\` when it only reads. Workers on one lane share one model, so race the roster's seats when a model race is the point: \`pstack-panel-<seat>-builder\` for writing arms, \`pstack-panel-<seat>-critic\` for read-only arms that return a structured verdict. The roster is the hidden note of configured panel seats, already capped by \`maxPanelSize\` (see \`${REF_FROM_SKILL.replace("provider-dispatch", "panel-verdicts")}\`). An unset seat is absent, not an error. For a model race, name each arm's agent and seat model up front (see \`${REF_FROM_SKILL}\`). Pick each subagent's lane and \`effort\` for the job, per the Subagents section of the **poteto-mode** skill.`,
	},
	{
		id: "dispatch/swarm-fan-out",
		reason: "Swarm workers were Cursor cloud agents; they are isolated background tasks.",
		files: "skills/swarm/SKILL.md",
		pattern: line("Spawn all N workers in one message with `subagent_type: generalPurpose`"),
		replacement: `Spawn all N workers in one \`task\` call, each with \`agent\` set to the step 3 lane and \`isolated: true\`, so each runs as a background task in its own worktree. Run a worker without isolation only when it needs state that lives in this checkout, such as uncommitted files or a service running here. If the \`task\` schema has no \`isolated\` field, isolation is off: read the Isolation section of \`${REF_FROM_SKILL}\` and do not fan out writers.`,
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
		replacement: "1. Install with `omp plugin install github:seenark/omp-pstack`.",
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
		reason:
			"pstack on OMP is built for OMP's `task` lanes, not for Cursor. Upstream's Claude Code install steps and adapter link are dropped, because the package installs only as an OMP package.",
		files: "skills/poteto-help/SKILL.md",
		pattern: span("pstack is built for Cursor, and it also installs in Claude Code", "so those parts may not work there."),
		replacement:
			"pstack is built for OMP's `task` lanes. Its workflow skills, including `/poteto-mode`, `/how`, `/why`, and `/pstack-teach`, spawn OMP `task` subagents on `pstack-*` model roles.\n\nOther tools can read the skills, because they use the Agent Skills format. But the parts that spawn `task` subagents on those roles may not work there.",
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
		id: "dispatch/effort-phrase",
		reason: "OMP's `task` sets `effort` and a lane, not a reasoning level and a fast or standard model speed.",
		pattern: /Pick each subagent's reasoning level(?: and fast or standard speed)? for the job/g,
		replacement: "Pick each subagent's lane and `effort` for the job",
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
				"Upstream writes a Cursor rules file of model slugs. On OMP the `/pstack setup` command writes the `pstack-*` model roles. The skill is kept so that asking an agent to configure pstack models points at the command, and every reference to `setup-pstack` still resolves. It keeps Upstream's closing offers of a verification skill and a formal verification skill.",
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
				"Project worker": /Project worker/,
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
