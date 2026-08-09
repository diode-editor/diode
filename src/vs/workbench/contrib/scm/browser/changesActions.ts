import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { scmSingleResource, scmSingleUriArg, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { ChangesComponentDIToken, SCM_CHANGES_VIEW_ID, SCM_VIEWLET_ID } from "./changesComponent.ts";
import { openDiffWithHead } from "./compareWithHeadAction.ts";
import { ScmInputComponentDIToken } from "./scmInputComponent.ts";

/**
 * Показать Source Control в сайдбаре (VS Code `workbench.view.scm`). У нас нет
 * activity bar, поэтому Explorer ↔ Source Control переключают команды: эта
 * подменяет контент сайдбара на список изменений (`SidebarService`) и отдаёт ему
 * фокус. Кейбинд — `ctrl+shift+g`, как у SCM-вьюлета в VS Code.
 */
export const showScmAction: CommandAction = {
    id: "workbench.view.scm",
    title: "View: Show Source Control",
    shortTitle: "Source Control",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 15 }],
    // Парно с Search (см. searchActions): аккорд работает на любом терминале,
    // канонический Ctrl+Shift+G объявлен там, где терминал способен его передать.
    keybinding: parseChord("ctrl+k g"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+g"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SCM_VIEWLET_ID);
    },
};

/**
 * Показать Source Control и поставить фокус в commit input box — VS Code
 * `workbench.scm.focus`. `workbench.view.scm` при этом по-прежнему фокусит
 * список изменений (сложившийся инвариант e2e).
 */
export const scmFocusInputAction: CommandAction = {
    id: "workbench.scm.focus",
    title: "Source Control: Focus on Source Control View",
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SCM_VIEWLET_ID, false);
        accessor.get(ScmInputComponentDIToken).focus();
    },
};

/**
 * Фокус из commit input box в список CHANGES — стрелка вниз (InputElement
 * ArrowDown не обрабатывает, событие доходит до диспетчера кейбиндов).
 * Обратно — `workbench.scm.focus`.
 */
export const scmFocusChangesAction: CommandAction = {
    id: "scm.action.focusChanges",
    title: "Source Control: Focus Changes List",
    keybinding: parseKeybinding("down"),
    when: "scmInputFocus",
    run(accessor) {
        accessor.get(ChangesComponentDIToken).focus();
    },
};

/**
 * Общий резолв цели SCM-команд: явный uri-аргумент (строкой — из пункта меню или
 * инлайн-кнопки) либо курсорная строка списка Changes (клавиатурный путь).
 */
function resolveScmUri(accessor: ServiceAccessor, rawUri: unknown): Uri | null {
    if (typeof rawUri === "string" && rawUri !== "") return Uri.parse(rawUri);
    return accessor.get(ChangesComponentDIToken).getCursorChange()?.uri ?? null;
}

/** Открыть сам файл (не дифф) — инлайн-кнопка строки, пункт меню и клавиатура. */
export const scmOpenFileAction: CommandAction = {
    id: "scm.action.openFile",
    title: "Source Control: Open File",
    shortTitle: "Open File",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "1_open",
            order: 10,
            args: scmSingleUriArg,
            visible: scmSingleResource,
        },
    ],
    run(accessor, rawUri) {
        const uri = resolveScmUri(accessor, rawUri);
        if (uri) accessor.get(EditorServiceDIToken).openUri(uri);
    },
};

/**
 * Открыть дифф изменения (активация строки и пункт меню). Файл без версии в git
 * (untracked, вне репозитория) откатывается на открытие самого файла: его полный
 * контент и есть «всё новое», а notice оставлен палитре, где файл уже открыт.
 */
export const scmOpenChangesAction: CommandAction = {
    id: "scm.action.openChanges",
    title: "Source Control: Open Changes",
    shortTitle: "Open Changes",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "1_open",
            order: 20,
            args: scmSingleUriArg,
            visible: scmSingleResource,
        },
    ],
    run(accessor, rawUri) {
        const uri = resolveScmUri(accessor, rawUri);
        if (!uri) return;
        void openDiffWithHead(accessor, uri).then((result) => {
            if (result === "no-original") accessor.get(EditorServiceDIToken).openUri(uri);
        });
    },
};

/**
 * Режим списка изменений: дерево папок (с компакцией цепочек) или плоский
 * список путей. Пара команд вместо тоггла — как у поиска и VS Code; выбор
 * персистится по-проектно. Живут и в меню «⋯» секции CHANGES
 * (`MenuId.ViewTitle`, фильтр — императивный `viewMenuVisible`).
 */
export const scmViewAsTreeAction: CommandAction = {
    id: "scm.action.viewAsTree",
    title: "Source Control: View as Tree",
    shortTitle: "View as Tree",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "1_view",
            order: 10,
            visible: viewMenuVisible(SCM_CHANGES_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(ChangesComponentDIToken).setViewMode("tree");
    },
};

export const scmViewAsListAction: CommandAction = {
    id: "scm.action.viewAsList",
    title: "Source Control: View as List",
    shortTitle: "View as List",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "1_view",
            order: 20,
            visible: viewMenuVisible(SCM_CHANGES_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(ChangesComponentDIToken).setViewMode("flat");
    },
};
