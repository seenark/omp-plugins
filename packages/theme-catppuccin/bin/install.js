#!/usr/bin/env bun

import { copyFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const themeFiles = [
  "catppuccin-latte.json",
  "catppuccin-frappe.json",
  "catppuccin-macchiato.json",
  "catppuccin-mocha.json",
];

async function installThemes() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourceThemesDir = path.join(packageRoot, "themes");
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? path.resolve(process.env.PI_CODING_AGENT_DIR)
    : path.join(os.homedir(), ".omp", "agent");
  const destinationThemesDir = path.join(agentDir, "themes");

  await mkdir(destinationThemesDir, { recursive: true });

  for (const file of themeFiles) {
    const source = path.join(sourceThemesDir, file);
    const destination = path.join(destinationThemesDir, file);
    const theme = JSON.parse(await readFile(source, "utf8"));
    const expectedThemeName = path.basename(file, ".json");

    if (theme.name !== expectedThemeName) {
      throw new Error(
        `Theme name mismatch for ${file}: expected ${expectedThemeName}, got ${theme.name}`,
      );
    }

    await copyFile(source, destination);
    console.log(`Installed ${expectedThemeName} -> ${destination}`);
  }

  console.log(
    "Open OMP /settings and select catppuccin-latte for Light Theme, or catppuccin-frappe, catppuccin-macchiato, or catppuccin-mocha for Dark Theme.",
  );
}

try {
  await installThemes();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to install Catppuccin themes: ${message}`);
  process.exitCode = 1;
}
