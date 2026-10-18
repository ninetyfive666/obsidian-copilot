export const COPILOT_SETTINGS_TAB_IDS = ["basic", "byok", "command", "advanced"] as const;

export type CopilotSettingsTabId = (typeof COPILOT_SETTINGS_TAB_IDS)[number];
