// Key names match VS Code (https://code.visualstudio.com/api/references/when-clause-contexts):
// stock extensions' `when` clauses rely on them.

export interface ContextKeyTypes {
    /** **Editable** text only: diffs are excluded, see {@link textViewFocus}. */
    textInputFocus: boolean;
    /** Editor OR inline diff: for commands that need only `EditorViewState` (cursor, selection, copy). */
    textViewFocus: boolean;
    inputWidgetFocus: boolean;
    editorGroupHasEditors: boolean;
    /** Focus anywhere in the editor area: any group, any tab kind (upstream name). */
    editorAreaFocus: boolean;
    editorTabsMultiple: boolean;
    editorHasMultipleSelections: boolean;
    editorReadonly: boolean;
    /** Context menu item visibility hangs on `editorHas*Provider`: without a provider the menu does not offer what cannot work. */
    editorHasDefinitionProvider: boolean;
    editorHasImplementationProvider: boolean;
    editorHasTypeDefinitionProvider: boolean;
    editorHasDeclarationProvider: boolean;
    editorHasReferenceProvider: boolean;
    editorHasCallHierarchyProvider: boolean;
    editorHasTypeHierarchyProvider: boolean;
    editorHasRenameProvider: boolean;
    editorHasCodeActionsProvider: boolean;
    editorHasCodeLensProvider: boolean;
    editorHasDocumentFormattingProvider: boolean;
    editorHasDocumentSelectionFormattingProvider: boolean;
    editorHasInlayHintsProvider: boolean;
    editorHasSelection: boolean;
    /** Upstream `ctxHasWordHighlights`: the active editor has occurrences on the frame. */
    hasWordHighlights: boolean;
    /** Upstream `CONTEXT_ONTYPE_RENAME_INPUT_VISIBLE`: the active editor has linked ranges on the frame. */
    LinkedEditingInputVisible: boolean;
    editorLangId: string;
    /** Upstream name of our {@link textInputFocus}, kept for extension `when` clauses. */
    editorTextFocus: boolean;

    listFocus: boolean;

    panelVisible: boolean;
    auxiliaryBarVisible: boolean;
    auxiliaryBarFocus: boolean;
    /**
     * While the Ctrl+Tab list is visible, arrows step through it; their bindings hang on this key.
     * Not upstream `inEditorsPicker`: that name is taken here by the Ctrl+K Ctrl+P picker, and
     * the switcher is a passthrough overlay without focus, not a quick pick.
     */
    tabSwitcherVisible: boolean;
    /** Our Quick Open picker (files, commands, go to line, editors) is visible; not QuickInputService prompts. */
    inQuickOpen: boolean;
    /** Quick Open shows the files picker (no prefix): Ctrl+P / Ctrl+E step through it. */
    inFilesPicker: boolean;
    /** Quick Open shows the symbols of the active editor (`@`). */
    inFileSymbolsPicker: boolean;

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
    /** 0 not mac, 1 legacy, 2 extended, 3 cmd. Do not compare by hand; use `macKeysAtLeast` / `macKeysIs` from `macKeys.ts`. */
    macKeys: number;
    /** Custom modes are registered dynamically as `mode_<name>`. */
    mode_local: boolean;
    mode_ssh: boolean;
    mode_tmux: boolean;

    filesExplorerFocus: boolean;
    /** Focus is inside the OPEN EDITORS section. */
    openEditorsFocus: boolean;
    explorerViewletCompressedFocus: boolean;
    explorerViewletCompressedFirstFocus: boolean;
    explorerViewletCompressedLastFocus: boolean;

    findWidgetVisible: boolean;
    suggestWidgetVisible: boolean;
    editorHoverVisible: boolean;
    parameterHintsVisible: boolean;
    parameterHintsMultipleSignatures: boolean;
    inlineSuggestionVisible: boolean;
    /** False when the cursor is in indentation and the suggestion starts with at least a tab of indentation: Tab then indents instead of accepting. */
    inlineSuggestionHasIndentationLessThanTabSize: boolean;
    /**
     * Not a VS Code key: upstream cancels the request from its observable graph, but we need
     * the state in `when` so Escape cancels a request whose ghost text has not appeared yet.
     */
    inlineSuggestionRequestPending: boolean;

    terminalFocus: boolean;
    terminalIsOpen: boolean;
    /** Upstream key: a terminal was created in this window, even if all are closed since. */
    terminalHasBeenCreated: boolean;
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
    /**
     * Not a VS Code key (upstream computes the action's `enabled`): `Install Specific Version of Extension...` has
     * something to list. Before the catalog is read, any installed extension counts.
     */
    extensionsCanInstallSpecificVersion: boolean;
    /** Upstream `HasOutdatedExtensionsContext`: by the last catalog read, false until the first one. */
    hasOutdatedExtensions: boolean;
    referencesViewletVisible: boolean;
    hasReferenceResult: boolean;
    referencesViewHasSomeCollapsibleResult: boolean;
    /** "incoming" | "outgoing"; the title button shows the current direction. */
    callHierarchyMode: string;
    /** The tree section is registered in the References container. */
    callHierarchyVisible: boolean;
    /** "subtypes" | "supertypes"; the title button shows the current direction. */
    typeHierarchyMode: string;
    /** The hierarchy section of the References container holds a type tree. */
    typeHierarchyVisible: boolean;
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
    /** Like `operationInProgress` of the VS Code git extension: mutating commands are disabled via `enablement`. */
    gitOperationInProgress: boolean;
    /** Empty when focus is not in a view. */
    focusedView: string;
    canNavigateBack: boolean;
    canNavigateForward: boolean;

    activeEditorGroupEmpty: boolean;
    /** 1-based (ViewColumn). */
    activeEditorGroupIndex: number;
    activeEditorGroupLast: boolean;
    activeEditorGroupLocked: boolean;
    multipleEditorGroups: boolean;

    isLinux: boolean;
    isMac: boolean;
    isWindows: boolean;

    /** `"empty"` | `"folder"` (upstream also has `"workspace"`). */
    workbenchState: string;
    /** Always `true`: no trust model, matches `workspace.isTrusted`. */
    isWorkspaceTrusted: boolean;

    /** Id of the tab whose controls the header currently shows. */
    view: string;
    activeOutputChannel: string;
    /** Empty while the secondary sidebar is hidden. */
    activeAuxiliary: string;
}

export type ContextKey = keyof ContextKeyTypes;
