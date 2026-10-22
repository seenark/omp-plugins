import type { FrameSequence } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_PATH, isRecord, readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";

export const DEFAULT_TEMPLATE = "⚠ {count} ports";

export type ProcessMonitorDisplay = { visible: boolean; template: string };

/** Read `display.processMonitor` from a whole root document; invalid fields fall back to defaults. */
export function normalizeProcessMonitorDisplay(root: unknown): ProcessMonitorDisplay {
	const display = isRecord(root) && isRecord(root.display) && isRecord(root.display.processMonitor) ? root.display.processMonitor : {};
	const template = typeof display.template === "string" ? display.template.trim() : "";
	return {
		visible: typeof display.visible === "boolean" ? display.visible : true,
		// Frame rows may not contain line breaks.
		template: template && !/[\r\n]/.test(template) ? template : DEFAULT_TEMPLATE,
	};
}

export function loadProcessMonitorDisplay(configPath = CODESOOK_OMP_CONFIG_PATH): ProcessMonitorDisplay {
	const root = readCodesookOmpConfig(configPath);
	return normalizeProcessMonitorDisplay(root.valid ? root.value : {});
}

/** Nothing is published at zero or when the segment is hidden. */
export function renderSegment(count: number, display: ProcessMonitorDisplay): FrameSequence | null {
	if (!display.visible || count === 0) return null;
	return { frames: [[display.template.replaceAll("{count}", String(count))]] };
}
