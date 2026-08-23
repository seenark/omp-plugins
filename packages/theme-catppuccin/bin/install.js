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
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WINDOWS_RESERVED_BASENAME_RE = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

function normalizeProfileName(profile) {
  const normalized = profile?.trim();
  if (!normalized || normalized === "default") return undefined;
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.endsWith(".") ||
    !PROFILE_NAME_RE.test(normalized) ||
    WINDOWS_RESERVED_BASENAME_RE.test(normalized)
  ) {
    throw new Error(
      `Invalid OMP profile "${profile}". Profile names must match ${PROFILE_NAME_RE.source}, cannot be "." or "..", cannot end with ".", or use a reserved Windows device name.`,
    );
  }
  return normalized;
}

export function resolveAgentDir(env = process.env, home = os.homedir()) {
  const configDir = env.PI_CONFIG_DIR || ".omp";
  const profileEnv = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
  const profile = normalizeProfileName(profileEnv);
  if (profile) return path.join(home, configDir, "profiles", profile, "agent");
  return env.PI_CODING_AGENT_DIR ? path.resolve(env.PI_CODING_AGENT_DIR) : path.join(home, configDir, "agent");
}

export async function installThemes({
  env = process.env,
  home = os.homedir(),
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
} = {}) {
  const sourceThemesDir = path.join(packageRoot, "themes");
  const destinationThemesDir = path.join(resolveAgentDir(env, home), "themes");

  await mkdir(destinationThemesDir, { recursive: true });

  for (const file of themeFiles) {
    const source = path.join(sourceThemesDir, file);
    const destination = path.join(destinationThemesDir, file);
    const theme = JSON.parse(await readFile(source, "utf8"));
    const expectedThemeName = path.basename(file, ".json");

    if (theme.name !== expectedThemeName) {
      throw new Error(`Theme name mismatch for ${file}: expected ${expectedThemeName}, got ${theme.name}`);
    }

    await copyFile(source, destination);
    console.log(`Installed ${expectedThemeName} -> ${destination}`);
  }

  console.log(
    "Open OMP /settings and select catppuccin-latte for Light Theme, or catppuccin-frappe, catppuccin-macchiato, or catppuccin-mocha for Dark Theme.",
  );
}

if (import.meta.main) {
  try {
    await installThemes();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to install Catppuccin themes: ${message}`);
    process.exitCode = 1;
  }
}
