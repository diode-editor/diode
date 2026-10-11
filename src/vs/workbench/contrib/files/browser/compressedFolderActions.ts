import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { ExplorerServiceDIToken } from "./explorerService.ts";

/**
 * Навигация по сегментам компактной строки Explorer'а (`explorer.compactFolders`)
 * — эталонные `previousCompressedFolder` и соседи из `fileCommands.ts`: те же id,
 * клавиши, `when` и вес `WorkbenchContrib + 10` (перебивает `list.focusFirst`/
 * `list.focusLast` на Home/End). На краю цепочки ключ First/Last снимает бинд, и
 * клавиша уходит дереву: Left сворачивает/идёт к родителю, Home — в начало списка.
 */
const COMPRESSED_FOCUS = "filesExplorerFocus && !inputWidgetFocus && explorerViewletCompressedFocus";
const NOT_FIRST = `${COMPRESSED_FOCUS} && !explorerViewletCompressedFirstFocus`;
const NOT_LAST = `${COMPRESSED_FOCUS} && !explorerViewletCompressedLastFocus`;
const WEIGHT = KeybindingWeight.WorkbenchContrib + 10;

export const previousCompressedFolderAction: CommandAction = {
    id: "previousCompressedFolder",
    title: "Explorer: Previous Compressed Folder",
    keybinding: parseKeybinding("left"),
    when: NOT_FIRST,
    weight: WEIGHT,
    run(accessor) {
        accessor.get(ExplorerServiceDIToken).moveCompressedFocus("previous");
    },
};

export const nextCompressedFolderAction: CommandAction = {
    id: "nextCompressedFolder",
    title: "Explorer: Next Compressed Folder",
    keybinding: parseKeybinding("right"),
    when: NOT_LAST,
    weight: WEIGHT,
    run(accessor) {
        accessor.get(ExplorerServiceDIToken).moveCompressedFocus("next");
    },
};

export const firstCompressedFolderAction: CommandAction = {
    id: "firstCompressedFolder",
    title: "Explorer: First Compressed Folder",
    keybinding: parseKeybinding("home"),
    when: NOT_FIRST,
    weight: WEIGHT,
    run(accessor) {
        accessor.get(ExplorerServiceDIToken).moveCompressedFocus("first");
    },
};

export const lastCompressedFolderAction: CommandAction = {
    id: "lastCompressedFolder",
    title: "Explorer: Last Compressed Folder",
    keybinding: parseKeybinding("end"),
    when: NOT_LAST,
    weight: WEIGHT,
    run(accessor) {
        accessor.get(ExplorerServiceDIToken).moveCompressedFocus("last");
    },
};
