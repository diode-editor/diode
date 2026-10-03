import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { macKeysLevel, type MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";

/** Срез терминального окружения, из которого выводятся when-ключи. */
export interface ITerminalEnvKeys {
    readonly tier: string;
    readonly os: string;
    /** Рунг мак-лестницы; `undefined` — клавиатура не маковская. */
    readonly macKeysRung: MacKeysRung | undefined;
    /** Capability → поддерживается ли (`extended-keys` → ключ `cap_extendedKeys`). */
    readonly capabilities: Readonly<Record<string, boolean>>;
    /** Мод → активен ли (`ssh` → ключ `mode_ssh`). */
    readonly modes: Readonly<Record<string, boolean>>;
}

/** Имя capability окружения → его контекст-ключ (`extended-keys` → `cap_extendedKeys`). */
export function capabilityContextKey(capability: string): string {
    return `cap_${capability.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase())}`;
}

/** Имя мода → его контекст-ключ (`ssh` → `mode_ssh`). */
export function modeContextKey(mode: string): string {
    return `mode_${mode}`;
}

/**
 * Единственный маппинг окружения в when-ключи: tier / os / isMac / isLinux /
 * isWindows / macKeys / cap_* / mode_*. Им пользуются и живой контекст
 * (`TerminalEnvContextKeysContribution`), и Keyboard Doctor, который строит
 * контекст «как если бы фокус был в редакторе» поверх своего снимка.
 */
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
