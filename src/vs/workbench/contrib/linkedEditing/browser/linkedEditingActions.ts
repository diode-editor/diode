import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { LinkedEditingServiceDIToken } from "./linkedEditingService.ts";

// Weights, `when` and preconditions as upstream `linkedEditing.ts`.

export const startLinkedEditingAction: CommandAction = {
    id: "editor.action.linkedEditing",
    title: "Start Linked Editing",
    weight: KeybindingWeight.EditorContrib,
    keybinding: parseKeybinding("ctrl+shift+f2"),
    when: "editorTextFocus",
    enablement: "!editorReadonly && editorHasRenameProvider",
    run(accessor) {
        return accessor.get(LinkedEditingServiceDIToken).start();
    },
};

export const cancelLinkedEditingInputAction: CommandAction = {
    id: "cancelLinkedEditingInput",
    title: "Cancel Linked Editing",
    weight: KeybindingWeight.EditorContrib + 99,
    keybinding: parseKeybinding("escape"),
    keybindings: [parseKeybinding("shift+escape")],
    when: "editorTextFocus",
    enablement: "LinkedEditingInputVisible",
    run(accessor) {
        accessor.get(LinkedEditingServiceDIToken).cancel();
    },
};

export const LINKED_EDITING_ACTIONS: readonly CommandAction[] = [
    startLinkedEditingAction,
    cancelLinkedEditingInputAction,
];
