import { describe, expect, it } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";

import { keepEditorAction } from "./tabActions.ts";

interface GroupStub {
    id: number;
    activeIndex: number;
    panes: { label: string }[];
    pinned: (string | undefined)[];
}

function makeGroup(id: number, labels: string[], activeIndex: number): GroupStub {
    return { id, activeIndex, panes: labels.map((label) => ({ label })), pinned: [] };
}

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

describe("keepEditorAction — command target", () => {
    it("an address from the menu pins the tab UNDER THE POINTER, not the active one", () => {
        const group = makeGroup(3, ["a.ts", "b.ts"], 1);

        run([group], 3, 0);

        expect(group.pinned).toEqual(["a.ts"]);
    });

    it("without an address (Ctrl+K Enter, command palette) — the active tab", () => {
        const group = makeGroup(3, ["a.ts", "b.ts"], 1);

        run([group]);

        expect(group.pinned).toEqual(["b.ts"]);
    });

    it("a stale address pins NOTHING and does not throw", () => {
        // A menu command must not fall back to the active tab.
        const group = makeGroup(3, ["a.ts"], 0);

        expect(() => {
            run([group], 3, 7);
        }).not.toThrow();

        expect(group.pinned).toEqual([]);
    });

    it("an empty group without an address — the command is a no-op, not a crash", () => {
        // The command palette skips the `editorGroupHasEditors` gate, so the command itself
        // must handle "no target".
        const group = makeGroup(3, [], -1);

        expect(() => {
            run([group]);
        }).not.toThrow();

        expect(group.pinned).toEqual([]);
    });
});
