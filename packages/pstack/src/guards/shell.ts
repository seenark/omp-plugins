import * as path from "node:path";

/** What an in-place stream edit (`sed -i`, `perl -i`) in a shell command would touch. */
export interface InPlaceEdit {
	tool: "sed" | "perl";
	/** Operands with relative paths resolved against the working directory the edit runs in. May hold shell globs. */
	files: string[];
	/** The files are not named in the command (`xargs sed -i`, `find -exec sed -i {}`). */
	unresolved: boolean;
}

const WRAPPERS = new Set(["sudo", "doas", "env", "command", "builtin", "exec", "time", "nohup", "nice", "stdbuf", "xargs"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const REDIRECT = /^\d*(?:>>?|<|&>>?)(.*)$/;
const MAX_SHELL_DEPTH = 3;

/**
 * Split a shell command line into simple commands made of unquoted words.
 * Understands quotes, backslash escapes and the separators `&& || ; | & ( ) ` and newline. It does not expand anything.
 */
export function splitCommands(command: string): string[][] {
	const commands: string[][] = [];
	let words: string[] = [];
	let word = "";
	let inWord = false;
	const endWord = (): void => {
		if (inWord) words.push(word);
		word = "";
		inWord = false;
	};
	const endCommand = (): void => {
		endWord();
		if (words.length > 0) commands.push(words);
		words = [];
	};
	for (let i = 0; i < command.length; i++) {
		const ch = command[i]!;
		if (ch === "'") {
			const close = command.indexOf("'", i + 1);
			const end = close === -1 ? command.length : close;
			word += command.slice(i + 1, end);
			inWord = true;
			i = end;
		} else if (ch === '"') {
			inWord = true;
			for (i++; i < command.length && command[i] !== '"'; i++) {
				if (command[i] === "\\" && '"\\$`'.includes(command[i + 1] ?? "")) i++;
				word += command[i] ?? "";
			}
		} else if (ch === "\\") {
			if (command[i + 1] === "\n") i++;
			else {
				word += command[i + 1] ?? "";
				inWord = true;
				i++;
			}
		} else if (ch === "&" && /[<>]$/.test(word)) {
			word += ch;
		} else if (";|&()`\n".includes(ch)) {
			endCommand();
		} else if (/\s/.test(ch)) {
			endWord();
		} else {
			word += ch;
			inWord = true;
		}
	}
	endCommand();
	return commands.map(withoutRedirections);
}

function withoutRedirections(words: string[]): string[] {
	const kept: string[] = [];
	for (let i = 0; i < words.length; i++) {
		const match = REDIRECT.exec(words[i]!);
		if (!match) kept.push(words[i]!);
		else if (match[1] === "") i++;
	}
	return kept;
}

interface Parsed {
	inPlace: boolean;
	operands: string[];
}

/** Short-option clusters: letters before `i` may be flags; `i` ends the cluster (the rest is its suffix). */
function parseClusters(args: string[], argLetters: string, scriptLetters: string): Parsed & { hasScript: boolean } {
	let inPlace = false;
	let hasScript = false;
	const operands: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--") {
			operands.push(...args.slice(i + 1));
			break;
		}
		if (arg.startsWith("--")) {
			const name = arg.slice(2).split("=")[0];
			if (name === "in-place") inPlace = true;
			else if (name === "expression" || name === "file") {
				hasScript = true;
				if (!arg.includes("=")) i++;
			} else if (name === "line-length" && !arg.includes("=")) i++;
			continue;
		}
		if (!arg.startsWith("-") || arg === "-") {
			operands.push(arg);
			continue;
		}
		for (let j = 1; j < arg.length; j++) {
			const letter = arg[j]!;
			if (letter === "i") {
				inPlace = true;
				break;
			}
			if (scriptLetters.includes(letter)) hasScript = true;
			if (argLetters.includes(letter)) {
				if (j === arg.length - 1) i++;
				break;
			}
		}
	}
	return { inPlace, operands, hasScript };
}

function parseSed(args: string[]): Parsed {
	const { inPlace, operands, hasScript } = parseClusters(args, "efl", "ef");
	return { inPlace, operands: hasScript ? operands : operands.slice(1) };
}

function parsePerl(args: string[]): Parsed {
	const { inPlace, operands, hasScript } = parseClusters(args, "eEFIMmCdDx", "eE");
	return { inPlace, operands: hasScript ? operands : operands.slice(1) };
}

const baseName = (word: string): string => path.basename(word);

interface Walk {
	cwd: string | undefined;
	edits: InPlaceEdit[];
}

function inspect(words: string[], walk: Walk, depth: number): void {
	const found = (tool: InPlaceEdit["tool"], parsed: Parsed): void => {
		if (!parsed.inPlace || walk.cwd === undefined) return;
		const cwd = walk.cwd;
		const named = parsed.operands.filter(operand => !operand.includes("{}"));
		const files = named.filter(operand => !/^[~$]/.test(operand)).map(operand => path.resolve(cwd, operand));
		walk.edits.push({ tool, files, unresolved: named.length === 0 || named.length !== parsed.operands.length });
	};
	const run = (start: number): void => {
		const name = baseName(words[start] ?? "");
		const args = words.slice(start + 1);
		if (name === "sed" || name === "gsed") found("sed", parseSed(args));
		else if (name === "perl") found("perl", parsePerl(args));
	};

	let start = 0;
	while (/^[A-Za-z_]\w*=/.test(words[start] ?? "")) start++;
	const first = baseName(words[start] ?? "");
	if (first === "cd") {
		const target = words[start + 1];
		if (target !== undefined && !/^[~$-]/.test(target)) walk.cwd = walk.cwd === undefined ? undefined : path.resolve(walk.cwd, target);
		else walk.cwd = undefined;
		return;
	}
	if (SHELLS.has(first) && depth < MAX_SHELL_DEPTH) {
		const flag = words.findIndex((word, index) => index > start && /^-[a-z]*c$/.test(word));
		const script = flag === -1 ? undefined : words[flag + 1];
		if (script !== undefined) for (const inner of splitCommands(script)) inspect(inner, walk, depth + 1);
		return;
	}
	if (first === "find") {
		words.forEach((word, index) => {
			if (EXEC_FLAGS.has(word)) {
				const end = words.findIndex((other, at) => at > index && (other === ";" || other === "+"));
				const inner = words.slice(index + 1, end === -1 ? words.length : end);
				inspectWithOwnWords(inner, walk, depth);
			}
		});
		return;
	}
	if (WRAPPERS.has(first)) {
		for (let i = start + 1; i < words.length; i++) {
			const word = baseName(words[i]!);
			if (word === "sed" || word === "gsed" || word === "perl") {
				run(i);
				return;
			}
		}
		return;
	}
	run(start);
}

function inspectWithOwnWords(words: string[], walk: Walk, depth: number): void {
	if (words.length > 0) inspect(words, { cwd: walk.cwd, edits: walk.edits }, depth + 1);
}

/**
 * Every `sed -i` / `perl -i` in `command`, however it is spelled (`-i.bak`, `-i ''`, `--in-place`, `-pi -e`, `-ni`)
 * and wherever it sits (`&&` chains, subshells, `bash -c`, `xargs`, `find -exec`). `sed -n`, `sed script file > out`
 * and other reads do not count. `cd dir &&` changes where later relative operands resolve.
 *
 * shortcut: no variable or glob expansion and no heredoc awareness; an operand starting with `$` or `~` is treated as unknown and passes.
 */
export function findInPlaceEdits(command: string, cwd: string): InPlaceEdit[] {
	const walk: Walk = { cwd, edits: [] };
	for (const words of splitCommands(command)) inspect(words, walk, 0);
	return walk.edits;
}
