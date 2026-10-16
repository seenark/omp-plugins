import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const COMMAND_USAGE = "Usage: /pstack [status]";

function notify(pi: ExtensionAPI, ctx: ExtensionContext, level: "info" | "warning", message: string): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else pi.logger[level === "warning" ? "warn" : level](message);
}

export default function pstackExtension(pi: ExtensionAPI): void {
	pi.registerCommand("pstack", {
		description: "pstack: report whether pstack is active in this Agent Session",
		handler: async (args, ctx) => {
			const subcommand = args.trim().split(/\s+/)[0] ?? "";
			if (subcommand === "" || subcommand === "status") notify(pi, ctx, "info", "pstack: inactive");
			else notify(pi, ctx, "warning", `Unknown /pstack subcommand. ${COMMAND_USAGE}`);
		},
	});
}
