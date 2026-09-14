import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_HEADROOM_CONFIG } from "./config.ts";
import { buildHeadroomInitFiles, writeHeadroomInitFiles, type HeadroomInitFile } from "./init.ts";

const states = ["off", "remote-blocked", "starting", "offline", "idle", "online", "compressed"] as const;

function paths(root: string) {
	return {
		config: path.join(root, "nested", "config.json"),
		glyphs: path.join(root, "nested", "glyphs"),
	};
}

describe("Headroom initialization", () => {
	it("builds one unified config and all state glyph files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-"));
		try {
			const files = buildHeadroomInitFiles("all", { symbol: (key: string) => key === "status.success" ? "S" : "" }, paths(root));
			expect(files.map(file => file.path)).toEqual([
				path.join(root, "nested", "config.json"),
				...states.map(state => path.join(root, "nested", "glyphs", `${state}.txt`)),
			]);
			expect(JSON.parse(files[0]?.content ?? "")).toEqual(DEFAULT_HEADROOM_CONFIG);
			expect(files.at(-1)?.content).toBe("S\n");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("creates missing files and preserves them when overwrite is declined", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-"));
		try {
			const files = buildHeadroomInitFiles("all", {}, paths(root));
			const first = await writeHeadroomInitFiles(files, async () => false);
			expect(first.created).toHaveLength(8);
			const before = files.map(file => fs.readFileSync(file.path, "utf8"));
			const second = await writeHeadroomInitFiles(files, async () => false);
			expect(second.skipped).toEqual(files.map(file => file.path));
			expect(files.map(file => fs.readFileSync(file.path, "utf8"))).toEqual(before);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports confirmed overwrite", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-"));
		try {
			const file: HeadroomInitFile = { path: path.join(root, "config.json"), label: "config.json", content: "new\n" };
			fs.writeFileSync(file.path, "old\n");
			expect(await writeHeadroomInitFiles([file], async () => true)).toMatchObject({ overwritten: [file.path] });
			expect(fs.readFileSync(file.path, "utf8")).toBe("new\n");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
