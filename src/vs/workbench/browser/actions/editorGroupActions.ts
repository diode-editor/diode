import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ILogServiceDIToken } from "../../../platform/log/common/iLogServiceDIToken.ts";
import { ExplorerServiceDIToken } from "../../contrib/files/browser/explorerService.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import { EditorPartComponentDIToken } from "../parts/editor/editorPartComponent.ts";
import { TextEditorPane } from "../parts/editor/textEditorPane.ts";

/** Kitty/CSI-u — единственные tier'ы, где Ctrl+цифра доходит до приложения. */
const EXTENDED_TIERS = "tier == 'kitty' || tier == 'csi-u'";

/** Шаг команд Increase/Decrease Editor Width/Height, в ячейках (как у сайдбара). */
const GROUP_RESIZE_STEP = 3;

/**
 * Приводит ось полосы к нужной для направленного сплита (`Split Editor Up` в
 * колоночной полосе): единственная группа — ось просто меняется (VS Code так же
 * превращает первую вертикаль в горизонталь); полоса уже разложена — отказ с
 * записью в лог (одна ось — решение постановки №2).
 */
function ensureAxis(accessor: ServiceAccessor, wanted: "columns" | "rows"): boolean {
    const part = accessor.get(EditorPartComponentDIToken);
    const service = accessor.get(EditorServiceDIToken);
    if (part.orientation === wanted) return true;
    if (service.groups.length === 1) {
        part.orientation = wanted;
        return true;
    }
    accessor
        .get(ILogServiceDIToken)
        .createLogger("workbench.editorGroups")
        .info(`split refused — strip axis is ${part.orientation}, wanted ${wanted}`);
    return false;
}

function directionalSplit(
    accessor: ServiceAccessor,
    axis: "columns" | "rows",
    position: "before" | "after",
): void {
    if (!ensureAxis(accessor, axis)) return;
    accessor.get(EditorServiceDIToken).splitActiveGroup({ position });
}

function directionalNewGroup(
    accessor: ServiceAccessor,
    axis: "columns" | "rows",
    position: "before" | "after",
): void {
    if (!ensureAxis(accessor, axis)) return;
    accessor.get(EditorServiceDIToken).newGroup(position);
}

/** Фокус соседней группы вдоль оси полосы; поперёк оси — no-op (US-10). */
function directionalFocus(accessor: ServiceAccessor, axis: "columns" | "rows", direction: "next" | "previous"): void {
    const part = accessor.get(EditorPartComponentDIToken);
    if (part.orientation !== axis) return;
    accessor.get(EditorServiceDIToken).focusGroup({ direction });
}

// ─── Разбиение ────────────────────────────────────────────────────────────────

export const splitEditorAction: CommandAction = {
    id: "workbench.action.splitEditor",
    title: "View: Split Editor",
    shortTitle: "Split Editor",
    // 0x1C (FS) — единственный «сплитовый» бинд, доходящий на любом tier.
    keybinding: parseKeybinding("ctrl+\\"),
    when: "editorGroupHasEditors",
    run(accessor) {
        accessor.get(EditorServiceDIToken).splitActiveGroup();
    },
};

export const splitEditorRightAction: CommandAction = {
    id: "workbench.action.splitEditorRight",
    title: "View: Split Editor Right",
    when: "editorGroupHasEditors",
    run(accessor) {
        directionalSplit(accessor, "columns", "after");
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
    when: "editorGroupHasEditors",
    run(accessor) {
        directionalSplit(accessor, "rows", "after");
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

// ─── Фокус групп ─────────────────────────────────────────────────────────────

/**
 * Фабрика «фокус N-й группы»: Ctrl+цифра на kitty/csi-u (на legacy неотличим
 * от прочего ввода) + чорд Ctrl+K цифра — работает везде. Дефолтные бинды —
 * только до пятой группы; Ctrl+6 занят alternate editor (решение постановки №1).
 */
function focusGroupByIndexAction(ordinal: string, index: number, withKeys: boolean): CommandAction {
    const digit = String(index + 1);
    return {
        id: `workbench.action.focus${ordinal}EditorGroup`,
        title: `View: Focus ${ordinal} Editor Group`,
        shortTitle: `Focus ${ordinal} Editor Group`,
        ...(withKeys
            ? {
                  keybinding: { keys: parseKeybinding(`ctrl+${digit}`), when: EXTENDED_TIERS },
                  keybindings: [parseChord(`ctrl+k ${digit}`)],
              }
            : {}),
        run(accessor) {
            accessor.get(EditorServiceDIToken).focusGroup({ index });
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
    keybinding: parseChord("ctrl+k ctrl+left"),
    run(accessor) {
        directionalFocus(accessor, "columns", "previous");
    },
};

export const focusRightGroupAction: CommandAction = {
    id: "workbench.action.focusRightGroup",
    title: "View: Focus Editor Group to the Right",
    keybinding: parseChord("ctrl+k ctrl+right"),
    run(accessor) {
        directionalFocus(accessor, "columns", "next");
    },
};

export const focusAboveGroupAction: CommandAction = {
    id: "workbench.action.focusAboveGroup",
    title: "View: Focus Editor Group Above",
    keybinding: parseChord("ctrl+k ctrl+up"),
    run(accessor) {
        directionalFocus(accessor, "rows", "previous");
    },
};

export const focusBelowGroupAction: CommandAction = {
    id: "workbench.action.focusBelowGroup",
    title: "View: Focus Editor Group Below",
    keybinding: parseChord("ctrl+k ctrl+down"),
    run(accessor) {
        directionalFocus(accessor, "rows", "next");
    },
};

export const navigateEditorGroupsAction: CommandAction = {
    id: "workbench.action.navigateEditorGroups",
    title: "View: Navigate Between Editor Groups",
    run(accessor) {
        accessor.get(EditorServiceDIToken).focusGroup({ direction: "cycle" });
    },
};

export const focusActiveEditorGroupAction: CommandAction = {
    id: "workbench.action.focusActiveEditorGroup",
    title: "View: Focus Active Editor Group",
    run(accessor) {
        const service = accessor.get(EditorServiceDIToken);
        service.focusGroup(service.activeGroup.id);
    },
};

// ─── Перенос вкладок и групп ─────────────────────────────────────────────────

export const moveEditorToNextGroupAction: CommandAction = {
    id: "workbench.action.moveEditorToNextGroup",
    title: "View: Move Editor into Next Group",
    when: "editorGroupHasEditors",
    keybinding: { keys: parseKeybinding("ctrl+alt+right"), when: EXTENDED_TIERS },
    // Ctrl+K ←/→ заняты word-motion-фолбэками legacy — чорд с Alt (см. EditorGroups.md).
    keybindings: [parseChord("ctrl+k alt+right")],
    run(accessor) {
        accessor.get(EditorServiceDIToken).moveActiveEditorToGroup("next");
    },
};

export const moveEditorToPreviousGroupAction: CommandAction = {
    id: "workbench.action.moveEditorToPreviousGroup",
    title: "View: Move Editor into Previous Group",
    when: "editorGroupHasEditors",
    keybinding: { keys: parseKeybinding("ctrl+alt+left"), when: EXTENDED_TIERS },
    keybindings: [parseChord("ctrl+k alt+left")],
    run(accessor) {
        accessor.get(EditorServiceDIToken).moveActiveEditorToGroup("previous");
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
        accessor.get(EditorServiceDIToken).moveActiveGroup("previous");
    },
};

export const moveActiveEditorGroupRightAction: CommandAction = {
    id: "workbench.action.moveActiveEditorGroupRight",
    title: "View: Move Editor Group Right",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorServiceDIToken).moveActiveGroup("next");
    },
};

export const joinTwoGroupsAction: CommandAction = {
    id: "workbench.action.joinTwoGroups",
    title: "View: Join Editor Group with Next Group",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorServiceDIToken).joinTwoGroups();
    },
};

export const joinAllGroupsAction: CommandAction = {
    id: "workbench.action.joinAllGroups",
    title: "View: Join All Editor Groups",
    when: "multipleEditorGroups",
    run(accessor) {
        accessor.get(EditorServiceDIToken).joinAllGroups();
    },
};

export const editorLayoutSingleAction: CommandAction = {
    id: "workbench.action.editorLayoutSingle",
    title: "View: Single Column Editor Layout",
    run(accessor) {
        accessor.get(EditorServiceDIToken).joinAllGroups();
    },
};

// ─── Раскладка и размер ──────────────────────────────────────────────────────

export const toggleEditorGroupLayoutAction: CommandAction = {
    id: "workbench.action.toggleEditorGroupLayout",
    title: "View: Toggle Vertical/Horizontal Editor Layout",
    keybinding: { keys: parseKeybinding("shift+alt+0"), when: EXTENDED_TIERS },
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

/** Фабрика resize-команд: ширина валидна в колоночной полосе, высота — в рядной. */
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

// ─── Закрытие ────────────────────────────────────────────────────────────────

/**
 * Последовательно закрывает вкладки группы с confirm-диалогом по каждому
 * несохранённому документу (последняя вкладка документа). Cancel прерывает всю
 * серию (US-48/49-семантика quit-флоу). Возвращает true, если группа закрыта
 * целиком.
 */
async function closeGroupEditorsWithConfirm(
    accessor: ServiceAccessor,
    service: EditorService,
    group: EditorGroup,
): Promise<boolean> {
    const dialogs = accessor.get(DialogServiceDIToken);
    while (group.editorCount > 0) {
        const index = group.editorCount - 1;
        const pane = group.getPane(index);
        /* v8 ignore next -- editorCount > 0 гарантирует вкладку */
        if (pane === null) return false;
        const needsConfirm =
            pane.isModified && (!(pane instanceof TextEditorPane) || service.isLastPaneForDocument(pane));
        if (needsConfirm && pane instanceof TextEditorPane) {
            const choice = await dialogs.confirmSave(service.displayName(pane));
            if (choice === "cancel") return false;
            if (choice === "save") await pane.save({ overwrite: true });
        }
        group.closeTab(index);
    }
    return true;
}

export const closeEditorsInGroupAction: CommandAction = {
    id: "workbench.action.closeEditorsInGroup",
    title: "View: Close All Editors in Group",
    keybinding: parseChord("ctrl+k w"),
    when: "editorGroupHasEditors",
    run(accessor) {
        const service = accessor.get(EditorServiceDIToken);
        void closeGroupEditorsWithConfirm(accessor, service, service.activeGroup);
    },
};

export const closeEditorsAndGroupAction: CommandAction = {
    id: "workbench.action.closeEditorsAndGroup",
    title: "View: Close Editor Group",
    run(accessor) {
        // Схлопывание группы — следствие опустения; отдельного сноса не нужно.
        const service = accessor.get(EditorServiceDIToken);
        void closeGroupEditorsWithConfirm(accessor, service, service.activeGroup);
    },
};

export const closeAllEditorsAction: CommandAction = {
    id: "workbench.action.closeAllEditors",
    title: "View: Close All Editors",
    keybinding: parseChord("ctrl+k ctrl+w"),
    when: "editorGroupHasEditors",
    run(accessor) {
        const service = accessor.get(EditorServiceDIToken);
        void (async () => {
            // Идём по группам с вкладками (не по активной: она может быть пустой,
            // а пустая группа не схлопывается сама — уже-пустое не «опустело»).
            // Cancel в любом диалоге прерывает серию.
            for (;;) {
                const group = service.groups.find((candidate) => candidate.editorCount > 0);
                if (group === undefined) return;
                const done = await closeGroupEditorsWithConfirm(accessor, service, group);
                if (!done) return;
            }
        })();
    },
};

// ─── Open to the Side ────────────────────────────────────────────────────────

export const explorerOpenToSideAction: CommandAction = {
    id: "explorer.openToSide",
    title: "File: Open to the Side",
    keybinding: parseKeybinding("ctrl+enter"),
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
