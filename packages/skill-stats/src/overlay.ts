import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";
import type { Report } from "./report.ts";

/** Copy `text` to the clipboard and say what actually happened. */
export type CopyToClipboard = (text: string, write: (data: string) => void) => Promise<string>;

const CLOSE_KEYS = ["enter", "escape"] as const;

/** Read-only Status Overlay: the report scrolls, `c` copies the delete command, Enter/Esc close. */
export async function showReportOverlay(ctx: ExtensionContext, report: Report, copy: CopyToClipboard): Promise<void> {
	await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
		let scroll = 0;
		let status = "";
		let copying = false;
		const viewport = (): number => Math.max(5, tui.terminal.rows - 4);
		const maxScroll = (): number => Math.max(0, report.lines.length - viewport());
		const move = (to: number): void => {
			scroll = Math.min(maxScroll(), Math.max(0, to));
			tui.requestRender();
		};
		const component: Component = {
			render(width: number): readonly string[] {
				const hint = [
					report.lines.length > viewport() ? `↑↓ PgUp/PgDn scroll (${scroll + 1}-${Math.min(report.lines.length, scroll + viewport())}/${report.lines.length})` : "",
					report.command === undefined ? "" : "c copy command",
					"Enter/Esc close",
				].filter(Boolean);
				return [
					...report.lines.slice(scroll, scroll + viewport()).map(line => truncateToWidth(line, width)),
					"",
					truncateToWidth(status === "" ? hint.join(" · ") : status, width),
				];
			},
			handleInput(data: string): void {
				if (CLOSE_KEYS.some(key => matchesKey(data, key)) || data === "\r" || data === "\n" || data === "\x1b") return done(undefined);
				if (matchesKey(data, "up")) return move(scroll - 1);
				if (matchesKey(data, "down")) return move(scroll + 1);
				if (matchesKey(data, "pageUp")) return move(scroll - viewport());
				if (matchesKey(data, "pageDown")) return move(scroll + viewport());
				if (matchesKey(data, "home")) return move(0);
				if (matchesKey(data, "end")) return move(maxScroll());
				if (data === "c" && report.command !== undefined && !copying) {
					copying = true;
					void copy(report.command, text => tui.terminal.write(text)).then(message => {
						status = message;
						copying = false;
						tui.requestRender();
					});
				}
			},
			invalidate() {},
		};
		return component;
	}, { overlay: true });
}
