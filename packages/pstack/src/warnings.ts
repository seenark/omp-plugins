import { isRecord } from "@codesook/omp-shared-display/config-store";

/**
 * Non-blocking style checks. Each returns what it found and never decides whether to speak:
 * `index.ts` applies guard strictness and activation, then delivers the text as tool-result context
 * or a session_stop continuation.
 */

export interface PlaybookStep {
	number: number;
	text: string;
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|c|h|cc|cpp|hpp|sh|bash|zsh|lua|sql)$/i;
const COMMENT_LEADER = /^\s*(?:\/\/+\s*|#\s+|--\s+)(.+?)\s*$/;
/** A comment that opens with the verb of what the next line does says what the code says. */
const NARRATING =
	/^(?:now|first|then|next|finally|here(?:'s| we)|we|let's|loop(?:ing)? (?:over|through)|iterat(?:e|es|ing)|increment(?:s|ing)?|decrement(?:s|ing)?|initiali[sz]e(?:s)?|creat(?:e|es|ing)|set(?:s|ting)?|get(?:s|ting)?|call(?:s|ing)?|check(?:s|ing)? (?:if|whether)|return(?:s|ing)?|import(?:s)?|defin(?:e|es|ing)|declar(?:e|es|ing)|assign(?:s|ing)?|add(?:s|ing)?|updat(?:e|es|ing)|print(?:s|ing)?|log(?:s|ging)?)\b/i;
const MAX_QUOTED = 80;
const MAX_REPORTED = 3;

interface AddedLine {
	path: string | undefined;
	text: string;
}

const SECTION_HEADERS = [/^\[(.+?)#[0-9A-Fa-f]{4}\]$/, /^\*\*\* (?:Update|Add) File: (.+)$/, /^\+\+\+ (?:b\/)?(.+)$/];

/** Lines an `input` string form (hashline, apply_patch, unified diff) adds, with the file of the section they sit in. */
function addedLinesOfPatch(patch: string, path: string | undefined): AddedLine[] {
	const added: AddedLine[] = [];
	let current = path;
	for (const line of patch.split(/\r?\n/)) {
		const header = SECTION_HEADERS.map(pattern => pattern.exec(line)?.[1]).find(match => match !== undefined);
		if (header !== undefined) current = header;
		else if (line.startsWith("+")) added.push({ path: current, text: line.slice(1) });
	}
	return added;
}

const linesOf = (text: string, path: string | undefined): AddedLine[] => text.split(/\r?\n/).map(line => ({ path, text: line }));

/** Text an `edit` or `write` call puts into files. Removed text (`old_string`, `-` lines) is never included. */
function addedLines(toolName: string, input: Record<string, unknown>): AddedLine[] {
	const path = typeof input.path === "string" ? input.path : undefined;
	if (toolName === "write") return typeof input.content === "string" ? linesOf(input.content, path) : [];
	if (toolName !== "edit") return [];
	if (typeof input.new_string === "string") return linesOf(input.new_string, path);
	if (typeof input.input === "string") return addedLinesOfPatch(input.input, path);
	if (Array.isArray(input.edits)) {
		return input.edits.flatMap(entry => (isRecord(entry) && typeof entry.diff === "string" ? addedLinesOfPatch(entry.diff, path) : []));
	}
	return [];
}

/** Comments an edit adds that narrate the next line. Only code files are read, so Markdown headings never match. */
export function narratingComments(toolName: string, input: Record<string, unknown>): string[] {
	const found: string[] = [];
	for (const { path, text } of addedLines(toolName, input)) {
		if (path === undefined || !CODE_FILE.test(path)) continue;
		const comment = COMMENT_LEADER.exec(text)?.[1];
		if (comment !== undefined && NARRATING.test(comment)) found.push(comment.slice(0, MAX_QUOTED));
	}
	return found;
}

export function narratingCommentsWarning(comments: readonly string[]): string {
	const quoted = comments.slice(0, MAX_REPORTED).map(comment => `"${comment}"`).join(", ");
	return `pstack warning: this edit adds comments that narrate the code (${quoted}). Name the thing in code instead and keep a comment only for a why the code cannot show. Remove them in your next edit.`;
}

const STOP_WORD = /^(?:the|and|for|with|over|that|this|from|into|each|any|its|your|you|when|then|than|not|per|one|are|has|have)$/;
const SENTENCE_END = /[.:;](?:\s|$)/;
const KEYWORDS_PER_STEP = 6;

/** Top-level numbered steps of a playbook. Indented sub-bullets and continuation lines belong to their step. */
export function playbookSteps(markdown: string): PlaybookStep[] {
	const steps: PlaybookStep[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const match = /^(\d+)\. (.+)$/.exec(line);
		if (match) steps.push({ number: Number(match[1]), text: match[2]! });
	}
	return steps;
}

/** Lowercase 4-letter word stems, so "opening" and "open" meet. */
const stems = (text: string): string[] =>
	(text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter(word => !STOP_WORD.test(word)).map(word => word.slice(0, 4));

function stepKeywords(step: PlaybookStep): string[] {
	const plain = step.text.replace(/[*`_]/g, "");
	const lead = plain.slice(0, SENTENCE_END.exec(plain)?.index ?? plain.length);
	return [...new Set(stems(lead))].slice(0, KEYWORDS_PER_STEP);
}

/** Playbook steps that no todo item copies: an item must carry at least half of the step's lead words. */
export function missingSteps(items: readonly string[], steps: readonly PlaybookStep[]): PlaybookStep[] {
	const itemStems = items.map(item => new Set(stems(item)));
	return steps.filter(step => {
		const keywords = stepKeywords(step);
		if (keywords.length === 0) return false;
		const needed = Math.ceil(keywords.length / 2);
		return !itemStems.some(words => keywords.filter(keyword => words.has(keyword)).length >= needed);
	});
}

/** Items of a successful todo `init`, flat or by phase; undefined for any other operation. */
export function todoInitItems(input: Record<string, unknown>): string[] | undefined {
	if (input.op !== "init") return undefined;
	const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
	const phased = Array.isArray(input.list) ? input.list.flatMap(phase => (isRecord(phase) ? strings(phase.items) : [])) : [];
	return [...phased, ...strings(input.items)];
}

const STEP_LABEL_LENGTH = 70;

export function missingStepsWarning(playbook: string, missing: readonly PlaybookStep[]): string {
	const named = missing
		.map(step => `step ${step.number} (${step.text.replace(/[*`]/g, "").slice(0, STEP_LABEL_LENGTH).trim()})`)
		.join("; ");
	return `pstack warning: the todo list does not copy every step of the ${playbook} playbook. Missing: ${named}. Append an item for each, or mark it n/a with the reason.`;
}

/** Whether a playbook asks for the throughput checkpoint. Read from the vendored file, not a list of names. */
export const requiresCheckpoint = (markdown: string): boolean => /throughput checkpoint/i.test(markdown);

interface Block {
	type?: unknown;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
}

const roleOf = (message: unknown): unknown => (isRecord(message) ? message.role : undefined);
const blocksOf = (message: unknown): Block[] =>
	isRecord(message) && Array.isArray(message.content) ? message.content.filter((block): block is Block => isRecord(block)) : [];
const assistantText = (message: unknown): string =>
	blocksOf(message)
		.flatMap(block => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
		.join("\n");

const CHECKPOINT_MENTION = /throughput checkpoint|blocking first steps/i;

/** True once the assistant wrote the checkpoint, in prose or as todo items. Tool results are skipped: reading the playbook quotes it. */
export function checkpointWritten(messages: readonly unknown[]): boolean {
	return messages.some(
		message =>
			roleOf(message) === "assistant" &&
			(CHECKPOINT_MENTION.test(assistantText(message)) ||
				blocksOf(message).some(block => block.type === "toolCall" && CHECKPOINT_MENTION.test(JSON.stringify(block.arguments ?? {})))),
	);
}

export const checkpointWarning =
	"pstack warning: no throughput checkpoint yet. Write it as four todo items (blocking first steps, independent workstreams, shared mutable state, smallest safe decomposition), marking a dimension n/a with its reason, then finish your answer.";

const MUTATING_TOOL = /^(?:edit|write|ast_edit)$/;
const RUNNING_TOOL = /^(?:bash|eval|browser|debug)$/;
const DONE_CLAIM =
	/(?<!not )(?<!n't )\b(?:done|finished|completed?|implemented|fixed|resolved|all (?:the )?tests (?:pass|are green)|ready (?:to merge|for review)|works now)\b/i;

/** The turn's messages after the last real user prompt. */
function currentTurn(messages: readonly unknown[]): unknown[] {
	const lastPrompt = messages.findLastIndex(message => roleOf(message) === "user" && !(isRecord(message) && message.synthetic === true));
	return messages.slice(lastPrompt + 1);
}

/** The reply claims the work is done, yet files changed after the last time anything ran. */
export function doneWithoutRuntimeProof(messages: readonly unknown[]): boolean {
	const turn = currentTurn(messages);
	const reply = turn.findLast(message => roleOf(message) === "assistant");
	if (reply === undefined || !DONE_CLAIM.test(assistantText(reply))) return false;
	let unproven = false;
	for (const message of turn) {
		if (roleOf(message) !== "toolResult" || !isRecord(message) || message.isError === true || typeof message.toolName !== "string") continue;
		if (MUTATING_TOOL.test(message.toolName)) unproven = true;
		else if (RUNNING_TOOL.test(message.toolName)) unproven = false;
	}
	return unproven;
}

export const doneWithoutProofWarning =
	"pstack warning: your reply claims the work is done, but nothing ran after your last edit. Run the changed behavior on its real surface (the test, command, or app) and report what you saw, or say that it is unverified.";
