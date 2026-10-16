import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { runPreset, runSetup, type SetupDeps, type SetupNotify } from "./flow.ts";
import { createModelProbe } from "./probe.ts";

export type SetupOptions = Partial<{
	settings: () => SetupDeps["settings"];
	probe: (ctx: ExtensionCommandContext) => SetupDeps["probe"];
}>;

/** Host settings load lazily so a settings-module problem cannot break the rest of the extension. */
export async function loadSetupSettings(pi: ExtensionAPI, options: SetupOptions = {}): Promise<SetupDeps["settings"]> {
	return options.settings?.() ?? (await import("./host-settings.ts")).createHostSetupSettings(pi.pi.settings);
}

/** `/pstack setup`. */
export async function runSetupCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, notify: SetupNotify, options: SetupOptions = {}): Promise<void> {
	await runSetup(ctx, { settings: await loadSetupSettings(pi, options), probe: options.probe?.(ctx) ?? createModelProbe(ctx) }, notify);
}

/** `/pstack preset <name>`. */
export async function runPresetCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, notify: SetupNotify, name: string, options: SetupOptions = {}): Promise<void> {
	await runPreset(ctx, { settings: await loadSetupSettings(pi, options), probe: options.probe?.(ctx) ?? createModelProbe(ctx) }, notify, name);
}
