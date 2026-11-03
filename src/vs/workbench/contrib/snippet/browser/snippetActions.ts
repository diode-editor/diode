import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { SnippetServiceDIToken } from "./snippetService.ts";

// Weights, `when` and preconditions as upstream `snippetController2.ts`: above Tab's indent, below the suggest
// widget and inline suggestions, which take Tab and Escape first.
const SNIPPET_WEIGHT = KeybindingWeight.EditorContrib + 30;
/** Upstream's editor commands are not in the command palette. */
const HIDDEN = [{ menuId: MenuId.CommandPalette, when: "false" }];

export const jumpToNextSnippetPlaceholderAction: CommandAction = {
    id: "jumpToNextSnippetPlaceholder",
    title: "Go to Next Snippet Placeholder",
    weight: SNIPPET_WEIGHT,
    keybinding: parseKeybinding("tab"),
    when: "textInputFocus",
    enablement: "inSnippetMode && hasNextTabstop",
    menus: HIDDEN,
    run(accessor) {
        accessor.get(SnippetServiceDIToken).next();
    },
};

export const jumpToPrevSnippetPlaceholderAction: CommandAction = {
    id: "jumpToPrevSnippetPlaceholder",
    title: "Go to Previous Snippet Placeholder",
    weight: SNIPPET_WEIGHT,
    keybinding: parseKeybinding("shift+tab"),
    // Upstream #236489: on a choice, above the suggest widget's own Shift+Tab (`acceptAlternativeSelectedSuggestion`).
    keybindings: [
        { keys: parseKeybinding("shift+tab"), when: "inSnippetChoice", weight: KeybindingWeight.EditorContrib + 91 },
    ],
    when: "textInputFocus",
    enablement: "inSnippetMode && hasPrevTabstop",
    menus: HIDDEN,
    run(accessor) {
        accessor.get(SnippetServiceDIToken).prev();
    },
};

export const leaveSnippetAction: CommandAction = {
    id: "leaveSnippet",
    title: "Leave Snippet",
    weight: SNIPPET_WEIGHT,
    keybinding: parseKeybinding("escape"),
    keybindings: [parseKeybinding("shift+escape")],
    when: "textInputFocus",
    enablement: "inSnippetMode",
    menus: HIDDEN,
    run(accessor) {
        accessor.get(SnippetServiceDIToken).leave();
    },
};

/** No key, as upstream. */
export const acceptSnippetAction: CommandAction = {
    id: "acceptSnippet",
    title: "Accept Snippet",
    enablement: "inSnippetMode",
    menus: HIDDEN,
    run(accessor) {
        accessor.get(SnippetServiceDIToken).accept();
    },
};

export const SNIPPET_ACTIONS: readonly CommandAction[] = [
    jumpToNextSnippetPlaceholderAction,
    jumpToPrevSnippetPlaceholderAction,
    leaveSnippetAction,
    acceptSnippetAction,
];
