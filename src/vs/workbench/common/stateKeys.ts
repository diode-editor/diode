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

/**
 * Режим отображения результатов поиска: `list` — файлы плоским списком (матчи
 * сворачиваются под файлом), `tree` — иерархия каталогов (как в VS Code).
 */
export type SearchViewMode = "tree" | "list";

export const SEARCH_VIEW_MODE_STATE: IStateDescriptor<SearchViewMode> = {
    key: "workbench.search.viewMode",
    scope: "workspace",
    default: "list",
    // v2: семантика сменилась — прежний "tree" (файл → матчи) стал "list", а
    // "tree" теперь иерархия каталогов; старый "flat" умер. Любое старое
    // значение приводится к "list".
    version: 2,
    migrate: () => "list",
};

/** Раскрыт ли блок «files to include/exclude» панели поиска (Toggle Search Details). */
export const SEARCH_QUERY_DETAILS_STATE: IStateDescriptor<boolean> = {
    key: "workbench.search.queryDetailsExpanded",
    scope: "workspace",
    default: false,
};

/** Режим списка изменений Source Control: плоско (как VS Code list) или дерево папок. */
export type ScmViewMode = "tree" | "flat";

export const SCM_VIEW_MODE_STATE: IStateDescriptor<ScmViewMode> = {
    key: "workbench.scm.viewMode",
    scope: "workspace",
    default: "flat",
};

/**
 * Развёрнута ли панель описания в suggest-попапе (тумблер
 * `toggleSuggestionDetails`). Как в VS Code — по умолчанию свёрнута, и выбор
 * пользователя переживает рестарт. Область global: это привычка человека, а не
 * свойство проекта.
 */
export const SUGGEST_DETAILS_VISIBLE_STATE: IStateDescriptor<boolean> = {
    key: "editor.suggest.showDetails",
    scope: "global",
    default: false,
};

/** Черновик сообщения коммита (commit input box) — переживает рестарт. */
export const SCM_INPUT_MESSAGE_STATE: IStateDescriptor<string> = {
    key: "workbench.scm.inputMessage",
    scope: "workspace",
    default: "",
};

/** Открытые файлы + активная вкладка. */
export const OPEN_EDITORS_STATE: IStateDescriptor<IOpenEditorsState> = {
    key: "workbench.editors.openEditors",
    scope: "workspace",
    default: { files: [], activeIndex: -1 },
};

/** Снимок одной группы редакторов: файлы вкладок + активная (индекс в `files`). */
export interface IEditorGroupSnapshot {
    readonly files: readonly string[];
    readonly activeIndex: number;
}

/** Полоса групп редакторов: ось, группы, доли, активная группа (индекс). */
export interface IEditorGroupsState {
    readonly orientation: "columns" | "rows";
    readonly groups: readonly IEditorGroupSnapshot[];
    readonly weights: readonly number[];
    readonly activeGroup: number;
}

/**
 * Раскладка полосы групп редакторов (сплиты). `null` — снимка нет: рестор
 * падает назад на плоский {@link OPEN_EDITORS_STATE} (сессии до сплитов;
 * тот продолжает писаться плоским снимком активной группы — откат на старую
 * сборку ничего не теряет, unknown-key preservation хранит этот ключ).
 */
export const EDITOR_GROUPS_STATE: IStateDescriptor<IEditorGroupsState | null> = {
    key: "workbench.editors.groups",
    scope: "workspace",
    default: null,
};

/** Состояние view-секций одного контейнера сайдбара (см. `ViewsService`). */
export interface IViewContainerViewsState {
    /** Id свёрнутых секций. */
    readonly collapsed: readonly string[];
    /** Веса (доли высоты) секций; после drag — фактические строки. */
    readonly weights: Readonly<Record<string, number>>;
    /**
     * Id секций, скрытых пользователем через «⋯» контейнера. Поля может не
     * быть — стор прошлых версий читается как «ничего не скрыто».
     */
    readonly hidden?: readonly string[];
}

/** Свёрнутость и веса view-секций сайдбара, по контейнерам. */
export const SIDEBAR_VIEWS_STATE: IStateDescriptor<Record<string, IViewContainerViewsState>> = {
    key: "workbench.views.state",
    scope: "workspace",
    default: {},
};

/**
 * Id записей статус-бара, скрытых пользователем через контекстное меню полосы.
 *
 * Единственный `global` в этом файле — сознательное отступление от
 * «состояние UI по-проектно»: состав полосы это вкус пользователя, а не свойство
 * проекта, и VS Code хранит его так же (application-scope memento).
 */
export const STATUS_BAR_HIDDEN_STATE: IStateDescriptor<readonly string[]> = {
    key: "workbench.statusbar.hidden",
    scope: "global",
    default: [],
};
