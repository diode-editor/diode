import { describe, expect, it } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";

import { keepEditorAction } from "./tabActions.ts";

/**
 * `workbench.action.keepEditor` адресуется парой (группа, индекс) из меню
 * вкладки либо работает по активной вкладке (Ctrl+K Enter, палитра). Здесь —
 * про ЦЕЛЬ команды: куда она попадает и, главное, куда не попадает. Что именно
 * делает прикалывание, проверяют сьюты группы и сервиса.
 */

interface GroupStub {
    id: number;
    activeIndex: number;
    panes: { label: string }[];
    pinned: (string | undefined)[];
}

function makeGroup(id: number, labels: string[], activeIndex: number): GroupStub {
    return { id, activeIndex, panes: labels.map((label) => ({ label })), pinned: [] };
}

/** Полоса групп в объёме, который трогает `resolveTabTarget` + команда. */
function serviceStub(groups: GroupStub[]) {
    const wrap = (group: GroupStub) => ({
        id: group.id,
        get activeIndex() {
            return group.activeIndex;
        },
        getPane: (index: number) => group.panes[index] ?? null,
        getPanes: () => group.panes,
        pinPane: (pane: { label: string } | undefined) => group.pinned.push(pane?.label),
    });
    const wrapped = groups.map(wrap);
    return { groups: wrapped, activeGroup: wrapped[0] };
}

function run(groups: GroupStub[], ...args: unknown[]): void {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    accessor.bind(EditorGroupsServiceDIToken, () => serviceStub(groups) as never);
    registerAction(commands, keybindings, accessor, keepEditorAction);
    commands.execute(keepEditorAction.id, ...args);
}

describe("keepEditorAction — цель команды", () => {
    it("адрес из меню прикалывает вкладку ПОД КУРСОРОМ, а не активную", () => {
        const group = makeGroup(3, ["a.ts", "b.ts"], 1);

        run([group], 3, 0);

        expect(group.pinned).toEqual(["a.ts"]);
    });

    it("без адреса (Ctrl+K Enter, палитра) — активная вкладка", () => {
        const group = makeGroup(3, ["a.ts", "b.ts"], 1);

        run([group]);

        expect(group.pinned).toEqual(["b.ts"]);
    });

    it("протухший адрес не прикалывает НИЧЕГО и не бросает", () => {
        // Вкладку успели закрыть: откатываться на активную команда меню не
        // имеет права — либо делает то, что в ней написано, либо ничего.
        const group = makeGroup(3, ["a.ts"], 0);

        expect(() => {
            run([group], 3, 7);
        }).not.toThrow();

        expect(group.pinned).toEqual([]);
    });

    it("пустая группа без адреса — команда молчит, а не падает", () => {
        // Прямой вызов из палитры гейт `editorGroupHasEditors` не проходит,
        // поэтому «цели нет» обязано отрабатывать и в самой команде.
        const group = makeGroup(3, [], -1);

        expect(() => {
            run([group]);
        }).not.toThrow();

        expect(group.pinned).toEqual([]);
    });
});
