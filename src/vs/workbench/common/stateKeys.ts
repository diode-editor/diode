import type { IStateDescriptor } from "../../platform/state/common/iStateService.ts";

/**
 * Реестр дескрипторов машинного состояния — «инструкция», какие свойства у
 * каждого сохраняемого значения (ключ, scope, дефолт, версия). Параллель
 * `ContextKeys.ts`. Потребители — {@link WorkbenchStateService} (открытые
 * редакторы) и {@link LayoutService} (layout); движок и правила —
 * docs/arch/State.md.
 *
 * Scope по решению: всё состояние UI/сессии — **`workspace`** (по-проектно), с
 * fallback на `global`-стор, когда проект не открыт. Дефолты дублируют встроенные
 * значения `WorkbenchLayoutElement` (30 / 12), чтобы «нет сохранённого значения»
 * воспроизводило исходное поведение.
 */

/** Снимок открытых редакторов группы. */
export interface IOpenEditorsState {
    /** Абсолютные пути открытых файлов в позиционном порядке вкладок. */
    readonly files: readonly string[];
    /** Индекс активной вкладки в `files` (или -1, если группа пуста). */
    readonly activeIndex: number;
}

/** Ширина сайдбара (explorer) в колонках. */
export const SIDEBAR_WIDTH_STATE: IStateDescriptor<number> = {
    key: "workbench.sideBar.width",
    scope: "workspace",
    default: 30,
};

/** Видимость сайдбара. */
export const SIDEBAR_VISIBLE_STATE: IStateDescriptor<boolean> = {
    key: "workbench.sideBar.visible",
    scope: "workspace",
    default: true,
};

/** Видимость нижней панели (Problems/Output/…). */
export const PANEL_VISIBLE_STATE: IStateDescriptor<boolean> = {
    key: "workbench.panel.visible",
    scope: "workspace",
    default: false,
};

/** Высота нижней панели в строках. */
export const PANEL_HEIGHT_STATE: IStateDescriptor<number> = {
    key: "workbench.panel.height",
    scope: "workspace",
    default: 12,
};

/**
 * Активная вкладка нижней панели (id view'а). Пустая строка — «не сохранено»,
 * тогда активной остаётся первая зарегистрированная вкладка.
 */
export const PANEL_ACTIVE_VIEW_STATE: IStateDescriptor<string> = {
    key: "workbench.panel.activeView",
    scope: "workspace",
    default: "",
};

/** Режим отображения результатов поиска: дерево (сворачиваемые группы) или плоско. */
export type SearchViewMode = "tree" | "flat";

export const SEARCH_VIEW_MODE_STATE: IStateDescriptor<SearchViewMode> = {
    key: "workbench.search.viewMode",
    scope: "workspace",
    default: "tree",
};

/** Режим списка изменений Source Control: плоско (как VS Code list) или дерево папок. */
export type ScmViewMode = "tree" | "flat";

export const SCM_VIEW_MODE_STATE: IStateDescriptor<ScmViewMode> = {
    key: "workbench.scm.viewMode",
    scope: "workspace",
    default: "flat",
};

/** Открытые файлы + активная вкладка. */
export const OPEN_EDITORS_STATE: IStateDescriptor<IOpenEditorsState> = {
    key: "workbench.editors.openEditors",
    scope: "workspace",
    default: { files: [], activeIndex: -1 },
};

/** Состояние view-секций одного контейнера сайдбара (см. `ViewsService`). */
export interface IViewContainerViewsState {
    /** Id свёрнутых секций. */
    readonly collapsed: readonly string[];
    /** Веса (доли высоты) секций; после drag — фактические строки. */
    readonly weights: Readonly<Record<string, number>>;
}

/** Свёрнутость и веса view-секций сайдбара, по контейнерам. */
export const SIDEBAR_VIEWS_STATE: IStateDescriptor<Record<string, IViewContainerViewsState>> = {
    key: "workbench.views.state",
    scope: "workspace",
    default: {},
};
