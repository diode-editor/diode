import type { CommandAction } from "../vs/platform/actions/common/commandAction.ts";
import { registerAction } from "../vs/platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../vs/platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../vs/platform/keybinding/common/keybindingRegistry.ts";
import { macKeysLevel, type MacKeysRung } from "../vs/platform/keybinding/common/macKeys.ts";
import { withMacKeybindings } from "../vs/workbench/browser/actions/macKeybindings.ts";
import { WORKBENCH_ACTIONS } from "../vs/workbench/workbench.common.main.ts";

/** Registers the way WorkbenchComponent does: the order of `actions` matters. */
export function registerBuiltins(actions: readonly CommandAction[] = WORKBENCH_ACTIONS): KeybindingRegistry {
    const keybindings = new KeybindingRegistry();
    const commands = new CommandRegistry();
    const accessor = {} as ServiceAccessor; // enablement is resolved only on execution
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

/** Representative focus contexts: bindings with different focus have mutually exclusive `when` clauses anyway. */
export const FOCUS_CONTEXTS: readonly Readonly<Record<string, boolean>>[] = [
    {},
    {
        textViewFocus: true,
        textInputFocus: true,
        editorAreaFocus: true,
        editorGroupHasEditors: true,
        editorTabsMultiple: true,
        // The enablement of the go-to keybindings: a document with a language server.
        editorHasDefinitionProvider: true,
        editorHasReferenceProvider: true,
    },
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
