# Матрица готовности: API расширений VS Code

**Конечная цель diode — полная поддержка API расширений VS Code везде, где она имеет смысл в
терминале.** Всё, что по природе требует браузера (webview и UI-heavy поверхности), не будет
поддержано никогда — и это указано в матрице явно, а не замолчано. Важная асимметрия: языковая
поддержка экосистемы (LSP, грамматики, темы, сниппеты, форматтеры) через webview не ходит — она
живёт в обычном extension API, который здесь есть.

Версия API: **1.127.0** (пин `extensions/VSCODE_VERSION`; матрица сверена с этим пином).
Матрица ведётся руками, но каждый статус сверяем с исходниками: активная поверхность API — это
дословно раскомментированные строки запиннённого `src/vscode-dts/vscode.d.ts`; матрица обновляется
в том же PR, который меняет поверхность. Отдельная таблица —
[события активации](#события-активации-activationevents): в `vscode.d.ts` их нет (они живут в
`package.json`), но именно они решают, запустится ли расширение.

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
| [`vscode.languages`](#vscodelanguages) | 🟡 | 14/40 |
| [`vscode.workspace`](#vscodeworkspace) | 🟡 | 21/45 |
| [`vscode.window`](#vscodewindow) | 🟡 | 30/57 |
| [`vscode.commands`](#vscodecommands) | 🟡 | 3/4 |
| [`vscode.extensions`](#vscodeextensions) | 🟡 | 3/3 |
| [`vscode.l10n`](#vscodel10n) | 🟡 | 3/3 |
| [`vscode.env`](#vscodeenv) | 🟡 | 11/21 |
| [`vscode.tasks`](#vscodetasks) | 🟡 | 8/8 |
| [`vscode.debug`](#пока-не-поднятые-namespace) | 🕐 | 0/18 |
| [`vscode.scm`](#пока-не-поднятые-namespace) | 🕐 | 0/2 |
| [`vscode.notebooks`](#пока-не-поднятые-namespace) | 🕐 | 0/3 |
| [`vscode.authentication`](#пока-не-поднятые-namespace) | 🕐 | 0/4 |
| [`vscode.tests`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.chat`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.lm`](#пока-не-поднятые-namespace) | 🕐 | 0/7 |
| [типы и классы](#типы-с-неполной-поверхностью) | — | 172/424 |
| [события активации](#события-активации-activationevents) | 🟡 | 6/32 |

## vscode.languages

🟡 **14/40.** Языковой стек уровня LSP поднят целиком; остальные провайдеры принимают
регистрацию, но пока не дёргаются.

| член | статус | комментарий |
| --- | :-: | --- |
| `createDiagnosticCollection` | 🟡 | работает (squiggle + Problems); related information не передаётся, маркеры умершего extension host не сбрасываются до его рестарта |
| `registerCompletionItemProvider` | ✅ | trigger-символы, resolve (описание, авто-импорт) |
| `registerDefinitionProvider` | ✅ | |
| `registerHoverProvider` | ✅ | несколько провайдеров конкатенируются |
| `registerReferenceProvider` | ✅ | |
| `registerRenameProvider` | ✅ | `prepareRename` (обе формы ответа) + правки по всем затронутым файлам одним шагом отмены; новое имя спрашивается полем ввода, а не inline-виджетом — своего виджета нет |
| `registerSignatureHelpProvider` | ✅ | обе перегрузки регистрации |
| `registerDocumentFormattingEditProvider` | ✅ | |
| `registerDocumentRangeFormattingEditProvider` | ✅ | мульти-диапазонный `provideDocumentRangesFormattingEdits` не активен |
| `registerCodeActionsProvider` | ✅ | quickfix, organize imports, fix all; `CodeAction.disabled` — как эталон (Quick Fix не показывает, авто-применение называет причину); лампочки-индикатора нет |
| `registerFoldingRangeProvider` | ✅ | |
| `registerDocumentSemanticTokensProvider` | ✅ | семантическая подсветка поверх TextMate: дельты (`provideDocumentSemanticTokensEdits`), `onDidChangeSemanticTokens`, `semanticTokenColors` темы и фоллбэк на TM-скоупы, `contributes.semanticToken*`, настройка `editor.semanticHighlighting.enabled`; `editor.semanticTokenColorCustomizations` не поддержана |
| `registerDocumentRangeSemanticTokensProvider` | ✅ | видимая область, пока нет полного набора токенов документа |
| `createLanguageStatusItem` | 🟡 | держатель полей с честным dispose, в UI пока не проецируется |
| `match` | ✅ | работает в рантайме (скоринг селекторов для языковых клиентов); декларация в `vscode.d.ts` ещё не поднята |
| остальные `register*Provider` (17: declaration, implementation, typeDefinition, documentHighlight, documentSymbol, workspaceSymbol, codeLens, documentLink, color, onTypeFormatting, selectionRange, inlayHints, inlineValues, inlineCompletion, linkedEditingRange, callHierarchy, typeHierarchy) | 🕐 | регистрация принимается (no-op) — расширение не падает, провайдер не дёргается |
| `getLanguages`, `setTextDocumentLanguage`, `setLanguageConfiguration`, `onDidChangeDiagnostics`, `getDiagnostics`, `registerEvaluatableExpressionProvider`, `registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider` | 🕐 | |

## vscode.workspace

🟡 **20/45.** Документы, конфигурация, события сохранения, файловые watcher'ы, доступ к диску,
поиск файлов по glob и bulk `applyEdit` (включая закрытые файлы и файловые операции) — рабочие;
notebook-поверхность — нет.

| член | статус | комментарий |
| --- | :-: | --- |
| `workspaceFolders`, `name` | ✅ | |
| `textDocuments`, `openTextDocument` | ✅ | включая `{ encoding }` — реальное декодирование не-utf8 |
| `onDidOpen/onDidClose/onDidChangeTextDocument` | ✅ | |
| `onWillSaveTextDocument`, `onDidSaveTextDocument` | ✅ | композиция save-участников с `codeActionsOnSave`/`formatOnSave` |
| `getConfiguration`, `onDidChangeConfiguration` | ✅ | слои default → user → workspace: настройки проекта — в `.diode/settings.json` открытой папки (у VS Code — `.vscode/settings.json`), `inspect().workspaceValue` честный; `workspaceFolderValue` — `undefined` до мульти-рута. `update()` — как у VS Code: без цели и `Workspace`/`false` — в `.diode/settings.json`, `Global`/`true` — в пользовательский `settings.json`, `WorkspaceFolder` — в тот же файл папки (мульти-рута нет); `undefined` снимает ключ; к резолву `get()` уже видит значение; отказы (незарегистрированный ключ, пустое окно, `application`/`machine` в воркспейс) — rejected promise с текстами VS Code, без тоста. Запись в секцию языка (`overrideInLanguage`) пока отклоняется |
| `asRelativePath` | ✅ | |
| `applyEdit` | 🟡 | настоящий bulk edit: текстовые правки по ОТКРЫТЫМ (через буфер, остаётся «грязным») и ЗАКРЫТЫМ (запись на диск) ресурсам плюс файловые операции `createFile`/`deleteFile`/`renameFile` с опциями `overwrite`/`ignoreIfExists`/`ignoreIfNotExists`, в порядке добавления; весь edit — ОДИН шаг отмены. All-or-nothing: read-only ресурс, нечитаемый файл, коллизия имени или пересекающиеся правки отбивают edit целиком (`false`). Отклонения: `recursive` у `deleteFile` игнорируется (удаление всегда рекурсивное — в корзину уходит всё дерево), `WorkspaceEditEntryMetadata` отбрасывается (preview-режима нет), `contents` в виде `DataTransferFile` игнорируется |
| `createFileSystemWatcher` | ✅ | настоящие watcher'ы: `RelativePattern`, `ignore*Events`, excludes из `files.watcherExclude` |
| `fs` | 🟡 | вся поверхность `FileSystem`: `stat`, `readFile`, `writeFile`, `readDirectory`, `createDirectory`, `delete` (с `recursive`), `rename` и `copy` (с `overwrite`), `isWritableFileSystem`. Работает локально через `node:fs` — без RPC на хост. Отклонения: `useTrash` у `delete` игнорируется (корзины у терминального редактора нет), а `isWritableFileSystem` отвечает `true` только про `file` — про схему провайдера расширения честный `undefined`. Схему, за которой не стоит ни диск, ни провайдер, ловит гейт `Unavailable` |
| `registerFileSystemProvider` | 🟡 | читающая часть: `watch`/`stat`/`readFile`/`onDidChangeFile` |
| `findFiles` | 🟡 | поиск по glob своим обходом дерева в субпроцессе (в эталоне за ним стоит ripgrep в ядре). Поддержаны обе формы `GlobPattern` (строка — по всем папкам воркспейса, `RelativePattern` — по своей базе), три значения `exclude` (`undefined` — настройка `files.exclude`, `null` — никаких, шаблон — вместо настройки), `maxResults` и токен отмены. Отклонения: глобы матчатся нашим `glob.ts` (диапазонов `[0-9]` нет) и у обхода есть предел в 5000 каталогов на запрос |
| `registerTextDocumentContentProvider` | ✅ | недисковые ресурсы (`jdt:` у Java) открываются read-only вкладкой; `onDidChange` перечитывает открытую; `openTextDocument` по такой схеме спрашивает провайдера |
| `isTrusted`, `onDidGrantWorkspaceTrust` | 🟡 | модели доверия нет — всегда `true`, событие не стреляет |
| `getWorkspaceFolder` | ✅ | работает в рантайме: матч по границе сегмента пути, файл **вне** папок воркспейса — `undefined`, как в эталоне (fallback на первую папку убран); декларация в `vscode.d.ts` ещё не поднята |
| события папок и файловых операций (`onDidChangeWorkspaceFolders`, `onWill/onDid{Create,Delete,Rename}Files`) | 🕐 | подписка принимается (no-op), событие не стреляет |
| notebook-поверхность (8 членов: `notebookDocuments`, `openNotebookDocument`, `registerNotebookSerializer`, события) | 🕐 | |
| `registerTaskProvider` | ✅ | устаревший двойник `tasks.registerTaskProvider` — тот же вызов |
| `rootPath`, `workspaceFile`, `updateWorkspaceFolders`, `save`, `saveAs`, `saveAll`, `decode`, `encode` | 🕐 | |

## vscode.window

🟡 **30/57.** Редакторы (включая событие выделения), активная тема, сообщения, прогресс,
output-каналы, декорации, пункты статус-бара и ввод (строка + выбор из списка) — рабочие;
терминалы расширений; диалоги файлов пока не отданы расширениям, деревья — заглушка без панели;
webview — потолок.

| член | статус | комментарий |
| --- | :-: | --- |
| `activeTextEditor`, `visibleTextEditors` | ✅ | |
| `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorViewColumn` | ✅ | |
| `state`, `onDidChangeWindowState` | ✅ | |
| `showTextDocument` | 🟡 | открывает ресурс, но возвращает активный редактор |
| `showInformation/Warning/ErrorMessage` | ✅ | все четыре перегрузки: кнопки строками и `MessageItem`-ами, `MessageOptions` (`modal` + `detail`). Немодальное сообщение — тост в правом нижнем углу над статус-баром: без кнопок уезжает сам (info 10 с, warning 12 с, error 15 с — значения эталона), с кнопками ждёт ответа и фокуса не забирает (как в эталоне), до кнопок ведёт `Notifications: Focus Message` или клик. Убрать сообщение можно всегда — кнопкой закрытия на самом тосте (аналог `notification.clear`) или командой `Notifications: Clear All`; видно не больше трёх тостов, остальные ждут места. Вопрос живёт дольше (минуту) и тоже закрывается сам: расширение, сделавшее `await show*Message(...)`, стоит ровно столько, сколько живёт показ, а вечный показ подвешивал языковому клиенту перезапуск сервера. Центра уведомлений, из которого эталон возвращает уехавшее сообщение, пока нет — это отдельная задача. Модальное — окно по центру, Escape отдаёт кнопку `isCloseAffordance`. Осознанное отступление от эталона: сообщение БЕЗ кнопок резолвится сразу при показе, а не при закрытии тоста — иначе `await showErrorMessage(...)` висел бы, пока человек не закроет sticky-тост |
| `createOutputChannel` | 🟡 | канал в панели Output с уровнями логов; `clear`/`replace` — no-op (журнал ретенционный) |
| `withProgress` | 🟡 | спиннер в статус-баре, message/increment живые; отмена не поддержана — токен не стреляет |
| `tabGroups` | 🟡 | снимки `Tab` на момент вызова (идентичность не гарантируется), `Tab.group` — объект своей группы в том же снимке; `onDidChangeTabs` живой, `close` работает |
| `createTextEditorDecorationType` | ✅ | gutter change-bar'ы, overview ruler |
| `registerFileDecorationProvider` | ✅ | файловые декорации в explorer |
| `showQuickPick` | 🟡 | список строк и `QuickPickItem` на общем QuickInput-оверлее: фильтрация по `label`, `canPickMany` с чекбоксами и `picked`, `placeHolder`, `title`, токен отмены; список-промис ждётся и показывается заполненным. Не поддержаны `QuickPickItemKind.Separator`, `iconPath`, `buttons`, `alwaysShow`, `matchOnDescription`/`matchOnDetail`, `ignoreFocusOut`, устаревший `onDidSelectItem`; `detail` рисуется на месте `description`, только когда `description` пуст (строка списка однострочная) |
| `showInputBox` | 🟡 | `title`, `prompt`, `placeHolder`, `value`, `password` (набранное закрыто маской `*` и не видно ни на экране, ни в инспекторе), `validateInput` (строкой и объектной формой со строгостью — ошибка блокирует Enter; асинхронная валидация поддержана, устаревшие ответы отбрасываются), токен отмены. Не поддержаны `valueSelection`, `ignoreFocusOut` |
| quick input прочее (`showWorkspaceFolderPick`, `showOpenDialog`, `showSaveDialog`, `createQuickPick`, `createInputBox`) | 🕐 | объектные формы (пошаговые мастера) и диалоги файлов |
| `createStatusBarItem` | 🟡 | пункт в полосе: `text` со значками `$(name)`, `name`, `alignment`, `priority`, команда по клику, `show`/`hide`/`dispose`. Стабы: `tooltip` принимается, но не показывается (виджета подсказки в TUI нет); `color`/`backgroundColor`/`accessibilityInformation` ни на что не влияют. Текст длиннее 24 символов усекается — ширина полосы в терминале дефицитна |
| `setStatusBarMessage` | 🕐 | |
| `createTerminal`, `terminals`, `activeTerminal`, `onDidOpenTerminal`, `onDidCloseTerminal`, `onDidChangeActiveTerminal` | 🟡 | терминал расширения — настоящий шелл встроенного терминала в нижней панели (вкладка в списке терминалов). Позиционная форма и `TerminalOptions`: `name`, `shellPath`, `shellArgs`, `cwd`, `env` (`null` снимает переменную), `strictEnv`, `hideFromUser` (фоновый терминал: в `terminals` есть, во вкладках — после `show()`), `message`. `terminals` — все терминалы, включая шеллы, открытые человеком (у них `creationOptions` — чем их запустили); `activeTerminal` и события — тоже по всем. `Terminal`: `sendText` (переводы строк — Enter, как в эталоне), `show(preserveFocus)` открывает панель на вкладке TERMINAL, `hide` прячет её, только если показан этот терминал, `dispose`, `processId`, `exitStatus` с причиной (`Process` — шелл вышел, `User` — Kill, `Extension` — `dispose()`). После `dispose()` методы бросают, как в эталоне. `ExtensionTerminalOptions` (`pty`): процессом владеет расширение, хост держит эмулятор — `onDidWrite` рисуется в панели (склейка вывода 5 мс, как в эталоне), `open` зовётся сразу при создании, набор человека и `sendText` приходят в `handleInput` (после `open`), размер виджета — в `setDimensions`, `onDidClose` закрывает терминал с его кодом, закрытие терминала зовёт `close()`; смерть субпроцесса расширений закрывает его pty-терминалы. `open` получает начальный размер 80×24, настоящий размер виджета приезжает следом `setDimensions`; `onDidOverrideDimensions` и `onDidChangeName` не поддержаны. Не поддержаны: `location`/`color`/`isTransient`/`shellIntegrationNonce` принимаются и игнорируются (терминал всегда в панели); `state.isInteractedWith` всегда `false`; строковые `shellArgs` режутся по пробелам; имя терминала не следует за заголовком процесса |
| `onDidChangeTerminalState`, shell integration (3 события), `registerTerminalLinkProvider`, `registerTerminalProfileProvider` | 🕐 | |
| деревья (`registerTreeDataProvider`, `createTreeView`) | 🟡 | декларации подняты, рантайм — заглушка: дерево пока не рисуется, провайдер никто не зовёт. Регистрация проходит (иначе расширение с деревом умирало на активации целиком), в Output — одна строка на view, что панели не будет. `createTreeView` без `treeDataProvider` бросает, как эталон; `TreeView` инертный: `visible` — `false`, `selection` пустой, события не стреляют, `reveal` сразу резолвится, `title`/`message`/`description`/`badge` записываются и ни на что не влияют. Значения `TreeItem` (дефолт `collapsibleState` — `None`), `TreeItemCollapsibleState`, `TreeItemCheckboxState`, `ThemeIcon` — настоящие |
| `onDidChangeTextEditorSelection` | ✅ | каждое движение каретки/смена выделения в редакторе; `kind` едет от жеста — набор и кейбинд дают `Keyboard`, мышь `Mouse`, команда расширения `Command`, остальное (undo/redo, find, фолдинг, программная правка) — `undefined`, как и разрешает upstream. Выделение, которое расширение поставило само, эхом не возвращается |
| события редактора (`onDidChangeTextEditorVisibleRanges`, `onDidChangeTextEditorOptions`) | 🕐 | |
| notebook-редакторы (7 членов) | 🕐 | |
| `activeColorTheme`, `onDidChangeActiveColorTheme` | ✅ | вид активной темы (`ColorThemeKind`) верен уже в `activate()`; событие стреляет на каждой смене темы, в том числе между двумя тёмными (как upstream: «changed **or has changes**»). Имя темы расширению не отдаётся — в `vscode.ColorTheme` его и нет |
| `registerUriHandler`, `withScmProgress` | 🕐 | |
| `createWebviewPanel`, `registerWebviewPanelSerializer`, `registerWebviewViewProvider` | ⛔ | webview — требует браузера; декларации не подняты, но в рантайме члены есть как инертный no-op (панели нет, в Output одна строка про неподдерживаемый webview) — иначе расширение с чат-панелью умирало на активации целиком |
| `registerCustomEditorProvider` | ⛔ | кастомные редакторы построены на webview; в рантайме — тот же инертный no-op, что у трёх соседей выше (у `redhat.java` на нём висит редактор настроек форматтера, и падение на регистрации убивало всю активацию) |

## vscode.commands

🟡 **3/4.**

| член | статус | комментарий |
| --- | :-: | --- |
| `registerCommand` | ✅ | |
| `executeCommand` | ✅ | из встроенных команд VS Code зарегистрирована `setContext` — расширение публикует ею свои when-ключи |
| `registerTextEditorCommand` | 🟡 | без активного редактора — warn + no-op (семантика VS Code); edit-builder инертен, батч-правки — через `workspace.applyEdit` |
| `getCommands` | 🕐 | |

## vscode.extensions

🟡 **3/3** — задекларирован целиком и раздаёт настоящий состав; расхождение с эталоном одно и
названо ниже (декларативные расширения).

| член | статус | комментарий |
| --- | :-: | --- |
| `getExtension` | ✅ | настоящая запись каталога (id, `extensionUri`/`extensionPath`, `packageJSON` целиком, живой `isActive`, `exports` активного соседа); id сравнивается без учёта регистра, как `ExtensionIdentifier` в эталоне. Верен уже в `activate()` — каталог приезжает семенем до первой активации |
| `all` | 🟡 | весь состав, известный extension host'у, **кроме декларативных расширений** — языковые паки без `main` в extension host не регистрируются и в `all` не попадают (в эталоне попадают) |
| `onDidChange` | ✅ | стреляет на смену состава (регистрация/снятие расширения); на активацию — нет, как в эталоне |

## vscode.tasks

🟡 **8/8** — namespace поднят целиком вместе с типами задач (`Task`, `TaskScope`, `TaskGroup`,
`ShellExecution`, `ProcessExecution`, `CustomExecution`, `TaskDefinition`, `TaskProvider`,
`TaskExecution`, события). Задачами владеет ядро Diode: Run Task, терминал задачи, Rerun /
Restart / Terminate / Show Running Tasks — то же, что у задач из `.diode/tasks.json` (у VS Code — `.vscode/tasks.json`).
**Problem matchers не исполняются вовсе** — задача просто бежит до выхода процесса.

| член | статус | комментарий |
| --- | :-: | --- |
| `registerTaskProvider` | ✅ | задачи провайдера — в Run Task (тип из `contributes.taskDefinitions` — второй уровень пикера), id задачи — `${расширение}.${ключ определения}`, как у эталона. Провайдера ждут не дольше 5 с; `task.autoDetect: off` его не спрашивает. `resolveTask` не зовётся: записи `tasks.json` с типом провайдера (кастомизация задачи расширения) пока пропускаются с предупреждением в лог `Tasks` |
| `fetchTasks` | ✅ | задачи `tasks.json` и всех провайдеров; с `{ type }` — только провайдеров этого типа |
| `executeTask` | ✅ | своя задача приходит в событиях тем же объектом; задача из `fetchTasks` исполняется по id ядра, изменённая — описанием целиком. Срабатывают `task.saveBeforeRun` и политика повторного запуска (`instancePolicy`) |
| `taskExecutions` | ✅ | все бегущие задачи — и запущенные из палитры или другим расширением (тогда `task` — новый объект с `name`/`source` провайдера) |
| `onDidStartTask`, `onDidEndTask` | ✅ | для всех задач, в том числе запущенных из палитры |
| `onDidStartTaskProcess` | 🟡 | pid процесса шелла; у задачи на `CustomExecution` — `-1` (как у эталона: процесса нет) |
| `onDidEndTaskProcess` | ✅ | код выхода; `undefined` — терминал задачи закрыли (Terminate) |

Типы задач — по контракту, с отличиями:

| символ | отличие |
| --- | --- |
| `Task.group`, `TaskGroup` | хранится и уезжает ядру, но групп build/test (Run Build Task, Ctrl+Shift+B) пока нет — на запуск не влияет |
| `Task.problemMatchers` | хранится, не исполняется (problem matchers не поддержаны) |
| `TaskScope.Global` | задача без папки — как у эталона, где область `Global` в документации «пока не поддержана», но исполняется как есть |
| `RunOptions` | `reevaluateOnRerun` работает (Rerun Last Task); у задач `tasks.json` — ещё `instancePolicy`; `instanceLimit` больше 1 — одна копия, `runOn: folderOpen` — не запускается сам |
| `TaskPresentationOptions` | `reveal`, `focus`, `echo`, `panel` (dedicated/shared/new — с переиспользованием терминала задачи), `showReuseMessage`, `clear`, `group`, `close` |
| `CustomExecution` | pty расширения подключается к терминалу задачи; при повторном запуске — тот же терминал, новый pty |

## vscode.l10n

🟡 **3/3** — задекларирован целиком; бандлов переводов нет.

| член | статус | комментарий |
| --- | :-: | --- |
| `t` | 🟡 | подставляет плейсхолдеры (`{0}`/`{name}`/options-форма), переводов нет |
| `bundle`, `uri` | 🟡 | `undefined` |

## vscode.env

🟡 **11/21.** Поднято то, что в терминале имеет смысл и реализовано по-настоящему: буфер обмена и
открытие внешней ссылки плюс константы окружения, которые расширения читают прямо в `activate()`
(`vscode-languageclient` — `language`/`appName`, стоковый `redhat.java` — `uiKind` и телеметрию).

| член | статус | комментарий |
| --- | :-: | --- |
| `appName`, `appHost`, `uriScheme`, `language` | 🟡 | константы шима (`Diode` / `desktop` / `diode` / `en`); переводов нет, поэтому `language` всегда `en` |
| `clipboard` | ✅ | тот же буфер, которым пользуются copy/paste ядра: запись уходит и в системный буфер через OSC 52. Чтение отдаёт внутренний регистр — OSC 52 read намеренно не делаем (многие терминалы его запрещают, и запрос просто вешается); внешнее содержимое приезжает жестом вставки терминала |
| `openExternal` | 🟡 | `http`/`https`/`mailto` открываются системным обработчиком (`xdg-open`/`open`/`cmd start`). Без графического сеанса (ssh, контейнер, голый сервер) ссылка ОТДАЁТСЯ человеку: URL уезжает в буфер обмена и показывается сообщением — и это считается успехом (`true`). Прочие схемы — честный `false` |
| `uiKind` | ✅ | всегда `UIKind.Desktop`: редактор настольный, пусть и в терминале, а `Web` в контракте значит «доступ из браузера» |
| `remoteName` | ✅ | `undefined` по букве контракта — удалённого extension host'а в Diode нет |
| `sessionId` | 🟡 | случайный uuid на сеанс extension host'а: стабилен внутри запуска, различается между запусками. Отклонение от эталона — там id переживает перезапуск extension host'а, у нас шим собирается заново вместе с субпроцессом |
| `isTelemetryEnabled`, `onDidChangeTelemetryEnabled` | ✅ | телеметрии в Diode нет вовсе — ни своей, ни канала для чужой, поэтому флаг всегда `false`, а событие валидное и никогда не стреляет (менять нечего) |
| `machineId`, `isNewAppInstall`, `isAppPortable`, `createTelemetryLogger` | 🕐 | |
| `shell`, `onDidChangeShell` | 🕐 | |
| `asExternalUri` | 🕐 | нужен вместе с `registerUriHandler` |
| `logLevel`, `onDidChangeLogLevel` | 🕐 | |

## События активации (`activationEvents`)

Это часть контракта расширения, которой нет в `vscode.d.ts`: она объявляется в `package.json`, но
решает, запустится ли расширение вообще. Расширение, чьи события не поддержаны, устанавливается,
показывается в каталоге — и молчит навсегда.

Активно **6 из 32** видов событий upstream 1.127.0 (`*` плюс 31 именованный вид из схемы
`activationEvents`). Строки ниже перечисляют все; неподдержанные сгруппированы по поверхности,
которой они ждут.

| событие | статус | комментарий |
| --- | :-: | --- |
| `*` | ✅ | eager; в него же превращается пустой/отсутствующий список — **отклонение от эталона** (там пусто значит пусто): на этот дефолт полагаются уже опубликованные в магазине расширения |
| `onStartupFinished` | ✅ | фаерится после открытия файлов из аргументов запуска |
| `onLanguage:<id>` | ✅ | когда языку впервые понадобились фичи — у любой модели (новый документ, смена языка, фоновая вкладка, дифф), как `requestRichLanguageFeatures` эталона; вместе с ним — голое `onLanguage` |
| `onCommand:<id>` | ✅ | плюс **неявные** события из `contributes.commands` (как `ImplicitActivationEvents` эталона): команда видна в палитре до активации, её исполнение ждёт `activate()`. Неявные `onLanguage:<id>` дают и `contributes.languages` |
| `workspaceContains:<паттерн>` | 🟡 | обе семантики префикса есть (проверка существования пути и поиск по дереву); глобы матчатся нашим `glob.ts` — **якорно по относительному пути**, тогда как за эталонным `workspaceContains:` стоит поиск на ripgrep, где паттерн без `/` ищется на любой глубине (`workspaceContains:*.py` у нас — только корень). Рекурсивные паттерны (`**/pyproject.toml`) совпадают |
| `onUri`, `onOpenExternalUri` | 🕐 | нужны вместе с `registerUriHandler` / `env.asExternalUri` |
| `onView:<id>`, `onWalkthrough:<id>` | 🕐 | ждут своих поверхностей (`contributes.views`, walkthrough) |
| `onWebviewPanel:<id>`, `onCustomEditor:<id>`, `onRenderer:<id>` | ⛔ | поверхности webview-природы — см. [потолок](#не-будет-by-design) |
| `onDebug`, `onDebugInitialConfigurations`, `onDebugDynamicConfigurations`, `onDebugResolve:<type>`, `onDebugAdapterProtocolTracker:<type>` | 🕐 | вместе с `vscode.debug` |
| `onTaskType:<type>` | ✅ | Run Task поднимает провайдеров перед тем, как спросить задачи (`onCommand:workbench.action.tasks.runTask` и `onTaskType:<type>`; без типа — все типы из `contributes.taskDefinitions`), плюс **неявное** `onTaskType:<type>` из `contributes.taskDefinitions` |
| `onNotebook:<type>` | 🕐 | вместе с `vscode.notebooks` |
| `onAuthenticationRequest:<id>` | 🕐 | вместе с `vscode.authentication` |
| `onChatParticipant:<id>`, `onChatContextProvider:<id>`, `onLanguageModelChatProvider:<id>`, `onLanguageModelTool:<id>` | 🕐 | вместе с `vscode.chat` / `vscode.lm` |
| `onTerminal`, `onTerminalProfile:<id>`, `onTerminalQuickFixRequest:<id>`, `onTerminalShellIntegration` | 🕐 | вместе с соответствующими вкладами терминала |
| `onFileSystem:<scheme>`, `onSearch:<scheme>`, `onEditSession:<scheme>`, `onIssueReporterOpened` | 🕐 | |

## Пока не поднятые namespace

| namespace | статус | комментарий |
| --- | :-: | --- |
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

«Не будет» — про панель, а не про расширение: четыре webview-члена `window`
существуют в рантайме как инертный no-op (`webviewNoop.ts`), потому что
расширение с чат-панелью поднимает её ПЕРВОЙ строкой `activate()` — отсутствие
члена убивало заодно его команды и провайдеры. Вызов возвращает мёртвую панель
(или честный `Disposable`) и пишет в Output одну строку «webview в TUI не
поддерживается»; декларации в `vscode.d.ts` при этом остаются закомментированными
— статус ⛔ рантайм-заглушка не меняет.

## Типы с неполной поверхностью

Активно 172 из 424 типов/классов upstream; поднятые — целиком, кроме перечисленных ниже
(bounded member-level uncommenting — раскомментировано подмножество членов). Одна строка
(`TextDocument`) — про другое: там раскомментировано и реализовано всё, но `save` — 🟡
заглушка; помечена отдельно, потому что для автора расширения это та же неполнота.

| тип | активно | не активно |
| --- | :-: | --- |
| `TextEditor` | 7/12 | `visibleRanges`, `insertSnippet`, `revealRange`, `show`, `hide` |
| `TextDocument` | 19/19 | — (класс документа проверяется компилятором: `implements vscode.TextDocument`). 🟡 `save` — всегда `false` («не сохранено»), у закрытого документа — отказ, как upstream: запроса «сохранить документ по uri» к хосту пока нет. `getWordRangeAtPosition` — дефолтное определение слова upstream (`DEFAULT_WORD_REGEXP`) либо регекс расширения; языковых word-definition (`wordPattern`) нет, регекс, матчащий пустую строку, — исключение. Рабочие и `offsetAt`/`positionAt`/`validateRange`/`validatePosition` (на их отсутствии молча ломался формат стокового prettier) |
| `TextEditorOptions` | 3/5 | `cursorStyle`, `lineNumbers` |
| `Terminal` | 9/10 | `shellIntegration` |
| `TerminalOptions` | 12/13 | `iconPath` |
| `TreeViewOptions` | 4/5 | `dragAndDropController` (drag-and-drop в TUI нет) |
| `ExtensionTerminalOptions` | 6/7 | `iconPath` |
| `ExtensionContext` | 15/17 | `environmentVariableCollection`, `languageModelAccessInformation`. Из активных: `extension` — запись самого расширения из каталога `vscode.extensions` (телеметрии читают по ней `packageJSON.version`); `globalState`/`workspaceState` переживают перезапуск (хранилище на хосте); `globalState.setKeysForSync` — осознанный no-op (Settings Sync нет) |
| `WorkspaceEdit` | 11/11 | — |
| `WorkspaceEditEntryMetadata` | 3/4 | `iconPath` |
| `FileStat` | 4/5 | `permissions` |
| `FileSystemProvider` | 4/10 | `readDirectory`, `createDirectory`, `writeFile`, `delete`, `rename`, `copy` |
| `DocumentFilter` | 3/4 | `notebookType` |
| `CompletionItem` | 8/16 | `tags`, `sortText`, `filterText`, `preselect`, `commitCharacters`, `keepWhitespace`, `textEdit`, `additionalTextEdits` |
| `DocumentRangeFormattingEditProvider` | 1/2 | `provideDocumentRangesFormattingEdits` |
| `LanguageStatusItem` | 9/10 | `accessibilityInformation` |
| `DataTransferFile` | 3/3 | — (тип объявлен ради `createFile({ contents })`; экземпляры создаёт только редактор, а drag-and-drop у нас нет — такой `contents` игнорируется) |

## Семантические отклонения

Тип совпадает с upstream, отличается смысл:

| символ | отклонение |
| --- | --- |
| `vscode.version` | возвращает версию **diode**, а не VS Code |
| `Event<T>` | подписки оборачиваются собственным эмиттером хоста |
| `TextEditorOptions.indentSize` | алиасится к `tabSize` — diode пока их не различает |
| `SecretStorage` | **без шифрования**: связки ключей ОС у нас нет, секреты лежат открытым текстом в `<profileDir>/secrets.json` под правами `0600`. Всё остальное по контракту — `get`/`store`/`delete`/`keys` работают, `onDidChange` стреляет и на запись, и на удаление, значения переживают перезапуск и у каждого расширения свой лоток |
| `Extension.extensionKind` | всегда `ExtensionKind.UI` — ровно как предписывает upstream, когда удалённого extension host'а нет (а в Diode его нет и не будет) |
| `Extension.activate()` | у **уже активного** расширения отдаёт его `exports`, у неактивного — отклоняется с объяснением. Активацией распоряжается хост (события активации, per-extension изоляция, оживление после смерти субпроцесса); «субпроцесс просит хост поднять соседа» — отдельная задача со своим RPC |
| namespaces / value-типы | рантайм может опережать декларацию (см. `languages.match`, `workspace.getWorkspaceFolder`) |

## Как читать «частично»

«Частично» — не «работает вполсилы», а «поверхность объявлена, отмеченные в комментарии члены —
стабы». Комментарий строки называет, какие именно члены не активны, чтобы автор расширения мог
проверить свой случай за минуту, не запуская diode.
