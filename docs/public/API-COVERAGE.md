# Readiness matrix: VS Code extension API

**Diode's end goal is full support for the VS Code extension API wherever it makes sense in a
terminal.** What inherently needs a browser (webview and the surfaces built on it) will never be
supported, and the matrix says so instead of staying silent. The ecosystem's language support (LSP,
grammars, themes, snippets, formatters) does not go through webview: it lives in the regular
extension API, which is what this page is about.

API version: **1.127.0**. The matrix is maintained by hand and updated in the same pull request
that changes the API surface, so every status here matches the build. A separate table covers
[activation events](#activation-events-activationevents): they are declared in `package.json`,
not in `vscode.d.ts`, yet they decide whether an extension starts at all.

## Legend

| status | meaning |
| --- | --- |
| ✅ | supported: declared in Diode's `vscode.d.ts`, covered by tests |
| 🟡 | partial: declared, the members or options named in the comment are stubs |
| 🕐 | planned: not declared yet; a call fails at compile time, at runtime it is accepted as a no-op where noted |
| ⛔ | not supported by design: requires a browser or a GUI |

## Summary

The **N/M** counter is how many members of a namespace are *declared and callable* out of those in
upstream 1.127.0 (overloads count as one). It counts the surface, not what works: `vscode.debug` is
18/18 and a null object at the same time. The status and the comment of each row say what really
works. The ⛔ surfaces live inside `window`, see [the ceiling](#not-supported-by-design).

| surface | status | members |
| --- | :-: | --- |
| [`vscode.languages`](#vscodelanguages) | 🟡 | 18/40 |
| [`vscode.workspace`](#vscodeworkspace) | 🟡 | 24/45 |
| [`vscode.window`](#vscodewindow) | 🟡 | 35/57 |
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
| [activation events](#activation-events-activationevents) | 🟡 | 8/32 |

## vscode.languages

🟡 **18/40.** The LSP-level language stack is in place; the remaining providers accept
registration but are not called yet.

| member | status | comment |
| --- | :-: | --- |
| `createDiagnosticCollection` | 🟡 | squiggles and the Problems panel; `relatedInformation` is not shown; markers of a dead extension host stay until it restarts |
| `getDiagnostics`, `onDidChangeDiagnostics` | ✅ | all collections of the extension host plus the editor's own markers (settings, tasks); the event coalesces changes over 50 ms. Deviations: editor markers that existed before the extension host started arrive as an initial batch; removal of an editor marker is reported even when the resource still has markers of its own |
| `registerCompletionItemProvider` | ✅ | trigger characters, resolve (documentation, auto-import) |
| `registerDefinitionProvider` | ✅ | |
| `registerHoverProvider` | ✅ | multiple providers are concatenated |
| `registerReferenceProvider` | ✅ | |
| `registerRenameProvider` | ✅ | `prepareRename` (both response forms), edits across all affected files as one undo step; the new name is asked for in an input box, there is no inline rename widget |
| `registerSignatureHelpProvider` | ✅ | both registration overloads |
| `registerDocumentFormattingEditProvider` | ✅ | |
| `registerDocumentRangeFormattingEditProvider` | ✅ | the multi-range `provideDocumentRangesFormattingEdits` is not active |
| `registerCodeActionsProvider` | ✅ | quickfix, organize imports, fix all; `CodeAction.disabled` as in VS Code (hidden from Quick Fix, auto-apply names the reason); there is no lightbulb indicator |
| `registerFoldingRangeProvider` | ✅ | |
| `registerSelectionRangeProvider` | ✅ | Expand/Shrink Selection; provider steps are merged with the built-in ones (word, subword, line, document); `vscode.executeSelectionRangeProvider` is not exposed |
| `registerDocumentSemanticTokensProvider` | ✅ | semantic highlighting on top of TextMate: deltas, `onDidChangeSemanticTokens`, theme `semanticTokenColors` with fallback to TextMate scopes, `contributes.semanticToken*`, `editor.semanticHighlighting.enabled`; `editor.semanticTokenColorCustomizations` is not supported |
| `registerDocumentRangeSemanticTokensProvider` | ✅ | used for the visible range while full document tokens are not yet available |
| `createLanguageStatusItem` | 🟡 | the item stores its fields and can be disposed; it is not shown in the UI yet |
| `match` | ✅ | works at runtime (selector scoring); not declared in `vscode.d.ts` yet |
| other `register*Provider` (16: declaration, implementation, typeDefinition, documentHighlight, documentSymbol, workspaceSymbol, codeLens, documentLink, color, onTypeFormatting, inlayHints, inlineValues, inlineCompletion, linkedEditingRange, callHierarchy, typeHierarchy) | 🕐 | registration is accepted as a no-op; the provider is never called |
| `setLanguageConfiguration` | 🟡 | `wordPattern` (for `TextDocument.getWordRangeAtPosition` only; not passed to the editor's word selection and completion boundaries), `comments`, `brackets`, `autoClosingPairs` (layered over `language-configuration.json`: a set section replaces the file's, the latest layer wins, dispose removes it). Not applied: `indentationRules`, `onEnterRules`, `LineCommentRule.noIndent`, `notIn: RegEx/Other`, the deprecated `__electricCharacterSupport`/`__characterPairSupport` |
| `getLanguages`, `setTextDocumentLanguage`, `registerEvaluatableExpressionProvider`, `registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider` | 🕐 | |

## vscode.workspace

🟡 **24/45.** Documents, configuration, saving and its events, file watchers, disk access, file
search by glob and bulk `applyEdit` (including closed files and file operations) work; the notebook
surface does not.

| member | status | comment |
| --- | :-: | --- |
| `workspaceFolders`, `name` | ✅ | |
| `textDocuments`, `openTextDocument` | ✅ | `{ encoding }` decodes non-utf8 files; `openTextDocument({ content, language })` creates an untitled buffer; `openTextDocument(untitled:-uri)` is not supported yet |
| `onDidOpen/onDidClose/onDidChangeTextDocument` | ✅ | |
| `onWillSaveTextDocument`, `onDidSaveTextDocument` | ✅ | composed with `codeActionsOnSave` and `formatOnSave` |
| `getConfiguration`, `onDidChangeConfiguration` | ✅ | layers default → user → workspace → folder; workspace settings live in `.diode/settings.json` (VS Code: `.vscode/settings.json`), a `.code-workspace` file's `settings` block is the workspace layer with `.diode/settings.json` of the folder on top; `inspect()` reports the layers. `update()` as in VS Code: targets, `undefined` removes the key, the new value is visible to `get()` when the promise resolves; refusals (unregistered key, empty window, `application`/`machine` scope into the workspace) reject with VS Code's messages. Deviation: `overrideInLanguage` (writing a language section) is rejected |
| `asRelativePath` | ✅ | |
| `applyEdit` | 🟡 | text edits to open resources (the buffer stays dirty) and closed ones (written to disk), plus `createFile`/`deleteFile`/`renameFile` with `overwrite`/`ignoreIfExists`/`ignoreIfNotExists`, in insertion order; one undo step per affected open file; `metadata.isRefactoring` saves per `files.refactoring.autoSave`; all-or-nothing (a read-only resource, an unreadable file, a name collision or overlapping edits reject the whole edit with `false`). Deviations: `recursive` on `deleteFile` is ignored (deletion is always recursive, to the trash); `WorkspaceEditEntryMetadata` is dropped (no preview mode); `contents` given as `DataTransferFile` is ignored |
| `createFileSystemWatcher` | ✅ | `RelativePattern`, `ignore*Events`, excludes from `files.watcherExclude` |
| `fs` | 🟡 | the whole `FileSystem` surface on the `file` scheme and on schemes of providers from the same extension (`stat`, `readFile`, `writeFile`; writes into a read-only scheme give `NoPermissions`; other operations on a provider scheme are `Unavailable` for now). Deviations: `useTrash` on `delete` is ignored; `isWritableFileSystem` is `true` for `file`, the provider's `isReadonly` for its scheme, `undefined` for an unknown scheme |
| `registerFileSystemProvider` | 🟡 | `watch`/`stat`/`readFile`/`writeFile`/`onDidChangeFile` and `isReadonly`. A writable provider's resource as a side of a diff (`vscode.diff`) is a live document: editable, saved through the provider (with save events), re-read on `onDidChangeFile`. Deviations: such a resource opens only as a side of a diff, not as a regular tab; `openTextDocument` on a provider scheme returns the document without opening it; the editor never calls `watch`, `readDirectory`, `createDirectory`, `delete`, `rename`, `copy`; `isCaseSensitive` is ignored; a provider without `writeFile` is treated as read-only |
| `findFiles` | 🟡 | both forms of `GlobPattern`, the three meanings of `exclude` (`undefined`: `files.exclude`, `null`: none, a pattern), `maxResults`, cancellation. Deviations: globs have no `[0-9]` ranges; the walk is capped at 5000 directories per request |
| `registerTextDocumentContentProvider` | ✅ | non-disk resources open in a read-only tab; `onDidChange` re-reads an open one; `openTextDocument` on such a scheme asks the provider |
| `isTrusted`, `onDidGrantWorkspaceTrust` | 🟡 | no trust model: always `true`, the event never fires |
| `getWorkspaceFolder` | ✅ | works at runtime (matches on a path segment boundary, a file outside the workspace gives `undefined`); not declared in `vscode.d.ts` yet |
| folder and file operation events (`onDidChangeWorkspaceFolders`, `onWill/onDid{Create,Delete,Rename}Files`) | 🕐 | subscription is accepted as a no-op, the event never fires |
| notebook surface (8 members: `notebookDocuments`, `openNotebookDocument`, `registerNotebookSerializer`, events) | 🕐 | |
| `registerTaskProvider` | ✅ | the deprecated twin of `tasks.registerTaskProvider` |
| `workspaceFile` | ✅ | the `Uri` of the `.code-workspace` file the window was opened with (single-folder files only), otherwise `undefined`; such a window is named `<file> (Workspace)` |
| `saveAll` | 🟡 | saves all unsaved files in all groups; a file changed on disk is not overwritten and a write failure gives `false` while the others are still saved. Deviation: `includeUntitled` does not open Save As, untitled buffers stay unsaved and the result is `false` |
| `save` | ✅ | saves the open document (a clean one too) and returns its `Uri`; not open, untitled, a disk conflict or a write failure give `undefined` |
| `rootPath`, `saveAs`, `decode`, `encode` | 🕐 | |
| `updateWorkspaceFolders` | 🟡 | VS Code's checks (duplicates, bounds, "nothing changes" gives `false`). There is no multi-root: an outcome of exactly one folder is carried out like File: Open Folder and restarts extensions (VS Code reloads the window); two or more folders, or none, give `false` and an error toast; the folder `name` is ignored |

## vscode.window

🟡 **35/57.** Editors (including the selection event), the active theme, messages, progress,
output channels, decorations, status bar items, quick input (text line, list, file dialogs) and
extension terminals and tree views work; webview is the ceiling.

| member | status | comment |
| --- | :-: | --- |
| `activeTextEditor`, `visibleTextEditors` | ✅ | both sides of a visible diff tab are visible editors. Deviation: a snapshot side (a git revision, the clipboard, "on disk") has no document of its own and is not in `visibleTextEditors` |
| `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorViewColumn` | ✅ | |
| `state`, `onDidChangeWindowState` | ✅ | |
| `showTextDocument` | 🟡 | opens the resource but returns the active editor |
| `showInformation/Warning/ErrorMessage` | ✅ | all four overloads, `MessageOptions` (`modal` + `detail`). Non-modal: a toast above the status bar; without buttons it closes on its own (info 10 s, warning 12 s, error 15 s), with buttons it waits about a minute without taking focus; at most three toasts at once; no notification center yet. Modal: a dialog in the center, Escape returns the `isCloseAffordance` button. Deviation: a message without buttons resolves when shown, not when the toast closes |
| `createOutputChannel` | 🟡 | a channel in the Output panel with log levels; `clear`/`replace` are no-ops |
| `withProgress` | 🟡 | a spinner in the status bar, message/increment are live; cancellation is not supported, the token never fires |
| `tabGroups` | 🟡 | `Tab` objects are snapshots taken at the call (no identity across calls); `onDidChangeTabs` is live, `close` works |
| `createTextEditorDecorationType` | ✅ | gutter change bars, overview ruler |
| `registerFileDecorationProvider` | ✅ | decorations in the explorer; `propagate` bubbles up to folders (color and "●") |
| `showQuickPick` | 🟡 | strings and `QuickPickItem`s: filtering by `label`, `canPickMany` with `picked`, `placeHolder`, `title`, cancellation, a promise of items. Not supported: separators (neither shown nor selectable), `iconPath`, `buttons`, `alwaysShow`, `matchOnDescription`/`matchOnDetail`, `ignoreFocusOut`, `onDidSelectItem`; `detail` is drawn only when `description` is empty (one line per row) |
| `showInputBox` | 🟡 | `title`, `prompt`, `placeHolder`, `value`, `password`, `validateInput` (string and object forms, async, an error blocks Enter), cancellation. Not supported: `valueSelection`, `ignoreFocusOut` |
| `createQuickPick` | 🟡 | a live picker with all the events (`onDidChangeValue`/`onDidAccept`/`onDidChangeActive`/`onDidChangeSelection`/`onDidHide`); `items`/`activeItems`/`selectedItems` can change while open; Enter does not close the picker, Enter on an empty list gives `onDidAccept` without a selection; `title` with `step`/`totalSteps`, `placeholder`, `prompt`, `value`, `canSelectMany`, `matchOnDescription`/`matchOnDetail`, `alwaysShow`, `keepScrollPosition`. Not drawn: separators, `busy`, `enabled: false`; not supported: `buttons` and item buttons, `iconPath`, `ignoreFocusOut`; `detail` as in `showQuickPick` |
| `QuickPickItemKind` | ✅ | |
| `showOpenDialog`, `showSaveDialog` | 🟡 | VS Code's simple (text-based) file dialog: a path line with the directory listing below, `..` and `~`, completion by arrow key, overwrite and create-directory prompts, filters, the first filter's extension on save. Local file system only; `canSelectMany` is not supported; `openLabel`/`saveLabel` are not drawn (Enter confirms) |
| other quick input (`showWorkspaceFolderPick`, `createInputBox`) | 🕐 | |
| `createStatusBarItem` | 🟡 | `text` with `$(name)` icons, `name`, `alignment`, `priority`, `command`, `show`/`hide`/`dispose`. Stubs: `tooltip`, `color`, `backgroundColor`, `accessibilityInformation`. Text longer than 24 characters is truncated |
| `setStatusBarMessage` | ✅ | all three overloads; one shared "Extension Status" item for all extensions, messages form a stack |
| `createTerminal`, `terminals`, `activeTerminal`, `onDidOpenTerminal`, `onDidCloseTerminal`, `onDidChangeActiveTerminal` | 🟡 | a real shell of the integrated terminal, in the panel or in the editor area (`location`: `TerminalLocation.Editor`, `{ viewColumn, preserveFocus }`, `{ parentTerminal }`, else `terminal.integrated.defaultLocation`). `TerminalOptions`: `name`, `shellPath`, `shellArgs`, `cwd`, `env` (`null` unsets), `strictEnv`, `hideFromUser`, `message`. `Terminal`: `sendText`, `show`, `hide`, `dispose`, `processId`, `exitStatus` with a reason; methods throw after `dispose()`. `ExtensionTerminalOptions` (`pty`): `onDidWrite` is drawn, `open` (initial size 80×24, the real size follows in `setDimensions`), `handleInput`, `onDidClose`, `close()`. `terminals` and the events cover shells opened by a person too. Not supported: `color`, `iconPath`, `shellIntegrationNonce`, `isTransient` (accepted, ignored), `onDidOverrideDimensions`, `onDidChangeName`; a terminal in the editor area never becomes `activeTerminal`; `state.isInteractedWith` is always `false`; string `shellArgs` are split on spaces; the name does not follow the process title |
| `onDidChangeTerminalShellIntegration`, `onDidStartTerminalShellExecution`, `onDidEndTerminalShellExecution` | 🟡 | no shell integration: `Terminal.shellIntegration` is always `undefined`, the events never fire |
| `onDidChangeTerminalState`, `registerTerminalLinkProvider`, `registerTerminalProfileProvider` | 🕐 | |
| trees (`registerTreeDataProvider`, `createTreeView`) | 🟡 | the tree is drawn in the view's section: `contributes.views` gives it one in Explorer, Source Control, a panel tab or the extension's own `contributes.viewsContainers` container (listed by the view switcher on the sidebar title, Diode's stand-in for the activity bar); the view's `when` is followed live. The section is empty until the extension registers its tree. Rows: label (a `TreeItemLabel`'s text; `highlights` are not drawn), dimmed `description` (`true` — the resource's folder relative to the workspace), chevron by `collapsibleState` (`Expanded` opens on first show), a `ThemeIcon` as its codicon in its theme color, a `resourceUri` without an icon gets the file icon as in Explorer; an SVG/PNG `iconPath` is not drawn. The root is read when the section is visible, children on expand; Enter or a click (`workbench.list.openMode`) runs `TreeItem.command` with its arguments, a failure is an error toast; `onDidChangeTreeData` rereads the root or the changed rows (debounced as in VS Code), expansion and the cursor survive by handle. `TreeView`: `visible`/`onDidChangeVisibility`, `selection`/`onDidChangeSelection` (`canSelectMany`), `onDidExpandElement`/`onDidCollapseElement`, `reveal` (rejects without `getParent`), `title`, `description`, `message`, `showCollapseAll`, `dispose` work; `badge` is kept but not drawn (no activity bar). Not supported: checkboxes (`TreeItemCheckboxState`, `manageCheckboxStateManually`), drag and drop, `resolveTreeItem`, `tooltip` (no hovers); `view/item/context` menus come later; `visibility: hidden`, `viewsWelcome` and view icons are not applied; `type: "webview"` views are not shown. Deviation: a tree for a view nobody contributed is an Output line, not an error |
| `onDidChangeTextEditorSelection` | ✅ | every cursor or selection change; `kind` is `Keyboard`, `Mouse`, `Command` or `undefined` (undo/redo, find, folding, programmatic edits) as VS Code allows; a selection the extension set itself is not echoed back; a tab becoming visible with a restored cursor fires with `kind` `undefined`, after `onDidChangeActiveTextEditor` |
| editor events (`onDidChangeTextEditorVisibleRanges`, `onDidChangeTextEditorOptions`) | 🕐 | |
| notebook editors (7 members) | 🕐 | |
| `activeColorTheme`, `onDidChangeActiveColorTheme` | ✅ | `ColorThemeKind` is correct already in `activate()`; the event fires on every theme change, including between two themes of the same kind |
| `registerUriHandler` | ✅ | one handler per extension; the address is `diode://<extension id>/…` (`env.uriScheme`). A URL for an extension without a handler is buffered for five minutes and activates it via [`onUri`](#activation-events-activationevents). Before delivery the person is asked "Allow '…' extension to open this URI?", except for ids in `extensions.confirmedUriHandlerExtensionIds`. URLs come from the `Developer: Open URL` command only; the OS protocol handler and `--open-url` are not wired up. Deviations: the dialog has no "Do not ask me again" checkbox; a URL for an extension that is not installed reports it as missing instead of installing it |
| `withScmProgress` | 🕐 | |
| `createWebviewPanel`, `registerWebviewPanelSerializer`, `registerWebviewViewProvider` | ⛔ | webview needs a browser. Not declared; at runtime the members exist as an inert no-op (no panel, one line in Output), so the rest of the extension keeps working |
| `registerCustomEditorProvider` | ⛔ | custom editors are built on webview; the same inert no-op |

## vscode.commands

🟡 **3/4.**

| member | status | comment |
| --- | :-: | --- |
| `registerCommand` | ✅ | |
| `executeCommand` | ✅ | the editor's built-in commands and `setContext` (settings are readable in when clauses as `config.<key>`, as in VS Code); of the API commands, `vscode.open` (a `Uri` opens a tab with column/options like `showTextDocument`; http(s) opens externally like `env.openExternal`) |
| `registerTextEditorCommand` | 🟡 | without an active editor: a warning and no-op, as in VS Code; the edit builder is inert, use `workspace.applyEdit` for edits |
| `getCommands` | 🕐 | |

## vscode.extensions

🟡 **3/3.** Reports the real set of extensions, with one discrepancy named below.

| member | status | comment |
| --- | :-: | --- |
| `getExtension` | ✅ | the real catalog entry (id, `extensionUri`/`extensionPath`, `packageJSON`, a live `isActive`, the `exports` of an active extension); ids are compared case-insensitively; correct already in `activate()` |
| `all` | 🟡 | every extension known to the extension host, **except declarative extensions**: language packs without `main` are not in `all` (in VS Code they are) |
| `onDidChange` | ✅ | fires when the set changes, not on activation |

## vscode.tasks

🟡 **8/8.** The namespace and the task types (`Task`, `TaskScope`, `TaskGroup`, `ShellExecution`,
`ProcessExecution`, `CustomExecution`, `TaskDefinition`, `TaskProvider`, `TaskExecution`, events)
are declared. Tasks are run by the editor: Run Task, the task terminal, Rerun / Restart / Terminate
/ Show Running Tasks, the same as for tasks from `.diode/tasks.json` (VS Code: `.vscode/tasks.json`).
**Problem matchers are not executed**: a task simply runs until the process exits.

| member | status | comment |
| --- | :-: | --- |
| `registerTaskProvider` | ✅ | provider tasks show up in Run Task (the type from `contributes.taskDefinitions` is the picker's second level); the provider is waited for up to 5 s; `task.autoDetect: off` skips it. A `tasks.json` entry with the provider's type is merged with the provider task by the definition key; `resolveTask` is not called, so an entry with no matching provider task is an error in the `Tasks` log |
| `fetchTasks` | ✅ | tasks from `tasks.json` and all providers; `{ type }` limits to providers of that type |
| `executeTask` | ✅ | the extension's own task comes back in events as the same object; `task.saveBeforeRun` and `instancePolicy` apply |
| `taskExecutions` | ✅ | all running tasks, including those started from the palette or by another extension |
| `onDidStartTask`, `onDidEndTask` | ✅ | for all tasks, including those started from the palette |
| `onDidStartTaskProcess` | 🟡 | the shell process pid; `-1` for a `CustomExecution` task, as in VS Code |
| `onDidEndTaskProcess` | ✅ | the exit code; `undefined` when the task terminal was closed |

The task types follow the contract, with differences:

| symbol | difference |
| --- | --- |
| `Task.group`, `TaskGroup` | stored, but there are no build/test groups yet (Run Build Task); does not affect running |
| `Task.problemMatchers` | stored, not executed |
| `TaskScope.Global` | a task without a folder; runs as is |
| `RunOptions` | `reevaluateOnRerun` works; `instancePolicy` for `tasks.json` tasks as well; an `instanceLimit` above 1 behaves as 1; `runOn: folderOpen` does not start on its own |
| `TaskPresentationOptions` | `reveal`, `focus`, `echo`, `panel` (dedicated/shared/new), `showReuseMessage`, `clear`, `group`, `close` |
| `CustomExecution` | the extension's pty is attached to the task terminal; a rerun reuses the terminal with a new pty |

## vscode.l10n

🟡 **3/3.** Declared; there are no translation bundles.

| member | status | comment |
| --- | :-: | --- |
| `t` | 🟡 | substitutes placeholders (`{0}`, `{name}`, the options form); no translations |
| `bundle`, `uri` | 🟡 | `undefined` |

## vscode.env

🟡 **15/21.** The clipboard, opening external links and the environment constants that extensions
read in `activate()` (language clients, telemetry reporters).

| member | status | comment |
| --- | :-: | --- |
| `appName`, `appHost`, `uriScheme`, `language` | 🟡 | constants (`Diode` / `desktop` / `diode` / `en`); `language` is always `en` |
| `clipboard` | ✅ | the editor's clipboard: writes also go to the system clipboard via OSC 52; reads return what was last copied inside Diode (no OSC 52 read, many terminals forbid it); external text arrives through the terminal's paste gesture |
| `openExternal` | 🟡 | `http`/`https`/`mailto` go to the system handler; without a graphical session (ssh, a container) the URL is copied to the clipboard and shown in a message, which counts as success (`true`); other schemes give `false` |
| `uiKind` | ✅ | always `UIKind.Desktop` |
| `remoteName` | ✅ | `undefined`: there is no remote extension host |
| `sessionId` | 🟡 | a random id per extension host run. Deviation: it changes when the extension host restarts (in VS Code it survives) |
| `isTelemetryEnabled`, `onDidChangeTelemetryEnabled` | ✅ | Diode has no telemetry: always `false`, the event never fires |
| `createTelemetryLogger` | ✅ | VS Code's logger with telemetry off: `isUsageEnabled`/`isErrorsEnabled` are `false`, nothing reaches the sender, the first `dispose` calls the sender's `flush`; `TelemetryTrustedValue` is real |
| `machineId` | ✅ | as in VS Code: sha256 of the first MAC address (a uuid without one), stable between runs |
| `shell` | ✅ | the shell the integrated terminal launches (`$SHELL`, the account's shell, `sh`; `%COMSPEC%` on Windows); there are no terminal profiles to change it |
| `onDidChangeShell` | ✅ | a valid event that never fires (the shell does not change) |
| `isNewAppInstall`, `isAppPortable` | 🕐 | |
| `asExternalUri` | 🕐 | there is no OS protocol handler for `diode://` yet |
| `logLevel`, `onDidChangeLogLevel` | 🕐 | |

## vscode.comments

🟡 **1/1.** Declared (controller, thread, comment and their enums), the runtime is inert: no
threads in the gutter or in a Comments panel yet.

| member | status | comment |
| --- | :-: | --- |
| `createCommentController` | 🟡 | a controller with `id`/`label`; `createCommentThread` returns a thread with VS Code's defaults, its fields are writable, `dispose` works. Nothing is drawn; `commentingRangeProvider` and `reactionHandler` are never called; one line per controller in Output. `CommentThreadCollapsibleState`, `CommentMode`, `CommentThreadState` are real |

## vscode.authentication

🟡 **4/4.** Declared, the runtime is a null object: there is no sign-in in Diode yet.

| member | status | comment |
| --- | :-: | --- |
| `getSession` | 🟡 | without `createIfNone`/`forceNewSession`: `undefined` (not signed in); with them: a rejection saying sign-in is not supported yet (the overload promises a session, so `undefined` would be a `TypeError` in the extension); options incompatible with `silent` give VS Code's errors |
| `getAccounts` | 🟡 | an empty list |
| `onDidChangeSessions` | 🟡 | a valid event that never fires |
| `registerAuthenticationProvider` | 🟡 | a `Disposable`; the provider is never called; one line per provider in Output |

## vscode.debug

🟡 **18/18.** Declared, the runtime is a null object: Diode has no debugger yet (the Debug
Adapter Protocol is planned, see [status](STATUS.md)).

| member | status | comment |
| --- | :-: | --- |
| `registerDebugConfigurationProvider`, `registerDebugAdapterDescriptorFactory`, `registerDebugAdapterTrackerFactory` | 🟡 | a `Disposable`; providers and factories are never called; one line per debugger type in Output |
| `startDebugging` / `stopDebugging` | 🟡 | `false` (one line in Output) / resolves |
| `activeDebugSession`, `activeStackItem`, `breakpoints`, `activeDebugConsole` | 🟡 | `undefined` / `undefined` / empty / a console whose output is not shown |
| `onDidChangeActiveDebugSession`, `onDidStartDebugSession`, `onDidReceiveDebugSessionCustomEvent`, `onDidTerminateDebugSession`, `onDidChangeBreakpoints`, `onDidChangeActiveStackItem` | 🟡 | valid events that never fire |
| `addBreakpoints`, `removeBreakpoints` | 🟡 | no-op |
| `asDebugSourceUri` | ✅ | a `debug:` uri for `sourceReference`, `file:` for a path |

The value types are VS Code's: `DebugAdapterExecutable`, `DebugAdapterServer`,
`DebugAdapterNamedPipeServer`, `DebugAdapterInlineImplementation`, `Breakpoint`,
`SourceBreakpoint`, `FunctionBreakpoint`, `DebugThread`, `DebugStackFrame`, the enums
`DebugConsoleMode`, `DebugConfigurationProviderTriggerKind`. The `onDebug*` activation events do not
fire (see the table below).

## vscode.tests

🟡 **1/1.** Declared, the runtime is inert: there is no Testing view.

| member | status | comment |
| --- | :-: | --- |
| `createTestController` | 🟡 | a controller with `id`/`label`; `items` and `children` are working collections; `createTestItem`, `createRunProfile`, `createTestRun` (accepts reports, `end` fires `onDidDispose` once) work. `runHandler`, `resolveHandler`, `refreshHandler` are never called; one line per controller in Output |

The value types are VS Code's: `TestRunProfileKind`, `TestTag`, `TestRunRequest`, `TestMessage`
(with `diff`), `TestMessageStackFrame`, `TestCoverageCount`, `FileCoverage` (with `fromDetails`),
`StatementCoverage`, `BranchCoverage`, `DeclarationCoverage`.

## Activation events (`activationEvents`)

The part of the contract that lives in `package.json` and decides whether the extension starts at
all. An extension whose events are not supported installs, shows up in the catalog, and stays
silent forever.

**8 of 32** kinds of upstream 1.127.0 events are active (`*` plus 31 named kinds). The
unsupported ones are grouped by the surface they wait for.

| event | status | comment |
| --- | :-: | --- |
| `*` | ✅ | eager. Deviation: an empty or missing list also means `*` (in VS Code it means never); extensions already in the store rely on this |
| `onStartupFinished` | ✅ | after the files from the launch arguments are opened |
| `onLanguage:<id>` | ✅ | when a language first needs its features, for any document (a new file, a language change, a background tab, a diff side); the bare `onLanguage` too |
| `onCommand:<id>` | ✅ | plus the implicit events from `contributes.commands`, as in VS Code: the command is in the palette before activation and waits for `activate()`; `contributes.languages` produces implicit `onLanguage:<id>` |
| `workspaceContains:<pattern>` | 🟡 | both forms (a path that exists, a glob search). Deviation: globs are anchored to the workspace-relative path, so `workspaceContains:*.py` matches the root only (in VS Code a pattern without `/` matches at any depth); `**/pyproject.toml` works |
| `onUri` | ✅ | a URL for the extension starts it before delivery; a bare `onUri` becomes `onUri:<id>` |
| `onOpenExternalUri` | 🕐 | together with `env.asExternalUri` |
| `onView:<id>` | ✅ | when the view's container is shown (the view switcher on the sidebar title, `workbench.view.extension.<id>`, `<view>.focus`, or restored with the layout); plus the implicit `onView:<id>` from `contributes.views` |
| `onWalkthrough:<id>` | 🕐 | waits for walkthroughs |
| `onWebviewPanel:<id>`, `onCustomEditor:<id>`, `onRenderer:<id>` | ⛔ | webview surfaces, see [the ceiling](#not-supported-by-design) |
| `onDebug`, `onDebugInitialConfigurations`, `onDebugDynamicConfigurations`, `onDebugResolve:<type>`, `onDebugAdapterProtocolTracker:<type>` | 🕐 | there is no debugger yet |
| `onTaskType:<type>` | ✅ | Run Task starts the providers before asking for tasks (without a type, all types from `contributes.taskDefinitions`); plus the implicit `onTaskType:<type>` from `contributes.taskDefinitions` |
| `onNotebook:<type>` | 🕐 | together with `vscode.notebooks` |
| `onAuthenticationRequest:<id>` | 🕐 | together with real `vscode.authentication` providers |
| `onChatParticipant:<id>`, `onChatContextProvider:<id>`, `onLanguageModelChatProvider:<id>`, `onLanguageModelTool:<id>` | 🕐 | together with `vscode.chat` / `vscode.lm` |
| `onTerminal`, `onTerminalProfile:<id>`, `onTerminalQuickFixRequest:<id>`, `onTerminalShellIntegration` | 🕐 | together with the corresponding terminal contributions |
| `onFileSystem:<scheme>`, `onSearch:<scheme>`, `onEditSession:<scheme>`, `onIssueReporterOpened` | 🕐 | |

## Namespaces not yet exposed

| namespace | status | comment |
| --- | :-: | --- |
| `vscode.scm` | 🕐 | source control |
| `vscode.notebooks` | 🕐 | serialization is possible; cell renderers are webview and will not be supported |
| `vscode.chat`, `vscode.lm` | 🕐 | text-based by nature, nothing stops them from working in a terminal |

## Not supported by design

The ceiling is everything that inherently requires a browser:

- `window.createWebviewPanel`, `window.registerWebviewPanelSerializer`,
  `window.registerWebviewViewProvider`: webview;
- `window.registerCustomEditorProvider`: custom editors are built on webview;
- notebook cell renderers (the Notebook API itself is 🕐).

"Not supported" refers to the panel, not to the extension. These members are not declared in
Diode's `vscode.d.ts`, but at runtime they exist as inert no-ops: the call returns a dead panel or a
`Disposable`, no panel opens, one line in Output says that webview is not supported, and the rest
of the extension (commands, providers, language server) keeps working. The runtime stub does not
change the ⛔ status.

## Types with a partial surface

262 of 424 upstream types and classes are declared. The declared ones are complete, except those
listed below, where only a subset of members is declared. `TextDocument` is listed for a different
reason: everything is declared and implemented, but `save` is a 🟡 stub.

| type | active | not active |
| --- | :-: | --- |
| `TextEditor` | 7/12 | `visibleRanges`, `insertSnippet`, `revealRange`, `show`, `hide` |
| `TextDocument` | 19/19 | — (the class is checked by the compiler against `vscode.TextDocument`). `save` goes through the editor with save participants and the scheme's provider; a document not open in the editor gives `false`, a closed one rejects. `getWordRangeAtPosition` uses VS Code's default word definition or the extension's regex (no language `wordPattern`; a regex matching the empty string throws). `offsetAt`/`positionAt`/`validateRange`/`validatePosition` work |
| `TextEditorOptions` | 3/5 | `cursorStyle`, `lineNumbers` |
| `TerminalOptions` | 12/13 | `iconPath` |
| `TreeViewOptions` | 4/5 | `dragAndDropController` (no drag-and-drop in a terminal) |
| `ExtensionTerminalOptions` | 6/7 | `iconPath` |
| `ExtensionContext` | 16/17 | `languageModelAccessInformation`. Among the active ones: `environmentVariableCollection`, see [semantic deviations](#semantic-deviations); `extension` is the extension's own catalog entry; `globalState`/`workspaceState` survive a restart; `globalState.setKeysForSync` is a no-op (there is no Settings Sync) |
| `WorkspaceEdit` | 11/11 | — |
| `WorkspaceEditEntryMetadata` | 3/4 | `iconPath` |
| `FileStat` | 4/5 | `permissions` |
| `FileSystemProvider` | 5/10 | `readDirectory`, `createDirectory`, `delete`, `rename`, `copy` |
| `DocumentFilter` | 3/4 | `notebookType` |
| `CompletionItem` | 9/16 | `tags`, `sortText`, `filterText`, `preselect`, `commitCharacters`, `keepWhitespace`, `textEdit`. `additionalTextEdits` works both in the list and when loaded by resolve |
| `DocumentRangeFormattingEditProvider` | 1/2 | `provideDocumentRangesFormattingEdits` |
| `LanguageStatusItem` | 9/10 | `accessibilityInformation` |
| `DataTransferFile` | 3/3 | — (declared for `createFile({ contents })`; there is no drag-and-drop, so such `contents` is ignored) |

## Semantic deviations

The type matches VS Code, the meaning differs:

| symbol | deviation |
| --- | --- |
| `vscode.version` | the version of **Diode**, not of VS Code |
| `Event<T>` | subscriptions are wrapped in the extension host's own emitter |
| `TextEditorOptions.indentSize` | aliased to `tabSize`; Diode does not distinguish them yet |
| `environmentVariableCollection` | the whole API (`replace`/`append`/`prepend`, `get`, `forEach`, iteration, `delete`, `clear`, `description`, `persistent`, `getScoped` per folder). Collections of all extensions are merged as in VS Code and applied to every terminal process (a person's shells, extension terminals, tasks), except terminals with `strictEnv`; `persistent` collections survive a restart and are available in `activate()`. Deviations: `applyAtShellIntegration` has no effect (no shell integration); no "environment is stale" indicator and no relaunch on `terminal.integrated.environmentChangesRelaunch`, the next process gets the new values; `${…}` variables in values are not expanded |
| `SecretStorage` | **unencrypted**: there is no OS keychain, secrets are stored in plain text in `<profileDir>/secrets.json` with `0600` permissions. Everything else follows the contract: `get`/`store`/`delete`/`keys`, `onDidChange` on writes and deletes, values survive a restart, one compartment per extension |
| `Extension.extensionKind` | always `ExtensionKind.UI`, as VS Code prescribes when there is no remote extension host |
| `Extension.activate()` | for an already active extension returns its `exports`; for an inactive one rejects with an explanation (activation is driven by activation events only) |
| namespaces / value types | the runtime may be ahead of the declaration (see `languages.match`, `workspace.getWorkspaceFolder`) |

## How to read "partial"

"Partial" does not mean "works at half strength", but "the surface is declared, and the members
marked in the comment are stubs". A row's comment names exactly which members are not active, so
that an extension author can check their case in a minute without running Diode.
