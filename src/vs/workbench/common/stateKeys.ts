import type { IStateDescriptor } from "../../platform/state/common/iStateService.ts";

/**
 * UI/session state is `workspace` (docs/arch/State.md); `global` is only for user taste, not
 * project properties. Defaults duplicate the built-in `WorkbenchLayoutElement` values (30 / 12),
 * so "nothing saved" means the original behavior.
 */

export interface IOpenEditorsState {
    /** Absolute paths in tab order. */
    readonly files: readonly string[];
    /** `-1` means the group is empty. */
    readonly activeIndex: number;
}

/** In columns. */
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

/** In rows. */
export const PANEL_HEIGHT_STATE: IStateDescriptor<number> = {
    key: "workbench.panel.height",
    scope: "workspace",
    default: 12,
};

/**
 * Upstream key (`LayoutStateKeys.AUXILIARYBAR_HIDDEN`). `null` means never saved in this workspace:
 * visibility comes from `workbench.secondarySideBar.defaultVisibility`.
 */
export const AUXILIARYBAR_HIDDEN_STATE: IStateDescriptor<boolean | null> = {
    key: "workbench.auxiliaryBar.hidden",
    scope: "workspace",
    default: null,
};

/** In columns. `null` means the user never set it: the layout's dynamic default (at most a quarter of the window). */
export const AUXILIARYBAR_SIZE_STATE: IStateDescriptor<number | null> = {
    key: "workbench.auxiliaryBar.size",
    scope: "workspace",
    default: null,
};

/** Upstream key (`AuxiliaryBarPart.activeViewSettingsKey`). `""` means not saved: the first container is active. */
export const AUXILIARYBAR_ACTIVE_VIEW_STATE: IStateDescriptor<string> = {
    key: "workbench.auxiliarybar.activepanelid",
    scope: "workspace",
    default: "",
};

/** `""` means not saved: the first registered tab is active. */
export const PANEL_ACTIVE_VIEW_STATE: IStateDescriptor<string> = {
    key: "workbench.panel.activeView",
    scope: "workspace",
    default: "",
};

/** `list` is a flat list of files with matches under each file, `tree` is the directory hierarchy. */
export type SearchViewMode = "tree" | "list";

export const SEARCH_VIEW_MODE_STATE: IStateDescriptor<SearchViewMode> = {
    key: "workbench.search.viewMode",
    scope: "workspace",
    default: "list",
    // v2: the old "tree" (file → matches) became "list" and "flat" is gone, so any old value → "list".
    version: 2,
    migrate: () => "list",
};

export const SEARCH_QUERY_DETAILS_STATE: IStateDescriptor<boolean> = {
    key: "workbench.search.queryDetailsExpanded",
    scope: "workspace",
    default: false,
};

/**
 * `auto` is side-by-side, falling back to inline in a narrow pane. After "Diff: Toggle Inline View",
 * only a state reset brings `auto` back, as in VS Code.
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
     * When present, restore uses it; `files` stays for builds that don't know `editors`
     * (rollback) and for grammar warm-up.
     */
    readonly editors?: readonly ISerializedEditor[];
    /** Index into {@link editors}; `-1` means none. */
    readonly activeEditor?: number;
}

export interface ISerializedEditor {
    /** The tab factory's `typeId`. */
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
 * `null` means no snapshot: restore falls back to the flat {@link OPEN_EDITORS_STATE}. That one
 * is still written from the active group, so rolling back to an older build loses nothing.
 */
export const EDITOR_GROUPS_STATE: IStateDescriptor<IEditorGroupsState | null> = {
    key: "workbench.editors.groups",
    scope: "workspace",
    default: null,
};

export interface IViewContainerViewsState {
    /**
     * An explicit value overrides the descriptor default; a missing id means the default applies,
     * otherwise a section that defaults to collapsed would collapse on every start.
     * An array is the format of older versions: listed ids are collapsed, the rest are unknown.
     */
    readonly collapsed: Readonly<Partial<Record<string, boolean>>> | readonly string[];
    /** Height fractions; actual rows after a drag. */
    readonly weights: Readonly<Record<string, number>>;
    /** Absent in older versions' store, meaning "nothing hidden". */
    readonly hidden?: readonly string[];
    /**
     * Sections shown at save time. Only a `hideByDefault` section reads it: absent here (or in an older
     * store), it stays hidden.
     */
    readonly visible?: readonly string[];
}

export const SIDEBAR_VIEWS_STATE: IStateDescriptor<Partial<Record<string, IViewContainerViewsState>>> = {
    key: "workbench.views.state",
    scope: "workspace",
    default: {},
};

/**
 * Upstream's `IViewsCustomizations` without badges: only differences from the default. A location is
 * upstream's `ViewContainerLocationToString` string.
 */
export interface IViewsCustomizationsState {
    readonly viewContainerLocations: Readonly<Partial<Record<string, string>>>;
    readonly viewLocations: Readonly<Partial<Record<string, string>>>;
}

/** Upstream uses scope PROFILE; `workspace` is the maintainer's decision (docs/TODO/SecondarySideBar.md). */
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
