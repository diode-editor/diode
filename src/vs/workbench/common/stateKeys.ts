import type { IStateDescriptor } from "../../platform/state/common/iStateService.ts";

/**
 * Состояние UI/сессии — `workspace` (docs/arch/State.md); `global` — только вкус
 * пользователя, а не свойство проекта. Дефолты дублируют встроенные значения
 * `WorkbenchLayoutElement` (30 / 12): «нет сохранённого» = исходное поведение.
 */

export interface IOpenEditorsState {
    /** Абсолютные пути в порядке вкладок. */
    readonly files: readonly string[];
    /** `-1` — группа пуста. */
    readonly activeIndex: number;
}

/** В колонках. */
export const SIDEBAR_WIDTH_STATE: IStateDescriptor<number> = {
    key: "workbench.sideBar.width",
    scope: "workspace",
    default: 30,
};

export const SIDEBAR_VISIBLE_STATE: IStateDescriptor<boolean> = {
    key: "workbench.sideBar.visible",
    scope: "workspace",
    default: true,
};

export const PANEL_VISIBLE_STATE: IStateDescriptor<boolean> = {
    key: "workbench.panel.visible",
    scope: "workspace",
    default: false,
};

/** В строках. */
export const PANEL_HEIGHT_STATE: IStateDescriptor<number> = {
    key: "workbench.panel.height",
    scope: "workspace",
    default: 12,
};

/**
 * Ключ эталона (`LayoutStateKeys.AUXILIARYBAR_HIDDEN`). `null` — в воркспейсе ещё не
 * сохраняли: видимость выводит `workbench.secondarySideBar.defaultVisibility`.
 */
export const AUXILIARYBAR_HIDDEN_STATE: IStateDescriptor<boolean | null> = {
    key: "workbench.auxiliaryBar.hidden",
    scope: "workspace",
    default: null,
};

/** В колонках. `null` — не задавал пользователь: динамический дефолт раскладки (не шире четверти окна). */
export const AUXILIARYBAR_SIZE_STATE: IStateDescriptor<number | null> = {
    key: "workbench.auxiliaryBar.size",
    scope: "workspace",
    default: null,
};

/** Ключ эталона (`AuxiliaryBarPart.activeViewSettingsKey`). `""` — не сохранено: активен первый контейнер. */
export const AUXILIARYBAR_ACTIVE_VIEW_STATE: IStateDescriptor<string> = {
    key: "workbench.auxiliarybar.activepanelid",
    scope: "workspace",
    default: "",
};

/** `""` — не сохранено: активна первая зарегистрированная вкладка. */
export const PANEL_ACTIVE_VIEW_STATE: IStateDescriptor<string> = {
    key: "workbench.panel.activeView",
    scope: "workspace",
    default: "",
};

/** `list` — файлы плоским списком с матчами под файлом, `tree` — иерархия каталогов. */
export type SearchViewMode = "tree" | "list";

export const SEARCH_VIEW_MODE_STATE: IStateDescriptor<SearchViewMode> = {
    key: "workbench.search.viewMode",
    scope: "workspace",
    default: "list",
    // v2: прежний "tree" (файл → матчи) стал "list", "flat" умер — любое старое значение → "list".
    version: 2,
    migrate: () => "list",
};

export const SEARCH_QUERY_DETAILS_STATE: IStateDescriptor<boolean> = {
    key: "workbench.search.queryDetailsExpanded",
    scope: "workspace",
    default: false,
};

/**
 * `auto` — side-by-side с фолбэком в inline на узкой панели. После тумблера «Diff:
 * Toggle Inline View» `auto` возвращается только сбросом стейта — как в VS Code.
 */
export type DiffViewMode = "auto" | "inline" | "side-by-side";

export const DIFF_VIEW_MODE_STATE: IStateDescriptor<DiffViewMode> = {
    key: "workbench.diff.viewMode",
    scope: "workspace",
    default: "auto",
};

export type ScmViewMode = "tree" | "flat";

export const SCM_VIEW_MODE_STATE: IStateDescriptor<ScmViewMode> = {
    key: "workbench.scm.viewMode",
    scope: "workspace",
    default: "flat",
};

export const SUGGEST_DETAILS_VISIBLE_STATE: IStateDescriptor<boolean> = {
    key: "editor.suggest.showDetails",
    scope: "global",
    default: false,
};

export const SCM_INPUT_MESSAGE_STATE: IStateDescriptor<string> = {
    key: "workbench.scm.inputMessage",
    scope: "workspace",
    default: "",
};

export const OPEN_EDITORS_STATE: IStateDescriptor<IOpenEditorsState> = {
    key: "workbench.editors.openEditors",
    scope: "workspace",
    default: { files: [], activeIndex: -1 },
};

export interface IEditorGroupSnapshot {
    readonly files: readonly string[];
    readonly activeIndex: number;
    /**
     * Есть — рестор идёт по нему; `files` остаётся для сборок, которые `editors`
     * не знают (откат), и для прогрева грамматик.
     */
    readonly editors?: readonly ISerializedEditor[];
    /** Индекс в {@link editors}; `-1` — нет. */
    readonly activeEditor?: number;
}

export interface ISerializedEditor {
    /** `typeId` фабрики вкладок. */
    readonly typeId: string;
    readonly value: string;
}

export interface IEditorGroupsState {
    readonly orientation: "columns" | "rows";
    readonly groups: readonly IEditorGroupSnapshot[];
    readonly weights: readonly number[];
    readonly activeGroup: number;
}

/**
 * `null` — снимка нет: рестор падает на плоский {@link OPEN_EDITORS_STATE}. Тот
 * продолжает писаться снимком активной группы, чтобы откат на старую сборку ничего не терял.
 */
export const EDITOR_GROUPS_STATE: IStateDescriptor<IEditorGroupsState | null> = {
    key: "workbench.editors.groups",
    scope: "workspace",
    default: null,
};

export interface IViewContainerViewsState {
    /**
     * Явное значение перебивает дефолт дескриптора, отсутствие id — действует дефолт:
     * иначе секция с дефолтом «свёрнута» сворачивалась бы на каждом старте.
     * Массив — формат прошлых версий: перечисленные свёрнуты, про остальные неизвестно.
     */
    readonly collapsed: Readonly<Partial<Record<string, boolean>>> | readonly string[];
    /** Доли высоты; после drag — фактические строки. */
    readonly weights: Readonly<Record<string, number>>;
    /** Поля нет в сторе прошлых версий — «ничего не скрыто». */
    readonly hidden?: readonly string[];
}

export const SIDEBAR_VIEWS_STATE: IStateDescriptor<Partial<Record<string, IViewContainerViewsState>>> = {
    key: "workbench.views.state",
    scope: "workspace",
    default: {},
};

/**
 * `IViewsCustomizations` эталона без бейджей: только отличия от дефолта. Место —
 * строка `ViewContainerLocationToString` эталона.
 */
export interface IViewsCustomizationsState {
    readonly viewContainerLocations: Readonly<Partial<Record<string, string>>>;
    readonly viewLocations: Readonly<Partial<Record<string, string>>>;
}

/** У эталона scope PROFILE; `workspace` — решение человека (docs/TODO/SecondarySideBar.md). */
export const VIEWS_CUSTOMIZATIONS_STATE: IStateDescriptor<IViewsCustomizationsState> = {
    key: "views.customizations",
    scope: "workspace",
    default: { viewContainerLocations: {}, viewLocations: {} },
};

export const STATUS_BAR_HIDDEN_STATE: IStateDescriptor<readonly string[]> = {
    key: "workbench.statusbar.hidden",
    scope: "global",
    default: [],
};
