# Readiness matrix: VS Code extension API

**Diode's end goal is full support for the VS Code extension API wherever it makes sense in a
terminal.** Everything that inherently requires a browser (webview and UI-heavy surfaces) will
never be supported — and the matrix says so explicitly instead of staying silent about it. An
important asymmetry: the ecosystem's language support (LSP, grammars, themes, snippets, formatters)
does not go through webview — it lives in the regular extension API, which is available here.

API version: **1.127.0** (pinned in `extensions/VSCODE_VERSION`; the matrix is checked against this pin).
The matrix is maintained by hand, but every status is checked against the sources: the active API
surface is exactly the uncommented lines of the pinned `src/vscode-dts/vscode.d.ts`; the matrix is
updated in the same PR that changes the surface. A separate table covers
[activation events](#activation-events-activationevents): they are not in `vscode.d.ts` (they live in
`package.json`), but they are what decides whether an extension starts at all.

## Legend

| status | meaning |
| --- | --- |
| ✅ | supported — uncommented in `vscode.d.ts`, covered by tests |
| 🟡 | partial — the surface exists, the marked members are still stubs |
| 🕐 | planned — on the roadmap, still commented out |
| ⛔ | not supported by design — requires a browser/GUI |

## Summary

The N/M counter is how many members of the namespace are active out of those in upstream 1.127.0
(overloads count as one member). The ⛔ surfaces live inside `window` — see [the ceiling](#not-supported-by-design).

| surface | status | members |
| --- | :-: | --- |
| [`vscode.languages`](#vscodelanguages) | 🟡 | 18/40 |
| [`vscode.workspace`](#vscodeworkspace) | 🟡 | 25/45 |
| [`vscode.window`](#vscodewindow) | 🟡 | 38/57 |
| [`vscode.commands`](#vscodecommands) | 🟡 | 3/4 |
| [`vscode.extensions`](#vscodeextensions) | 🟡 | 3/3 |
| [`vscode.l10n`](#vscodel10n) | 🟡 | 3/3 |
| [`vscode.env`](#vscodeenv) | 🟡 | 15/21 |
| [`vscode.tasks`](#vscodetasks) | 🟡 | 8/8 |
| [`vscode.authentication`](#vscodeauthentication) | 🟡 | 4/4 |
| [`vscode.comments`](#vscodecomments) | 🟡 | 1/1 |
| [`vscode.debug`](#vscodedebug) | 🟡 | 18/18 |
| [`vscode.tests`](#vscodetests) | 🟡 | 1/1 |
| [`vscode.scm`](#namespaces-not-yet-exposed) | 🕐 | 0/2 |
| [`vscode.notebooks`](#namespaces-not-yet-exposed) | 🕐 | 0/3 |
| [`vscode.chat`](#namespaces-not-yet-exposed) | 🕐 | 0/1 |
| [`vscode.lm`](#namespaces-not-yet-exposed) | 🕐 | 0/7 |
| [types and classes](#types-with-a-partial-surface) | — | 262/424 |
| [activation events](#activation-events-activationevents) | 🟡 | 6/32 |

## vscode.languages

🟡 **18/40.** The LSP-level language stack is fully in place; the remaining providers accept
registration but are not called yet.

| member | status | comment |
| --- | :-: | --- |
| `createDiagnosticCollection` | 🟡 | works (squiggles + Problems); related information is not passed through, and markers of a dead extension host are not cleared until it restarts |
| `getDiagnostics`, `onDidChangeDiagnostics` | ✅ | diagnostics of all collections in the subprocess plus foreign core markers (settings, tasks) — a mirror, like upstream's `$acceptMarkersChange`; the event coalesces changes over 50 ms. Deviation: foreign markers that appeared before the extension host started arrive as a seed; removal of foreign markers is reported even when the resource still has its own |
| `registerCompletionItemProvider` | ✅ | trigger characters, resolve (documentation, auto-import) |
| `registerDefinitionProvider` | ✅ | |
| `registerHoverProvider` | ✅ | multiple providers are concatenated |
| `registerReferenceProvider` | ✅ | |
| `registerRenameProvider` | ✅ | `prepareRename` (both response forms) + edits across all affected files as a single undo step; the new name is asked for in an input box rather than an inline widget — there is no dedicated widget |
| `registerSignatureHelpProvider` | ✅ | both registration overloads |
| `registerDocumentFormattingEditProvider` | ✅ | |
| `registerDocumentRangeFormattingEditProvider` | ✅ | the multi-range `provideDocumentRangesFormattingEdits` is not active |
| `registerCodeActionsProvider` | ✅ | quickfix, organize imports, fix all; `CodeAction.disabled` — as upstream (Quick Fix does not show it, auto-apply names the reason); there is no lightbulb indicator |
| `registerFoldingRangeProvider` | ✅ | |
| `registerSelectionRangeProvider` | ✅ | Expand/Shrink Selection (`Shift+Alt+→/←`); provider steps are merged with the built-in ones (word, subword, line, document), as upstream; `vscode.executeSelectionRangeProvider` is not exposed |
| `registerDocumentSemanticTokensProvider` | ✅ | semantic highlighting on top of TextMate: deltas (`provideDocumentSemanticTokensEdits`), `onDidChangeSemanticTokens`, theme `semanticTokenColors` with fallback to TM scopes, `contributes.semanticToken*`, the `editor.semanticHighlighting.enabled` setting; `editor.semanticTokenColorCustomizations` is not supported |
| `registerDocumentRangeSemanticTokensProvider` | ✅ | the visible range, while the full set of document tokens is not yet available |
| `createLanguageStatusItem` | 🟡 | a field holder with an honest dispose, not yet projected into the UI |
| `match` | ✅ | works at runtime (selector scoring for language clients); the declaration in `vscode.d.ts` is not exposed yet |
| other `register*Provider` (16: declaration, implementation, typeDefinition, documentHighlight, documentSymbol, workspaceSymbol, codeLens, documentLink, color, onTypeFormatting, inlayHints, inlineValues, inlineCompletion, linkedEditingRange, callHierarchy, typeHierarchy) | 🕐 | registration is accepted (no-op) — the extension does not crash, the provider is not called |
| `setLanguageConfiguration` | 🟡 | `wordPattern` — the language's word definition for `TextDocument.getWordRangeAtPosition` in the subprocess (a regex matching the empty string is an upstream exception); `comments`, `brackets`, `autoClosingPairs` — a layer on top of `language-configuration.json` in the core (commenting, auto-closing and surrounding): a section that is set replaces the file's section, a later layer wins over an earlier one, dispose and extension host death remove the layer. Not applied (the core cannot handle them from the file either): `indentationRules`, `onEnterRules`, `LineCommentRule.noIndent`, `notIn: RegEx/Other`, the deprecated `__electricCharacterSupport`/`__characterPairSupport`; `wordPattern` is not passed to the core editor (word selection, completion boundaries) |
| `getLanguages`, `setTextDocumentLanguage`, `registerEvaluatableExpressionProvider`, `registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider` | 🕐 | |

## vscode.workspace

🟡 **24/45.** Documents, configuration, saving and its events, file watchers, disk access, file
search by glob and bulk `applyEdit` (including closed files and file operations) work; the notebook
surface does not.

| member | status | comment |
| --- | :-: | --- |
| `workspaceFolders`, `name` | ✅ | |
| `textDocuments`, `openTextDocument` | ✅ | including `{ encoding }` — real decoding of non-utf8; `openTextDocument({ content, language })` — an untitled buffer `untitled:Untitled-N`, as upstream (`openTextDocument(untitled:-uri)` — not yet) |
| `onDidOpen/onDidClose/onDidChangeTextDocument` | ✅ | |
| `onWillSaveTextDocument`, `onDidSaveTextDocument` | ✅ | composition of save participants with `codeActionsOnSave`/`formatOnSave` |
| `getConfiguration`, `onDidChangeConfiguration` | ✅ | layers default → user → workspace → workspaceFolder: project settings live in `.diode/settings.json` of the open folder (VS Code uses `.vscode/settings.json`); for a window opened from a `.code-workspace` file, the workspace is the file's `settings` block, and `.diode/settings.json` is the folder layer on top of it; `inspect().workspaceValue`/`workspaceFolderValue` are honest. `update()` — as in VS Code: `Workspace`/`false` — to the workspace settings, `Global`/`true` — to the user `settings.json`, `WorkspaceFolder` — to the folder's `.diode/settings.json`; without a target — the workspace, while for a window from `.code-workspace` a `resource`/`language-overridable` key with a resource goes to the folder (`deriveConfigurationTarget`); `undefined` removes the key; by the time it resolves, `get()` already sees the value; refusals (unregistered key, empty window, `application`/`machine` into the workspace) — a rejected promise with VS Code's messages, without a toast. Writing to a language section (`overrideInLanguage`) is rejected for now |
| `asRelativePath` | ✅ | |
| `applyEdit` | 🟡 | a real bulk edit: text edits to OPEN resources (through the buffer, which stays dirty) and CLOSED ones (written to disk), plus the file operations `createFile`/`deleteFile`/`renameFile` with the options `overwrite`/`ignoreIfExists`/`ignoreIfNotExists`, in the order they were added; the whole edit is ONE undo step in the history of every open affected file (Ctrl+Z from any of their tabs). `metadata.isRefactoring` — the affected files are saved according to `files.refactoring.autoSave`. All-or-nothing: a read-only resource, an unreadable file, a name collision or overlapping edits reject the whole edit (`false`). Deviations: `recursive` on `deleteFile` is ignored (deletion is always recursive — the whole tree goes to the trash), `WorkspaceEditEntryMetadata` is dropped (there is no preview mode), `contents` given as `DataTransferFile` is ignored |
| `createFileSystemWatcher` | ✅ | real watchers: `RelativePattern`, `ignore*Events`, excludes from `files.watcherExclude` |
| `fs` | 🟡 | the whole `FileSystem` surface: `stat`, `readFile`, `writeFile`, `readDirectory`, `createDirectory`, `delete` (with `recursive`), `rename` and `copy` (with `overwrite`), `isWritableFileSystem`. The `file` scheme is handled locally via `node:fs`, without RPC to the host; a scheme of a provider from the same extension subprocess is handled by the provider itself (`stat`, `readFile`, `writeFile`; into a read-only scheme — `NoPermissions`), other operations on such a scheme are `Unavailable` for now. Deviations: `useTrash` on `delete` is ignored (a terminal editor has no trash). `isWritableFileSystem`: `file` — `true`, a provider scheme — by its `isReadonly`, an unknown one — `undefined`, as upstream. A scheme backed by neither the disk nor a provider is caught by the `Unavailable` gate |
| `registerFileSystemProvider` | 🟡 | `watch`/`stat`/`readFile`/`writeFile`/`onDidChangeFile` and the `isReadonly` option. A writable provider's resource as a side of a diff (`vscode.diff`) is a live document under its own uri, as upstream: it can be edited, it is saved by a provider write (with `onWillSave`/`onDidSave`), a clean buffer is re-read on `onDidChangeFile` — this is what Claude Code's proposed diff runs on. Deviations: such a resource opens only as a side of a diff, not as a regular tab (`showTextDocument`/`vscode.open`); `openTextDocument` on a provider scheme returns a document read by the provider but does not open it in the core; the core does not call `watch`, `readDirectory`, `createDirectory`, `delete`, `rename`, `copy`; `isCaseSensitive` is ignored; a provider without `writeFile` is treated as read-only (beyond upstream: there is nothing to write with) |
| `findFiles` | 🟡 | glob search by our own tree walk in the subprocess (upstream uses ripgrep in the core). Both forms of `GlobPattern` are supported (a string — across all workspace folders, `RelativePattern` — within its base), the three values of `exclude` (`undefined` — the `files.exclude` setting, `null` — none, a pattern — instead of the setting), `maxResults` and the cancellation token. Deviations: globs are matched by our `glob.ts` (no `[0-9]` ranges) and the walk is limited to 5000 directories per request |
| `registerTextDocumentContentProvider` | ✅ | non-disk resources (`jdt:` for Java) open in a read-only tab; `onDidChange` re-reads the open one; `openTextDocument` on such a scheme asks the provider |
| `isTrusted`, `onDidGrantWorkspaceTrust` | 🟡 | there is no trust model — always `true`, the event never fires |
| `getWorkspaceFolder` | ✅ | works at runtime: matches on a path segment boundary, a file **outside** the workspace folders — `undefined`, as upstream (the fallback to the first folder was removed); the declaration in `vscode.d.ts` is not exposed yet |
| folder and file operation events (`onDidChangeWorkspaceFolders`, `onWill/onDid{Create,Delete,Rename}Files`) | 🕐 | subscription is accepted (no-op), the event never fires |
| notebook surface (8 members: `notebookDocuments`, `openNotebookDocument`, `registerNotebookSerializer`, events) | 🕐 | |
| `registerTaskProvider` | ✅ | the deprecated twin of `tasks.registerTaskProvider` — the same call |
| `workspaceFile` | ✅ | the `Uri` of the `.code-workspace` file if the window was opened through it (a file with a single folder); otherwise `undefined`. The `name` of such a window is `<file> (Workspace)`, as in VS Code |
| `saveAll` | 🟡 | saves all unsaved files in all groups (like upstream's `$saveAll`); a file changed on disk is not overwritten, a write failure gives `false`, while the others are still saved. Deviation: `includeUntitled` does not open Save As for untitled buffers — they stay unsaved, and the result is `false` |
| `save` | ✅ | saves the open document of the resource (a clean one too — upstream's `force`), the result is its `Uri`; not open, untitled, a conflict with the disk or a write failure — `undefined` |
| `rootPath`, `saveAs`, `decode`, `encode` | 🕐 | |
| `updateWorkspaceFolders` | 🟡 | upstream's checks (duplicates, bounds, "nothing changes" → `false`); we have no multi-root, so only an outcome of exactly one folder can be carried out (empty window + a folder, replacing the only one) — it opens like `File: Open Folder`, extensions are restarted (upstream reloads the window). An outcome of two or more folders, or of none — `false` and an error toast `Extension '…' failed to update workspace folders: multi-root workspaces are not supported`; the folder `name` is not taken into account (the name is the basename) |

## vscode.window

🟡 **35/57.** Editors (including the selection event), the active theme, messages, progress,
output channels, decorations, status bar items and input (a text line + picking from a list) work;
extension terminals too; file dialogs are not yet available to extensions, trees are a stub
without a panel; webview is the ceiling.

| member | status | comment |
| --- | :-: | --- |
| `activeTextEditor`, `visibleTextEditors` | ✅ | the sides of a visible diff tab are visible editors too, like upstream's two diff editors; deviation: a snapshot side (a git revision, the clipboard, "on disk") has no document of its own under the side's uri and is not included in `visibleTextEditors` |
| `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorViewColumn` | ✅ | |
| `state`, `onDidChangeWindowState` | ✅ | |
| `showTextDocument` | 🟡 | opens the resource but returns the active editor |
| `showInformation/Warning/ErrorMessage` | ✅ | all four overloads: buttons as strings and as `MessageItem`s, `MessageOptions` (`modal` + `detail`). A non-modal message is a toast in the bottom-right corner above the status bar: without buttons it goes away on its own (info 10 s, warning 12 s, error 15 s — upstream's values), with buttons it waits for an answer and does not take focus (as upstream); `Notifications: Focus Message` or a click gets you to the buttons. A message can always be dismissed — with the close button on the toast itself (the equivalent of `notification.clear`) or with the `Notifications: Clear All` command; at most three toasts are visible, the rest wait for room. A question lives longer (a minute) and also closes on its own: an extension that did `await show*Message(...)` is blocked exactly as long as the message is shown, and a message shown forever used to hang a language client's server restart. There is no notification center yet from which upstream brings back a message that went away — that is a separate task. A modal message is a dialog in the center, Escape returns the `isCloseAffordance` button. A deliberate deviation from upstream: a message WITHOUT buttons resolves immediately when shown rather than when the toast closes — otherwise `await showErrorMessage(...)` would hang until a person closes the sticky toast |
| `createOutputChannel` | 🟡 | a channel in the Output panel with log levels; `clear`/`replace` — no-op (the log is retention-based) |
| `withProgress` | 🟡 | a spinner in the status bar, message/increment are live; cancellation is not supported — the token never fires |
| `tabGroups` | 🟡 | `Tab` snapshots at the time of the call (identity is not guaranteed), `Tab.group` is the object of its own group in the same snapshot; `onDidChangeTabs` is live, `close` works |
| `createTextEditorDecorationType` | ✅ | gutter change bars, overview ruler |
| `registerFileDecorationProvider` | ✅ | file decorations in the explorer; `propagate` bubbles up to folders (color + "●") |
| `showQuickPick` | 🟡 | a list of strings and `QuickPickItem`s on the shared QuickInput overlay: filtering by `label`, `canPickMany` with checkboxes and `picked`, `placeHolder`, `title`, the cancellation token; a promise of a list is awaited and shown once filled. Separators (`kind: QuickPickItemKind.Separator`) are neither shown nor selectable — the overlay has no group headers. Not supported: `iconPath`, `buttons`, `alwaysShow`, `matchOnDescription`/`matchOnDetail`, `ignoreFocusOut`, the deprecated `onDidSelectItem`; `detail` is drawn in place of `description` only when `description` is empty (a list row is a single line) |
| `showInputBox` | 🟡 | `title`, `prompt`, `placeHolder`, `value`, `password` (the typed text is masked with `*` and is visible neither on screen nor in the inspector), `validateInput` (as a string and in the object form with severity — an error blocks Enter; asynchronous validation is supported, stale responses are discarded), the cancellation token. Not supported: `valueSelection`, `ignoreFocusOut` |
| `createQuickPick` | 🟡 | a live object on the shared QuickInput overlay, in upstream's shape: state goes to the host as a diff (a batch of assignments — one send), a person's actions come back as the events `onDidChangeValue` / `onDidAccept` / `onDidChangeActive` / `onDidChangeSelection` / `onDidHide`, with the extension's own objects. `items` / `activeItems` / `selectedItems` can be changed while the picker is open too; Enter does not close the picker (the extension closes it), Enter on an empty list gives `onDidAccept` without a selection; `title` with `step`/`totalSteps` ("Title (1/3)"), `placeholder`, `prompt`, `value`, `canSelectMany`, `matchOnDescription`/`matchOnDetail`, `alwaysShow`, `keepScrollPosition`; separators (`QuickPickItemKind.Separator`) are not drawn. Stored but not drawn: `busy` (the overlay has no loading indicator) and `enabled: false`; not supported: `buttons`/item buttons, `iconPath`, `ignoreFocusOut` (a click outside always closes it); `detail` goes in place of `description`, as with `showQuickPick` |
| `QuickPickItemKind` | ✅ | the enum value for separators |
| `showOpenDialog`, `showSaveDialog` | 🟡 | a port of upstream's `SimpleFileDialog` (the terminal-style dialog of `files.simpleDialog.enable`) on the shared QuickInput overlay: the full path in the input line, the directory below it (`..`, directories before files), navigation by separator, `..` and `~`, an arrow key completes the highlighted name, upstream's checks and messages, a prompt about overwriting and about creating a directory, filters hide non-matching files, saving appends the first filter's extension. Local file system only (a `defaultUri` that is not `file:` — falls back to the default folder); `canSelectMany` is not supported (as in upstream's dialog of this kind); `openLabel`/`saveLabel` are not drawn — there are no buttons, Enter confirms |
| other quick input (`showWorkspaceFolderPick`, `createInputBox`) | 🕐 | the object form of the input box |
| `createStatusBarItem` | 🟡 | an item in the bar: `text` with `$(name)` icons, `name`, `alignment`, `priority`, a command on click, `show`/`hide`/`dispose`. Stubs: `tooltip` is accepted but not shown (the TUI has no tooltip widget); `color`/`backgroundColor`/`accessibilityInformation` have no effect. Text longer than 24 characters is truncated — the bar's width is scarce in a terminal |
| `setStatusBarMessage` | ✅ | all three overloads (timeout, thenable, until `dispose`). As upstream: one shared bar item for all extensions (id `status.extensionMessage`, on the left, named "Extension Status"), messages form a stack — the most recent is visible, removing the top one brings back the previous one. The item is created on the first message and is hidden through the bar's visibility menu, like the others |
| `createTerminal`, `terminals`, `activeTerminal`, `onDidOpenTerminal`, `onDidCloseTerminal`, `onDidChangeActiveTerminal` | 🟡 | an extension terminal is a real shell of the integrated terminal: in the bottom panel (a tab in the terminal list) or as a tab in the editor area via `location` — `TerminalLocation.Editor` (the active group), `{ viewColumn, preserveFocus }` (`Beside` — the group to the right, a new one if needed; 1..9), `{ parentTerminal }` (wherever the parent is: for an editor terminal — to the right of its group); without `location` — according to `terminal.integrated.defaultLocation`. The positional form and `TerminalOptions`: `name`, `shellPath`, `shellArgs`, `cwd`, `env` (`null` unsets the variable), `strictEnv`, `hideFromUser` (a background terminal: present in `terminals`, in the tabs — after `show()`), `message`. `terminals` is all terminals, including shells opened by a person (their `creationOptions` is what they were launched with); `activeTerminal` and the events also cover all of them. `Terminal`: `sendText` (newlines are Enter, as upstream), `show(preserveFocus)` opens the panel on the TERMINAL tab (for an editor terminal tab — shows that tab), `hide` hides the panel only if this terminal is the one shown (for an editor tab — nothing, as upstream), `dispose`, `processId`, `exitStatus` with a reason (`Process` — the shell exited, `User` — Kill, `Extension` — `dispose()`). After `dispose()` the methods throw, as upstream. `ExtensionTerminalOptions` (`pty`): the extension owns the process, the host holds the emulator — `onDidWrite` is drawn in the panel (output is coalesced over 5 ms, as upstream), `open` is called right at creation, a person's typing and `sendText` arrive in `handleInput` (after `open`), the widget size — in `setDimensions`, `onDidClose` closes the terminal with its code, closing the terminal calls `close()`; death of the extension subprocess closes its pty terminals. `open` receives an initial size of 80×24, the real widget size follows via `setDimensions`; `onDidOverrideDimensions` and `onDidChangeName` are not supported. Closing a terminal tab kills the process (`User`), process exit closes the tab. Not supported: `color`/`iconPath`/`shellIntegrationNonce` are accepted and ignored; `isTransient` — terminals are not restored after a restart anyway; a terminal tab in the editor area does not become `activeTerminal`; `state.isInteractedWith` is always `false`; string `shellArgs` are split on spaces; the terminal name does not follow the process title |
| `onDidChangeTerminalShellIntegration`, `onDidStartTerminalShellExecution`, `onDidEndTerminalShellExecution` | 🟡 | shell integration (injection scripts, OSC 633 parsing) is not in place: `Terminal.shellIntegration` is always `undefined` — per the contract, "never activated", and the events are valid and never fire. Extensions waiting for integration (Claude Code — 3 s) fall back to `sendText` |
| `onDidChangeTerminalState`, `registerTerminalLinkProvider`, `registerTerminalProfileProvider` | 🕐 | |
| trees (`registerTreeDataProvider`, `createTreeView`) | 🟡 | the declarations are exposed, the runtime is a stub: the tree is not drawn yet, nobody calls the provider. Registration succeeds (otherwise an extension with a tree died entirely at activation), with one line per view in Output saying there will be no panel. `createTreeView` without `treeDataProvider` throws, as upstream; the `TreeView` is inert: `visible` is `false`, `selection` is empty, the events never fire, `reveal` resolves immediately, `title`/`message`/`description`/`badge` are stored and have no effect. The `TreeItem` values (the `collapsibleState` default is `None`), `TreeItemCollapsibleState`, `TreeItemCheckboxState`, `ThemeIcon` are real |
| `onDidChangeTextEditorSelection` | ✅ | every cursor movement/selection change in an editor; `kind` comes from the gesture — typing and a keybinding give `Keyboard`, the mouse `Mouse`, an extension command `Command`, everything else (undo/redo, find, folding, a programmatic edit) — `undefined`, as upstream allows. A selection the extension set itself is not echoed back. A tab that becomes visible with a selection not at the start of the document (you came back to it) produces the event with `kind` `undefined` — like upstream's cursor restore; in the active group — after `onDidChangeActiveTextEditor` |
| editor events (`onDidChangeTextEditorVisibleRanges`, `onDidChangeTextEditorOptions`) | 🕐 | |
| notebook editors (7 members) | 🕐 | |
| `activeColorTheme`, `onDidChangeActiveColorTheme` | ✅ | the active theme's kind (`ColorThemeKind`) is correct already in `activate()`; the event fires on every theme change, including between two dark ones (as upstream: "changed **or has changes**"). The theme name is not given to the extension — `vscode.ColorTheme` does not have it anyway |
| `registerUriHandler` | ✅ | one handler per extension (registering again gives upstream's error `Protocol handler already registered…`), the address is `diode://<extension id>/…` (`env.uriScheme`). A URL for an extension that has not set up its handler yet is buffered (five minutes, as upstream) and starts the extension via [`onUri`](#activation-events-activationevents); a handler set up during activation receives the buffer. Before delivery — the question "Allow '…' extension to open this URI?"; without the question — extensions from upstream's `extensions.confirmedUriHandlerExtensionIds` setting. The URL source is the `Developer: Open URL` command (`workbench.action.url.openUrl`, as upstream); the OS protocol handler and `--open-url` are not wired up. **Deviations:** the dialog has no "Do not ask me again" checkbox — trust is configured via the same setting, and the dialog mentions it; a URL for an extension that is not installed does not install it, but reports that the extension is missing |
| `withScmProgress` | 🕐 | |
| `createWebviewPanel`, `registerWebviewPanelSerializer`, `registerWebviewViewProvider` | ⛔ | webview — requires a browser; the declarations are not exposed, but at runtime the members exist as an inert no-op (no panel, one line in Output about unsupported webview) — otherwise an extension with a chat panel died entirely at activation |
| `registerCustomEditorProvider` | ⛔ | custom editors are built on webview; at runtime — the same inert no-op as its three neighbors above (`redhat.java` hangs its formatter settings editor on it, and a failure at registration killed the whole activation) |

## vscode.commands

🟡 **3/4.**

| member | status | comment |
| --- | :-: | --- |
| `registerCommand` | ✅ | |
| `executeCommand` | ✅ | of VS Code's built-in commands, `setContext` is registered — an extension uses it to publish its when keys (settings in when clauses — `config.<key>` — are read directly, as upstream: `when: config.claudeCode.useTerminal` in `contributes.keybindings`/`menus`); of upstream's API commands (`extHostApiCommands`) — `vscode.open` (a Uri — into a tab, with column/options like `showTextDocument`; http(s) — externally, like `env.openExternal`) |
| `registerTextEditorCommand` | 🟡 | without an active editor — warn + no-op (VS Code semantics); the edit builder is inert, batch edits go through `workspace.applyEdit` |
| `getCommands` | 🕐 | |

## vscode.extensions

🟡 **3/3** — fully declared and reports the real set of extensions; there is one discrepancy with
upstream, named below (declarative extensions).

| member | status | comment |
| --- | :-: | --- |
| `getExtension` | ✅ | the real catalog entry (id, `extensionUri`/`extensionPath`, the whole `packageJSON`, a live `isActive`, the `exports` of an active neighbor); the id is compared case-insensitively, like `ExtensionIdentifier` upstream. Correct already in `activate()` — the catalog arrives as a seed before the first activation |
| `all` | 🟡 | the whole set known to the extension host, **except declarative extensions** — language packs without `main` are not registered in the extension host and do not appear in `all` (upstream they do) |
| `onDidChange` | ✅ | fires when the set changes (an extension is registered/removed); not on activation, as upstream |

## vscode.tasks

🟡 **8/8** — the namespace is fully exposed together with the task types (`Task`, `TaskScope`, `TaskGroup`,
`ShellExecution`, `ProcessExecution`, `CustomExecution`, `TaskDefinition`, `TaskProvider`,
`TaskExecution`, events). Tasks are owned by the Diode core: Run Task, the task terminal, Rerun /
Restart / Terminate / Show Running Tasks — the same as for tasks from `.diode/tasks.json` (VS Code uses `.vscode/tasks.json`).
**Problem matchers are not executed at all** — a task simply runs until the process exits.

| member | status | comment |
| --- | :-: | --- |
| `registerTaskProvider` | ✅ | provider tasks show up in Run Task (a type from `contributes.taskDefinitions` is the picker's second level), the task id is `${extension}.${definition key}`, as upstream. The provider is waited for no longer than 5 s; `task.autoDetect: off` does not ask it. A `tasks.json` entry with the provider's type (a customization of an extension task, appended by Configure Task) is merged with the provider task by the definition key; `resolveTask` is not called — an entry for which `provideTasks` returned no task remains an error in the `Tasks` log |
| `fetchTasks` | ✅ | tasks from `tasks.json` and from all providers; with `{ type }` — only from providers of that type |
| `executeTask` | ✅ | the extension's own task comes back in events as the same object; a task from `fetchTasks` is executed by its core id, a modified one — by its full description. `task.saveBeforeRun` and the rerun policy (`instancePolicy`) apply |
| `taskExecutions` | ✅ | all running tasks — including those started from the palette or by another extension (then `task` is a new object with the provider's `name`/`source`) |
| `onDidStartTask`, `onDidEndTask` | ✅ | for all tasks, including those started from the palette |
| `onDidStartTaskProcess` | 🟡 | the shell process pid; for a `CustomExecution` task — `-1` (as upstream: there is no process) |
| `onDidEndTaskProcess` | ✅ | the exit code; `undefined` — the task terminal was closed (Terminate) |

The task types follow the contract, with differences:

| symbol | difference |
| --- | --- |
| `Task.group`, `TaskGroup` | stored and sent to the core, but there are no build/test groups yet (Run Build Task, Ctrl+Shift+B) — it does not affect running |
| `Task.problemMatchers` | stored, not executed (problem matchers are not supported) |
| `TaskScope.Global` | a task without a folder — as upstream, where the documentation says the `Global` scope is "not supported yet", but it runs as is |
| `RunOptions` | `reevaluateOnRerun` works (Rerun Last Task); for `tasks.json` tasks — `instancePolicy` as well; an `instanceLimit` above 1 gives a single instance, `runOn: folderOpen` does not start on its own |
| `TaskPresentationOptions` | `reveal`, `focus`, `echo`, `panel` (dedicated/shared/new — with task terminal reuse), `showReuseMessage`, `clear`, `group`, `close` |
| `CustomExecution` | the extension's pty is attached to the task terminal; on rerun — the same terminal, a new pty |

## vscode.l10n

🟡 **3/3** — fully declared; there are no translation bundles.

| member | status | comment |
| --- | :-: | --- |
| `t` | 🟡 | substitutes placeholders (`{0}`/`{name}`/the options form), there are no translations |
| `bundle`, `uri` | 🟡 | `undefined` |

## vscode.env

🟡 **15/21.** What is exposed is what makes sense in a terminal and is implemented for real: the
clipboard and opening an external link, plus the environment constants that extensions read right
in `activate()` (`vscode-languageclient` — `language`/`appName`, the stock `redhat.java` — `uiKind`
and telemetry, `@vscode/extension-telemetry` — the telemetry logger).

| member | status | comment |
| --- | :-: | --- |
| `appName`, `appHost`, `uriScheme`, `language` | 🟡 | shim constants (`Diode` / `desktop` / `diode` / `en`); there are no translations, so `language` is always `en` |
| `clipboard` | ✅ | the same clipboard the core's copy/paste uses: writes also go to the system clipboard via OSC 52. Reading returns the internal register — we deliberately do not do an OSC 52 read (many terminals forbid it, and the request just hangs); external content arrives through the terminal's paste gesture |
| `openExternal` | 🟡 | `http`/`https`/`mailto` are opened by the system handler (`xdg-open`/`open`/`cmd start`). Without a graphical session (ssh, a container, a bare server) the link is HANDED to the person: the URL goes to the clipboard and is shown in a message — and this counts as success (`true`). Other schemes — an honest `false` |
| `uiKind` | ✅ | always `UIKind.Desktop`: the editor is a desktop one, even if it runs in a terminal, and `Web` in the contract means "accessed from a browser" |
| `remoteName` | ✅ | `undefined` per the letter of the contract — Diode has no remote extension host |
| `sessionId` | 🟡 | a random uuid per extension host session: stable within a run, different between runs. A deviation from upstream — there the id survives an extension host restart, while our shim is rebuilt together with the subprocess |
| `isTelemetryEnabled`, `onDidChangeTelemetryEnabled` | ✅ | Diode has no telemetry at all — neither its own nor a channel for anyone else's, so the flag is always `false`, and the event is valid and never fires (nothing can change) |
| `createTelemetryLogger` | ✅ | upstream's logger with telemetry turned off: `isUsageEnabled`/`isErrorsEnabled` — `false`, `logUsage`/`logError` never reach the sender, `onDidChangeEnableStates` never fires, the first `dispose` calls the sender's `flush`. The sender validation and its messages are upstream's. Without this member `@vscode/extension-telemetry` crashed (the reporter builds the logger in its constructor), and with it the whole activation of `hashicorp.terraform`. `TelemetryTrustedValue` is a real class |
| `machineId` | ✅ | as upstream: sha256 of the first real MAC address in hex (without an address — a uuid), cached in application state under the same `telemetry.machineId` key — stable between runs |
| `shell` | ✅ | the shell the integrated terminal launches without `shellPath` (`$SHELL` → the account's shell → `sh`; on Windows — `%COMSPEC%`). There are no terminal profiles, so no setting changes it |
| `onDidChangeShell` | ✅ | a valid event; without terminal profiles the shell does not change, and it never fires |
| `isNewAppInstall`, `isAppPortable` | 🕐 | |
| `asExternalUri` | 🕐 | URI handlers exist (`window.registerUriHandler`), but there is no external source of `diode://` (an OS protocol handler) — there is nothing to hand out yet |
| `logLevel`, `onDidChangeLogLevel` | 🕐 | |

## vscode.comments

🟡 **1/1.** The declarations are fully exposed (controller, thread, comment and their enums), the
runtime is inert: there are no threads in the gutter or in the Comments panel yet. The namespace
exists because without it an entire extension feature crashed: Claude Code attaches a thread to
every hunk of a proposed diff.

| member | status | comment |
| --- | :-: | --- |
| `createCommentController` | 🟡 | a controller with `id`/`label`; `createCommentThread` returns a thread with upstream's defaults (collapsed, `canReply: true`), the fields are writable, `dispose` is harmless. Nothing is drawn, nobody calls `commentingRangeProvider` and `reactionHandler`; one line per controller id in Output saying there will be no threads. `CommentThreadCollapsibleState`, `CommentMode`, `CommentThreadState` are real enums |

## vscode.authentication

🟡 **4/4.** The declarations are fully exposed, the runtime is a null object: there is no sign-in in
Diode yet, real providers are planned. The namespace exists because its absence killed the entire
extension: `hashicorp.terraform` registers its own provider and requests a session in `activate()`,
before the language server starts.

| member | status | comment |
| --- | :-: | --- |
| `getSession` | 🟡 | without `createIfNone`/`forceNewSession` — `undefined` ("not signed in"). With them — a refusal with the reason "sign-in is not supported in the TUI yet": at this point upstream asks the person, and the overload promises a session, so `undefined` would crash the extension with an obscure `TypeError`. Options incompatible with `silent` give upstream's errors |
| `getAccounts` | 🟡 | an empty list |
| `onDidChangeSessions` | 🟡 | a valid event, never fires — there are no sessions |
| `registerAuthenticationProvider` | 🟡 | a `Disposable`, nobody calls the provider; one line per provider id in Output saying there will be no sign-in |

## vscode.debug

🟡 **18/18.** The declarations are fully exposed, the runtime is a null object: Diode has no
debugger (DAP), and none is planned. The namespace exists because its absence killed the entire
extension: `golang.go` registers a configuration provider in the middle of `activate()`, and without
`vscode.debug` ~60 of its commands did not appear (while the language server was already running).

| member | status | comment |
| --- | :-: | --- |
| `registerDebugConfigurationProvider`, `registerDebugAdapterDescriptorFactory`, `registerDebugAdapterTrackerFactory` | 🟡 | a `Disposable`, nobody calls the providers and factories; one line per debugger type in Output saying there will be no sessions (trackers on `*` stay silent) |
| `startDebugging` / `stopDebugging` | 🟡 | `false` ("not started", one line in Output) / resolves — there is nothing to stop |
| `activeDebugSession`, `activeStackItem`, `breakpoints`, `activeDebugConsole` | 🟡 | `undefined` / `undefined` / empty / a console whose output has nowhere to be shown |
| `onDidChangeActiveDebugSession`, `onDidStartDebugSession`, `onDidReceiveDebugSessionCustomEvent`, `onDidTerminateDebugSession`, `onDidChangeBreakpoints`, `onDidChangeActiveStackItem` | 🟡 | valid events, never fire |
| `addBreakpoints`, `removeBreakpoints` | 🟡 | no-op |
| `asDebugSourceUri` | ✅ | as upstream: a `debug:` uri for `sourceReference`, `file:` for a path |

The value types are upstream's: `DebugAdapterExecutable`, `DebugAdapterServer`,
`DebugAdapterNamedPipeServer`, `DebugAdapterInlineImplementation`, `Breakpoint`,
`SourceBreakpoint`, `FunctionBreakpoint`, `DebugThread`, `DebugStackFrame`, the enums
`DebugConsoleMode`, `DebugConfigurationProviderTriggerKind`. The `onDebug*` activation events do not
fire (see the table below).

## vscode.tests

🟡 **1/1.** The Test API declarations are fully exposed, the runtime is inert: there is no Testing view.
The namespace exists because `golang.go` creates a controller in `activate()` (`go.testExplorer.enable`
is on by default) — without it activation was cut short.

| member | status | comment |
| --- | :-: | --- |
| `createTestController` | 🟡 | a controller with `id`/`label`; `items` and the items' `children` are working collections (`add`/`get`/`delete`/`replace`/iteration, `parent` is set, the same id replaces an item); `createTestItem` — an item with upstream's defaults; `createRunProfile` — a profile with the given fields; `createTestRun` — a run that accepts reports, `end` sends `onDidDispose` once. Nobody calls `runHandler`, `resolveHandler`, `refreshHandler`; one line per controller id in Output |

The value types are upstream's: `TestRunProfileKind`, `TestTag`, `TestRunRequest`, `TestMessage`
(with `diff`), `TestMessageStackFrame`, `TestCoverageCount`, `FileCoverage` (with `fromDetails`),
`StatementCoverage`, `BranchCoverage`, `DeclarationCoverage`.

## Activation events (`activationEvents`)

This is the part of the extension contract that is not in `vscode.d.ts`: it is declared in
`package.json`, yet it decides whether the extension starts at all. An extension whose events are
not supported gets installed, shows up in the catalog — and stays silent forever.

**7 of 32** kinds of upstream 1.127.0 events are active (`*` plus 31 named kinds from the
`activationEvents` schema). The rows below list all of them; the unsupported ones are grouped by the
surface they wait for.

| event | status | comment |
| --- | :-: | --- |
| `*` | ✅ | eager; an empty/missing list also turns into it — **a deviation from upstream** (there, empty means empty): extensions already published on the marketplace rely on this default |
| `onStartupFinished` | ✅ | fires after the files from the launch arguments are opened |
| `onLanguage:<id>` | ✅ | when a language first needs its features — for any model (a new document, a language change, a background tab, a diff), like upstream's `requestRichLanguageFeatures`; together with it — the bare `onLanguage` |
| `onCommand:<id>` | ✅ | plus **implicit** events from `contributes.commands` (like upstream's `ImplicitActivationEvents`): the command is visible in the palette before activation, and its execution waits for `activate()`. `contributes.languages` also produces implicit `onLanguage:<id>` |
| `workspaceContains:<pattern>` | 🟡 | both prefix semantics are there (checking that a path exists and searching the tree); globs are matched by our `glob.ts` — **anchored to the relative path**, whereas upstream's `workspaceContains:` is backed by a ripgrep search, where a pattern without `/` is found at any depth (`workspaceContains:*.py` matches only the root here). Recursive patterns (`**/pyproject.toml`) match |
| `onUri` | ✅ | a URL for an extension without a handler (`diode://<id>/…`) starts it before delivery; a bare `onUri` in the manifest becomes `onUri:<id>`, as upstream |
| `onOpenExternalUri` | 🕐 | together with `env.asExternalUri` |
| `onView:<id>`, `onWalkthrough:<id>` | 🕐 | wait for their surfaces (`contributes.views`, walkthrough) |
| `onWebviewPanel:<id>`, `onCustomEditor:<id>`, `onRenderer:<id>` | ⛔ | webview-type surfaces — see [the ceiling](#not-supported-by-design) |
| `onDebug`, `onDebugInitialConfigurations`, `onDebugDynamicConfigurations`, `onDebugResolve:<type>`, `onDebugAdapterProtocolTracker:<type>` | 🕐 | do not fire: there is no debugger, `vscode.debug` is a null object |
| `onTaskType:<type>` | ✅ | Run Task starts providers before asking for tasks (`onCommand:workbench.action.tasks.runTask` and `onTaskType:<type>`; without a type — all types from `contributes.taskDefinitions`), plus the **implicit** `onTaskType:<type>` from `contributes.taskDefinitions` |
| `onNotebook:<type>` | 🕐 | together with `vscode.notebooks` |
| `onAuthenticationRequest:<id>` | 🕐 | together with real `vscode.authentication` providers (currently the namespace is a null object) |
| `onChatParticipant:<id>`, `onChatContextProvider:<id>`, `onLanguageModelChatProvider:<id>`, `onLanguageModelTool:<id>` | 🕐 | together with `vscode.chat` / `vscode.lm` |
| `onTerminal`, `onTerminalProfile:<id>`, `onTerminalQuickFixRequest:<id>`, `onTerminalShellIntegration` | 🕐 | together with the corresponding terminal contributions |
| `onFileSystem:<scheme>`, `onSearch:<scheme>`, `onEditSession:<scheme>`, `onIssueReporterOpened` | 🕐 | |

## Namespaces not yet exposed

| namespace | status | comment |
| --- | :-: | --- |
| `vscode.scm` | 🕐 | source control |
| `vscode.notebooks` | 🕐 | serialization is possible; cell renderers are webview, they will not be supported |
| `vscode.chat`, `vscode.lm` | 🕐 | text-based by nature — nothing stops them from working in a terminal |

## Not supported by design

The ceiling is everything that inherently requires a browser:

- `window.createWebviewPanel`, `window.registerWebviewPanelSerializer`,
  `window.registerWebviewViewProvider` — webview;
- `window.registerCustomEditorProvider` — custom editors are built on webview;
- notebook cell renderers (the Notebook API itself is 🕐).

"Not supported" refers to the panel, not to the extension: the four webview members of `window`
exist at runtime as an inert no-op (`webviewNoop.ts`), because an extension with a chat panel
creates it in the FIRST line of `activate()` — a missing member also killed its commands and
providers. The call returns a dead panel (or an honest `Disposable`) and writes one line to Output
saying "webview is not supported in the TUI"; the declarations in `vscode.d.ts` stay commented
out — the runtime stub does not change the ⛔ status.

## Types with a partial surface

262 of 424 upstream types/classes are active; the exposed ones are complete, except for those listed
below (bounded member-level uncommenting — a subset of members is uncommented). One row
(`TextDocument`) is about something else: everything there is uncommented and implemented, but
`save` is a 🟡 stub; it is listed separately because for an extension author this is the same kind
of incompleteness.

| type | active | not active |
| --- | :-: | --- |
| `TextEditor` | 7/12 | `visibleRanges`, `insertSnippet`, `revealRange`, `show`, `hide` |
| `TextDocument` | 19/19 | — (the document class is checked by the compiler: `implements vscode.TextDocument`). `save` — by the core, along the same path as `workspace.save` (upstream's `$trySaveDocument`): save participants, writing through the scheme's provider; a document not open in the core — `false`, a closed one — a refusal, as upstream. `getWordRangeAtPosition` — upstream's default word definition (`DEFAULT_WORD_REGEXP`) or the extension's regex; there are no language word definitions (`wordPattern`), a regex matching the empty string is an exception. `offsetAt`/`positionAt`/`validateRange`/`validatePosition` work too (their absence silently broke formatting by the stock prettier) |
| `TextEditorOptions` | 3/5 | `cursorStyle`, `lineNumbers` |
| `TerminalOptions` | 12/13 | `iconPath` |
| `TreeViewOptions` | 4/5 | `dragAndDropController` (the TUI has no drag-and-drop) |
| `ExtensionTerminalOptions` | 6/7 | `iconPath` |
| `ExtensionContext` | 16/17 | `languageModelAccessInformation`. Among the active ones: `environmentVariableCollection` — see [semantic deviations](#semantic-deviations); `extension` — the extension's own entry from the `vscode.extensions` catalog (telemetry reads `packageJSON.version` from it); `globalState`/`workspaceState` survive a restart (storage on the host); `globalState.setKeysForSync` is a deliberate no-op (there is no Settings Sync) |
| `WorkspaceEdit` | 11/11 | — |
| `WorkspaceEditEntryMetadata` | 3/4 | `iconPath` |
| `FileStat` | 4/5 | `permissions` |
| `FileSystemProvider` | 5/10 | `readDirectory`, `createDirectory`, `delete`, `rename`, `copy` |
| `DocumentFilter` | 3/4 | `notebookType` |
| `CompletionItem` | 9/16 | `tags`, `sortText`, `filterText`, `preselect`, `commitCharacters`, `keepWhitespace`, `textEdit`. `additionalTextEdits` — both in the list itself (gopls) and loaded later by resolve (tsserver) |
| `DocumentRangeFormattingEditProvider` | 1/2 | `provideDocumentRangesFormattingEdits` |
| `LanguageStatusItem` | 9/10 | `accessibilityInformation` |
| `DataTransferFile` | 3/3 | — (the type is declared for the sake of `createFile({ contents })`; instances are created only by the editor, and we have no drag-and-drop — such `contents` is ignored) |

## Semantic deviations

The type matches upstream, the meaning differs:

| symbol | deviation |
| --- | --- |
| `vscode.version` | returns the version of **diode**, not of VS Code |
| `Event<T>` | subscriptions are wrapped in the host's own emitter |
| `TextEditorOptions.indentSize` | aliased to `tabSize` — diode does not distinguish them yet |
| `environmentVariableCollection` | the whole API (`replace`/`append`/`prepend`, `get`, `forEach`, iteration, `delete`, `clear`, `description`, `persistent`, `getScoped` per folder). The collections of all extensions are merged, as upstream (Replace cuts off the rest, the order is the reverse of creation), and are applied to the environment of **every** terminal process: a person's shells, extension terminals and tasks, including when a task terminal is restarted; a terminal with `strictEnv` does not get them. The folder scope is determined by the folder of the terminal's cwd, otherwise by the workspace root. `persistent` collections are stored in workspace state (`terminal.integrated.environmentVariableCollectionsV2`) and reach the extension already in `activate()`; the collections of removed extensions are forgotten. **Deviations:** `applyAtShellIntegration` goes nowhere (there is no shell integration — nobody reads the `VSCODE_ENV_*` variables); there is no "terminal environment is stale" indicator and no relaunch on `terminal.integrated.environmentChangesRelaunch` — the next process gets the new values; `${…}` variables in values are not expanded |
| `SecretStorage` | **unencrypted**: we have no OS keychain, secrets are stored in plain text in `<profileDir>/secrets.json` with `0600` permissions. Everything else follows the contract — `get`/`store`/`delete`/`keys` work, `onDidChange` fires on both writes and deletes, values survive a restart, and each extension has its own compartment |
| `Extension.extensionKind` | always `ExtensionKind.UI` — exactly as upstream prescribes when there is no remote extension host (and Diode has none and will not have one) |
| `Extension.activate()` | for an **already active** extension returns its `exports`, for an inactive one it rejects with an explanation. Activation is managed by the host (activation events, per-extension isolation, revival after the subprocess dies); "the subprocess asks the host to start a neighbor" is a separate task with its own RPC |
| namespaces / value types | the runtime may be ahead of the declaration (see `languages.match`, `workspace.getWorkspaceFolder`) |

## How to read "partial"

"Partial" does not mean "works at half strength", but "the surface is declared, and the members
marked in the comment are stubs". A row's comment names exactly which members are not active, so
that an extension author can check their case in a minute without running diode.
