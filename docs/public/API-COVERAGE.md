# Матрица готовности: API расширений VS Code

**Конечная цель diode — полная поддержка API расширений VS Code везде, где она имеет смысл в
терминале.** Всё, что по природе требует браузера (webview и UI-heavy поверхности), не будет
поддержано никогда — и это указано в матрице явно, а не замолчано. Важная асимметрия: языковая
поддержка экосистемы (LSP, грамматики, темы, сниппеты, форматтеры) через webview не ходит — она
живёт в обычном extension API, который здесь есть.

Версия API: **1.127.0** (пин `extensions/VSCODE_VERSION`; матрица сверена с этим пином).
Матрица ведётся руками, но каждый статус сверяем с исходниками: активная поверхность API — это
дословно раскомментированные строки запиннённого `src/vscode-dts/vscode.d.ts`; матрица обновляется
в том же PR, который меняет поверхность.

## Легенда

| статус | значение |
| --- | --- |
| ✅ | поддержано — раскомментировано в `vscode.d.ts`, закрыто тестами |
| 🟡 | частично — поверхность есть, отмеченные члены пока стабы |
| 🕐 | запланировано — в роадмапе, пока закомментировано |
| ⛔ | не будет by design — требует браузера/GUI |

## Сводка

Счётчик N/M — сколько членов namespace активно из имеющихся в upstream 1.127.0 (перегрузки
считаются одним членом). Поверхности ⛔ живут внутри `window` — см. [потолок](#не-будет-by-design).

| поверхность | статус | члены |
| --- | :-: | --- |
| [`vscode.languages`](#vscodelanguages) | 🟡 | 11/40 |
| [`vscode.workspace`](#vscodeworkspace) | 🟡 | 18/45 |
| [`vscode.window`](#vscodewindow) | 🟡 | 16/57 |
| [`vscode.commands`](#vscodecommands) | 🟡 | 3/4 |
| [`vscode.extensions`](#vscodeextensions) | 🟡 | 3/3 |
| [`vscode.l10n`](#vscodel10n) | 🟡 | 3/3 |
| [`vscode.env`](#пока-не-поднятые-namespace) | 🟡 | 0/21 |
| [`vscode.tasks`](#пока-не-поднятые-namespace) | 🕐 | 0/8 |
| [`vscode.debug`](#пока-не-поднятые-namespace) | 🕐 | 0/18 |
| [`vscode.scm`](#пока-не-поднятые-namespace) | 🕐 | 0/2 |
| [`vscode.notebooks`](#пока-не-поднятые-namespace) | 🕐 | 0/3 |
| [`vscode.authentication`](#пока-не-поднятые-namespace) | 🕐 | 0/4 |
| [`vscode.tests`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.chat`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.lm`](#пока-не-поднятые-namespace) | 🕐 | 0/7 |
| [типы и классы](#типы-с-неполной-поверхностью) | — | 99/424 |

## vscode.languages

🟡 **11/40.** Языковой стек уровня LSP поднят целиком; остальные провайдеры принимают
регистрацию, но пока не дёргаются.

| член | статус | комментарий |
| --- | :-: | --- |
| `createDiagnosticCollection` | 🟡 | работает (squiggle + Problems); related information не передаётся, маркеры умершего extension host не сбрасываются до его рестарта |
| `registerCompletionItemProvider` | ✅ | trigger-символы, resolve (описание, авто-импорт) |
| `registerDefinitionProvider` | ✅ | |
| `registerHoverProvider` | ✅ | несколько провайдеров конкатенируются |
| `registerReferenceProvider` | ✅ | |
| `registerSignatureHelpProvider` | ✅ | обе перегрузки регистрации |
| `registerDocumentFormattingEditProvider` | ✅ | |
| `registerDocumentRangeFormattingEditProvider` | ✅ | мульти-диапазонный `provideDocumentRangesFormattingEdits` не активен |
| `registerCodeActionsProvider` | ✅ | quickfix, organize imports, fix all; лампочки-индикатора нет |
| `registerFoldingRangeProvider` | ✅ | |
| `createLanguageStatusItem` | 🟡 | держатель полей с честным dispose, в UI пока не проецируется |
| `match` | ✅ | работает в рантайме (скоринг селекторов для языковых клиентов); декларация в `vscode.d.ts` ещё не поднята |
| остальные `register*Provider` (20: declaration, implementation, typeDefinition, documentHighlight, documentSymbol, workspaceSymbol, codeLens, documentLink, color, onTypeFormatting, rename, selectionRange, semanticTokens ×2, inlayHints, inlineValues, inlineCompletion, linkedEditingRange, callHierarchy, typeHierarchy) | 🕐 | регистрация принимается (no-op) — расширение не падает, провайдер не дёргается |
| `getLanguages`, `setTextDocumentLanguage`, `setLanguageConfiguration`, `onDidChangeDiagnostics`, `getDiagnostics`, `registerEvaluatableExpressionProvider`, `registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider` | 🕐 | |

## vscode.workspace

🟡 **18/45.** Документы, конфигурация, события сохранения и файловые watcher'ы — рабочие;
файловые операции `WorkspaceEdit` и notebook-поверхность — нет.

| член | статус | комментарий |
| --- | :-: | --- |
| `workspaceFolders`, `name` | ✅ | |
| `textDocuments`, `openTextDocument` | ✅ | включая `{ encoding }` — реальное декодирование не-utf8 |
| `onDidOpen/onDidClose/onDidChangeTextDocument` | ✅ | |
| `onWillSaveTextDocument`, `onDidSaveTextDocument` | ✅ | композиция save-участников с `codeActionsOnSave`/`formatOnSave` |
| `getConfiguration`, `onDidChangeConfiguration` | ✅ | |
| `asRelativePath` | ✅ | |
| `applyEdit` | 🟡 | текстовые правки по открытым документам, per-документ undo; файловые операции `WorkspaceEdit` не поддержаны (edit с ними целиком отвечает `false`) |
| `createFileSystemWatcher` | ✅ | настоящие watcher'ы: `RelativePattern`, `ignore*Events`, excludes из `files.watcherExclude` |
| `fs` | 🟡 | `stat`/`readFile`/`writeFile`; `readDirectory`, `createDirectory`, `delete`, `rename`, `copy` — нет |
| `registerFileSystemProvider` | 🟡 | читающая часть: `watch`/`stat`/`readFile`/`onDidChangeFile` |
| `isTrusted`, `onDidGrantWorkspaceTrust` | 🟡 | модели доверия нет — всегда `true`, событие не стреляет |
| `getWorkspaceFolder` | 🟡 | работает наивно в рантайме (префикс-матч + fallback на первую папку); декларация ещё не поднята |
| события папок и файловых операций (`onDidChangeWorkspaceFolders`, `onWill/onDid{Create,Delete,Rename}Files`) | 🕐 | подписка принимается (no-op), событие не стреляет |
| notebook-поверхность (8 членов: `notebookDocuments`, `openNotebookDocument`, `registerNotebookSerializer`, события) | 🕐 | |
| `rootPath`, `workspaceFile`, `updateWorkspaceFolders`, `findFiles`, `save`, `saveAs`, `saveAll`, `registerTextDocumentContentProvider`, `registerTaskProvider`, `decode`, `encode` | 🕐 | |

## vscode.window

🟡 **16/57.** Редакторы, сообщения, прогресс, output-каналы и декорации — рабочие; quick input,
статус-бар, терминал и деревья пока не отданы расширениям; webview — потолок.

| член | статус | комментарий |
| --- | :-: | --- |
| `activeTextEditor`, `visibleTextEditors` | ✅ | |
| `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorViewColumn` | ✅ | |
| `state`, `onDidChangeWindowState` | ✅ | |
| `showTextDocument` | 🟡 | открывает ресурс, но возвращает активный редактор |
| `showInformation/Warning/ErrorMessage` | ✅ | активна строковая перегрузка action-пунктов |
| `createOutputChannel` | 🟡 | канал в панели Output с уровнями логов; `clear`/`replace` — no-op (журнал ретенционный) |
| `withProgress` | 🟡 | спиннер в статус-баре, message/increment живые; отмена не поддержана — токен не стреляет |
| `tabGroups` | 🟡 | снимки `Tab` на момент вызова (идентичность не гарантируется); `onDidChangeTabs` живой, `close` работает |
| `createTextEditorDecorationType` | ✅ | gutter change-bar'ы, overview ruler |
| `registerFileDecorationProvider` | ✅ | файловые декорации в explorer |
| quick input (`showQuickPick`, `showInputBox`, `showWorkspaceFolderPick`, `showOpenDialog`, `showSaveDialog`, `createQuickPick`, `createInputBox`) | 🕐 | ядро QuickInput в приложении есть, расширениям пока не отдано |
| статус-бар (`createStatusBarItem`, `setStatusBarMessage`) | 🕐 | |
| терминал (12 членов: `createTerminal`, `terminals`, события, shell integration, link/profile-провайдеры) | 🕐 | |
| деревья (`registerTreeDataProvider`, `createTreeView`) | 🕐 | |
| события редактора (`onDidChangeTextEditorSelection`, `onDidChangeTextEditorVisibleRanges`, `onDidChangeTextEditorOptions`) | 🕐 | |
| notebook-редакторы (7 членов) | 🕐 | |
| тема (`activeColorTheme`, `onDidChangeActiveColorTheme`) | 🕐 | |
| `registerUriHandler`, `withScmProgress` | 🕐 | |
| `createWebviewPanel`, `registerWebviewPanelSerializer`, `registerWebviewViewProvider` | ⛔ | webview — требует браузера |
| `registerCustomEditorProvider` | ⛔ | кастомные редакторы построены на webview |

## vscode.commands

🟡 **3/4.**

| член | статус | комментарий |
| --- | :-: | --- |
| `registerCommand` | ✅ | |
| `executeCommand` | ✅ | |
| `registerTextEditorCommand` | 🟡 | без активного редактора — warn + no-op (семантика VS Code); edit-builder инертен, батч-правки — через `workspace.applyEdit` |
| `getCommands` | 🕐 | |

## vscode.extensions

🟡 **3/3** — задекларирован целиком, но реализация наивна: каталог расширений субпроцессу не
раздаётся.

| член | статус | комментарий |
| --- | :-: | --- |
| `getExtension` | 🟡 | честно `undefined` |
| `all` | 🟡 | пуст |
| `onDidChange` | 🟡 | не стреляет |

## vscode.l10n

🟡 **3/3** — задекларирован целиком; бандлов переводов нет.

| член | статус | комментарий |
| --- | :-: | --- |
| `t` | 🟡 | подставляет плейсхолдеры (`{0}`/`{name}`/options-форма), переводов нет |
| `bundle`, `uri` | 🟡 | `undefined` |

## Пока не поднятые namespace

| namespace | статус | комментарий |
| --- | :-: | --- |
| `vscode.env` | 🟡 | декларация не поднята, но в рантайме есть наивный минимум: `appName`/`language` честные, `clipboard` пуст, `openExternal` отказывает |
| `vscode.tasks` | 🕐 | таск-раннер |
| `vscode.debug` | 🕐 | DAP — в заявленном стеке проекта, поверхность появится вместе с дебаггером |
| `vscode.scm` | 🕐 | source control |
| `vscode.notebooks` | 🕐 | сериализация — возможна; рендеры ячеек — webview, их не будет |
| `vscode.authentication` | 🕐 | |
| `vscode.tests` | 🕐 | Test API |
| `vscode.chat`, `vscode.lm` | 🕐 | текстовые по природе — терминалу не противопоказаны |

## Не будет by design

Потолок — всё, что по природе требует браузера:

- `window.createWebviewPanel`, `window.registerWebviewPanelSerializer`,
  `window.registerWebviewViewProvider` — webview;
- `window.registerCustomEditorProvider` — кастомные редакторы построены на webview;
- рендеры notebook-ячеек (сам Notebook API при этом — 🕐).

## Типы с неполной поверхностью

Активно 99 из 424 типов/классов upstream; поднятые — целиком, кроме перечисленных ниже
(bounded member-level uncommenting — раскомментировано подмножество членов).

| тип | активно | не активно |
| --- | :-: | --- |
| `TextEditor` | 7/12 | `visibleRanges`, `insertSnippet`, `revealRange`, `show`, `hide` |
| `TextEditorOptions` | 3/5 | `cursorStyle`, `lineNumbers` |
| `ExtensionContext` | 7/17 | `secrets`, `storageUri`/`storagePath`, `globalStorageUri`/`globalStoragePath`, `logUri`/`logPath`, `environmentVariableCollection`, `extension`, `languageModelAccessInformation` |
| `Extension` | 7/8 | `extensionKind` |
| `WorkspaceEdit` | 8/11 | файловые операции: `createFile`, `deleteFile`, `renameFile` |
| `WorkspaceEditEntryMetadata` | 3/4 | `iconPath` |
| `FileStat` | 4/5 | `permissions` |
| `FileSystem` | 3/9 | `readDirectory`, `createDirectory`, `delete`, `rename`, `copy`, `isWritableFileSystem` |
| `FileSystemProvider` | 4/10 | `readDirectory`, `createDirectory`, `writeFile`, `delete`, `rename`, `copy` |
| `DocumentFilter` | 3/4 | `notebookType` |
| `CompletionItem` | 8/16 | `tags`, `sortText`, `filterText`, `preselect`, `commitCharacters`, `keepWhitespace`, `textEdit`, `additionalTextEdits` |
| `DocumentRangeFormattingEditProvider` | 1/2 | `provideDocumentRangesFormattingEdits` |
| `LanguageStatusItem` | 9/10 | `accessibilityInformation` |

## Семантические отклонения

Тип совпадает с upstream, отличается смысл:

| символ | отклонение |
| --- | --- |
| `vscode.version` | возвращает версию **diode**, а не VS Code |
| `Event<T>` | подписки оборачиваются собственным эмиттером хоста |
| `TextEditorOptions.indentSize` | алиасится к `tabSize` — diode пока их не различает |
| namespaces / value-типы | рантайм может опережать декларацию (см. `languages.match`, `workspace.getWorkspaceFolder`) |

## Как читать «частично»

«Частично» — не «работает вполсилы», а «поверхность объявлена, отмеченные в комментарии члены —
стабы». Комментарий строки называет, какие именно члены не активны, чтобы автор расширения мог
проверить свой случай за минуту, не запуская diode.
