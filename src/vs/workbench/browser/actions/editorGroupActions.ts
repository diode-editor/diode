import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ILogServiceDIToken } from "../../../platform/log/common/iLogServiceDIToken.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { EditorPartComponentDIToken } from "../parts/editor/editorPartComponent.ts";

/** Kitty/CSI-u — единственные tier'ы, где Ctrl+цифра доходит до приложения. */
const EXTENDED_TIERS = "tier == 'kitty' || tier == 'csi-u'";

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
];
