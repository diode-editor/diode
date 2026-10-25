import { codicon } from "../../../base/common/codicons.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ILogServiceDIToken } from "../../../platform/log/common/iLogServiceDIToken.ts";
import { ExplorerServiceDIToken } from "../../contrib/files/browser/explorerService.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { EditorPartComponentDIToken } from "../parts/editor/editorPartComponent.ts";

import { resolveAddressedTab } from "./editorTabTarget.ts";
import { editorTabTargetArg, editorTitleBarGroupArg, editorTitleBarGroupLocked } from "./menuContexts.ts";

/** Kitty/CSI-u are the only tiers where Ctrl+digit reaches the application. */
const EXTENDED_TIERS = "tier == 'kitty' || tier == 'csi-u'";

/** In cells, like the sidebar. */
const GROUP_RESIZE_STEP = 3;

/**
 * With a single group the axis simply changes (as in VS Code); once the strip is laid out,
 * refuse and log it (one axis only — spec decision #2).
 */
function ensureAxis(accessor: ServiceAccessor, wanted: "columns" | "rows"): boolean {
    const part = accessor.get(EditorPartComponentDIToken);
    const groups = accessor.get(EditorGroupsServiceDIToken);
    if (part.orientation === wanted) return true;
    if (groups.groups.length === 1) {
        part.orientation = wanted;
        return true;
    }
    accessor
        .get(ILogServiceDIToken)
        .createLogger("workbench.editorGroups")
        .info(`split refused — strip axis is ${part.orientation}, wanted ${wanted}`);
    return false;
}

/** Activates the tab from the tab context menu before splitting: the split keeps its own editor active. */
function directionalSplit(
    accessor: ServiceAccessor,
    axis: "columns" | "rows",
    position: "before" | "after",
    // Stryker disable next-line ArrayDeclaration: the default only serves argument-less calls, and only a pair of numbers counts as an address — any other list behaves as empty
    args: readonly unknown[] = [],
): void {
    const groups = accessor.get(EditorGroupsServiceDIToken);
    const addressed = resolveAddressedTab(groups, args);
    if (addressed !== null) {
        groups.focusGroup(addressed.group.id, { focus: false });
        addressed.group.activateTab(addressed.index, { focus: false });
    }
    if (!ensureAxis(accessor, axis)) return;
    accessor.get(EditorServiceDIToken).splitActiveGroup({ position });
}

function directionalNewGroup(accessor: ServiceAccessor, axis: "columns" | "rows", position: "before" | "after"): void {
    if (!ensureAxis(accessor, axis)) return;
    accessor.get(EditorGroupsServiceDIToken).newGroup(position);
}

/** Across the axis it is a no-op (US-10). */
function directionalFocus(accessor: ServiceAccessor, axis: "columns" | "rows", direction: "next" | "previous"): void {
    const part = accessor.get(EditorPartComponentDIToken);
    if (part.orientation !== axis) return;
    accessor.get(EditorGroupsServiceDIToken).focusGroup({ direction });
}

export const splitEditorAction: CommandAction = {
    id: "workbench.action.splitEditor",
    title: "View: Split Editor",
    shortTitle: "Split Editor",
    // 0x1C (FS) is the only split binding that arrives on every tier.
    keybinding: parseKeybinding("mod+\\"),
    when: "editorGroupHasEditors",
    run(accessor) {
        accessor.get(EditorServiceDIToken).splitActiveGroup();
    },
};

export const splitEditorRightAction: CommandAction = {
    id: "workbench.action.splitEditorRight",
    title: "View: Split Editor Right",
    shortTitle: "Split Right",
    menus: [{ menuId: MenuId.EditorTitleContext, group: "2_split", order: 10, args: editorTabTargetArg }],
    when: "editorGroupHasEditors",
    run(accessor, ...args) {
        // Stryker disable next-line StringLiteral: splitActiveGroup compares the position only with "before", so "after" and any other string put the group in the same place
        directionalSplit(accessor, "columns", "after", args);
    },
};

export const splitEditorLeftAction: CommandAction = {
    id: "workbench.action.splitEditorLeft",
    title: "View: Split Editor Left",
    when: "editorGroupHasEditors",
    run(accessor) {
        directionalSplit(accessor, "columns", "before");
    },
};

export const splitEditorDownAction: CommandAction = {
    id: "workbench.action.splitEditorDown",
    title: "View: Split Editor Down",
    shortTitle: "Split Down",
    menus: [{ menuId: MenuId.EditorTitleContext, group: "2_split", order: 20, args: editorTabTargetArg }],
    when: "editorGroupHasEditors",
    run(accessor, ...args) {
        // Stryker disable next-line StringLiteral: see splitEditorRightAction — the position is compared only with "before"
        directionalSplit(accessor, "rows", "after", args);
    },
};

export const splitEditorUpAction: CommandAction = {
    id: "workbench.action.splitEditorUp",
    title: "View: Split Editor Up",
    when: "editorGroupHasEditors",
    run(accessor) {
        directionalSplit(accessor, "rows", "before");
    },
};

export const newGroupRightAction: CommandAction = {
    id: "workbench.action.newGroupRight",
    title: "View: New Editor Group to the Right",
    run(accessor) {
        directionalNewGroup(accessor, "columns", "after");
    },
};

export const newGroupLeftAction: CommandAction = {
    id: "workbench.action.newGroupLeft",
    title: "View: New Editor Group to the Left",
    run(accessor) {
        directionalNewGroup(accessor, "columns", "before");
    },
};

export const newGroupBelowAction: CommandAction = {
    id: "workbench.action.newGroupBelow",
    title: "View: New Editor Group Below",
    run(accessor) {
        directionalNewGroup(accessor, "rows", "after");
    },
};

export const newGroupAboveAction: CommandAction = {
    id: "workbench.action.newGroupAbove",
    title: "View: New Editor Group Above",
    run(accessor) {
        directionalNewGroup(accessor, "rows", "before");
    },
};

/**
 * Ctrl+digit works only on kitty/csi-u, the Ctrl+K digit chord works everywhere. Default
 * bindings go up to the fifth group: Ctrl+6 is taken by alternate editor (spec decision #1).
 */
function focusGroupByIndexAction(ordinal: string, index: number, withKeys: boolean): CommandAction {
    const digit = String(index + 1);
    return {
        id: `workbench.action.focus${ordinal}EditorGroup`,
        title: `View: Focus ${ordinal} Editor Group`,
        shortTitle: `Focus ${ordinal} Editor Group`,
        ...(withKeys
            ? {
                  keybinding: { keys: parseKeybinding(`mod+${digit}`), when: EXTENDED_TIERS },
                  keybindings: [parseChord(`ctrl+k ${digit}`)],
              }
            : {}),
        run(accessor) {
            accessor.get(EditorGroupsServiceDIToken).focusGroup({ index });
        },
    };
}

export const focusFirstEditorGroupAction = focusGroupByIndexAction("First", 0, true);
export const focusSecondEditorGroupAction = focusGroupByIndexAction("Second", 1, true);
export const focusThirdEditorGroupAction = focusGroupByIndexAction("Third", 2, true);
export const focusFourthEditorGroupAction = focusGroupByIndexAction("Fourth", 3, true);
export const focusFifthEditorGroupAction = focusGroupByIndexAction("Fifth", 4, true);
export const focusSixthEditorGroupAction = focusGroupByIndexAction("Sixth", 5, false);
export const focusSeventhEditorGroupAction = focusGroupByIndexAction("Seventh", 6, false);
export const focusEighthEditorGroupAction = focusGroupByIndexAction("Eighth", 7, false);

export const focusLeftGroupAction: CommandAction = {
    id: "workbench.action.focusLeftGroup",
    title: "View: Focus Editor Group to the Left",
    keybinding: parseChord("mod+k mod+left"),
    run(accessor) {
        directionalFocus(accessor, "columns", "previous");
    },
};

export const focusRightGroupAction: CommandAction = {
    id: "workbench.action.focusRightGroup",
    title: "View: Focus Editor Group to the Right",
    keybinding: parseChord("mod+k mod+right"),
    run(accessor) {
        directionalFocus(accessor, "columns", "next");
    },
};

export const focusAboveGroupAction: CommandAction = {
    id: "workbench.action.focusAboveGroup",
    title: "View: Focus Editor Group Above",
    keybinding: parseChord("mod+k mod+up"),
    run(accessor) {
        directionalFocus(accessor, "rows", "previous");
    },
};

export const focusBelowGroupAction: CommandAction = {
    id: "workbench.action.focusBelowGroup",
    title: "View: Focus Editor Group Below",
    keybinding: parseChord("mod+k mod+down"),
    run(accessor) {
        directionalFocus(accessor, "rows", "next");
    },
};

export const navigateEditorGroupsAction: CommandAction = {
    id: "workbench.action.navigateEditorGroups",
    title: "View: Navigate Between Editor Groups",
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).focusGroup({ direction: "cycle" });
    },
};

export const focusActiveEditorGroupAction: CommandAction = {
    id: "workbench.action.focusActiveEditorGroup",
    title: "View: Focus Active Editor Group",
    run(accessor) {
        const groups = accessor.get(EditorGroupsServiceDIToken);
        groups.focusGroup(groups.activeGroup.id);
    },
};

export const moveEditorToNextGroupAction: CommandAction = {
    id: "workbench.action.moveEditorToNextGroup",
    title: "View: Move Editor into Next Group",
    when: "editorGroupHasEditors",
    keybinding: { keys: parseKeybinding("ctrl+alt+right"), when: EXTENDED_TIERS },
    // Ctrl+K ←/→ are taken by legacy word-motion fallbacks, hence the Alt chord
    // (see docs/arch/workbench/EditorPart.md).
    keybindings: [parseChord("ctrl+k alt+right")],
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).moveActiveEditorToGroup("next");
    },
};

export const moveEditorToPreviousGroupAction: CommandAction = {
    id: "workbench.action.moveEditorToPreviousGroup",
    title: "View: Move Editor into Previous Group",
    when: "editorGroupHasEditors",
    keybinding: { keys: parseKeybinding("ctrl+alt+left"), when: EXTENDED_TIERS },
    keybindings: [parseChord("ctrl+k alt+left")],
    run(accessor) {
        // The strip reads anything other than "next" as "previous": an empty string is the same step.
        // Stryker disable next-line StringLiteral: equivalent — see above
        accessor.get(EditorGroupsServiceDIToken).moveActiveEditorToGroup("previous");
    },
};

export const copyEditorToNextGroupAction: CommandAction = {
    id: "workbench.action.copyEditorToNextGroup",
    title: "View: Duplicate Editor into Next Group",
    when: "editorGroupHasEditors",
    run(accessor) {
        accessor.get(EditorServiceDIToken).copyActiveEditorToGroup("next");
    },
};

export const copyEditorToPreviousGroupAction: CommandAction = {
    id: "workbench.action.copyEditorToPreviousGroup",
    title: "View: Duplicate Editor into Previous Group",
    when: "editorGroupHasEditors",
    run(accessor) {
        accessor.get(EditorServiceDIToken).copyActiveEditorToGroup("previous");
    },
};

export const moveActiveEditorGroupLeftAction: CommandAction = {
    id: "workbench.action.moveActiveEditorGroupLeft",
    title: "View: Move Editor Group Left",
    when: "multipleEditorGroups",
    run(accessor) {
        // Stryker disable next-line StringLiteral: the strip reads anything other than "next" as "previous" — equivalent
        accessor.get(EditorGroupsServiceDIToken).moveActiveGroup("previous");
    },
};

export const moveActiveEditorGroupRightAction: CommandAction = {
    id: "workbench.action.moveActiveEditorGroupRight",
    title: "View: Move Editor Group Right",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).moveActiveGroup("next");
    },
};

export const joinTwoGroupsAction: CommandAction = {
    id: "workbench.action.joinTwoGroups",
    title: "View: Join Editor Group with Next Group",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).joinTwoGroups();
    },
};

export const joinAllGroupsAction: CommandAction = {
    id: "workbench.action.joinAllGroups",
    title: "View: Join All Editor Groups",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).joinAllGroups();
    },
};

const LOCK_ICON = codicon("lock");

/** Upstream `CLOSE_ORDER - 1`: the unlock button sits at the right end of the title. */
const UNLOCK_BUTTON_ORDER = 999_999;

/** Upstream `setEditorGroupLock`: a title bar passes its group id; the palette acts on the active group. */
function setEditorGroupLock(accessor: ServiceAccessor, locked: boolean | undefined, groupId: unknown): void {
    const groups = accessor.get(EditorGroupsServiceDIToken);
    const group = groups.groups.find((candidate) => candidate.id === groupId) ?? groups.activeGroup;
    group.lock(locked ?? !group.isLocked);
}

// Upstream also lists it in the title's "⋯" (`8_group_operations`, toggled): we have no other built-in
// `editor/title` items yet, and that one entry would put "⋯" into every group's tab row.
export const toggleEditorGroupLockAction: CommandAction = {
    id: "workbench.action.toggleEditorGroupLock",
    title: "View: Toggle Editor Group Lock",
    run(accessor, groupId) {
        setEditorGroupLock(accessor, undefined, groupId);
    },
};

// Upstream's `precondition` on the lock state is left out: our enablement is global, and it would
// disable the unlock button of an inactive locked group. Locking a locked group is a no-op anyway.
export const lockEditorGroupAction: CommandAction = {
    id: "workbench.action.lockEditorGroup",
    title: "View: Lock Editor Group",
    run(accessor, groupId) {
        setEditorGroupLock(accessor, true, groupId);
    },
};

export const unlockEditorGroupAction: CommandAction = {
    id: "workbench.action.unlockEditorGroup",
    title: "View: Unlock Editor Group",
    menus: [
        {
            menuId: MenuId.EditorTitle,
            title: "Unlock Group",
            group: "navigation",
            order: UNLOCK_BUTTON_ORDER,
            icon: LOCK_ICON,
            visible: editorTitleBarGroupLocked,
            args: editorTitleBarGroupArg,
        },
    ],
    run(accessor, groupId) {
        setEditorGroupLock(accessor, false, groupId);
    },
};

export const editorLayoutSingleAction: CommandAction = {
    id: "workbench.action.editorLayoutSingle",
    title: "View: Single Column Editor Layout",
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).joinAllGroups();
    },
};

export const toggleEditorGroupLayoutAction: CommandAction = {
    id: "workbench.action.toggleEditorGroupLayout",
    title: "View: Toggle Vertical/Horizontal Editor Layout",
    // The canonical Shift+Alt+0 only on extended tiers (in legacy, `ESC )` is
    // indistinguishable from typing the character).
    keybinding: parseChord("ctrl+k alt+0"),
    keybindings: [{ keys: parseKeybinding("shift+alt+0"), when: EXTENDED_TIERS }],
    run(accessor) {
        accessor.get(EditorPartComponentDIToken).toggleOrientation();
    },
};

export const evenEditorWidthsAction: CommandAction = {
    id: "workbench.action.evenEditorWidths",
    title: "View: Reset Editor Group Sizes",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorPartComponentDIToken).evenWeights();
    },
};

function resizeGroupAction(id: string, title: string, axis: "columns" | "rows", delta: number): CommandAction {
    return {
        id,
        title,
        when: "multipleEditorGroups",
        run(accessor) {
            const part = accessor.get(EditorPartComponentDIToken);
            if (part.orientation !== axis) return;
            part.nudgeActiveGroup(delta);
        },
    };
}

export const increaseEditorWidthAction = resizeGroupAction(
    "workbench.action.increaseEditorWidth",
    "View: Increase Editor Width",
    "columns",
    GROUP_RESIZE_STEP,
);
export const decreaseEditorWidthAction = resizeGroupAction(
    "workbench.action.decreaseEditorWidth",
    "View: Decrease Editor Width",
    "columns",
    -GROUP_RESIZE_STEP,
);
export const increaseEditorHeightAction = resizeGroupAction(
    "workbench.action.increaseEditorHeight",
    "View: Increase Editor Height",
    "rows",
    GROUP_RESIZE_STEP,
);
export const decreaseEditorHeightAction = resizeGroupAction(
    "workbench.action.decreaseEditorHeight",
    "View: Decrease Editor Height",
    "rows",
    -GROUP_RESIZE_STEP,
);

export const toggleMaximizeEditorGroupAction: CommandAction = {
    id: "workbench.action.toggleMaximizeEditorGroup",
    title: "View: Toggle Maximize Editor Group",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorPartComponentDIToken).toggleMaximizeActiveGroup();
    },
};

export const closeEditorsInGroupAction: CommandAction = {
    id: "workbench.action.closeEditorsInGroup",
    title: "View: Close All Editors in Group",
    keybinding: parseChord("mod+k w"),
    when: "editorGroupHasEditors",
    run(accessor) {
        const service = accessor.get(EditorServiceDIToken);
        void service.closeAllEditors(accessor.get(EditorGroupsServiceDIToken).activeGroup);
    },
};

export const closeEditorsAndGroupAction: CommandAction = {
    id: "workbench.action.closeEditorsAndGroup",
    title: "View: Close Editor Group",
    run(accessor) {
        // The group collapses by itself once empty.
        const service = accessor.get(EditorServiceDIToken);
        void service.closeAllEditors(accessor.get(EditorGroupsServiceDIToken).activeGroup);
    },
};

export const closeAllEditorsAction: CommandAction = {
    id: "workbench.action.closeAllEditors",
    title: "View: Close All Editors",
    shortTitle: "Close All",
    menus: [{ menuId: MenuId.EditorTitleContext, group: "1_close", order: 50 }],
    keybinding: parseChord("mod+k mod+w"),
    when: "editorGroupHasEditors",
    run(accessor) {
        const service = accessor.get(EditorServiceDIToken);
        const groups = accessor.get(EditorGroupsServiceDIToken);
        void (async () => {
            // Not by the active group: it may be empty, and an already empty group does not collapse.
            for (;;) {
                const group = groups.groups.find((candidate) => candidate.editorCount > 0);
                if (group === undefined) return;
                const done = await service.closeAllEditors(group);
                if (!done) return;
            }
        })();
    },
};

export const explorerOpenToSideAction: CommandAction = {
    id: "explorer.openToSide",
    title: "File: Open to the Side",
    // In the legacy stream Ctrl+Enter is plain Enter (0x0d), so the canonical binding sits
    // behind a tier gate and the reachable path is Alt+Enter (`ESC CR`, a separate token).
    keybinding: parseKeybinding("alt+enter"),
    keybindings: [{ keys: parseKeybinding("ctrl+enter"), when: "tier != 'legacy'" }],
    when: "filesExplorerFocus",
    run(accessor) {
        const filePath = accessor.get(ExplorerServiceDIToken).getSelectedFilePath();
        if (filePath === null) return;
        accessor.get(EditorServiceDIToken).openFile(filePath, { group: "beside" });
    },
};

export const EDITOR_GROUP_ACTIONS: readonly CommandAction[] = [
    splitEditorAction,
    splitEditorRightAction,
    splitEditorLeftAction,
    splitEditorDownAction,
    splitEditorUpAction,
    newGroupRightAction,
    newGroupLeftAction,
    newGroupBelowAction,
    newGroupAboveAction,
    focusFirstEditorGroupAction,
    focusSecondEditorGroupAction,
    focusThirdEditorGroupAction,
    focusFourthEditorGroupAction,
    focusFifthEditorGroupAction,
    focusSixthEditorGroupAction,
    focusSeventhEditorGroupAction,
    focusEighthEditorGroupAction,
    focusLeftGroupAction,
    focusRightGroupAction,
    focusAboveGroupAction,
    focusBelowGroupAction,
    navigateEditorGroupsAction,
    focusActiveEditorGroupAction,
    moveEditorToNextGroupAction,
    moveEditorToPreviousGroupAction,
    copyEditorToNextGroupAction,
    copyEditorToPreviousGroupAction,
    moveActiveEditorGroupLeftAction,
    moveActiveEditorGroupRightAction,
    joinTwoGroupsAction,
    joinAllGroupsAction,
    toggleEditorGroupLockAction,
    lockEditorGroupAction,
    unlockEditorGroupAction,
    editorLayoutSingleAction,
    toggleEditorGroupLayoutAction,
    evenEditorWidthsAction,
    increaseEditorWidthAction,
    decreaseEditorWidthAction,
    increaseEditorHeightAction,
    decreaseEditorHeightAction,
    toggleMaximizeEditorGroupAction,
    closeEditorsInGroupAction,
    closeEditorsAndGroupAction,
    closeAllEditorsAction,
    explorerOpenToSideAction,
];
