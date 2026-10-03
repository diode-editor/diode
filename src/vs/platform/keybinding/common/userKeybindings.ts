import { token } from "../../instantiation/common/diContainer.ts";

/**
 * A single user keybinding rule, VS Code-shaped. Pure data — parsing the `key`
 * into chords and registering into the KeybindingRegistry happens in the
 * Workbench layer (this layer must not depend on it).
 *
 *   [
 *     { "key": "ctrl+shift+right", "command": "cursorWordRight", "when": "tier == 'kitty'" },
 *     { "key": "ctrl+s", "command": "-workbench.action.files.save" }   // leading '-' = unbind
 *   ]
 */
export interface IUserKeybindingRule {
    /** Chord spec, e.g. "ctrl+s" or "ctrl+k ctrl+s". Empty allowed only for a bare unbind-all. */
    readonly key: string;
    /** Command id. A leading "-" unbinds (removes) instead of adding. */
    readonly command: string;
    /** Optional when-clause (can reference tier / cap_* / mode_* / os). */
    readonly when?: string;
    /** Optional command argument, passed as the command's first argument (VS Code semantics). */
    readonly args?: unknown;
}

/** User keybinding rules loaded from `keybindings.json` (empty when none / in tests). */
export const UserKeybindingsDIToken = token<readonly IUserKeybindingRule[]>("UserKeybindings");
