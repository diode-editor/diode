/**
 * Typed context keys for when-clause evaluation.
 * Based on VS Code when-clause contexts reference:
 * https://code.visualstudio.com/api/references/when-clause-contexts
 *
 * Active keys are uncommented and used in the current codebase.
 * Commented-out keys are reserved for future use — uncomment as features are implemented.
 */

export interface ContextKeyTypes {
    // -- Editor contexts --
    // editorFocus: boolean;
    // editorTextFocus: boolean;
    /**
     * Фокус в **редактируемом** текстовом виджете. На этом ключе висит всё,
     * что осмысленно только над буфером файла: правка, фолдинг, suggest,
     * find, goto-definition. Дифф под него НЕ попадает — см. {@link textViewFocus}.
     */
    textInputFocus: boolean;
    /**
     * Фокус в любой текстовой поверхности — редакторе ИЛИ инлайн-диффе (Diode;
     * ближайший аналог в VS Code — `editorTextFocus`, который у них тоже
     * истинен в дифф-редакторе). Здесь живут команды, которым нужен только
     * `EditorViewState`: движение каретки, выделение, копирование.
     */
    textViewFocus: boolean;
    inputWidgetFocus: boolean;
    editorGroupHasEditors: boolean;
    editorTabsMultiple: boolean;
    // inputFocus: boolean;
    // editorTabMovesFocus: boolean;
    // editorHasSelection: boolean;
    /** True while the focused editor has more than one cursor/selection. */
    editorHasMultipleSelections: boolean;
    /** True while the focused editor is read-only (VS Code `editorReadonly`). */
    editorReadonly: boolean;
    // editorLangId: string;
    // isInDiffEditor: boolean;
    // isInEmbeddedEditor: boolean;

    // -- List contexts --
    listFocus: boolean;
    // listSupportsMultiselect: boolean;
    // listHasSelectionOrFocus: boolean;
    // listDoubleSelection: boolean;
    // listMultiSelection: boolean;

    // -- Workbench UI contexts --
    /** True while the bottom Panel (Problems/Output/…) is visible. */
    panelVisible: boolean;

    // -- Terminal environment contexts (see TerminalEnvironmentService) --
    /** "legacy" | "csi-u" | "kitty" — use as `tier == 'kitty'`. */
    tier: string;
    /** "mac" | "linux" | "windows" — use as `os == 'mac'`. */
    os: string;
    cap_extendedKeys: boolean;
    cap_osc52: boolean;
    cap_truecolor: boolean;
    cap_kittyGraphics: boolean;
    cap_mouseSgr: boolean;
    /** Built-in modes. Custom modes are registered dynamically as `mode_<name>`. */
    mode_local: boolean;
    mode_ssh: boolean;
    mode_tmux: boolean;

    // -- Mode contexts --
    // inSnippetMode: boolean;
    // inQuickOpen: boolean;

    // -- Resource contexts --
    // resourceScheme: string;
    // resourceFilename: string;
    // resourceExtname: string;
    // resourceDirname: string;
    // resourcePath: string;
    // resourceLangId: string;
    // isFileSystemResource: boolean;
    // resourceSet: boolean;
    // resource: string;

    // -- Explorer contexts --
    // explorerViewletVisible: boolean;
    // explorerViewletFocus: boolean;
    /** True while the Explorer file tree has keyboard focus. */
    filesExplorerFocus: boolean;
    // openEditorsFocus: boolean;
    // explorerResourceIsFolder: boolean;

    // -- Editor widget contexts --
    findWidgetVisible: boolean;
    suggestWidgetVisible: boolean;
    // suggestWidgetMultipleSuggestions: boolean;
    // renameInputVisible: boolean;
    // referenceSearchVisible: boolean;
    // inReferenceSearchEditor: boolean;
    // codeActionMenuVisible: boolean;
    // parameterHintsVisible: boolean;
    // parameterHintsMultipleSignatures: boolean;

    // -- Debugger contexts --
    // debuggersAvailable: boolean;
    // inDebugMode: boolean;
    // debugState: string;
    // debugType: string;
    // inDebugRepl: boolean;

    // -- Integrated terminal contexts --
    /** True while an integrated terminal widget has keyboard focus. */
    terminalFocus: boolean;
    /** True while at least one integrated terminal instance is open. */
    terminalIsOpen: boolean;

    // -- Global UI contexts --
    // notificationFocus: boolean;
    // notificationCenterVisible: boolean;
    // notificationToastsVisible: boolean;
    searchViewletVisible: boolean;
    /** Фокус внутри тела вьюлета Search (инпуты или список результатов). */
    searchViewletFocus: boolean;
    /** Фокус в одном из инпутов панели поиска (query/include/exclude). */
    searchInputBoxFocus: boolean;
    /** Курсор на первой строке списка результатов поиска (возврат Up в инпуты). */
    firstMatchFocus: boolean;
    /** Режим отображения результатов поиска: "tree" | "list" (данные, не фокус — сетит SearchComponent). */
    searchViewMode: string;
    /** Есть результаты у текущего поиска (данные — сетит SearchComponent). */
    hasSearchResult: boolean;
    /** Есть видимая развёрнутая строка результатов — тумблер Collapse All/Expand All. */
    viewHasSomeCollapsibleResult: boolean;
    scmViewletVisible: boolean;
    /** Фокус в commit input box вьюлета Source Control (Diode; VS Code: scmInputIsInFocus). */
    scmInputFocus: boolean;
    /** Файл отложен командой «Select for Compare» — открывает «Compare with Selected». */
    resourceSelectedForCompare: boolean;
    // -- Git repo-state (Diode: публикует ScmRepoStateService из diode.scm.publishRepoState) --
    gitHasRepo: boolean;
    gitHasRemotes: boolean;
    gitHasUpstream: boolean;
    gitMerging: boolean;
    gitRebasing: boolean;
    gitDetached: boolean;
    /**
     * Идёт git-операция, запущенная из UI (аналог `operationInProgress` в
     * git-расширении VS Code): мутирующие команды на это время гасятся через
     * `enablement`. Публикует `ScmBusyContextContribution` из `ProgressService`.
     */
    gitOperationInProgress: boolean;
    // sideBarVisible: boolean;
    // sideBarFocus: boolean;
    // panelFocus: boolean;
    // auxiliaryBarFocus: boolean;
    // inZenMode: boolean;
    // isCenteredLayout: boolean;
    // isFullscreen: boolean;
    // focusedView: string;
    /** True while there is somewhere to go back to in the navigation history. */
    canNavigateBack: boolean;
    /** True while there is somewhere to go forward to in the navigation history. */
    canNavigateForward: boolean;
    // canNavigateToLastEditLocation: boolean;

    // -- Global Editor UI contexts --
    // textCompareEditorVisible: boolean;
    // textCompareEditorActive: boolean;
    // editorIsOpen: boolean;
    // groupEditorsCount: number;
    /** True while the active editor group has no tabs. */
    activeEditorGroupEmpty: boolean;
    /** 1-based index (ViewColumn) of the active editor group. */
    activeEditorGroupIndex: number;
    /** True while the active editor group is the last in the strip. */
    activeEditorGroupLast: boolean;
    /** True while the editor area is split into more than one group. */
    multipleEditorGroups: boolean;
    // activeEditor: string;
    // activeEditorIsDirty: boolean;
    // activeEditorIsNotPreview: boolean;
    // activeEditorIsPinned: boolean;
    // inSearchEditor: boolean;

    // -- OS contexts --
    isLinux: boolean;
    isMac: boolean;
    isWindows: boolean;
    // isWeb: boolean;

    // -- Workspace contexts --
    // workbenchState: string;
    // workspaceFolderCount: number;
    // replaceActive: boolean;

    // -- View contexts --
    /** Id вкладки, чьи контролы сейчас показывает шапка (`view == 'workbench.panel.output'`). */
    view: string;
    /** Id активного канала Output (VS Code `activeOutputChannel`). */
    activeOutputChannel: string;
    // viewItem: string;
    // activeViewlet: string;
    // activePanel: string;
    // activeAuxiliary: string;
}

export type ContextKey = keyof ContextKeyTypes;
export type ContextKeyValue = ContextKeyTypes[ContextKey];

export const allContextKeys: ContextKey[] = [
    // -- Editor contexts --
    // "editorFocus",
    // "editorTextFocus",
    "textInputFocus",
    "textViewFocus",
    "inputWidgetFocus",
    "editorGroupHasEditors",
    "editorTabsMultiple",
    // "inputFocus",
    // "editorTabMovesFocus",
    // "editorHasSelection",
    "editorHasMultipleSelections",
    "editorReadonly",
    // "editorLangId",
    // "isInDiffEditor",
    // "isInEmbeddedEditor",

    // -- List contexts --
    "listFocus",
    // "listSupportsMultiselect",
    // "listHasSelectionOrFocus",
    // "listDoubleSelection",
    // "listMultiSelection",

    // -- Workbench UI contexts --
    "panelVisible",

    // -- Terminal environment contexts --
    "tier",
    "os",
    "cap_extendedKeys",
    "cap_osc52",
    "cap_truecolor",
    "cap_kittyGraphics",
    "cap_mouseSgr",
    "mode_local",
    "mode_ssh",
    "mode_tmux",

    // -- Mode contexts --
    // "inSnippetMode",
    // "inQuickOpen",

    // -- Resource contexts --
    // "resourceScheme",
    // "resourceFilename",
    // "resourceExtname",
    // "resourceDirname",
    // "resourcePath",
    // "resourceLangId",
    // "isFileSystemResource",
    // "resourceSet",
    // "resource",

    // -- Explorer contexts --
    // "explorerViewletVisible",
    // "explorerViewletFocus",
    "filesExplorerFocus",
    // "openEditorsFocus",
    // "explorerResourceIsFolder",

    // -- Editor widget contexts --
    "findWidgetVisible",
    "suggestWidgetVisible",
    // "suggestWidgetMultipleSuggestions",
    // "renameInputVisible",
    // "referenceSearchVisible",
    // "inReferenceSearchEditor",
    // "codeActionMenuVisible",
    // "parameterHintsVisible",
    // "parameterHintsMultipleSignatures",

    // -- Debugger contexts --
    // "debuggersAvailable",
    // "inDebugMode",
    // "debugState",
    // "debugType",
    // "inDebugRepl",

    // -- Integrated terminal contexts --
    "terminalFocus",
    "terminalIsOpen",

    // -- Global UI contexts --
    // "notificationFocus",
    // "notificationCenterVisible",
    // "notificationToastsVisible",
    "searchViewletVisible",
    "searchViewletFocus",
    "searchInputBoxFocus",
    "firstMatchFocus",
    "searchViewMode",
    "hasSearchResult",
    "viewHasSomeCollapsibleResult",
    "scmViewletVisible",
    "scmInputFocus",
    "resourceSelectedForCompare",
    "gitHasRepo",
    "gitHasRemotes",
    "gitHasUpstream",
    "gitMerging",
    "gitRebasing",
    "gitDetached",
    "gitOperationInProgress",
    // "sideBarVisible",
    // "sideBarFocus",
    // "panelFocus",
    // "auxiliaryBarFocus",
    // "inZenMode",
    // "isCenteredLayout",
    // "isFullscreen",
    // "focusedView",
    "canNavigateBack",
    "canNavigateForward",
    // "canNavigateToLastEditLocation",

    // -- Global Editor UI contexts --
    // "textCompareEditorVisible",
    // "textCompareEditorActive",
    // "editorIsOpen",
    // "groupEditorsCount",
    "activeEditorGroupEmpty",
    "activeEditorGroupIndex",
    "activeEditorGroupLast",
    "multipleEditorGroups",
    // "activeEditor",
    // "activeEditorIsDirty",
    // "activeEditorIsNotPreview",
    // "activeEditorIsPinned",
    // "inSearchEditor",

    // -- OS contexts --
    "isLinux",
    "isMac",
    "isWindows",
    // "isWeb",

    // -- Workspace contexts --
    // "workbenchState",
    // "workspaceFolderCount",
    // "replaceActive",

    // -- View contexts --
    "view",
    "activeOutputChannel",
    // "viewItem",
    // "activeViewlet",
    // "activePanel",
    // "activeAuxiliary",
];

/**
 * Dynamically registered context-key names (not in the typed {@link ContextKeyTypes}).
 * Used for user-defined custom modes (`mode_<name>`) declared in config — they must be
 * known to the `when`-evaluator before any binding referencing them is evaluated.
 */
const dynamicContextKeys: string[] = [];

/**
 * Bumped whenever the set of known names grows. Consumers that compile
 * `when`-expressions against this set (see `ContextKeyService.evaluate`) key
 * their cache on it: a compiled function bakes in the parameter list, so a
 * stale one would silently evaluate a later-registered key as `undefined`.
 */
let contextKeyNamesVersion = 0;

/** Version of the known-names set — cache key for compiled `when`-expressions. */
export function getContextKeyNamesVersion(): number {
    return contextKeyNamesVersion;
}

/** Register extra context-key identifiers (e.g. custom-mode `mode_<name>`). Idempotent. */
export function registerContextKeys(names: readonly string[]): void {
    for (const name of names) {
        if (!(allContextKeys as readonly string[]).includes(name) && !dynamicContextKeys.includes(name)) {
            dynamicContextKeys.push(name);
            contextKeyNamesVersion++;
        }
    }
}

/** All context-key identifiers known to the `when`-evaluator (built-in + dynamic). */
export function getAllContextKeyNames(): string[] {
    return [...allContextKeys, ...dynamicContextKeys];
}
