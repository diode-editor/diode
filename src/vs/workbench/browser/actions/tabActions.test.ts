import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

import {
    closeActiveEditorAction,
    nextEditorAction,
    nextEditorInGroupAction,
    openPreviousRecentlyUsedEditorInGroupAction,
    previousEditorAction,
    previousEditorInGroupAction,
} from "./tabActions.ts";

interface TabGroupStub {
    id?: number;
    activeIndex: number;
    getPane: (index: number) => { isModified: boolean } | null;
    closeTab: (index: number) => void;
    cycleMru?: (direction: 1 | -1) => void;
    endMruCycle?: () => void;
}

interface GroupStub {
    cycleEditor?: (direction: 1 | -1) => void;
    activeGroup?: TabGroupStub;
    groups?: readonly TabGroupStub[];
    /** Диалоги проверяют харнесс-тесты `EditorService.closeEditor`. */
    closeEditor?: (group: TabGroupStub, index: number) => Promise<boolean>;
}

const closeEditorStub = (group: TabGroupStub, index: number): Promise<boolean> => {
    group.closeTab(index);
    return Promise.resolve(true);
};

function setupActionTest(group: GroupStub) {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    const armory = new ModifierReleaseArmory();
    accessor.bind(EditorServiceDIToken, () => group as never);
    accessor.bind(EditorGroupsServiceDIToken, () => group as never);
    accessor.bind(ModifierReleaseArmoryDIToken, () => armory);
    return { commands, keybindings, accessor, armory };
}

describe("TabActions", () => {
    it("nextEditorInGroup steps forward through the MRU stack", () => {
        const cycleMru = vi.fn();
        const group: GroupStub = {
            activeGroup: {
                activeIndex: 0,
                getPane: () => null,
                closeTab: vi.fn(),
                cycleMru,
            },
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, nextEditorInGroupAction);

        commands.execute("workbench.action.nextEditorInGroup");

        expect(cycleMru).toHaveBeenCalledWith(1);
    });

    it("previousEditorInGroup steps backward through the MRU stack", () => {
        const cycleMru = vi.fn();
        const group: GroupStub = {
            activeGroup: {
                activeIndex: 0,
                getPane: () => null,
                closeTab: vi.fn(),
                cycleMru,
            },
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, previousEditorInGroupAction);

        commands.execute("workbench.action.previousEditorInGroup");

        expect(cycleMru).toHaveBeenCalledWith(-1);
    });

    it("метаданные nextEditor/previousEditor: заголовки, бинды с Alt-дублями, when", () => {
        expect(nextEditorAction.title).toBe("Open Next Editor");
        expect(previousEditorAction.title).toBe("Open Previous Editor");
        expect(nextEditorAction.when).toBe("textViewFocus || terminalEditorFocus");
        expect(previousEditorAction.when).toBe("textViewFocus || terminalEditorFocus");
        expect(nextEditorAction.keybinding).toEqual(parseKeybinding("ctrl+pagedown"));
        expect(nextEditorAction.keybindings).toEqual([parseKeybinding("alt+pagedown")]);
        expect(previousEditorAction.keybinding).toEqual(parseKeybinding("ctrl+pageup"));
        expect(previousEditorAction.keybindings).toEqual([parseKeybinding("alt+pageup")]);
    });

    it("nextEditor / previousEditor циклируют по визуальному порядку без hold-сессии", () => {
        const cycleEditor = vi.fn();
        const endMruCycle = vi.fn();
        const group: GroupStub = {
            cycleEditor,
            activeGroup: {
                activeIndex: 0,
                getPane: () => null,
                closeTab: vi.fn(),
                endMruCycle,
            },
        };

        const { commands, keybindings, accessor, armory } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, nextEditorAction);
        registerAction(commands, keybindings, accessor, previousEditorAction);

        armory.withTrigger({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, () => {
            commands.execute("workbench.action.nextEditor");
        });
        expect(cycleEditor).toHaveBeenCalledWith(1);

        commands.execute("workbench.action.previousEditor");
        expect(cycleEditor).toHaveBeenCalledWith(-1);

        // Ничего не взведено даже при запуске с зажатым Ctrl.
        armory.fireRelease("Control");
        expect(endMruCycle).not.toHaveBeenCalled();
    });

    it("arms the trigger's hold modifier so releasing it commits the MRU cycle", () => {
        const endMruCycle = vi.fn();
        const group: GroupStub = {
            activeGroup: {
                activeIndex: 0,
                getPane: () => null,
                closeTab: vi.fn(),
                cycleMru: vi.fn(),
                endMruCycle,
            },
        };

        const { commands, keybindings, accessor, armory } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, nextEditorInGroupAction);

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
            activeGroup: {
                activeIndex: 0,
                getPane: () => null,
                closeTab: vi.fn(),
                cycleMru: vi.fn(),
                endMruCycle,
            },
        };

        const { commands, keybindings, accessor, armory } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, previousEditorInGroupAction);

        commands.execute("workbench.action.previousEditorInGroup"); // no trigger

        armory.fireRelease("Control");
        expect(endMruCycle).not.toHaveBeenCalled();
    });

    // Keyup модификатора на legacy не приходит — шаг фиксируется сразу.
    it("openPreviousRecentlyUsedEditorInGroup toggles and commits the step immediately", () => {
        const calls: string[] = [];
        const group: GroupStub = {
            activeGroup: {
                activeIndex: 0,
                getPane: () => null,
                closeTab: vi.fn(),
                cycleMru: (direction) => calls.push(`cycle:${String(direction)}`),
                endMruCycle: () => calls.push("end"),
            },
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
        const activeGroup: TabGroupStub = {
            activeIndex: 1,
            closeTab,
            getPane: () => ({ isModified: false }),
        };
        const group: GroupStub = {
            activeGroup,
            closeEditor: closeEditorStub,
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        commands.execute("workbench.action.closeActiveEditor");

        expect(closeTab).toHaveBeenCalledWith(1);
    });

    it("closeActiveEditor closes the addressed tab of another group (tab context menu)", () => {
        const activeClose = vi.fn();
        const otherClose = vi.fn();
        const activeGroup: TabGroupStub = {
            id: 1,
            activeIndex: 0,
            closeTab: activeClose,
            getPane: () => ({ isModified: false }),
        };
        const otherGroup: TabGroupStub = {
            id: 2,
            activeIndex: 0,
            closeTab: otherClose,
            getPane: () => ({ isModified: false }),
        };
        const group: GroupStub = {
            activeGroup,
            groups: [activeGroup, otherGroup],
            closeEditor: closeEditorStub,
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        // Правый клик по вкладке ЧУЖОЙ группы активную не меняет — адрес приходит аргументами.
        commands.execute("workbench.action.closeActiveEditor", 2, 1);

        expect(otherClose).toHaveBeenCalledWith(1);
        expect(activeClose).not.toHaveBeenCalled();
    });

    it("closeActiveEditor is a no-op when the group is empty", () => {
        const closeTab = vi.fn();
        const activeGroup: TabGroupStub = {
            activeIndex: -1,
            closeTab,
            getPane: () => null,
        };
        const group: GroupStub = {
            activeGroup,
            closeEditor: closeEditorStub,
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        commands.execute("workbench.action.closeActiveEditor");

        expect(closeTab).not.toHaveBeenCalled();
    });

    it("closeActiveEditor is a no-op when the addressed tab no longer exists", () => {
        const closeTab = vi.fn();
        const activeGroup: TabGroupStub = { id: 1, activeIndex: 0, closeTab, getPane: () => null };
        const group: GroupStub = {
            activeGroup,
            closeEditor: closeEditorStub,
            groups: [activeGroup],
        };

        const { commands, keybindings, accessor } = setupActionTest(group);
        registerAction(commands, keybindings, accessor, closeActiveEditorAction);

        // Группа есть, а вкладки по индексу уже нет — и адрес из чужой группы тоже.
        commands.execute("workbench.action.closeActiveEditor", 1, 5);
        commands.execute("workbench.action.closeActiveEditor", 99, 0);

        expect(closeTab).not.toHaveBeenCalled();
    });
});
