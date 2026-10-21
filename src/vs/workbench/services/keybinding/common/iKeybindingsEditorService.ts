import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../../../platform/keybinding/common/userKeybindings.ts";

/** A file write error is a result, not an exception: the tab shows it as text and stays alive. */
export type IKeybindingMutationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Sole owner of applying user rules to the registry and of writing keybindings.json.
 * Mutations apply immediately; there is no file watcher — manual file edits take effect after Reload Window.
 */
export interface IKeybindingsEditorService extends IDisposable {
    /** Called once, after all defaults are registered. */
    applyUserKeybindings(rules: readonly IUserKeybindingRule[]): void;

    /**
     * With `previous`, replaces the entry: a default/extension binding is removed by an unbind
     * rule (VS Code's "`-command` + new rule" pair), a user rule is rewritten; without it, adds
     * another binding. `when` is copied resolved, with enablement folded in, as VS Code writes it.
     */
    defineKeybinding(
        commandId: string,
        chord: KeybindingChord,
        previous?: IKeybindingEntrySnapshot,
    ): Promise<IKeybindingMutationResult>;

    /** A user rule is deleted from the file; a default/extension binding gets an unbind rule. */
    removeKeybinding(entry: IKeybindingEntrySnapshot): Promise<IKeybindingMutationResult>;

    resetKeybinding(commandId: string): Promise<IKeybindingMutationResult>;

    /** Gates the "Reset Keybinding" menu item. */
    hasUserModifications(commandId: string): boolean;

    onDidChange(cb: () => void): IDisposable;
}

export const KeybindingsEditorServiceDIToken = token<IKeybindingsEditorService>("KeybindingsEditorService");
