import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installThemes, resolveAgentDir } from "../bin/install.js";

const packageRoot = path.resolve(import.meta.dir, "..");
const themeNames = ["catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"];

describe("Catppuccin theme installer", () => {
	it("ships theme files with the upgraded OMP schema metadata", async () => {
		const schemaUrl = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/modes/theme/theme-schema.json";
		for (const name of themeNames) {
			const theme = JSON.parse(await readFile(path.join(packageRoot, "themes", `${name}.json`), "utf8"));
			expect(theme.$schema).toBe(schemaUrl);
			expect(theme.name).toBe(name);
			expect(theme.colors.link).toBeUndefined();
			expect(theme.colors.toolText).toBeUndefined();
		}
	});
	it("matches OMP profile and config directory resolution", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "omp-theme-installer-"));
		try {
			const env = {
				OMP_PROFILE: "work",
				PI_PROFILE: "ignored",
				PI_CONFIG_DIR: "omp-config",
				PI_CODING_AGENT_DIR: path.join(home, "ignored-agent"),
			};
			const expectedAgentDir = path.join(home, "omp-config", "profiles", "work", "agent");

			expect(resolveAgentDir(env, home)).toBe(expectedAgentDir);
			await installThemes({ env, home, packageRoot });

			for (const name of themeNames) {
				expect(await readFile(path.join(expectedAgentDir, "themes", `${name}.json`), "utf8")).toContain(
					`"name": "${name}"`,
				);
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("honors an explicit agent directory for the default profile", () => {
		const env = { PI_CODING_AGENT_DIR: "/tmp/omp-agent", OMP_PROFILE: "" };
		expect(resolveAgentDir(env, "/tmp/home")).toBe("/tmp/omp-agent");
	});

	it("rejects profile names OMP will not activate", () => {
		expect(() => resolveAgentDir({ OMP_PROFILE: "CON" }, "/tmp/home")).toThrow(/Invalid OMP profile/);
		expect(() => resolveAgentDir({ OMP_PROFILE: "com1.txt" }, "/tmp/home")).toThrow(/Invalid OMP profile/);
	});
});
