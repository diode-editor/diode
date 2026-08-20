import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import type { KeyboardEventLike } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { HistoryServiceDIToken } from "../../services/history/browser/historyService.ts";

import { navigateBackAction, navigateForwardAction } from "./navigationActions.ts";

function key(overrides: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike {
    return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...overrides };
}

function setup(tier: string) {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    const contextKeys = new ContextKeyService();
    const history = { goBack: vi.fn(), goForward: vi.fn() };
    accessor.bind(HistoryServiceDIToken, () => history as never);
    contextKeys.set("tier", tier);
    registerAction(commands, keybindings, accessor, navigateBackAction);
    registerAction(commands, keybindings, accessor, navigateForwardAction);
    return { commands, keybindings, contextKeys, history };
}

describe("NavigationActions", () => {
    it("Go Back просит историю шагнуть назад", () => {
        const { commands, history } = setup("kitty");

        commands.execute("workbench.action.navigateBack");

        expect(history.goBack).toHaveBeenCalledOnce();
        expect(history.goForward).not.toHaveBeenCalled();
    });

    it("Go Forward просит историю шагнуть вперёд", () => {
        const { commands, history } = setup("kitty");

        commands.execute("workbench.action.navigateForward");

        expect(history.goForward).toHaveBeenCalledOnce();
    });

    it("на расширенном tier работают канонические комбинации VS Code", () => {
        const { keybindings, contextKeys } = setup("kitty");

        expect(keybindings.resolveKey(key({ key: "-", ctrlKey: true, altKey: true }), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "workbench.action.navigateBack",
        });
        expect(keybindings.resolveKey(key({ key: "-", ctrlKey: true, shiftKey: true }), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "workbench.action.navigateForward",
        });
    });

    it("на legacy канонические комбинации не резолвятся, а аккорд работает", () => {
        const { keybindings, contextKeys } = setup("legacy");

        expect(keybindings.resolveKey(key({ key: "-", ctrlKey: true, altKey: true }), contextKeys)).not.toMatchObject({
            kind: "command",
        });

        // Первая часть аккорда переводит диспатчер в chord-режим, вторая — команда.
        expect(keybindings.resolveKey(key({ key: "k", ctrlKey: true }), contextKeys)).toMatchObject({ kind: "chord" });
        expect(keybindings.resolveKey(key({ key: "b", ctrlKey: true }), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "workbench.action.navigateBack",
        });

        expect(keybindings.resolveKey(key({ key: "k", ctrlKey: true }), contextKeys)).toMatchObject({ kind: "chord" });
        expect(keybindings.resolveKey(key({ key: "f", ctrlKey: true }), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "workbench.action.navigateForward",
        });
    });
});
