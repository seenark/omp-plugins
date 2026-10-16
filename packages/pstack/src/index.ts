import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { createBehaviorStore, type BehaviorStoreOptions } from "./behavior.ts";
import { DROPOUT_ENTRY_TYPE, watchDropouts } from "./dropouts.ts";
import { guardSeatSpawn } from "./panel.ts";

const COMMAND_USAGE = "Usage: /pstack [status]";

function notify(pi: ExtensionAPI, ctx: ExtensionContext, level: "info" | "warning", message: string): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else pi.logger[level === "warning" ? "warn" : level](message);
}

export type PstackExtensionOptions = Pick<BehaviorStoreOptions, "configPath" | "homeDirectory">;

export default function pstackExtension(pi: ExtensionAPI, options: PstackExtensionOptions = {}): void {
	const behavior = createBehaviorStore(pi.events, { ...options, onWarning: message => pi.logger.warn(message) });
	let stopDropouts: (() => void) | undefined;

	pi.on("session_start", () => {
		behavior.reload();
		stopDropouts?.();
		stopDropouts = watchDropouts(pi.events, dropout => pi.appendEntry(DROPOUT_ENTRY_TYPE, dropout));
	});
	pi.on("session_shutdown", () => {
		stopDropouts?.();
		stopDropouts = undefined;
		behavior.dispose();
	});
	pi.on("before_subagent_spawn", (event, ctx) => guardSeatSpawn(event, ctx));

	pi.registerCommand("pstack", {
		description: "pstack: report whether pstack is active in this Agent Session",
		handler: async (args, ctx) => {
			const subcommand = args.trim().split(/\s+/)[0] ?? "";
			if (subcommand === "" || subcommand === "status") notify(pi, ctx, "info", "pstack: inactive");
			else notify(pi, ctx, "warning", `Unknown /pstack subcommand. ${COMMAND_USAGE}`);
		},
	});
}
