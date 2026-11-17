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
    /** Upstream `SnippetController2.InSnippetMode`: the active editor has a snippet session. */
    inSnippetMode: boolean;
    /** Upstream `SnippetController2.HasNextTabstop`. */
    hasNextTabstop: boolean;
    /** Upstream `SnippetController2.HasPrevTabstop`: the session is past its first tab stop. */
    hasPrevTabstop: boolean;
    /** Upstream `SnippetController2.InSnippetChoice`: the session's current tab stop is a choice. */
    inSnippetChoice: boolean;
    editorLangId: string;
    /** Upstream name of our {@link textInputFocus}, kept for extension `when` clauses. */
    editorTextFocus: boolean;
    /**
     * Upstream `ResourceContextKey` of the editor group: the active editor's resource while the focus is in the
     * editor area, unset elsewhere. Extension keybindings and editor menus gate on them (`resourceLangId == cpp`).
     */
    resource: string;
    resourceScheme: string;
    resourceFilename: string;
    resourceDirname: string;
    resourcePath: string;
    resourceLangId: string;
    resourceExtname: string;
    resourceSet: boolean;

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
    /** Quick Open shows the symbols of the workspace (`#`). */
    inWorkspaceSymbolsPicker: boolean;

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
    /** Upstream key: the active terminal (in the panel or an editor tab) has a text selection. */
    terminalTextSelected: boolean;
    /** Upstream key: the focused terminal has a text selection. */
    terminalTextSelectedInFocused: boolean;

    taskRunning: boolean;

    /** Upstream `TestingContextKeys`: test controllers registered by extensions. */
    "testing.providerCount": number;
    /** Some controller has a `refreshHandler`. */
    "testing.canRefresh": boolean;
    "testing.isRefreshing": boolean;
    /** Some controller has a `Run` profile. */
    "testing.hasRunnableTests": boolean;
    /** Always `false`: no debugger (owner's decision), Debug profiles are kept but not offered. */
    "testing.hasDebuggableTests": boolean;
    /** Always `false`: coverage is a later wave, Coverage profiles are kept but not offered. */
    "testing.hasCoverableTests": boolean;
    /** Some test run is going on. */
    "testing.isRunning": boolean;
    /** Some test run is kept: the reruns have something to repeat. */
    "testing.hasAnyResults": boolean;
    /** The active text editor's file has tests. */
    "testing.activeEditorHasTests": boolean;
    /** The active text editor's cursor is inside the range of one of its tests. */
    "testing.cursorInsideTestRange": boolean;
    /** Upstream `TestExplorerViewSorting`: "status" | "location" | "duration". */
    "testing.explorerViewSorting": string;
    /** A Test Explorer row's menu (`MenuId.TestItem`) only: the test's own id, the last segment of its path. */
    testId: string;
    /** A Test Explorer row's menu only: the controller the test belongs to. */
    controllerId: string;
    /** A Test Explorer row's menu only: the test has a `uri`, Go to Test has somewhere to go. */
    "testing.testItemHasUri": boolean;
    /** A test message's menus only: the message's `contextValue`. */
    testMessage: string;
    /** A test message's menus only: the run has been retired by a newer one; ours are never, so `false`. */
    testResultOutdated: boolean;
    /** The message shown in TEST RESULTS has a stack trace: Collapse Stack Frames has something to do. */
    "testing.peekHasStack": boolean;

    /** Upstream `CONTEXT_*` keys of `contrib/debug/common/debug.ts`, with their descriptions. */
    /** Debug type of the active debug session. For example 'python'. */
    debugType: string;
    /** Debug type of the selected launch configuration. For example 'python'. */
    debugConfigurationType: string;
    /** State that the focused debug session is in. One of the following: 'inactive', 'initializing', 'stopped' or 'running'. */
    debugState: string;
    /** Debug UX state. When there are no debug configurations it is 'simple', otherwise 'default'. Used to decide when to show welcome views in the debug viewlet. */
    debugUx: string;
    /** True when a debug session has been started at least once, false otherwise. */
    hasDebugged: boolean;
    /** True when debugging, false otherwise. */
    inDebugMode: boolean;
    /** True when focus is in the debug console, false otherwise. */
    inDebugRepl: boolean;
    /** True when breakpoint editor zone widget is visible, false otherwise. */
    breakpointWidgetVisible: boolean;
    /** True when focus is in the breakpoint editor zone widget, false otherwise. */
    inBreakpointWidget: boolean;
    /** True when the BREAKPOINTS view is focused, false otherwise. */
    breakpointsFocused: boolean;
    /** True when the WATCH view is focused, false otherwise. */
    watchExpressionsFocused: boolean;
    /** True when at least one watch expression exists, false otherwise. */
    watchExpressionsExist: boolean;
    /** True when the VARIABLES views is focused, false otherwise */
    variablesFocused: boolean;
    /** True when an expression input box is open in either the WATCH or the VARIABLES view, false otherwise. */
    expressionSelected: boolean;
    /** True when the input box has focus in the BREAKPOINTS view. */
    breakpointInputFocused: boolean;
    /** Represents the item type of the focused element in the CALL STACK view. For example: 'session', 'thread', 'stackFrame' */
    callStackItemType: string;
    /** True when the session in the CALL STACK view is attach, false otherwise. Used internally for inline menus in the CALL STACK view. */
    callStackSessionIsAttach: boolean;
    /** True when the focused item in the CALL STACK is stopped. Used internally for inline menus in the CALL STACK view. */
    callStackItemStopped: boolean;
    /** True when the focused session in the CALL STACK view has exactly one thread. Used internally for inline menus in the CALL STACK view. */
    callStackSessionHasOneThread: boolean;
    /** True when the CALLSTACK view is focused, false otherwise. */
    callStackFocused: boolean;
    /** Represents the item type of the focused element in the WATCH view. For example: 'expression', 'variable' */
    watchItemType: string;
    /** Indicates whether the item in the view has an associated memory reference. */
    canViewMemory: boolean;
    /** Represents the item type of the focused element in the BREAKPOINTS view. For example: 'breakpoint', 'exceptionBreakpoint', 'functionBreakpoint', 'dataBreakpoint' */
    breakpointItemType: string;
    /** Whether the breakpoint item is a data breakpoint on a byte range. */
    breakpointItemBytes: boolean;
    /** Whether the breakpoint has multiple modes it can switch to. */
    breakpointHasModes: boolean;
    /** True when the focused breakpoint supports conditions. */
    breakpointSupportsCondition: boolean;
    /** True when the focused sessions supports the LOADED SCRIPTS view */
    loadedScriptsSupported: boolean;
    /** Represents the item type of the focused element in the LOADED SCRIPTS view. */
    loadedScriptsItemType: string;
    /** True when the focused session is 'attach'. */
    focusedSessionIsAttach: boolean;
    /** True when the focused session is run without debugging. */
    focusedSessionIsNoDebug: boolean;
    /** True when the focused session supports 'stepBack' requests. */
    stepBackSupported: boolean;
    /** True when the focused session supports 'restartFrame' requests. */
    restartFrameSupported: boolean;
    /** True when the focused stack frame supports 'restartFrame'. */
    stackFrameSupportsRestart: boolean;
    /** True when the focused session supports 'jumpToCursor' request. */
    jumpToCursorSupported: boolean;
    /** True when the focused session supports 'stepIntoTargets' request. */
    stepIntoTargetsSupported: boolean;
    /** True when at least one breakpoint exists. */
    breakpointsExist: boolean;
    /** True when there is at least one debug extensions active. */
    debuggersAvailable: boolean;
    /** True when there is at least one debug extension installed and enabled. */
    debugExtensionAvailable: boolean;
    /** Represents the context the debug adapter sets on the focused variable in the VARIABLES view. */
    debugProtocolVariableMenuContext: string;
    /** True when the focused session supports 'setVariable' request. */
    debugSetVariableSupported: boolean;
    /** True when the focused session supports 'getBreakpointInfo' request on an address. */
    debugSetDataBreakpointAddressSupported: boolean;
    /** True when the focused session supports 'setExpression' request. */
    debugSetExpressionSupported: boolean;
    /** True when the focused session supports to break when value changes. */
    breakWhenValueChangesSupported: boolean;
    /** True when the focused breakpoint supports to break when value is accessed. */
    breakWhenValueIsAccessedSupported: boolean;
    /** True when the focused breakpoint supports to break when value is read. */
    breakWhenValueIsReadSupported: boolean;
    /** True when the focused session supports the terminate debuggee capability. */
    terminateDebuggeeSupported: boolean;
    /** True when the focused session supports the suspend debuggee capability. */
    suspendDebuggeeSupported: boolean;
    /** True when the focused session supports the terminate threads capability. */
    terminateThreadsSupported: boolean;
    /** True when the focused variable has an 'evaluateName' field set. */
    variableEvaluateNamePresent: boolean;
    /** True when the focused variable is read-only. */
    variableIsReadonly: boolean;
    /** Value of the variable, present for debug visualization clauses. */
    variableValue: string;
    /** Type of the variable, present for debug visualization clauses. */
    variableType: string;
    /** Any interfaces or contracts that the variable satisfies, present for debug visualization clauses. */
    variableInterfaces: readonly string[];
    /** Name of the variable, present for debug visualization clauses. */
    variableName: string;
    /** Language of the variable source, present for debug visualization clauses. */
    variableLanguage: string;
    /** Extension ID of the variable source, present for debug visualization clauses. */
    variableExtensionId: string;
    /** True when the exception widget is visible. */
    exceptionWidgetVisible: boolean;
    /** True when there is more than 1 debug console. */
    multiSessionRepl: boolean;
    /** True when there is more than 1 active debug session. */
    multiSessionDebug: boolean;
    /** True when the focused sessions supports disassemble request. */
    disassembleRequestSupported: boolean;
    /** True when the Disassembly View is focused. */
    disassemblyViewFocus: boolean;
    /** True when the language in the current editor supports disassemble request. */
    languageSupportsDisassembleRequest: boolean;
    /** True when the focused stack frame has instruction pointer reference. */
    focusedStackFrameHasInstructionReference: boolean;

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
