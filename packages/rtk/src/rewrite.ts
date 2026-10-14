export type RtkExec = (
	command: string,
	args: string[],
	options: { timeout: number },
) => Promise<{ code: number; stdout: string }>;

/** An executed command that already runs rtk; Headroom uses the same pattern to skip those results. */
export const RTK_INVOCATION = /(^|[;&|(]\s*)rtk\s/;

const SEGMENT = String.raw`(?:^|[;&(]\s*)`;
const TEST_COMMAND = /\b(?:test|pytest)\b/;
const TEST_DETAIL_FLAG = /\s(?:-v|--verbose|--list|-fuzz\S*)(?=\s|=|$)/;

/** First match wins; the name is the skip reason shown by `/rtk status`. */
const GUARDS: readonly (readonly [reason: string, skips: (command: string) => boolean])[] = [
	["already-rtk", c => RTK_INVOCATION.test(c)],
	["rtk-disabled", c => /^\s*RTK_DISABLED=1(?=\s|$)/.test(c)],
	["pipe", c => c.includes("|")],
	["multiline", c => c.includes("\n")],
	["heredoc", c => c.includes("<<")],
	["env-assignment", c => /^\s*[A-Za-z_]\w*=/.test(c)],
	["read-like", c => new RegExp(`${SEGMENT}(?:(?:cat|head|tail|less|more|bat|nl)|sed\\s+-n)(?=\\s|$)`).test(c)],
	["git-diff", c => new RegExp(`${SEGMENT}git\\s+(?:[^\\s;&()]+\\s+)*?(?:diff|show)(?=\\s|$)`).test(c)],
	["js-test-runner", c => /\b(?:vitest|jest)\b/.test(c)],
	["test-detail", c => TEST_COMMAND.test(c) && TEST_DETAIL_FLAG.test(c)],
	["long-lived", c => new RegExp(`${SEGMENT}(?:ssh|top|htop|vim|nvim)(?=\\s|$)|\\b(?:bun|npm|pnpm|yarn)\\s+(?:run\\s+)?dev\\b|--watch\\b`).test(c)],
];

export function guardReason(command: string): string | undefined {
	return GUARDS.find(([, skips]) => skips(command))?.[0];
}

export type RewriteOutcome =
	| { kind: "rewritten"; command: string }
	| { kind: "skipped"; reason: string }
	| { kind: "unchanged" };

/** Ask `rtk rewrite`; exit 0 and 3 carry a rewrite, anything else leaves the command alone. */
export async function rewriteCommand(exec: RtkExec, command: string): Promise<RewriteOutcome> {
	const reason = guardReason(command);
	if (reason) return { kind: "skipped", reason };
	try {
		const result = await exec("rtk", ["rewrite", command], { timeout: 2000 });
		const rewritten = result.stdout.trim();
		if ((result.code === 0 || result.code === 3) && rewritten && !rewritten.includes("\n") && rewritten !== command) {
			return { kind: "rewritten", command: rewritten };
		}
	} catch {
		// Missing binary or timeout: run the original command.
	}
	return { kind: "unchanged" };
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/** Export the session databases for this and later commands in the session's own shell; never touches process.env. */
export function withSessionEnv(command: string, historyDb: string, recallDb: string): string {
	return `export RTK_DB_PATH=${shellQuote(historyDb)}; export RTK_RECALL_DB=${shellQuote(recallDb)}; ${command}`;
}

/** Installed rtk version when it is at least 0.51.0; otherwise undefined. */
export async function detectRtk(exec: RtkExec): Promise<string | undefined> {
	try {
		const result = await exec("rtk", ["--version"], { timeout: 2000 });
		const match = /(\d+)\.(\d+)\.(\d+)/.exec(result.stdout);
		// ponytail: assumes minor and patch stay below 1000.
		return result.code === 0 && match && Number(match[1]) * 1e6 + Number(match[2]) * 1e3 + Number(match[3]) >= 51_000 ? match[0] : undefined;
	} catch {
		return undefined;
	}
}
