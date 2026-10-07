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
    /** True while the focused editor has more than one cursor/selection. */
    editorHasMultipleSelections: boolean;
    /** True while the focused editor is read-only (VS Code `editorReadonly`). */
    editorReadonly: boolean;
    /**
     * Есть ли у документа активного редактора провайдеры соответствующей
     * языковой фичи (upstream `editorHas*Provider`). Ключи выставляет
     * `LanguageFeatureContextKeys` по реестрам `ILanguageFeaturesService`:
     * на них висит видимость пунктов контекст-меню — без провайдера меню не
     * обещает нерабочее («Go to Definition» в .txt).
     */
    editorHasDefinitionProvider: boolean;
    editorHasReferenceProvider: boolean;
    editorHasRenameProvider: boolean;
    editorHasCodeActionsProvider: boolean;
    editorHasDocumentFormattingProvider: boolean;
    editorHasDocumentSelectionFormattingProvider: boolean;
    /** Есть ли в активном редакторе непустое выделение (upstream `editorHasSelection`). */
    editorHasSelection: boolean;
    /**
     * Язык документа активного редактора (`editorLangId == 'python'`). Имя
     * upstream'ское: на него смотрят `when` пунктов `contributes.menus` у
     * стоковых расширений.
     */
    editorLangId: string;
    /**
     * Фокус в тексте редактора — upstream'ское имя нашего {@link textInputFocus}.
     * Живёт ради `when` расширений: они пишут `editorTextFocus`, а не наши имена.
     */
    editorTextFocus: boolean;
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
    /**
     * Виден список серии Ctrl+Tab. Пока он виден, стрелки Вверх/Вниз шагают по
     * списку, а не по редактору — на этом ключе висят их бинды.
     *
     * В VS Code ту же роль играет `inEditorsPicker` поверх quick pick. Имя взято своё:
     * «editors picker» у нас уже занят пикером открытых редакторов (Ctrl+K Ctrl+P),
     * а наш переключатель — passthrough-оверлей без фокуса, не quick pick.
     */
    tabSwitcherVisible: boolean;

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
    /** «Cmd доезжает» — super-бит реально приходит (см. `macKeys.ts`). */
    cap_super: boolean;
    /**
     * Рунг мак-лестницы числом: 0 — не мак, 1 legacy, 2 extended, 3 cmd.
     * Руками не сравнивать — хелперы `macKeysAtLeast` / `macKeysIs` из `macKeys.ts`.
     */
    macKeys: number;
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
    /** True while the editor hover popup is visible. */
    editorHoverVisible: boolean;
    // suggestWidgetMultipleSuggestions: boolean;
    // renameInputVisible: boolean;
    // referenceSearchVisible: boolean;
    // inReferenceSearchEditor: boolean;
    // codeActionMenuVisible: boolean;
    /** True while the parameter hints popup is visible. */
    parameterHintsVisible: boolean;
    /** True when the shown signature help has more than one overload (arrows switch them). */
    parameterHintsMultipleSignatures: boolean;
    /** True while an inline suggestion (ghost text) is showing. */
    inlineSuggestionVisible: boolean;
    /**
     * True unless the shown inline suggestion starts with at least a tab's worth
     * of indentation while the cursor sits inside the line's indentation — then
     * Tab keeps indenting instead of accepting (VS Code semantics; default true).
     */
    inlineSuggestionHasIndentationLessThanTabSize: boolean;
    /**
     * True while an inline-suggestion request is in flight (asked, not answered
     * yet). Not a VS Code key: upstream drives cancellation from its observable
     * graph, we need the state in a `when` clause so Escape can cancel a request
     * whose ghost text has not appeared yet.
     */
    inlineSuggestionRequestPending: boolean;

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
    /** The current number of terminals. */
    terminalCount: number;
    /** Whether the terminal tabs widget is focused. */
    terminalTabsFocus: boolean;

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
    /** Показан вьюлет Extensions (магазин расширений). */
    extensionsViewletVisible: boolean;
    /** Показан вьюлет References (результат Find All References). */
    referencesViewletVisible: boolean;
    /** Есть ссылки в панели References (данные — сетит ReferencesComponent). */
    hasReferenceResult: boolean;
    /** Есть видимая развёрнутая строка в панели References — тумблер Collapse All/Expand All. */
    referencesViewHasSomeCollapsibleResult: boolean;
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
    /** `"empty"` | `"folder"` (у эталона ещё `"workspace"` — `.code-workspace`); как `workbenchState != 'empty'`. */
    workbenchState: string;
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
