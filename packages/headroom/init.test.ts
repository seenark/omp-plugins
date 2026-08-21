import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_HEADROOM_SETTINGS } from "./config.ts";
import { DEFAULT_DISPLAY_CONFIG } from "./display.ts";
import {
	buildHeadroomInitFiles,
	writeHeadroomInitFiles,
	type HeadroomInitFile,
} from "./init.ts";

const states = ["off", "remote-blocked", "starting", "offline", "idle", "online", "compressed"] as const;

function temporaryPaths(root: string) {
	return {
		config: path.join(root, "nested", "config", "settings.json"),
		display: path.join(root, "nested", "display", "display-config.json"),
		glyphs: path.join(root, "nested", "glyphs"),
	};
}

describe("Headroom initialization", () => {
	it("builds the exact ordered nine-file plan with deterministic defaults", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-plan-"));
		try {
			const files = buildHeadroomInitFiles(
				"all",
				{
					symbol(key: string) {
						return (
							{
								"status.disabled": "D",
								"status.warning": "W",
								"status.pending": "P",
								"status.aborted": "A",
								"status.shadowed": "H",
								"status.success": "S",
							}[key] ?? ""
						);
					},
				},
				temporaryPaths(root),
			);

			expect(files.map((file) => file.path)).toEqual([
				path.join(root, "nested", "config", "settings.json"),
				path.join(root, "nested", "display", "display-config.json"),
				...states.map((state) => path.join(root, "nested", "glyphs", `${state}.txt`)),
			]);
			expect(files[0]?.content).toBe(`${JSON.stringify(DEFAULT_HEADROOM_SETTINGS, null, 2)}\n`);
			expect(files[1]?.content).toBe(`${JSON.stringify(DEFAULT_DISPLAY_CONFIG, null, 2)}\n`);
			expect(JSON.parse(files[1]?.content ?? "")).toEqual(DEFAULT_DISPLAY_CONFIG);
			expect(files.slice(2).map((file) => file.content)).toEqual(["D\n", "W\n", "P\n", "A\n", "H\n", "S\n", "S\n"]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("creates parent directories recursively and reports created files", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-create-"));
		try {
			const files = buildHeadroomInitFiles("all", {}, temporaryPaths(root));
			const result = await writeHeadroomInitFiles(files, async () => {
				throw new Error("confirmation should not run for missing files");
			});

			expect(result.created).toHaveLength(9);
			expect(result.overwritten).toEqual([]);
			expect(result.skipped).toEqual([]);
			expect(result.failed).toEqual([]);
			expect(fs.existsSync(path.join(root, "nested", "config", "settings.json"))).toBe(true);
			expect(fs.existsSync(path.join(root, "nested", "glyphs", "compressed.txt"))).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves every existing file when overwrite confirmation is declined", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-skip-"));
		try {
			const files = buildHeadroomInitFiles("all", {}, temporaryPaths(root));
			await writeHeadroomInitFiles(files, async () => true);
			const before = files.map((file) => fs.readFileSync(file.path, "utf8"));
			const confirmed: string[] = [];
			const result = await writeHeadroomInitFiles(files, async (file) => {
				confirmed.push(file.path);
				return false;
			});

			expect(result.created).toEqual([]);
			expect(result.overwritten).toEqual([]);
			expect(result.skipped).toEqual(files.map((file) => file.path));
			expect(result.failed).toEqual([]);
			expect(confirmed).toEqual(files.map((file) => file.path));
			expect(files.map((file) => fs.readFileSync(file.path, "utf8"))).toEqual(before);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("overwrites a confirmed existing file", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-overwrite-"));
		try {
			const file: HeadroomInitFile = {
				path: path.join(root, "settings.json"),
				label: "settings.json",
				content: "generated\n",
			};
			fs.writeFileSync(file.path, "old\n");

			const result = await writeHeadroomInitFiles([file], async () => true);
			expect(result).toEqual({
				created: [],
				overwritten: [file.path],
				skipped: [],
				failed: [],
			});
			expect(fs.readFileSync(file.path, "utf8")).toBe("generated\n");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports one write failure and continues with later files", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-init-failure-"));
		try {
			const blockedPath = path.join(root, "blocked");
			fs.mkdirSync(blockedPath);
			const laterPath = path.join(root, "later", "ok.txt");
			const files: HeadroomInitFile[] = [
				{ path: blockedPath, label: "blocked", content: "cannot write\n" },
				{ path: laterPath, label: "ok.txt", content: "later\n" },
			];

			const result = await writeHeadroomInitFiles(files, async () => true);
			expect(result.failed).toEqual([{ path: blockedPath, message: expect.any(String) }]);
			expect(result.created).toEqual([laterPath]);
			expect(fs.readFileSync(laterPath, "utf8")).toBe("later\n");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
