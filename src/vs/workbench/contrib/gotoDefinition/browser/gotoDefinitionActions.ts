import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

export const revealDefinitionAction: CommandAction = {
    id: "editor.action.revealDefinition",
    title: "Go to Definition",
    keybinding: parseKeybinding("f12"),
    when: "textInputFocus",
    enablement: "editorHasDefinitionProvider",
    // Group and order are copied from upstream (`goToCommands.ts`): the item is visible
    // only where someone provides a definition.
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "navigation",
            order: 1.1,
            when: "editorHasDefinitionProvider",
        },
    ],
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).revealDefinition();
    },
};

export const revealDefinitionAsideAction: CommandAction = {
    id: "editor.action.revealDefinitionAside",
    title: "Open Definition to the Side",
    keybinding: parseChord("mod+k f12"),
    when: "textInputFocus",
    enablement: "editorHasDefinitionProvider",
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).revealDefinition({ toSide: true });
    },
};

export const goToImplementationAction: CommandAction = {
    id: "editor.action.goToImplementation",
    title: "Go to Implementations",
    keybinding: parseKeybinding("mod+f12"),
    when: "textInputFocus",
    enablement: "editorHasImplementationProvider",
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "navigation",
            order: 1.45,
            when: "editorHasImplementationProvider",
        },
    ],
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).goToImplementation();
    },
};

// Upstream has no key for this command either (`primary: 0`).
export const goToTypeDefinitionAction: CommandAction = {
    id: "editor.action.goToTypeDefinition",
    title: "Go to Type Definition",
    enablement: "editorHasTypeDefinitionProvider",
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "navigation",
            order: 1.4,
            when: "editorHasTypeDefinitionProvider",
        },
    ],
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).goToTypeDefinition();
    },
};

// Not `editor.action.goToDeclaration`: upstream keeps that id as a deprecated alias of `revealDefinition`.
export const revealDeclarationAction: CommandAction = {
    id: "editor.action.revealDeclaration",
    title: "Go to Declaration",
    enablement: "editorHasDeclarationProvider",
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "navigation",
            order: 1.3,
            when: "editorHasDeclarationProvider",
        },
    ],
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).revealDeclaration();
    },
};

export const GOTO_DEFINITION_ACTIONS: readonly CommandAction[] = [
    revealDefinitionAction,
    revealDefinitionAsideAction,
    goToImplementationAction,
    goToTypeDefinitionAction,
    revealDeclarationAction,
];
