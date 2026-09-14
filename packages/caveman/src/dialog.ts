import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import {
	Container,
	Input,
	SettingsList,
	Text,
	type Component,
	type SettingItem,
} from "@oh-my-pi/pi-tui";
import {
	CAVEMAN_LEVELS,
	cloneCavemanConfig,
	isCavemanLevel,
	type CavemanConfig,
} from "./types.ts";
import { validateCavemanConfig } from "./config.ts";

const ACTION_IDS = new Set(["showPaths", "initialize", "reload", "apply", "cancel"]);

type DialogResult = { kind: "applied" } | undefined;

export interface CavemanDialogOptions {
	ctx: ExtensionContext;
	config: CavemanConfig;
	configPath: string;
	skillPath: string;
	glyphPath: string;
	onApply: (draft: CavemanConfig) => Promise<void>;
	onReload: () => Promise<CavemanConfig>;
	onInitialize: (draft: CavemanConfig) => Promise<readonly string[]>;
}

function inputSubmenu(value: string, done: (value?: string) => void): Component {
	const input = new Input();
	input.prompt = "";
	input.setValue(value);
	input.onSubmit = next => done(next);
	input.onEscape = () => done();
	return input;
}

export async function openCavemanDialog(options: CavemanDialogOptions): Promise<DialogResult> {
	const { ctx } = options;
	return ctx.ui.custom((_tui, theme, _keybindings, done) => {
		let draft = cloneCavemanConfig(options.config);
		let settingsList: SettingsList;
		const errorText = new Text("", 1, 0);
		const setError = (message: string): void => {
			errorText.setText(message ? theme.fg("error", message) : "");
		};
		const refresh = (): void => {
			settingsList.setItems(makeItems());
		};
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold(" Caveman Config")), 0, 0));
		container.addChild(new Text(theme.fg("dim", ` Saved to ${options.configPath}`), 0, 0));
		container.addChild(new Text("", 0, 0));
		const makeItems = (): SettingItem[] => [
			{ id: "heading-config", label: "Config", currentValue: "", heading: true },
			{
				id: "defaultLevel",
				label: "Default level",
				description: "Level used when a session has no saved Caveman level. Applying a changed value also selects it now; off disables Caveman instructions and status.",
				currentValue: draft.defaultLevel,
				values: [...CAVEMAN_LEVELS],
			},
			{
				id: "nativeVisible",
				label: "Native status",
				description: "Show Caveman in OMP's native footer with a static glyph. Independent of Shared Display; hidden when the active level is off.",
				currentValue: draft.nativeVisible ? "on" : "off",
				values: ["on", "off"],
			},
			{ id: "heading-display", label: "Display", currentValue: "", heading: true },
			{
				id: "display.visible",
				label: "Shared display",
				description: "Publish Caveman frames to Shared Display. Independent of native status; disabled or level off publishes no Caveman source.",
				currentValue: draft.display.visible ? "on" : "off",
				values: ["on", "off"],
			},
			{
				id: "display.template",
				label: "Status template",
				description: "Single-line status format. Tokens: {activity}=●/○, {glyph}=current frame, {level}=level label; other text stays literal.",
				currentValue: draft.display.template,
				submenu: inputSubmenu,
			},
			{
				id: "display.glyphDirectory",
				label: "Glyph directory",
				description: "Files: lite.txt, full.txt, ultra.txt, wenyan-lite.txt, wenyan-full.txt, wenyan-ultra.txt; no off.txt. Optional positive fps=N; whitespace frames or blank-line blocks. Invalid/missing files use packaged assets; ~ means home.",
				currentValue: draft.display.glyphDirectory,
				submenu: inputSubmenu,
			},
			{ id: "heading-assets", label: "Assets", currentValue: "", heading: true },
			{
				id: "showPaths",
				label: "Show paths",
				description: "Show the active config.json, vendored skill, and Glyph directory paths.",
				currentValue: "run",
			},
			{
				id: "initialize",
				label: "Initialize missing glyphs",
				description: "Create only missing Caveman glyph files from packaged assets. Optional positive fps=N sets speed; whitespace frames or blank-line blocks. Created files remain after Cancel.",
				currentValue: "run",
			},
			{ id: "heading-actions", label: "Actions", currentValue: "", heading: true },
			{
				id: "reload",
				label: "Reload from disk",
				description: "Discard draft edits and reread config.json; live settings stay unchanged until Apply.",
				currentValue: "run",
			},
			{
				id: "apply",
				label: "Apply changes",
				description: "Validate every field, atomically save config.json, and activate this draft.",
				currentValue: "run",
			},
			{ id: "cancel", label: "Cancel", description: "Close without saving draft edits or changing live settings; initialized asset files remain on disk.", currentValue: "run" },
		];

		const onChange = (id: string, value: string): void => {
			if (id === "defaultLevel" && isCavemanLevel(value)) draft.defaultLevel = value;
			else if (id === "nativeVisible") draft.nativeVisible = value === "on";
			else if (id === "display.visible") draft.display.visible = value === "on";
			else if (id === "display.template") draft.display.template = value;
			else if (id === "display.glyphDirectory") draft.display.glyphDirectory = value;
			setError("");
			refresh();
		};

		const runAction = (id: string): void => {
			if (id === "showPaths") {
				ctx.ui.notify(
					`Caveman config: ${options.configPath}\nSkill: ${options.skillPath}\nGlyphs: ${options.glyphPath}`,
					"info",
				);
				return;
			}
			if (id === "initialize") {
				void ctx.ui
					.confirm("Initialize Caveman glyphs", "Copy packaged assets only for missing files?")
					.then(async confirmed => {
						if (!confirmed) return;
						try {
							const files = await options.onInitialize(draft);
							ctx.ui.notify(files.length > 0 ? `Initialized ${files.length} glyph files.` : "No missing glyph files.", "info");
						} catch (error) {
							setError(`Initialize failed: ${String(error)}`);
						}
						_tui.requestRender();
					});
				return;
			}
			if (id === "reload") {
				void options.onReload().then(
					next => {
						draft = cloneCavemanConfig(next);
						setError("");
						refresh();
						_tui.requestRender();
					},
					error => {
						setError(`Reload failed: ${String(error)}`);
						_tui.requestRender();
					},
				);
				return;
			}
			if (id === "apply") {
				const error = validateCavemanConfig(draft);
				if (error) {
					setError(error);
					_tui.requestRender();
					return;
				}
				void options.onApply(cloneCavemanConfig(draft)).then(
					() => done({ kind: "applied" }),
					error => {
						setError(`Apply failed: ${String(error)}`);
						_tui.requestRender();
					},
				);
				return;
			}
			if (id === "cancel") done(undefined);
		};

		settingsList = new SettingsList(
			makeItems(),
			Math.min(16, makeItems().length),
			getSettingsListTheme(),
			onChange,
			() => done(undefined),
			{ layout: "flat", hint: "Enter edit/run · Space change · ↑↓ navigate · Esc cancel" },
		);
		container.addChild(settingsList);
		container.addChild(errorText);

		const component: Component = {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (data === "\r" || data === "\n") {
					const selected = settingsList.getSelectedItem();
					if (selected && ACTION_IDS.has(selected.id)) {
						runAction(selected.id);
						return;
					}
				}
				settingsList.handleInput(data);
				_tui.requestRender();
			},
		};
		return component;
	});
}
