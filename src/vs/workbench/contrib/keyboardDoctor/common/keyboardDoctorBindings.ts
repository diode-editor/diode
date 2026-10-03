import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import {
    chordsEqual,
    type Keybinding,
    type KeybindingRegistry,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { MAC_KEYS_RUNGS, type MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";
import { applyTerminalEnvContextKeys } from "../../../services/terminalEnvironment/common/terminalEnvContextKeys.ts";

import type { KeyboardDoctorEnv, MatchedBinding } from "./keyboardDoctorModel.ts";

function asRung(value: string | undefined): MacKeysRung | undefined {
    return MAC_KEYS_RUNGS.find((rung) => rung === value);
}

/**
 * Контекст «как если бы фокус был в редакторе» поверх окружения доктора. Живой
 * контекст в момент проверки смотрит на сам оверлей доктора, а человеку важно,
 * сработает ли комбинация там, где он её нажмёт в работе.
 */
export function editorContextFor(env: KeyboardDoctorEnv): ContextKeyService {
    const contextKeys = new ContextKeyService();
    // Снимок доктора несёт только включённое — выключенное в свежем контексте и так ложно.
    applyTerminalEnvContextKeys(contextKeys, {
        tier: env.tier,
        os: env.os,
        macKeysRung: asRung(env.macKeysRung),
        capabilities: Object.fromEntries(env.capabilities.map((capability) => [capability, true])),
        modes: Object.fromEntries(env.modes.map((mode) => [mode, true])),
    });
    for (const focus of ["textViewFocus", "textInputFocus", "editorGroupHasEditors", "editorTabsMultiple"] as const) {
        contextKeys.set(focus, true);
    }
    return contextKeys;
}

/** Все бинды комбинации из реестра и действует ли каждый в окружении доктора. */
export function lookupBindings(
    registry: KeybindingRegistry,
    part: Keybinding,
    env: KeyboardDoctorEnv,
): MatchedBinding[] {
    const contextKeys = editorContextFor(env);
    const chord = [
        { key: part.key, ctrlKey: part.ctrlKey, shiftKey: part.shiftKey, altKey: part.altKey, metaKey: part.metaKey },
    ];
    return registry
        .listBindings()
        .filter((entry) => chordsEqual(entry.chord, chord))
        .map((entry) => ({
            commandId: entry.commandId,
            when: entry.when,
            active: entry.when === undefined || contextKeys.evaluate(entry.when),
        }));
}
