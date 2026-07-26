import { ListViewElement } from "../../../../../tuidom/ui/list/listViewElement.ts";
import { TreeViewElement } from "../../../../../tuidom/ui/tree/treeViewElement.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { TuiApplicationDIToken } from "../../common/coreTokens.ts";

// Оба списочных контрола имеют одинаковую четвёрку focus-методов; двух классов
// мало, чтобы заводить общий интерфейс tuidom, — хватает union-instanceof
// (парного к вычислению ключа `listFocus` в workbenchContextKeys.ts).
type ListLike = TreeViewElement<unknown> | ListViewElement;

function activeList(accessor: Parameters<CommandAction["run"]>[0]): ListLike | null {
    const app = accessor.get(TuiApplicationDIToken);
    const active = app.focusManager?.activeElement;
    if (active instanceof TreeViewElement || active instanceof ListViewElement) return active;
    return null;
}

export const listFocusPageDownAction: CommandAction = {
    id: "list.focusPageDown",
    title: "List: Page Down",
    keybinding: parseKeybinding("pagedown"),
    when: "listFocus",
    run(accessor) {
        activeList(accessor)?.focusPageDown();
    },
};

export const listFocusPageUpAction: CommandAction = {
    id: "list.focusPageUp",
    title: "List: Page Up",
    keybinding: parseKeybinding("pageup"),
    when: "listFocus",
    run(accessor) {
        activeList(accessor)?.focusPageUp();
    },
};

export const listFocusFirstAction: CommandAction = {
    id: "list.focusFirst",
    title: "List: Focus First",
    keybinding: parseKeybinding("home"),
    when: "listFocus",
    run(accessor) {
        activeList(accessor)?.focusFirst();
    },
};

export const listFocusLastAction: CommandAction = {
    id: "list.focusLast",
    title: "List: Focus Last",
    keybinding: parseKeybinding("end"),
    when: "listFocus",
    run(accessor) {
        activeList(accessor)?.focusLast();
    },
};
