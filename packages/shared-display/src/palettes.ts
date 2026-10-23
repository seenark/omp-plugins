import type { ResolvedPalette, SharedDisplayPalette } from "./index.ts";

export type FixedPaletteName = Exclude<SharedDisplayPalette, "none" | "theme">;

const catppuccinAccents = ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#74c7ec", "#b4befe"] as const;

export const FIXED_PALETTES: Record<FixedPaletteName, ResolvedPalette> = {
	gruvbox: {
		segments: ["#d65d0e", "#d79921", "#689d6a", "#458588", "#665c54", "#3c3836"].map(bg => ({ bg, fg: "#fbf1c7" })),
		text: ["#d65d0e", "#d79921", "#689d6a", "#458588"],
	},
	catppuccin: {
		segments: catppuccinAccents.map(bg => ({ bg, fg: "#11111b" })),
		text: catppuccinAccents,
	},
	pastel: {
		segments: ["#9a348e", "#da627d", "#fca17d", "#86bbd8", "#06969a", "#33658a"].map(bg => ({ bg })),
		text: ["#da627d", "#fca17d", "#86bbd8", "#06969a"],
	},
	"tokyo-night": {
		segments: [
			{ bg: "#a3aed2", fg: "#090c0c" },
			{ bg: "#769ff0", fg: "#e3e5e5" },
			{ bg: "#394260", fg: "#769ff0" },
			{ bg: "#212736", fg: "#769ff0" },
			{ bg: "#1d2230", fg: "#a0a9cb" },
		],
		text: ["#a3aed2", "#769ff0", "#e3e5e5", "#a0a9cb"],
	},
};
