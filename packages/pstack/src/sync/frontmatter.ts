export interface FrontmatterEdit {
	/** Top-level keys to drop, with their indented continuation lines. */
	remove?: readonly string[];
	/** Replaces the value of `name`, inserting the key when absent. */
	name?: string;
	/** Adds `key: value` lines for keys not already present. */
	add?: Readonly<Record<string, string>>;
}

const KEY = /^([\w-]+):/;

/** Line-based so untouched frontmatter stays byte-identical. Text without frontmatter is returned unchanged. */
export function editFrontmatter(text: string, edit: FrontmatterEdit): string {
	if (!text.startsWith("---\n")) return text;
	const end = text.indexOf("\n---", 4);
	if (end === -1) return text;
	const lines = text.slice(4, end).split("\n");
	const rest = text.slice(end);

	const kept: string[] = [];
	let dropping = false;
	for (const line of lines) {
		const key = KEY.exec(line)?.[1];
		if (key !== undefined) dropping = edit.remove?.includes(key) ?? false;
		else if (!/^\s/.test(line)) dropping = false;
		if (!dropping) kept.push(line);
	}

	if (edit.name !== undefined) {
		const index = kept.findIndex(line => KEY.exec(line)?.[1] === "name");
		if (index === -1) kept.unshift(`name: ${edit.name}`);
		else if (kept[index] !== `name: ${edit.name}`) kept[index] = `name: ${edit.name}`;
	}
	for (const [key, value] of Object.entries(edit.add ?? {})) {
		if (!kept.some(line => KEY.exec(line)?.[1] === key)) kept.push(`${key}: ${value}`);
	}
	return `---\n${kept.join("\n")}${rest}`;
}
