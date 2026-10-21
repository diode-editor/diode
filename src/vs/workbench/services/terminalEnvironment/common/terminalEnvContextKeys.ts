import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { macKeysLevel, type MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";

export interface ITerminalEnvKeys {
    readonly tier: string;
    readonly os: string;
    /** Rung of the mac ladder; `undefined` means the keyboard is not a Mac one. */
    readonly macKeysRung: MacKeysRung | undefined;
    readonly capabilities: Readonly<Record<string, boolean>>;
    readonly modes: Readonly<Record<string, boolean>>;
}

export function capabilityContextKey(capability: string): string {
    return `cap_${capability.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase())}`;
}

export function modeContextKey(mode: string): string {
    return `mode_${mode}`;
}

/** The single mapping of the environment to when keys — shared by the live context and Keyboard Doctor. */
export function applyTerminalEnvContextKeys(contextKeys: ContextKeyService, env: ITerminalEnvKeys): void {
    contextKeys.set("tier", env.tier);
    contextKeys.set("os", env.os);
    contextKeys.set("isMac", env.os === "mac");
    contextKeys.set("isLinux", env.os === "linux");
    contextKeys.set("isWindows", env.os === "windows");
    contextKeys.set("macKeys", macKeysLevel(env.macKeysRung));
    for (const [capability, supported] of Object.entries(env.capabilities)) {
        contextKeys.setRaw(capabilityContextKey(capability), supported);
    }
    for (const [mode, active] of Object.entries(env.modes)) {
        contextKeys.setRaw(modeContextKey(mode), active);
    }
}
