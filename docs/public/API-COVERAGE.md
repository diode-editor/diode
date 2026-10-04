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
| [`vscode.languages`](#vscodelanguages) | 🟡 | 12/40 |
| [`vscode.workspace`](#vscodeworkspace) | 🟡 | 20/45 |
| [`vscode.window`](#vscodewindow) | 🟡 | 22/57 |
| [`vscode.commands`](#vscodecommands) | 🟡 | 3/4 |
| [`vscode.extensions`](#vscodeextensions) | 🟡 | 3/3 |
| [`vscode.l10n`](#vscodel10n) | 🟡 | 3/3 |
| [`vscode.env`](#vscodeenv) | 🟡 | 11/21 |
| [`vscode.tasks`](#пока-не-поднятые-namespace) | 🕐 | 0/8 |
| [`vscode.debug`](#пока-не-поднятые-namespace) | 🕐 | 0/18 |
| [`vscode.scm`](#пока-не-поднятые-namespace) | 🕐 | 0/2 |
| [`vscode.notebooks`](#пока-не-поднятые-namespace) | 🕐 | 0/3 |
| [`vscode.authentication`](#пока-не-поднятые-namespace) | 🕐 | 0/4 |
| [`vscode.tests`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.chat`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.lm`](#пока-не-поднятые-namespace) | 🕐 | 0/7 |
| [типы и классы](#типы-с-неполной-поверхностью) | — | 117/424 |
| [события активации](#события-активации-activationevents) | 🟡 | 5/32 |

## vscode.languages

🟡 **12/40.** Языковой стек уровня LSP поднят целиком; остальные провайдеры принимают
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
| `registerCodeActionsProvider` | ✅ | quickfix, organize imports, fix all; лампочки-индикатора нет |
| `registerFoldingRangeProvider` | ✅ | |
| `createLanguageStatusItem` | 🟡 | держатель полей с честным dispose, в UI пока не проецируется |
| `match` | ✅ | работает в рантайме (скоринг селекторов для языковых клиентов); декларация в `vscode.d.ts` ещё не поднята |
| остальные `register*Provider` (19: declaration, implementation, typeDefinition, documentHighlight, documentSymbol, workspaceSymbol, codeLens, documentLink, color, onTypeFormatting, selectionRange, semanticTokens ×2, inlayHints, inlineValues, inlineCompletion, linkedEditingRange, callHierarchy, typeHierarchy) | 🕐 | регистрация принимается (no-op) — расширение не падает, провайдер не дёргается |
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
| `getConfiguration`, `onDidChangeConfiguration` | ✅ | |
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
| `rootPath`, `workspaceFile`, `updateWorkspaceFolders`, `save`, `saveAs`, `saveAll`, `registerTaskProvider`, `decode`, `encode` | 🕐 | |

## vscode.window

🟡 **22/57.** Редакторы (включая событие выделения), активная тема, сообщения, прогресс,
output-каналы, декорации, пункты статус-бара и ввод (строка + выбор из списка) — рабочие;
диалоги файлов, терминал и деревья пока не отданы расширениям; webview — потолок.

| член | статус | комментарий |
| --- | :-: | --- |
| `activeTextEditor`, `visibleTextEditors` | ✅ | |
| `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorViewColumn` | ✅ | |
| `state`, `onDidChangeWindowState` | ✅ | |
| `showTextDocument` | 🟡 | открывает ресурс, но возвращает активный редактор |
| `showInformation/Warning/ErrorMessage` | ✅ | все четыре перегрузки: кнопки строками и `MessageItem`-ами, `MessageOptions` (`modal` + `detail`). Немодальное сообщение — тост в правом нижнем углу над статус-баром: без кнопок уезжает сам (info 10 с, warning 12 с, error 15 с — значения эталона), с кнопками ждёт ответа и фокуса не забирает (как в эталоне), до кнопок ведёт `Notifications: Focus Message` или клик. Убрать сообщение можно всегда — кнопкой закрытия на самом тосте (аналог `notification.clear`) или командой `Notifications: Clear All`; видно не больше трёх тостов, остальные ждут места. Вопрос живёт дольше (минуту) и тоже закрывается сам: расширение, сделавшее `await show*Message(...)`, стоит ровно столько, сколько живёт показ, а вечный показ подвешивал языковому клиенту перезапуск сервера. Центра уведомлений, из которого эталон возвращает уехавшее сообщение, пока нет — это отдельная задача. Модальное — окно по центру, Escape отдаёт кнопку `isCloseAffordance`. Осознанное отступление от эталона: сообщение БЕЗ кнопок резолвится сразу при показе, а не при закрытии тоста — иначе `await showErrorMessage(...)` висел бы, пока человек не закроет sticky-тост |
| `createOutputChannel` | 🟡 | канал в панели Output с уровнями логов; `clear`/`replace` — no-op (журнал ретенционный) |
| `withProgress` | 🟡 | спиннер в статус-баре, message/increment живые; отмена не поддержана — токен не стреляет |
| `tabGroups` | 🟡 | снимки `Tab` на момент вызова (идентичность не гарантируется); `onDidChangeTabs` живой, `close` работает |
| `createTextEditorDecorationType` | ✅ | gutter change-bar'ы, overview ruler |
| `registerFileDecorationProvider` | ✅ | файловые декорации в explorer |
| `showQuickPick` | 🟡 | список строк и `QuickPickItem` на общем QuickInput-оверлее: фильтрация по `label`, `canPickMany` с чекбоксами и `picked`, `placeHolder`, `title`, токен отмены; список-промис ждётся и показывается заполненным. Не поддержаны `QuickPickItemKind.Separator`, `iconPath`, `buttons`, `alwaysShow`, `matchOnDescription`/`matchOnDetail`, `ignoreFocusOut`, устаревший `onDidSelectItem`; `detail` рисуется на месте `description`, только когда `description` пуст (строка списка однострочная) |
| `showInputBox` | 🟡 | `title`, `prompt`, `placeHolder`, `value`, `password` (набранное закрыто маской `*` и не видно ни на экране, ни в инспекторе), `validateInput` (строкой и объектной формой со строгостью — ошибка блокирует Enter; асинхронная валидация поддержана, устаревшие ответы отбрасываются), токен отмены. Не поддержаны `valueSelection`, `ignoreFocusOut` |
| quick input прочее (`showWorkspaceFolderPick`, `showOpenDialog`, `showSaveDialog`, `createQuickPick`, `createInputBox`) | 🕐 | объектные формы (пошаговые мастера) и диалоги файлов |
| `createStatusBarItem` | 🟡 | пункт в полосе: `text` со значками `$(name)`, `name`, `alignment`, `priority`, команда по клику, `show`/`hide`/`dispose`. Стабы: `tooltip` принимается, но не показывается (виджета подсказки в TUI нет); `color`/`backgroundColor`/`accessibilityInformation` ни на что не влияют. Текст длиннее 24 символов усекается — ширина полосы в терминале дефицитна |
| `setStatusBarMessage` | 🕐 | |
| терминал (12 членов: `createTerminal`, `terminals`, события, shell integration, link/profile-провайдеры) | 🕐 | |
| деревья (`registerTreeDataProvider`, `createTreeView`) | 🕐 | |
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

Активно **5 из 32** видов событий upstream 1.127.0 (`*` плюс 31 именованный вид из схемы
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
| `onTaskType:<type>` | 🕐 | вместе с `vscode.tasks` |
| `onNotebook:<type>` | 🕐 | вместе с `vscode.notebooks` |
| `onAuthenticationRequest:<id>` | 🕐 | вместе с `vscode.authentication` |
| `onChatParticipant:<id>`, `onChatContextProvider:<id>`, `onLanguageModelChatProvider:<id>`, `onLanguageModelTool:<id>` | 🕐 | вместе с `vscode.chat` / `vscode.lm` |
| `onTerminal`, `onTerminalProfile:<id>`, `onTerminalQuickFixRequest:<id>`, `onTerminalShellIntegration` | 🕐 | вместе с соответствующими вкладами терминала |
| `onFileSystem:<scheme>`, `onSearch:<scheme>`, `onEditSession:<scheme>`, `onIssueReporterOpened` | 🕐 | |

## Пока не поднятые namespace

| namespace | статус | комментарий |
| --- | :-: | --- |
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

«Не будет» — про панель, а не про расширение: четыре webview-члена `window`
существуют в рантайме как инертный no-op (`webviewNoop.ts`), потому что
расширение с чат-панелью поднимает её ПЕРВОЙ строкой `activate()` — отсутствие
члена убивало заодно его команды и провайдеры. Вызов возвращает мёртвую панель
(или честный `Disposable`) и пишет в Output одну строку «webview в TUI не
поддерживается»; декларации в `vscode.d.ts` при этом остаются закомментированными
— статус ⛔ рантайм-заглушка не меняет.

## Типы с неполной поверхностью

Активно 115 из 424 типов/классов upstream; поднятые — целиком, кроме перечисленных ниже
(bounded member-level uncommenting — раскомментировано подмножество членов). Одна строка
(`TextDocument`) — про другое: там раскомментировано всё, но два члена ещё не реализованы
в рантайме; помечена отдельно, потому что для автора расширения разницы нет.

| тип | активно | не активно |
| --- | :-: | --- |
| `TextEditor` | 7/12 | `visibleRanges`, `insertSnippet`, `revealRange`, `show`, `hide` |
| `TextDocument` | 17/19 | `save`, `getWordRangeAtPosition` — объявлены в `vscode.d.ts`, но в субпроцессе отсутствуют: обращение бросает `TypeError`. Остальное рабочее, включая `offsetAt`/`positionAt`/`validateRange`/`validatePosition` (на их отсутствии молча ломался формат стокового prettier) |
| `TextEditorOptions` | 3/5 | `cursorStyle`, `lineNumbers` |
| `ExtensionContext` | 14/17 | `environmentVariableCollection`, `extension`, `languageModelAccessInformation`. Из активных: `globalState`/`workspaceState` переживают перезапуск (хранилище на хосте); `globalState.setKeysForSync` — осознанный no-op (Settings Sync нет) |
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
