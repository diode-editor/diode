// Имена ключей — как у VS Code (https://code.visualstudio.com/api/references/when-clause-contexts):
// на них смотрят `when` стоковых расширений.

export interface ContextKeyTypes {
    /** Только **редактируемый** текст: дифф сюда не попадает — см. {@link textViewFocus}. */
    textInputFocus: boolean;
    /** Редактор ИЛИ инлайн-дифф: команды, которым нужен только `EditorViewState` (каретка, выделение, копирование). */
    textViewFocus: boolean;
    inputWidgetFocus: boolean;
    editorGroupHasEditors: boolean;
    editorTabsMultiple: boolean;
    editorHasMultipleSelections: boolean;
    editorReadonly: boolean;
    /** На `editorHas*Provider` висит видимость пунктов контекст-меню: без провайдера меню не обещает нерабочее. */
    editorHasDefinitionProvider: boolean;
    editorHasReferenceProvider: boolean;
    editorHasRenameProvider: boolean;
    editorHasCodeActionsProvider: boolean;
    editorHasDocumentFormattingProvider: boolean;
    editorHasDocumentSelectionFormattingProvider: boolean;
    editorHasSelection: boolean;
    editorLangId: string;
    /** Upstream'ское имя нашего {@link textInputFocus} — ради `when` расширений. */
    editorTextFocus: boolean;

    listFocus: boolean;

    panelVisible: boolean;
    auxiliaryBarVisible: boolean;
    auxiliaryBarFocus: boolean;
    /**
     * Пока виден список Ctrl+Tab, стрелки шагают по нему — на этом ключе висят их бинды.
     * Не `inEditorsPicker` эталона: это имя у нас занято пикером Ctrl+K Ctrl+P, а
     * переключатель — passthrough-оверлей без фокуса, не quick pick.
     */
    tabSwitcherVisible: boolean;

    /** "legacy" | "csi-u" | "kitty" */
    tier: string;
    /** "mac" | "linux" | "windows" */
    os: string;
    cap_extendedKeys: boolean;
    cap_osc52: boolean;
    cap_truecolor: boolean;
    cap_kittyGraphics: boolean;
    cap_mouseSgr: boolean;
    cap_super: boolean;
    /** 0 — не мак, 1 legacy, 2 extended, 3 cmd. Руками не сравнивать — `macKeysAtLeast` / `macKeysIs` из `macKeys.ts`. */
    macKeys: number;
    /** Свои режимы регистрируются динамически как `mode_<name>`. */
    mode_local: boolean;
    mode_ssh: boolean;
    mode_tmux: boolean;

    filesExplorerFocus: boolean;
    explorerViewletCompressedFocus: boolean;
    explorerViewletCompressedFirstFocus: boolean;
    explorerViewletCompressedLastFocus: boolean;

    findWidgetVisible: boolean;
    suggestWidgetVisible: boolean;
    editorHoverVisible: boolean;
    parameterHintsVisible: boolean;
    parameterHintsMultipleSignatures: boolean;
    inlineSuggestionVisible: boolean;
    /** Ложь, когда каретка в отступе, а подсказка начинается с отступа не меньше таба: Tab тогда отступает, а не принимает. */
    inlineSuggestionHasIndentationLessThanTabSize: boolean;
    /**
     * Не ключ VS Code: upstream отменяет запрос из своего observable-графа, нам состояние
     * нужно в `when`, чтобы Escape отменял запрос, чей ghost text ещё не появился.
     */
    inlineSuggestionRequestPending: boolean;

    terminalFocus: boolean;
    terminalIsOpen: boolean;
    terminalCount: number;
    terminalTabsFocus: boolean;
    terminalEditorFocus: boolean;
    terminalEditorActive: boolean;

    taskRunning: boolean;

    searchViewletVisible: boolean;
    searchViewletFocus: boolean;
    searchInputBoxFocus: boolean;
    firstMatchFocus: boolean;
    /** "tree" | "list" */
    searchViewMode: string;
    hasSearchResult: boolean;
    viewHasSomeCollapsibleResult: boolean;
    extensionsViewletVisible: boolean;
    referencesViewletVisible: boolean;
    hasReferenceResult: boolean;
    referencesViewHasSomeCollapsibleResult: boolean;
    scmViewletVisible: boolean;
    /** VS Code: `scmInputIsInFocus`. */
    scmInputFocus: boolean;
    resourceSelectedForCompare: boolean;
    gitHasRepo: boolean;
    gitHasRemotes: boolean;
    gitHasUpstream: boolean;
    gitMerging: boolean;
    gitRebasing: boolean;
    gitDetached: boolean;
    /** Как `operationInProgress` git-расширения VS Code: мутирующие команды гасятся через `enablement`. */
    gitOperationInProgress: boolean;
    /** Пусто — фокус не в виде. */
    focusedView: string;
    canNavigateBack: boolean;
    canNavigateForward: boolean;

    activeEditorGroupEmpty: boolean;
    /** 1-based (ViewColumn). */
    activeEditorGroupIndex: number;
    activeEditorGroupLast: boolean;
    multipleEditorGroups: boolean;

    isLinux: boolean;
    isMac: boolean;
    isWindows: boolean;

    /** `"empty"` | `"folder"` (у эталона ещё `"workspace"`). */
    workbenchState: string;

    /** Id вкладки, чьи контролы сейчас показывает шапка. */
    view: string;
    activeOutputChannel: string;
    /** Пусто, пока вторичная боковая панель скрыта. */
    activeAuxiliary: string;
}

export type ContextKey = keyof ContextKeyTypes;
