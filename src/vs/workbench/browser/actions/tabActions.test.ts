import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

import {
    closeActiveEditorAction,
    nextEditorInGroupAction,
    openPreviousRecentlyUsedEditorInGroupAction,
    previousEditorInGroupAction,
} from "./tabActions.ts";

interface GroupStub {
    activeIndex: number;
    editorCount: number;
    activateTab: (index: number) => void;
    cycleMru?: (direction: 1 | -1) => void;
    endMruCycle?: () => void;
    closeTab: (index: number) => void;
    /** Закрываемую вкладку экшен берёт по индексу, а не через focus-aware активный редактор. */
    getEditor?: (index: number) => { isModified: boolean } | null;
    onRequestConfirmClose?: (index: number) => void;
}

function setupActionTest(group: GroupStub) {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    const armory = new ModifierReleaseArmory();
    accessor.bind(EditorServiceDIToken, () => group as never);
    accessor.bind(ModifierReleaseArmoryDIToken, () => armory);
    return { commands, keybindings, accessor, armory };
}

describe("TabActions", () => {
    it("nextEditorInGroup steps forward through the MRU stack", () => {
        const cycleMru = vi.fn();
        const group: GroupStub = {
            activeIndex: 2,
            editorCount: 3,
            activateTab: vi.fn(),
            cycleMru,
            closeTab: vi.fn(),
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, nextEditorInGroupAction);

        commands.execute("workbench.action.nextEditorInGroup");

        expect(cycleMru).toHaveBeenCalledWith(1);
    });

    it("previousEditorInGroup steps backward through the MRU stack", () => {
        const cycleMru = vi.fn();
        const group: GroupStub = {
            activeIndex: 0,
            editorCount: 3,
            activateTab: vi.fn(),
            cycleMru,
            closeTab: vi.fn(),
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, previousEditorInGroupAction);

        commands.execute("workbench.action.previousEditorInGroup");

        expect(cycleMru).toHaveBeenCalledWith(-1);
    });

    it("arms the trigger's hold modifier so releasing it commits the MRU cycle", () => {
        const endMruCycle = vi.fn();
        const group: GroupStub = {
            activeIndex: 0,
            editorCount: 3,
            activateTab: vi.fn(),
            cycleMru: vi.fn(),
            endMruCycle,
            closeTab: vi.fn(),
        };

        const { commands, keybindings, accessor, armory } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, nextEditorInGroupAction);

        // Triggered by Ctrl+Tab → runs inside a Control trigger context → arms on Control release.
        armory.withTrigger({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, () => {
            commands.execute("workbench.action.nextEditorInGroup");
        });
        expect(endMruCycle).not.toHaveBeenCalled();

        armory.fireRelease("Control");
        expect(endMruCycle).toHaveBeenCalledTimes(1);
    });

    it("does not arm a hold session when invoked without a modifier (e.g. from a menu)", () => {
        const endMruCycle = vi.fn();
        const group: GroupStub = {
            activeIndex: 0,
            editorCount: 3,
            activateTab: vi.fn(),
            cycleMru: vi.fn(),
            endMruCycle,
            closeTab: vi.fn(),
        };

        const { commands, keybindings, accessor, armory } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, previousEditorInGroupAction);

        commands.execute("workbench.action.previousEditorInGroup"); // no trigger

        armory.fireRelease("Control");
        expect(endMruCycle).not.toHaveBeenCalled();
    });

    // Ctrl+6 задуман работающим и на legacy-терминале, где keyup модификатора не
    // приходит вовсе, — поэтому шаг фиксируется сразу, без hold-сессии.
    it("openPreviousRecentlyUsedEditorInGroup toggles and commits the step immediately", () => {
        const calls: string[] = [];
        const group: GroupStub = {
            activeIndex: 0,
            editorCount: 3,
            activateTab: vi.fn(),
            cycleMru: (direction) => calls.push(`cycle:${String(direction)}`),
            endMruCycle: () => calls.push("end"),
            closeTab: vi.fn(),
        };

        const { commands, keybindings, accessor, armory } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, openPreviousRecentlyUsedEditorInGroupAction);

        armory.withTrigger({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, () => {
            commands.execute("workbench.action.openPreviousRecentlyUsedEditorInGroup");
        });

        expect(calls).toEqual(["cycle:1", "end"]);

        // Ничего не взведено: отпускание Ctrl не должно дёргать фиксацию повторно.
        armory.fireRelease("Control");
        expect(calls).toEqual(["cycle:1", "end"]);
    });

    it("closeActiveEditor closes currently active tab", () => {
        const closeTab = vi.fn();
        const group: GroupStub = {
            activeIndex: 1,
            editorCount: 3,
            activateTab: vi.fn(),
            closeTab,
            getEditor: () => ({ isModified: false }),
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        commands.execute("workbench.action.closeActiveEditor");

        expect(closeTab).toHaveBeenCalledWith(1);
    });

    it("closeActiveEditor routes a modified editor through the confirm-close dialog", () => {
        const closeTab = vi.fn();
        const onRequestConfirmClose = vi.fn();
        const group: GroupStub = {
            activeIndex: 2,
            editorCount: 3,
            activateTab: vi.fn(),
            closeTab,
            getEditor: () => ({ isModified: true }),
            onRequestConfirmClose,
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        commands.execute("workbench.action.closeActiveEditor");

        expect(onRequestConfirmClose).toHaveBeenCalledWith(2);
        expect(closeTab).not.toHaveBeenCalled();
    });

    it("closeActiveEditor closes directly when modified but no confirm handler is wired", () => {
        const closeTab = vi.fn();
        const group: GroupStub = {
            activeIndex: 0,
            editorCount: 1,
            activateTab: vi.fn(),
            closeTab,
            getEditor: () => ({ isModified: true }),
            // onRequestConfirmClose intentionally absent → else branch.
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        commands.execute("workbench.action.closeActiveEditor");

        expect(closeTab).toHaveBeenCalledWith(0);
    });

    it("closeActiveEditor is a no-op when the group is empty", () => {
        const closeTab = vi.fn();
        const group: GroupStub = {
            activeIndex: -1,
            editorCount: 0,
            activateTab: vi.fn(),
            closeTab,
            getEditor: () => null,
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        commands.execute("workbench.action.closeActiveEditor");

        expect(closeTab).not.toHaveBeenCalled();
    });
});
