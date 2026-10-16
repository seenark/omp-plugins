import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { runSetup, type SetupDeps, type SetupNotify } from "./flow.ts";
import { createModelProbe } from "./probe.ts";

export type SetupOptions = Partial<{
	settings: () => SetupDeps["settings"];
	probe: (ctx: ExtensionCommandContext) => SetupDeps["probe"];
}>;

/** `/pstack setup`. Host settings load lazily so a settings-module problem cannot break the rest of the extension. */
export async function runSetupCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, notify: SetupNotify, options: SetupOptions = {}): Promise<void> {
	const settings = options.settings?.() ?? (await import("./host-settings.ts")).createHostSetupSettings(pi.pi.settings);
	await runSetup(ctx, { settings, probe: options.probe?.(ctx) ?? createModelProbe(ctx) }, notify);
}
