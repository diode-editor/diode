import { token } from "../../platform/instantiation/common/diContainer.ts";

/** Absolute path of the active-profile Diode settings.json, or null when unknown (tests/demo). */
export const SettingsResourceDIToken = token<string | null>("SettingsResource");
/** Absolute path of the active-profile Diode keybindings.json, or null when unknown (tests/demo). */
export const KeybindingsResourceDIToken = token<string | null>("KeybindingsResource");
