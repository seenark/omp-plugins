import * as fs from "node:fs";
import * as path from "node:path";
import type { Group, Rule } from "../types.ts";

/**
 * Session paths, goal mode, CLI/UI drivers, other cursor-team-kit skills, and
 * the `/skill:<name>` form of slash commands.
 */

const SESSIONS = "~/.omp/agent/sessions";
const SESSION_DIRECTORY = `\`${SESSIONS}/<encoded-cwd>/\` (one directory per working directory, named from its path with each "/" turned into "-")`;
const BROWSER_TOOL = "the OMP `browser` tool (the `browser` global in `eval`, documented at `xd://eval/browser`)";
const GOAL_MODE = "OMP goal mode (an extension cannot start it, so tell the user to run `/goal set <objective>`)";

/**
 * Every skill pstack ships, by the name its slash command takes, read from the generated `skills/` directory.
 * A skill Upstream adds is rewritten from the second sync on: the first run writes it, the next run sees it.
 */
const SKILL_COMMANDS: readonly string[] = fs
	.readdirSync(path.join(import.meta.dirname, "..", "..", "..", "skills"), { withFileTypes: true })
	.filter(entry => entry.isDirectory() && !entry.name.startsWith("principle-"))
	.map(entry => entry.name)
	.sort();

/** `/name` outside a path, URL or longer word; the placeholder forms `/verify-<app>` and `/principle-<name>` are skills too. */
const SLASH_FORM = new RegExp(
	`(?<![\\w/.:~<>-])/((?:${SKILL_COMMANDS.join("|")}|principle-(?:<name>|[a-z-]+)|verify-<app>))(?![\\w/-])`,
);

const transcripts: Rule[] = [
	{
		id: "sessions/reflect-transcript",
		reason: "OMP names no transcript directory in the system prompt; history:// and the session directory replace Cursor's agent-transcripts/.",
		files: "skills/reflect/SKILL.md",
		pattern: "in the `agent-transcripts/` directory the system prompt names.",
		replacement: `with \`history://\` (bare \`history://\` lists agent ids, \`history://<id>\` reads one) or in the workspace's session directory, ${SESSION_DIRECTORY}.`,
	},
	{
		id: "sessions/reflect-listing",
		reason: "OMP stores subagent transcripts one level down, in a directory named after the session file; there is no subagents/ folder.",
		files: "skills/reflect/SKILL.md",
		pattern: "<agent-transcripts>/*.jsonl <agent-transcripts>/*/*.jsonl <agent-transcripts>/*/subagents/*.jsonl",
		replacement: "<session-directory>/*.jsonl <session-directory>/*/*.jsonl",
	},
	{
		id: "sessions/recall-location",
		reason: "Cursor keeps transcripts in ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/; OMP keeps session files in one directory per working directory.",
		files: "skills/recall/SKILL.md",
		pattern:
			"Transcripts live at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each \"/\" turned into \"-\" (so `/Users/you/proj` becomes `Users-you-proj`). Every line is one chat message.",
		replacement: `Session files live at \`${SESSIONS}/<encoded-cwd>/<timestamp>_<id>.jsonl\`, one directory per working directory, named from its path with each "/" turned into "-"; list ${SESSIONS} to find it. Subagent transcripts sit in \`<timestamp>_<id>/<agent>.jsonl\` beside each file. Every line is one JSON entry, and \`type: "message"\` entries are the chat. \`history://\` lists agent ids and \`history://<id>\` reads one transcript as Markdown.`,
	},
	{
		id: "sessions/show-me-your-work-transcript",
		reason: "The run's transcript is read through history:// or the session directory, not a Cursor workspace path.",
		files: "skills/show-me-your-work/SKILL.md",
		pattern: "under the active workspace's `agent-transcripts/` directory (the system prompt names the path).",
		replacement: `with \`history://<id>\` or in the workspace's session directory, ${SESSION_DIRECTORY}.`,
	},
	{
		id: "sessions/automate-me-transcripts",
		reason: "Mining the workspace's chats starts from the OMP session directory, not a path the system prompt names.",
		files: "skills/automate-me/SKILL.md",
		pattern: "The system prompt names the workspace's `agent-transcripts/` directory. Use only that path.",
		replacement: `The workspace's session directory is ${SESSION_DIRECTORY}, and \`history://<id>\` reads one transcript. Use only those sources.`,
	},
	{
		id: "sessions/eval-transcripts",
		reason: "Candidate transcripts are read through history:// or the session directory.",
		files: "skills/poteto-mode/playbooks/eval.md",
		pattern: "under the active workspace's `agent-transcripts/` directory (the system prompt names this path).",
		replacement: `with \`history://<id>\` or in the workspace's session directory, ${SESSION_DIRECTORY}.`,
	},
	{
		id: "sessions/session-pickup-transcripts",
		reason: "The prior trail is read through history:// or the session directory; the shared glob warning below it is rewritten by sessions/no-cross-project-glob.",
		files: "skills/poteto-mode/playbooks/session-pickup.md",
		pattern: "under the active workspace's `agent-transcripts/` directory (the system prompt names the path. ",
		replacement: `from \`history://<id>\` or a session file under \`${SESSIONS}/<encoded-cwd>/\` (`,
	},
	{
		id: "sessions/orchestrate-transcripts",
		reason: "Local transcripts live in OMP's session directory.",
		files: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern: "Reading local transcripts under `agent-transcripts/`.",
		replacement: `Reading local transcripts under \`${SESSIONS}/\`.`,
	},
	{
		id: "sessions/no-cross-project-glob",
		reason: "The privacy guard against globbing other projects' chats points at OMP's per-working-directory session directories.",
		pattern: /(Do not|Don't|do not) glob across `~\/\.cursor\/projects\/\*\/`/g,
		replacement: `$1 glob across \`${SESSIONS}/*/\``,
	},
	{
		id: "sessions/worktree-audit-transcripts",
		reason: "OMP gives each worktree its own encoded session directory, so the audit scans every session file for the worktree path instead of one Cursor project slug.",
		files: "skills/poteto-mode/scripts/worktree-audit.sh",
		pattern:
			"# Transcripts dir: ~/.cursor/projects/<slugified-repo-path>/agent-transcripts.\nslug=$(printf '%s' \"$main_wt\" | sed 's#^/##; s#/#-#g')\ntranscripts=\"$HOME/.cursor/projects/$slug/agent-transcripts\"",
		replacement: `# Transcripts dir: OMP keeps one session directory per working directory under ${SESSIONS}, so scan all of them.\ntranscripts="$HOME/.omp/agent/sessions"`,
	},
	{
		id: "sessions/worktree-cleanup-location",
		reason: "Worktrees created by OMP tooling do not live under Cursor's .cursor/worktrees.",
		files: "skills/poteto-mode/playbooks/worktree-cleanup.md",
		pattern: "lives at `.cursor/worktrees/myrepo/x`",
		replacement: "lives in a tool-managed directory such as `<tool-dir>/worktrees/myrepo/x`",
	},
];

const skillLocations: Rule[] = [
	{
		id: "sessions/reflect-skill-use",
		reason: "A skill counts as used when the transcript shows it read through skill:// or from an OMP skill directory.",
		files: "skills/reflect/references/*.md",
		pattern: "(under `.cursor/skills/`, `~/.cursor/skills/`, or `~/.cursor/plugins/`)",
		replacement: "(by its `skill://<name>` URL, or under `.omp/skills/`, `~/.omp/agent/skills/`, or an installed plugin's `skills/` directory)",
	},
	{
		id: "sessions/poteto-agent-locate-skill",
		reason: "OMP resolves a skill by name through skill://, so the agent does not search a Cursor plugin directory or read .cursor-plugin/plugin.json.",
		files: "agents/poteto-agent.md",
		pattern:
			"With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`.",
		replacement: "With no path, before any other work, read `skill://poteto-mode`.",
	},
	{
		id: "sessions/user-skill-directory",
		reason: "OMP's user skill directory is ~/.omp/agent/skills.",
		pattern: "~/.cursor/skills/",
		replacement: "~/.omp/agent/skills/",
	},
	{
		id: "sessions/project-skill-directory",
		reason: "OMP's project skill directory is .omp/skills.",
		pattern: ".cursor/skills/",
		replacement: ".omp/skills/",
	},
];

const drivers: Rule[] = [
	{
		id: "sessions/driver-by-surface",
		reason: "control-ui and control-cli come from cursor-team-kit; OMP drives a browser with its browser tool and a CLI or TUI with bash.",
		files: "skills/poteto-mode/playbooks/multi-phase-plan.md",
		pattern: "Browser, Electron, and web UIs use `control-ui` from `cursor-team-kit`. CLIs and TUIs use `control-cli` from `cursor-team-kit`.",
		replacement: `Browser and web UIs use ${BROWSER_TOOL}. CLIs and TUIs use \`bash\` with \`pty: true\`, or a managed service (\`bash\` with \`name\` and \`ready\`) for a long-running app. Electron and native windows launch through \`bash\` and use the driver the repo ships.`,
	},
	{
		id: "sessions/driver-live-lane",
		reason: "Live lanes drive the real surface through the OMP browser tool or bash, not cursor-team-kit skills.",
		files: "skills/poteto-mode/playbooks/multi-phase-plan.md",
		pattern: "Drive through `control-ui` or `control-cli` from `cursor-team-kit`.",
		replacement: "Drive through the `browser` tool or `bash`.",
	},
	{
		id: "sessions/driver-orchestrate-worker",
		reason: "Runtime verification runs through the OMP browser tool or bash.",
		files: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern: "`control-ui` or `control-cli` runtime verification (from `cursor-team-kit`)",
		replacement: "`browser` or `bash` runtime verification",
	},
	{
		id: "sessions/driver-such-as",
		reason: "The example drivers named in verifier steps become the OMP browser tool and bash.",
		pattern: "(such as `control-ui` or `control-cli` from `cursor-team-kit`)",
		replacement: "(such as the `browser` tool or `bash` with a PTY)",
	},
	{
		id: "sessions/driver-poteto-mode",
		reason: "poteto-mode names the matching driver for UI, IDE and CLI work; OMP's are the browser tool and bash.",
		files: "skills/poteto-mode/SKILL.md",
		pattern: "`cursor-team-kit` publishes `control-cli` (CLIs and TUIs) and `control-ui` (browser / Electron / web UIs).",
		replacement: `The OMP \`browser\` tool (the \`browser\` global in \`eval\`, documented at \`xd://eval/browser\`) drives browser and web UIs. \`bash\` drives CLIs and TUIs, with \`pty: true\` or a managed service (\`name\` and \`ready\`).`,
	},
	{
		id: "sessions/driver-help-not-in-pstack",
		reason: "deslop now ships in pstack; control-cli and control-ui have no pstack equivalent, only OMP tools.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "- `/deslop`, `control-cli`, and `control-ui` ship in the `cursor-team-kit` plugin.",
		replacement: "- pstack has no driver skills. The OMP `browser` tool drives web UIs and `bash` drives CLIs and TUIs.",
	},
	{
		id: "sessions/deslop-from-team-kit",
		reason: "deslop is vendored into pstack from cursor-team-kit, so it is no longer a plugin to name.",
		pattern: /the `deslop` skill from the `cursor-team-kit` plugin \(`\/deslop`\)/g,
		replacement: "the `deslop` skill",
	},
	{
		id: "sessions/deslop-opening-a-pr",
		reason: "deslop is vendored into pstack from cursor-team-kit, so it is no longer a plugin to name.",
		files: "skills/poteto-mode/playbooks/opening-a-pr.md",
		pattern: "Run `/deslop` from `cursor-team-kit` over the diff",
		replacement: "Run `/deslop` over the diff",
	},
];

const goalMode: Rule[] = [
	{
		id: "sessions/goal-bug-hunt",
		reason: "Cursor's /loop becomes OMP goal mode; extensions cannot start it, so the playbook tells the user.",
		files: "skills/poteto-mode/playbooks/bug-fix.md",
		pattern: "Drive a long or stubborn hunt with Cursor's `/loop` command.",
		replacement: "For a long or stubborn hunt, tell the user to run `/goal set <objective>` so OMP goal mode keeps going until the mechanism is confirmed.",
	},
	{
		id: "sessions/goal-autonomous-run",
		reason: "Cursor's /loop becomes OMP goal mode; extensions cannot start it, so the playbook tells the user.",
		files: "skills/poteto-mode/playbooks/autonomous-run.md",
		pattern: "using Cursor's `/loop` command (a built-in, not a pstack skill)",
		replacement: `using ${GOAL_MODE}`,
	},
	{
		id: "sessions/goal-visual-parity",
		reason: "Cursor's /loop becomes OMP goal mode.",
		files: "skills/poteto-mode/playbooks/visual-parity.md",
		pattern: "`/loop` per component until the diff is zero.",
		replacement: "Repeat per component until the diff is zero. For an unattended run, tell the user to run `/goal set <objective>`.",
	},
	{
		id: "sessions/goal-poteto-mode-trigger",
		reason: "The user's unattended-run phrase (twice in poteto-mode) is OMP's /goal set.",
		files: "skills/poteto-mode/SKILL.md",
		pattern: "\"/loop until X\"",
		replacement: "\"/goal set X\"",
	},
	{
		id: "sessions/goal-session-overrides",
		reason: "\"Run until done\" maps to OMP goal mode, which only the user can start.",
		files: "skills/poteto-mode/SKILL.md",
		pattern: "\"be fully autonomous\" → keep going.",
		replacement: "\"be fully autonomous\" → keep going. For an unattended run, tell the user to run `/goal set <objective>`: an extension cannot start OMP goal mode.",
	},
	{
		id: "sessions/goal-recipe-prompt",
		reason: "The bedtime recipe asked Cursor's /loop to keep going; the prompt now says so in words and the user starts goal mode.",
		files: "skills/poteto-help/references/recipes.md",
		pattern: "/loop until done.",
		replacement: "keep going until done.",
	},
	{
		id: "sessions/goal-recipe-start",
		reason: "Goal mode is started by the user with /goal set, outside the prompt.",
		files: "skills/poteto-help/references/recipes.md",
		pattern: "stop and write up why.`",
		replacement: "stop and write up why.` Run `/goal set <goal>` first so OMP goal mode keeps the run going.",
	},
	{
		id: "sessions/goal-prompting-predicate",
		reason: "The finish predicate goes into the /goal set objective.",
		files: "skills/poteto-help/references/prompting.md",
		pattern: "give `/loop` that predicate.",
		replacement: "put that predicate in the `/goal set <objective>` text.",
	},
	{
		id: "sessions/goal-help-builtin",
		reason: "Cursor's /loop is replaced by OMP goal mode.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "- `/loop` and `/create-skill` are Cursor built-ins.",
		replacement: "- Use OMP goal mode (`/goal set <objective>`) for a long run that must reach a finish condition.",
	},
	{
		id: "sessions/goal-help-troubleshooting",
		reason: "The overnight-run advice applies to the /goal set objective.",
		files: "skills/poteto-help/SKILL.md",
		pattern: "`/loop` needs a check that can pass or fail, not a duration.",
		replacement: "`/goal set <objective>` needs a check that can pass or fail, not a duration.",
	},
];

/** Last on purpose: every rule above sees Upstream's `/name` form, and text those rules write passes through this one too. */
const slashCommands: Rule[] = [
	{
		id: "sessions/skill-slash-form",
		reason: "OMP runs a skill as /skill:<name>; the bare /<name> form only works in Cursor. /poteto and /pstack are real extension commands and stay.",
		pattern: SLASH_FORM,
		replacement: "/skill:$1",
	},
];

export const sessions: Group = {
	name: "sessions",
	rules: [...transcripts, ...skillLocations, ...drivers, ...goalMode, ...slashCommands],
	exclusions: [],
	forks: [],
	terms: [
		{
			id: "sessions",
			patterns: {
				"Cursor skill, plugin or transcript path": /\.cursor\/(?:skills|projects|plugins|worktrees)|\.cursor-plugin/,
				"agent-transcripts": /agent-transcripts/,
				"Cursor /loop as a goal": /\/loop until|Cursor's `\/loop`|`\/loop` (?:per|needs)|give `\/loop`/,
				"control-cli/control-ui": /control-(?:cli|ui)/,
				"cursor-team-kit": /cursor-team-kit/,
				"team-kit skill": /\b(?:verify-this|loop-on-ci|review-and-ship|new-branch-and-pr|run-smoke-tests|pr-review-canvas|workflow-from-chats|check-compiler-errors|weekly-review|get-pr-comments)\b/,
				"bare /<skill> slash form": new RegExp(SLASH_FORM.source),
			},
		},
	],
};
