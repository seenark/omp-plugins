import type { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgRetryFallbackChains } from "@oh-my-pi/pi-coding-agent/session/settings";
import { cfgTaskIsolationEnabled } from "@oh-my-pi/pi-coding-agent/task/settings";
import type { SetupSettings } from "./settings.ts";

/** Adapter over OMP's in-process settings: sibling roles survive and writes flush to the config file. */
export function createHostSetupSettings(settings: Settings): SetupSettings {
	return {
		modelRoles: () => ({ ...settings.getModelRoles() }) as Record<string, string>,
		fallbackChains: () => ({ ...cfgRetryFallbackChains.get(settings) }),
		taskIsolation: () => cfgTaskIsolationEnabled.get(settings),
		setModelRole: (role, model) => settings.setModelRole(role, model),
		setFallbackChain: (role, chain) => cfgRetryFallbackChains.setEntry(settings, role, chain),
		setTaskIsolation: enabled => cfgTaskIsolationEnabled.set(settings, enabled),
		commit: async () => {
			await settings.flush();
			await settings.reloadFromDisk();
		},
	};
}
