import type { CommandAction } from "../vs/platform/actions/common/commandAction.ts";
import { registerAction } from "../vs/platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../vs/platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../vs/platform/keybinding/common/keybindingRegistry.ts";
import { macKeysLevel, type MacKeysRung } from "../vs/platform/keybinding/common/macKeys.ts";
import { builtinActions } from "../vs/workbench/browser/actions/builtinActions.ts";
import { withMacKeybindings } from "../vs/workbench/browser/actions/macKeybindings.ts";

/** Дефолтные бинды — так, как их регистрирует WorkbenchComponent (в порядке `actions`). */
export function registerBuiltins(actions: readonly CommandAction[] = builtinActions): KeybindingRegistry {
    const keybindings = new KeybindingRegistry();
    const commands = new CommandRegistry();
    const accessor = {} as ServiceAccessor; // enablement резолвится только при исполнении
    for (const action of actions) registerAction(commands, keybindings, accessor, withMacKeybindings(action));
    return keybindings;
}

export interface Environment {
    readonly name: string;
    readonly tier: "legacy" | "csi-u" | "kitty";
    readonly rung?: MacKeysRung;
    readonly tmux?: boolean;
}

export const ENVIRONMENTS: readonly Environment[] = [
    { name: "pc legacy", tier: "legacy" },
    { name: "pc csi-u", tier: "csi-u" },
    { name: "pc kitty", tier: "kitty" },
    { name: "mac-legacy (Terminal.app)", tier: "legacy", rung: "legacy" },
    { name: "mac-legacy (tmux)", tier: "legacy", rung: "legacy", tmux: true },
    { name: "mac-extended (tmux + extended-keys)", tier: "csi-u", rung: "extended", tmux: true },
    { name: "mac-cmd (kitty)", tier: "kitty", rung: "cmd" },
];

/** Представительные фокус-контексты: у биндов с разным фокусом when взаимоисключающие сами. */
export const FOCUS_CONTEXTS: readonly Readonly<Record<string, boolean>>[] = [
    {},
    { textViewFocus: true, textInputFocus: true, editorGroupHasEditors: true, editorTabsMultiple: true },
    { inputWidgetFocus: true },
    { listFocus: true },
];

export function contextFor(env: Environment, focus: Readonly<Record<string, boolean>>): ContextKeyService {
    const contextKeys = new ContextKeyService();
    const os = env.rung === undefined ? "linux" : "mac";
    contextKeys.set("tier", env.tier);
    contextKeys.set("os", os);
    contextKeys.set("isMac", os === "mac");
    contextKeys.set("isLinux", os === "linux");
    contextKeys.set("cap_extendedKeys", env.tier !== "legacy");
    contextKeys.set("cap_super", env.rung === "cmd");
    contextKeys.set("macKeys", macKeysLevel(env.rung));
    contextKeys.set("mode_tmux", env.tmux === true);
    for (const [key, value] of Object.entries(focus)) contextKeys.setRaw(key, value);
    return contextKeys;
}
