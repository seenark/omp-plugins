export const PANEL_SEATS = ["a", "b", "c", "d", "e"] as const;
export type PanelSeat = (typeof PANEL_SEATS)[number];

export type Access = "read-only" | "write";

export interface RoleText {
	/** What the role is. */
	what: string;
	/** When pstack uses it. */
	when: string;
	/** The kind of model that suits it. */
	recommended: string;
}

export interface WorkRole extends RoleText {
	kind: "work";
	id: string;
	/** Built-in OMP role used when `id` is unset. */
	fallback: string;
	access: Access;
	/** Agent description: what the lane is for. */
	lane: string;
}

export interface PanelRole extends RoleText {
	kind: "panel";
	id: string;
	seat: PanelSeat;
	/** A seat has no fallback: unset means the seat is absent. */
	fallback: null;
}

export type ModelRole = WorkRole | PanelRole;

/** The single source for pstack model roles: generated agents, setup, doctor and panel workflows read this. */
export const WORK_ROLES: readonly WorkRole[] = [
	{
		kind: "work",
		id: "pstack-explore",
		fallback: "@smol",
		access: "read-only",
		lane: "Read-only pstack lane that maps code and reports what it found.",
		what: "Read-only scouting: finds files, symbols and call paths and reports what it saw.",
		when: "Playbook steps that map unfamiliar code before design or edits.",
		recommended: "A fast, cheap model with a large context window.",
	},
	{
		kind: "work",
		id: "pstack-build",
		fallback: "@task",
		access: "write",
		lane: "Write-capable pstack lane that implements one scoped change and runs its own checks.",
		what: "Implements a scoped change end to end: edits, runs, and fixes its own failures.",
		when: "Feature, fix and refactor steps that write code.",
		recommended: "A strong coding model with reliable tool use; a mid-tier model is usually enough.",
	},
	{
		kind: "work",
		id: "pstack-mechanical",
		fallback: "@tiny",
		access: "write",
		lane: "Write-capable pstack lane for fully specified mechanical edits.",
		what: "Applies fully specified mechanical edits: renames, codemods, formatting and bulk updates.",
		when: "Steps where the change is already decided and only needs doing.",
		recommended: "The cheapest model that follows instructions exactly.",
	},
	{
		kind: "work",
		id: "pstack-design",
		fallback: "@designer",
		access: "read-only",
		lane: "Read-only pstack lane that proposes or critiques a design.",
		what: "Proposes and critiques design: architecture, module boundaries, types and interfaces.",
		when: "Architect and design steps, before code is written.",
		recommended: "A model with strong design and visual judgment.",
	},
	{
		kind: "work",
		id: "pstack-judge",
		fallback: "@slow",
		access: "read-only",
		lane: "Read-only pstack lane that merges panel verdicts into one decision.",
		what: "Merges the panel's verdicts into one decision and breaks ties.",
		when: "The end of a panel run (interrogate, arena, swarm, architect) and final reviews.",
		recommended: "Your strongest reasoning model.",
	},
	{
		kind: "work",
		id: "pstack-security",
		fallback: "@slow",
		access: "read-only",
		lane: "Read-only pstack lane that reviews a change for security flaws.",
		what: "Reviews a change for security flaws.",
		when: "Review steps that touch authentication, input handling, secrets or dependencies.",
		recommended: "A strong reasoning model; a different vendor from your judge adds coverage.",
	},
];

export const PANEL_ROLES: readonly PanelRole[] = PANEL_SEATS.map(seat => ({
	kind: "panel",
	id: `pstack-panel-${seat}`,
	seat,
	fallback: null,
	what: `Panel seat ${seat.toUpperCase()}: an independent reviewer whose verdict is compared with the other seats.`,
	when: "Panel workflows (interrogate, arena, swarm, architect, how critics) dispatch every configured seat in parallel.",
	recommended:
		"A distinct model per seat, ideally from different vendors. Leave a seat unset to drop it: an unset seat is skipped, not an error.",
}));

export const MODEL_ROLES: readonly ModelRole[] = [...WORK_ROLES, ...PANEL_ROLES];

export const READ_ONLY_TOOLS: readonly string[] = ["read", "grep", "glob", "lsp", "ast_grep"];
export const WRITE_TOOLS: readonly string[] = [...READ_ONLY_TOOLS, "ast_edit", "edit", "write", "bash"];

export const VERDICTS = ["approve", "concerns", "reject"] as const;
export const FINDING_SEVERITIES = ["blocker", "major", "minor", "nit"] as const;

export type LaneKind = "work" | "critic" | "builder";

export interface LaneAgent {
	name: string;
	kind: LaneKind;
	role: ModelRole;
	access: Access;
	description: string;
	/** Model list for the agent frontmatter, in attempt order. */
	model: string[];
	tools: readonly string[];
}

export function roleAlias(role: Pick<ModelRole, "id">): string {
	return `@${role.id}`;
}

function workLane(role: WorkRole): LaneAgent {
	return {
		name: role.id,
		kind: "work",
		role,
		access: role.access,
		description: role.lane,
		model: [roleAlias(role), role.fallback],
		tools: role.access === "write" ? WRITE_TOOLS : READ_ONLY_TOOLS,
	};
}

function seatLanes(role: PanelRole): LaneAgent[] {
	const seat = role.seat.toUpperCase();
	return [
		{
			name: `${role.id}-critic`,
			kind: "critic",
			role,
			access: "read-only",
			description: `Read-only pstack panel seat ${seat} critic that returns a structured verdict.`,
			model: [roleAlias(role)],
			tools: READ_ONLY_TOOLS,
		},
		{
			name: `${role.id}-builder`,
			kind: "builder",
			role,
			access: "write",
			description: `Write-capable pstack panel seat ${seat} builder; dispatch it only with task isolation.`,
			model: [roleAlias(role)],
			tools: WRITE_TOOLS,
		},
	];
}

export const LANE_AGENTS: readonly LaneAgent[] = [...WORK_ROLES.map(workLane), ...PANEL_ROLES.flatMap(seatLanes)];

export function findLaneAgent(name: string): LaneAgent | undefined {
	const wanted = name.trim().toLowerCase();
	return LANE_AGENTS.find(agent => agent.name === wanted);
}
