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
| [`vscode.languages`](#vscodelanguages) | 🟡 | 16/40 |
| [`vscode.workspace`](#vscodeworkspace) | 🟡 | 25/45 |
| [`vscode.window`](#vscodewindow) | 🟡 | 36/57 |
| [`vscode.commands`](#vscodecommands) | 🟡 | 3/4 |
| [`vscode.extensions`](#vscodeextensions) | 🟡 | 3/3 |
| [`vscode.l10n`](#vscodel10n) | 🟡 | 3/3 |
| [`vscode.env`](#vscodeenv) | 🟡 | 15/21 |
| [`vscode.tasks`](#vscodetasks) | 🟡 | 8/8 |
| [`vscode.authentication`](#vscodeauthentication) | 🟡 | 4/4 |
| [`vscode.comments`](#vscodecomments) | 🟡 | 1/1 |
| [`vscode.debug`](#vscodedebug) | 🟡 | 18/18 |
| [`vscode.tests`](#vscodetests) | 🟡 | 1/1 |
| [`vscode.scm`](#пока-не-поднятые-namespace) | 🕐 | 0/2 |
| [`vscode.notebooks`](#пока-не-поднятые-namespace) | 🕐 | 0/3 |
| [`vscode.chat`](#пока-не-поднятые-namespace) | 🕐 | 0/1 |
| [`vscode.lm`](#пока-не-поднятые-namespace) | 🕐 | 0/7 |
| [типы и классы](#типы-с-неполной-поверхностью) | — | 261/424 |
| [события активации](#события-активации-activationevents) | 🟡 | 6/32 |

## vscode.languages

🟡 **16/40.** Языковой стек уровня LSP поднят целиком; остальные провайдеры принимают
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
| `registerSelectionRangeProvider` | ✅ | Expand/Shrink Selection (`Shift+Alt+→/←`); ступени провайдеров сливаются со встроенными (слово, подслово, строка, документ), как в эталоне; `vscode.executeSelectionRangeProvider` не поднят |
| `registerDocumentSemanticTokensProvider` | ✅ | семантическая подсветка поверх TextMate: дельты (`provideDocumentSemanticTokensEdits`), `onDidChangeSemanticTokens`, `semanticTokenColors` темы и фоллбэк на TM-скоупы, `contributes.semanticToken*`, настройка `editor.semanticHighlighting.enabled`; `editor.semanticTokenColorCustomizations` не поддержана |
| `registerDocumentRangeSemanticTokensProvider` | ✅ | видимая область, пока нет полного набора токенов документа |
| `createLanguageStatusItem` | 🟡 | держатель полей с честным dispose, в UI пока не проецируется |
| `match` | ✅ | работает в рантайме (скоринг селекторов для языковых клиентов); декларация в `vscode.d.ts` ещё не поднята |
| остальные `register*Provider` (16: declaration, implementation, typeDefinition, documentHighlight, documentSymbol, workspaceSymbol, codeLens, documentLink, color, onTypeFormatting, inlayHints, inlineValues, inlineCompletion, linkedEditingRange, callHierarchy, typeHierarchy) | 🕐 | регистрация принимается (no-op) — расширение не падает, провайдер не дёргается |
| `setLanguageConfiguration` | 🟡 | `wordPattern` — определение слова языка для `TextDocument.getWordRangeAtPosition` в субпроцессе (регекс, матчащий пустую строку, — эталонное исключение); `comments`, `brackets`, `autoClosingPairs` — слой поверх `language-configuration.json` в ядре (комментирование, авто-закрытие и обрамление): заданная секция заменяет секцию файла, поздний слой побеждает ранний, dispose и смерть extension host снимают слой. Не применяются (ядро не умеет их и из файла): `indentationRules`, `onEnterRules`, `LineCommentRule.noIndent`, `notIn: RegEx/Other`, устаревшие `__electricCharacterSupport`/`__characterPairSupport`; `wordPattern` редактору ядра (выделение слова, границы автодополнения) не передаётся |
| `getLanguages`, `setTextDocumentLanguage`, `onDidChangeDiagnostics`, `getDiagnostics`, `registerEvaluatableExpressionProvider`, `registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider` | 🕐 | |

## vscode.workspace

🟡 **24/45.** Документы, конфигурация, сохранение и его события, файловые watcher'ы, доступ к
диску, поиск файлов по glob и bulk `applyEdit` (включая закрытые файлы и файловые операции) —
рабочие; notebook-поверхность — нет.

| член | статус | комментарий |
| --- | :-: | --- |
| `workspaceFolders`, `name` | ✅ | |
| `textDocuments`, `openTextDocument` | ✅ | включая `{ encoding }` — реальное декодирование не-utf8; `openTextDocument({ content, language })` — безымянный буфер `untitled:Untitled-N`, как в эталоне (`openTextDocument(untitled:-uri)` — пока нет) |
| `onDidOpen/onDidClose/onDidChangeTextDocument` | ✅ | |
| `onWillSaveTextDocument`, `onDidSaveTextDocument` | ✅ | композиция save-участников с `codeActionsOnSave`/`formatOnSave` |
| `getConfiguration`, `onDidChangeConfiguration` | ✅ | слои default → user → workspace → workspaceFolder: настройки проекта — в `.diode/settings.json` открытой папки (у VS Code — `.vscode/settings.json`); у окна из файла `.code-workspace` воркспейс — блок `settings` файла, а `.diode/settings.json` — слой папки поверх него; `inspect().workspaceValue`/`workspaceFolderValue` честные. `update()` — как у VS Code: `Workspace`/`false` — в настройки воркспейса, `Global`/`true` — в пользовательский `settings.json`, `WorkspaceFolder` — в `.diode/settings.json` папки; без цели — воркспейс, а у окна из `.code-workspace` ключ `resource`/`language-overridable` с ресурсом — папка (`deriveConfigurationTarget`); `undefined` снимает ключ; к резолву `get()` уже видит значение; отказы (незарегистрированный ключ, пустое окно, `application`/`machine` в воркспейс) — rejected promise с текстами VS Code, без тоста. Запись в секцию языка (`overrideInLanguage`) пока отклоняется |
| `asRelativePath` | ✅ | |
| `applyEdit` | 🟡 | настоящий bulk edit: текстовые правки по ОТКРЫТЫМ (через буфер, остаётся «грязным») и ЗАКРЫТЫМ (запись на диск) ресурсам плюс файловые операции `createFile`/`deleteFile`/`renameFile` с опциями `overwrite`/`ignoreIfExists`/`ignoreIfNotExists`, в порядке добавления; весь edit — ОДИН шаг отмены в истории всех открытых затронутых файлов (Ctrl+Z из любой их вкладки). `metadata.isRefactoring` — затронутые файлы сохраняются по `files.refactoring.autoSave`. All-or-nothing: read-only ресурс, нечитаемый файл, коллизия имени или пересекающиеся правки отбивают edit целиком (`false`). Отклонения: `recursive` у `deleteFile` игнорируется (удаление всегда рекурсивное — в корзину уходит всё дерево), `WorkspaceEditEntryMetadata` отбрасывается (preview-режима нет), `contents` в виде `DataTransferFile` игнорируется |
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
| `workspaceFile` | ✅ | `Uri` файла `.code-workspace`, если окно открыто через него (файл с одной папкой); иначе `undefined`. `name` такого окна — `<файл> (Workspace)`, как в VS Code |
| `saveAll` | 🟡 | сохраняет все несохранённые файлы всех групп (как `$saveAll` эталона); файл, изменённый на диске, не перезаписывается, сбой записи — `false`, остальные при этом сохраняются. Отклонение: `includeUntitled` не открывает Save As на безымянные буферы — они остаются несохранёнными, и ответ `false` |
| `save` | ✅ | сохраняет открытый документ ресурса (и чистый — `force` эталона), результат — его `Uri`; не открыт, безымянный, конфликт с диском или сбой записи — `undefined` |
| `rootPath`, `saveAs`, `decode`, `encode` | 🕐 | |
| `updateWorkspaceFolders` | 🟡 | проверки эталона (повторы, границы, «ничего не меняется» → `false`); multi-root у нас нет, поэтому выполним только итог ровно в одну папку (пустое окно + папка, замена единственной) — она открывается, как `File: Open Folder`, расширения перезапускаются (у эталона — reload окна). Итог в две папки и больше или пустой — `false` и тост ошибки `Extension '…' failed to update workspace folders: multi-root workspaces are not supported`; `name` папки не учитывается (имя — basename) |

## vscode.window

🟡 **35/57.** Редакторы (включая событие выделения), активная тема, сообщения, прогресс,
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
| `registerFileDecorationProvider` | ✅ | файловые декорации в explorer; `propagate` всплывает к папкам (цвет + «●») |
| `showQuickPick` | 🟡 | список строк и `QuickPickItem` на общем QuickInput-оверлее: фильтрация по `label`, `canPickMany` с чекбоксами и `picked`, `placeHolder`, `title`, токен отмены; список-промис ждётся и показывается заполненным. Разделители (`kind: QuickPickItemKind.Separator`) не показываются и не выбираются — заголовков групп у оверлея нет. Не поддержаны `iconPath`, `buttons`, `alwaysShow`, `matchOnDescription`/`matchOnDetail`, `ignoreFocusOut`, устаревший `onDidSelectItem`; `detail` рисуется на месте `description`, только когда `description` пуст (строка списка однострочная) |
| `showInputBox` | 🟡 | `title`, `prompt`, `placeHolder`, `value`, `password` (набранное закрыто маской `*` и не видно ни на экране, ни в инспекторе), `validateInput` (строкой и объектной формой со строгостью — ошибка блокирует Enter; асинхронная валидация поддержана, устаревшие ответы отбрасываются), токен отмены. Не поддержаны `valueSelection`, `ignoreFocusOut` |
| `createQuickPick` | 🟡 | живой объект на общем QuickInput-оверлее, форма эталона: состояние уезжает хосту диффом (пачка присваиваний — одна отправка), действия человека — событиями `onDidChangeValue` / `onDidAccept` / `onDidChangeActive` / `onDidChangeSelection` / `onDidHide`, обратно — свои объекты расширения. `items` / `activeItems` / `selectedItems` меняются и в открытом пикере; Enter не закрывает пикер (закрывает расширение), Enter на пустом списке — `onDidAccept` без выбора; `title` со `step`/`totalSteps` («Title (1/3)»), `placeholder`, `prompt`, `value`, `canSelectMany`, `matchOnDescription`/`matchOnDetail`, `alwaysShow`, `keepScrollPosition`; разделители (`QuickPickItemKind.Separator`) не рисуются. Хранятся, но не рисуются `busy` (индикатора загрузки у оверлея нет) и `enabled: false`; не поддержаны `buttons`/кнопки пунктов, `iconPath`, `ignoreFocusOut` (клик мимо закрывает всегда); `detail` — на месте `description`, как у `showQuickPick` |
| `QuickPickItemKind` | ✅ | значение enum'а для разделителей |
| quick input прочее (`showWorkspaceFolderPick`, `showOpenDialog`, `showSaveDialog`, `createInputBox`) | 🕐 | объектная форма поля ввода и диалоги файлов |
| `createStatusBarItem` | 🟡 | пункт в полосе: `text` со значками `$(name)`, `name`, `alignment`, `priority`, команда по клику, `show`/`hide`/`dispose`. Стабы: `tooltip` принимается, но не показывается (виджета подсказки в TUI нет); `color`/`backgroundColor`/`accessibilityInformation` ни на что не влияют. Текст длиннее 24 символов усекается — ширина полосы в терминале дефицитна |
| `setStatusBarMessage` | ✅ | все три перегрузки (таймаут, thenable, до `dispose`). Как в эталоне: один общий пункт полосы на все расширения (id `status.extensionMessage`, слева, имя «Extension Status»), сообщения стеком — видно самое свежее, снятие верхнего возвращает предыдущее. Пункт заводится на первом сообщении и скрывается через меню видимости полосы, как остальные |
| `createTerminal`, `terminals`, `activeTerminal`, `onDidOpenTerminal`, `onDidCloseTerminal`, `onDidChangeActiveTerminal` | 🟡 | терминал расширения — настоящий шелл встроенного терминала в нижней панели (вкладка в списке терминалов). Позиционная форма и `TerminalOptions`: `name`, `shellPath`, `shellArgs`, `cwd`, `env` (`null` снимает переменную), `strictEnv`, `hideFromUser` (фоновый терминал: в `terminals` есть, во вкладках — после `show()`), `message`. `terminals` — все терминалы, включая шеллы, открытые человеком (у них `creationOptions` — чем их запустили); `activeTerminal` и события — тоже по всем. `Terminal`: `sendText` (переводы строк — Enter, как в эталоне), `show(preserveFocus)` открывает панель на вкладке TERMINAL, `hide` прячет её, только если показан этот терминал, `dispose`, `processId`, `exitStatus` с причиной (`Process` — шелл вышел, `User` — Kill, `Extension` — `dispose()`). После `dispose()` методы бросают, как в эталоне. `ExtensionTerminalOptions` (`pty`): процессом владеет расширение, хост держит эмулятор — `onDidWrite` рисуется в панели (склейка вывода 5 мс, как в эталоне), `open` зовётся сразу при создании, набор человека и `sendText` приходят в `handleInput` (после `open`), размер виджета — в `setDimensions`, `onDidClose` закрывает терминал с его кодом, закрытие терминала зовёт `close()`; смерть субпроцесса расширений закрывает его pty-терминалы. `open` получает начальный размер 80×24, настоящий размер виджета приезжает следом `setDimensions`; `onDidOverrideDimensions` и `onDidChangeName` не поддержаны. Не поддержаны: `location`/`color`/`isTransient`/`shellIntegrationNonce` принимаются и игнорируются (терминал всегда в панели); `state.isInteractedWith` всегда `false`; строковые `shellArgs` режутся по пробелам; имя терминала не следует за заголовком процесса |
| `onDidChangeTerminalShellIntegration`, `onDidStartTerminalShellExecution`, `onDidEndTerminalShellExecution` | 🟡 | shell integration (скрипты внедрения, разбор OSC 633) не поднята: `Terminal.shellIntegration` всегда `undefined` — по контракту «так и не активировалась», а события валидные и никогда не стреляют. Расширения, ждущие интеграцию (Claude Code — 3 с), уходят в свой фоллбэк на `sendText` |
| `onDidChangeTerminalState`, `registerTerminalLinkProvider`, `registerTerminalProfileProvider` | 🕐 | |
| деревья (`registerTreeDataProvider`, `createTreeView`) | 🟡 | декларации подняты, рантайм — заглушка: дерево пока не рисуется, провайдер никто не зовёт. Регистрация проходит (иначе расширение с деревом умирало на активации целиком), в Output — одна строка на view, что панели не будет. `createTreeView` без `treeDataProvider` бросает, как эталон; `TreeView` инертный: `visible` — `false`, `selection` пустой, события не стреляют, `reveal` сразу резолвится, `title`/`message`/`description`/`badge` записываются и ни на что не влияют. Значения `TreeItem` (дефолт `collapsibleState` — `None`), `TreeItemCollapsibleState`, `TreeItemCheckboxState`, `ThemeIcon` — настоящие |
| `onDidChangeTextEditorSelection` | ✅ | каждое движение каретки/смена выделения в редакторе; `kind` едет от жеста — набор и кейбинд дают `Keyboard`, мышь `Mouse`, команда расширения `Command`, остальное (undo/redo, find, фолдинг, программная правка) — `undefined`, как и разрешает upstream. Выделение, которое расширение поставило само, эхом не возвращается |
| события редактора (`onDidChangeTextEditorVisibleRanges`, `onDidChangeTextEditorOptions`) | 🕐 | |
| notebook-редакторы (7 членов) | 🕐 | |
| `activeColorTheme`, `onDidChangeActiveColorTheme` | ✅ | вид активной темы (`ColorThemeKind`) верен уже в `activate()`; событие стреляет на каждой смене темы, в том числе между двумя тёмными (как upstream: «changed **or has changes**»). Имя темы расширению не отдаётся — в `vscode.ColorTheme` его и нет |
| `registerUriHandler` | ✅ | один обработчик на расширение (повторная регистрация — эталонная ошибка `Protocol handler already registered…`), адрес — `diode://<id расширения>/…` (`env.uriScheme`). URL расширению, которое обработчик ещё не завело, копится в буфере (пять минут, как у эталона) и поднимает расширение по [`onUri`](#события-активации-activationevents); заведённый на активации обработчик получает буфер. Перед доставкой — вопрос «Allow '…' extension to open this URI?»; без вопроса — расширения из эталонной настройки `extensions.confirmedUriHandlerExtensionIds`. Источник URL — команда `Developer: Open URL` (`workbench.action.url.openUrl`, как у эталона); протокол ОС и `--open-url` не подключены. **Отступления:** галочки «Do not ask me again» в диалоге нет — доверие задаётся той же настройкой, диалог о ней говорит; URL неустановленному расширению не ставит его, а сообщает, что расширения нет |
| `withScmProgress` | 🕐 | |
| `createWebviewPanel`, `registerWebviewPanelSerializer`, `registerWebviewViewProvider` | ⛔ | webview — требует браузера; декларации не подняты, но в рантайме члены есть как инертный no-op (панели нет, в Output одна строка про неподдерживаемый webview) — иначе расширение с чат-панелью умирало на активации целиком |
| `registerCustomEditorProvider` | ⛔ | кастомные редакторы построены на webview; в рантайме — тот же инертный no-op, что у трёх соседей выше (у `redhat.java` на нём висит редактор настроек форматтера, и падение на регистрации убивало всю активацию) |

## vscode.commands

🟡 **3/4.**

| член | статус | комментарий |
| --- | :-: | --- |
| `registerCommand` | ✅ | |
| `executeCommand` | ✅ | из встроенных команд VS Code зарегистрирована `setContext` — расширение публикует ею свои when-ключи; из API-команд эталона (`extHostApiCommands`) — `vscode.open` (Uri — во вкладку, колонкой/опциями как `showTextDocument`; http(s) — наружу, как `env.openExternal`) |
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
| `registerTaskProvider` | ✅ | задачи провайдера — в Run Task (тип из `contributes.taskDefinitions` — второй уровень пикера), id задачи — `${расширение}.${ключ определения}`, как у эталона. Провайдера ждут не дольше 5 с; `task.autoDetect: off` его не спрашивает. Запись `tasks.json` с типом провайдера (кастомизация задачи расширения, её дописывает Configure Task) сливается с задачей провайдера по ключу определения; `resolveTask` не зовётся — запись, которой `provideTasks` задачи не дал, остаётся ошибкой в логе `Tasks` |
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

🟡 **15/21.** Поднято то, что в терминале имеет смысл и реализовано по-настоящему: буфер обмена и
открытие внешней ссылки плюс константы окружения, которые расширения читают прямо в `activate()`
(`vscode-languageclient` — `language`/`appName`, стоковый `redhat.java` — `uiKind` и телеметрию,
`@vscode/extension-telemetry` — логгер телеметрии).

| член | статус | комментарий |
| --- | :-: | --- |
| `appName`, `appHost`, `uriScheme`, `language` | 🟡 | константы шима (`Diode` / `desktop` / `diode` / `en`); переводов нет, поэтому `language` всегда `en` |
| `clipboard` | ✅ | тот же буфер, которым пользуются copy/paste ядра: запись уходит и в системный буфер через OSC 52. Чтение отдаёт внутренний регистр — OSC 52 read намеренно не делаем (многие терминалы его запрещают, и запрос просто вешается); внешнее содержимое приезжает жестом вставки терминала |
| `openExternal` | 🟡 | `http`/`https`/`mailto` открываются системным обработчиком (`xdg-open`/`open`/`cmd start`). Без графического сеанса (ssh, контейнер, голый сервер) ссылка ОТДАЁТСЯ человеку: URL уезжает в буфер обмена и показывается сообщением — и это считается успехом (`true`). Прочие схемы — честный `false` |
| `uiKind` | ✅ | всегда `UIKind.Desktop`: редактор настольный, пусть и в терминале, а `Web` в контракте значит «доступ из браузера» |
| `remoteName` | ✅ | `undefined` по букве контракта — удалённого extension host'а в Diode нет |
| `sessionId` | 🟡 | случайный uuid на сеанс extension host'а: стабилен внутри запуска, различается между запусками. Отклонение от эталона — там id переживает перезапуск extension host'а, у нас шим собирается заново вместе с субпроцессом |
| `isTelemetryEnabled`, `onDidChangeTelemetryEnabled` | ✅ | телеметрии в Diode нет вовсе — ни своей, ни канала для чужой, поэтому флаг всегда `false`, а событие валидное и никогда не стреляет (менять нечего) |
| `createTelemetryLogger` | ✅ | эталонный логгер при выключенной телеметрии: `isUsageEnabled`/`isErrorsEnabled` — `false`, `logUsage`/`logError` до отправителя не доходят, `onDidChangeEnableStates` не стреляет, на первом `dispose` — `flush` отправителя. Проверка отправителя и её тексты — эталонные. Без члена падал `@vscode/extension-telemetry` (репортер строит логгер в конструкторе), а с ним — вся активация `hashicorp.terraform`. `TelemetryTrustedValue` — настоящий класс |
| `machineId` | ✅ | как в эталоне: sha256 от первого настоящего MAC-адреса в hex (без адреса — uuid), кэш в application-состоянии под тем же ключом `telemetry.machineId` — стабилен между запусками |
| `shell` | ✅ | шелл, которым запускается встроенный терминал без `shellPath` (`$SHELL` → шелл учётной записи → `sh`; Windows — `%COMSPEC%`). Профилей терминала нет, поэтому настройкой он не меняется |
| `onDidChangeShell` | ✅ | валидное событие; без профилей терминала шелл не меняется, и оно не стреляет |
| `isNewAppInstall`, `isAppPortable` | 🕐 | |
| `asExternalUri` | 🕐 | обработчики URI есть (`window.registerUriHandler`), но внешнего источника `diode://` (протокол ОС) нет — отдавать наружу пока нечего |
| `logLevel`, `onDidChangeLogLevel` | 🕐 | |

## vscode.comments

🟡 **1/1.** Декларации подняты целиком (контроллер, тред, комментарий и их enum'ы), рантайм —
инертный: тредов в гаттере и панели Comments пока нет. Namespace есть, потому что без него падала
фича расширения целиком: Claude Code вешает тред на каждый ханк предложенного диффа.

| член | статус | комментарий |
| --- | :-: | --- |
| `createCommentController` | 🟡 | контроллер с `id`/`label`; `createCommentThread` отдаёт тред с эталонными дефолтами (свёрнут, `canReply: true`), поля записываемые, `dispose` безвреден. Ничего не рисуется, `commentingRangeProvider` и `reactionHandler` никто не зовёт; в Output — одна строка на id контроллера, что тредов не будет. `CommentThreadCollapsibleState`, `CommentMode`, `CommentThreadState` — настоящие enum'ы |

## vscode.authentication

🟡 **4/4.** Декларации подняты целиком, рантайм — null-объект: входа в Diode пока нет, настоящие
провайдеры — в планах. Namespace есть, потому что его отсутствие убивало расширение целиком: `hashicorp.terraform` регистрирует свой
провайдер и спрашивает сессию в `activate()`, до старта языкового сервера.

| член | статус | комментарий |
| --- | :-: | --- |
| `getSession` | 🟡 | без `createIfNone`/`forceNewSession` — `undefined` («не входил»). С ними — отказ с причиной «вход в TUI пока не поддержан»: эталон в этом месте спрашивает человека, а перегрузка обещает сессию, и `undefined` уронил бы расширение невнятным `TypeError`. Несовместимые с `silent` опции — эталонные ошибки |
| `getAccounts` | 🟡 | пустой список |
| `onDidChangeSessions` | 🟡 | валидное событие, никогда не стреляет — сессий нет |
| `registerAuthenticationProvider` | 🟡 | `Disposable`, провайдер никто не зовёт; в Output — одна строка на id провайдера, что входа не будет |

## vscode.debug

🟡 **18/18.** Декларации подняты целиком, рантайм — null-объект: дебаггера (DAP) в Diode нет и
не планируется. Namespace есть, потому что его отсутствие убивало расширение целиком: `golang.go`
регистрирует провайдер конфигураций посреди `activate()`, и без `vscode.debug` не появлялись ~60
его команд (языковой сервер при этом уже жил).

| член | статус | комментарий |
| --- | :-: | --- |
| `registerDebugConfigurationProvider`, `registerDebugAdapterDescriptorFactory`, `registerDebugAdapterTrackerFactory` | 🟡 | `Disposable`, провайдеры и фабрики никто не зовёт; в Output — одна строка на тип отладчика, что сессий не будет (трекеры на `*` молчат) |
| `startDebugging` / `stopDebugging` | 🟡 | `false` («не начата», одна строка в Output) / выполнено — останавливать нечего |
| `activeDebugSession`, `activeStackItem`, `breakpoints`, `activeDebugConsole` | 🟡 | `undefined` / `undefined` / пусто / консоль, вывод которой некому показать |
| `onDidChangeActiveDebugSession`, `onDidStartDebugSession`, `onDidReceiveDebugSessionCustomEvent`, `onDidTerminateDebugSession`, `onDidChangeBreakpoints`, `onDidChangeActiveStackItem` | 🟡 | валидные события, никогда не стреляют |
| `addBreakpoints`, `removeBreakpoints` | 🟡 | no-op |
| `asDebugSourceUri` | ✅ | по эталону: `debug:`-uri для `sourceReference`, `file:` для пути |

Значения-типы — эталонные: `DebugAdapterExecutable`, `DebugAdapterServer`,
`DebugAdapterNamedPipeServer`, `DebugAdapterInlineImplementation`, `Breakpoint`,
`SourceBreakpoint`, `FunctionBreakpoint`, `DebugThread`, `DebugStackFrame`, enum'ы
`DebugConsoleMode`, `DebugConfigurationProviderTriggerKind`. События активации `onDebug*` не
стреляют (см. таблицу ниже).

## vscode.tests

🟡 **1/1.** Декларации Test API подняты целиком, рантайм — инертный: view Testing нет.
Namespace есть, потому что `golang.go` заводит контроллер в `activate()` (`go.testExplorer.enable`
по умолчанию включён) — без него активация обрывалась.

| член | статус | комментарий |
| --- | :-: | --- |
| `createTestController` | 🟡 | контроллер с `id`/`label`; `items` и `children` элементов — рабочие коллекции (`add`/`get`/`delete`/`replace`/итерация, `parent` выставляется, тот же id заменяет элемент); `createTestItem` — элемент с эталонными дефолтами; `createRunProfile` — профиль с переданными полями; `createTestRun` — прогон, принимающий отчёты, `end` один раз шлёт `onDidDispose`. `runHandler`, `resolveHandler`, `refreshHandler` никто не зовёт; в Output — одна строка на id контроллера |

Значения-типы — эталонные: `TestRunProfileKind`, `TestTag`, `TestRunRequest`, `TestMessage`
(с `diff`), `TestMessageStackFrame`, `TestCoverageCount`, `FileCoverage` (с `fromDetails`),
`StatementCoverage`, `BranchCoverage`, `DeclarationCoverage`.

## События активации (`activationEvents`)

Это часть контракта расширения, которой нет в `vscode.d.ts`: она объявляется в `package.json`, но
решает, запустится ли расширение вообще. Расширение, чьи события не поддержаны, устанавливается,
показывается в каталоге — и молчит навсегда.

Активно **7 из 32** видов событий upstream 1.127.0 (`*` плюс 31 именованный вид из схемы
`activationEvents`). Строки ниже перечисляют все; неподдержанные сгруппированы по поверхности,
которой они ждут.

| событие | статус | комментарий |
| --- | :-: | --- |
| `*` | ✅ | eager; в него же превращается пустой/отсутствующий список — **отклонение от эталона** (там пусто значит пусто): на этот дефолт полагаются уже опубликованные в магазине расширения |
| `onStartupFinished` | ✅ | фаерится после открытия файлов из аргументов запуска |
| `onLanguage:<id>` | ✅ | когда языку впервые понадобились фичи — у любой модели (новый документ, смена языка, фоновая вкладка, дифф), как `requestRichLanguageFeatures` эталона; вместе с ним — голое `onLanguage` |
| `onCommand:<id>` | ✅ | плюс **неявные** события из `contributes.commands` (как `ImplicitActivationEvents` эталона): команда видна в палитре до активации, её исполнение ждёт `activate()`. Неявные `onLanguage:<id>` дают и `contributes.languages` |
| `workspaceContains:<паттерн>` | 🟡 | обе семантики префикса есть (проверка существования пути и поиск по дереву); глобы матчатся нашим `glob.ts` — **якорно по относительному пути**, тогда как за эталонным `workspaceContains:` стоит поиск на ripgrep, где паттерн без `/` ищется на любой глубине (`workspaceContains:*.py` у нас — только корень). Рекурсивные паттерны (`**/pyproject.toml`) совпадают |
| `onUri` | ✅ | URL расширению без обработчика (`diode://<id>/…`) поднимает его перед доставкой; голое `onUri` манифеста становится `onUri:<id>`, как в эталоне |
| `onOpenExternalUri` | 🕐 | вместе с `env.asExternalUri` |
| `onView:<id>`, `onWalkthrough:<id>` | 🕐 | ждут своих поверхностей (`contributes.views`, walkthrough) |
| `onWebviewPanel:<id>`, `onCustomEditor:<id>`, `onRenderer:<id>` | ⛔ | поверхности webview-природы — см. [потолок](#не-будет-by-design) |
| `onDebug`, `onDebugInitialConfigurations`, `onDebugDynamicConfigurations`, `onDebugResolve:<type>`, `onDebugAdapterProtocolTracker:<type>` | 🕐 | не стреляют: дебаггера нет, `vscode.debug` — null-объект |
| `onTaskType:<type>` | ✅ | Run Task поднимает провайдеров перед тем, как спросить задачи (`onCommand:workbench.action.tasks.runTask` и `onTaskType:<type>`; без типа — все типы из `contributes.taskDefinitions`), плюс **неявное** `onTaskType:<type>` из `contributes.taskDefinitions` |
| `onNotebook:<type>` | 🕐 | вместе с `vscode.notebooks` |
| `onAuthenticationRequest:<id>` | 🕐 | вместе с настоящими провайдерами `vscode.authentication` (сейчас namespace — null-объект) |
| `onChatParticipant:<id>`, `onChatContextProvider:<id>`, `onLanguageModelChatProvider:<id>`, `onLanguageModelTool:<id>` | 🕐 | вместе с `vscode.chat` / `vscode.lm` |
| `onTerminal`, `onTerminalProfile:<id>`, `onTerminalQuickFixRequest:<id>`, `onTerminalShellIntegration` | 🕐 | вместе с соответствующими вкладами терминала |
| `onFileSystem:<scheme>`, `onSearch:<scheme>`, `onEditSession:<scheme>`, `onIssueReporterOpened` | 🕐 | |

## Пока не поднятые namespace

| namespace | статус | комментарий |
| --- | :-: | --- |
| `vscode.scm` | 🕐 | source control |
| `vscode.notebooks` | 🕐 | сериализация — возможна; рендеры ячеек — webview, их не будет |
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

Активно 261 из 424 типов/классов upstream; поднятые — целиком, кроме перечисленных ниже
(bounded member-level uncommenting — раскомментировано подмножество членов). Одна строка
(`TextDocument`) — про другое: там раскомментировано и реализовано всё, но `save` — 🟡
заглушка; помечена отдельно, потому что для автора расширения это та же неполнота.

| тип | активно | не активно |
| --- | :-: | --- |
| `TextEditor` | 7/12 | `visibleRanges`, `insertSnippet`, `revealRange`, `show`, `hide` |
| `TextDocument` | 19/19 | — (класс документа проверяется компилятором: `implements vscode.TextDocument`). 🟡 `save` — всегда `false` («не сохранено»), у закрытого документа — отказ, как upstream: запроса «сохранить документ по uri» к хосту пока нет. `getWordRangeAtPosition` — дефолтное определение слова upstream (`DEFAULT_WORD_REGEXP`) либо регекс расширения; языковых word-definition (`wordPattern`) нет, регекс, матчащий пустую строку, — исключение. Рабочие и `offsetAt`/`positionAt`/`validateRange`/`validatePosition` (на их отсутствии молча ломался формат стокового prettier) |
| `TextEditorOptions` | 3/5 | `cursorStyle`, `lineNumbers` |
| `TerminalOptions` | 12/13 | `iconPath` |
| `TreeViewOptions` | 4/5 | `dragAndDropController` (drag-and-drop в TUI нет) |
| `ExtensionTerminalOptions` | 6/7 | `iconPath` |
| `ExtensionContext` | 16/17 | `languageModelAccessInformation`. Из активных: `environmentVariableCollection` — см. [семантические отклонения](#семантические-отклонения); `extension` — запись самого расширения из каталога `vscode.extensions` (телеметрии читают по ней `packageJSON.version`); `globalState`/`workspaceState` переживают перезапуск (хранилище на хосте); `globalState.setKeysForSync` — осознанный no-op (Settings Sync нет) |
| `WorkspaceEdit` | 11/11 | — |
| `WorkspaceEditEntryMetadata` | 3/4 | `iconPath` |
| `FileStat` | 4/5 | `permissions` |
| `FileSystemProvider` | 4/10 | `readDirectory`, `createDirectory`, `writeFile`, `delete`, `rename`, `copy` |
| `DocumentFilter` | 3/4 | `notebookType` |
| `CompletionItem` | 9/16 | `tags`, `sortText`, `filterText`, `preselect`, `commitCharacters`, `keepWhitespace`, `textEdit`. `additionalTextEdits` — и в самом списке (gopls), и догруженные resolve'ом (tsserver) |
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
| `environmentVariableCollection` | API целиком (`replace`/`append`/`prepend`, `get`, `forEach`, итерация, `delete`, `clear`, `description`, `persistent`, `getScoped` по папке). Коллекции всех расширений сливаются, как в эталоне (Replace отсекает остальные, порядок — обратный заведению), и ложатся на окружение **каждого** процесса терминала: шеллов человека, терминалов расширений и задач, в том числе при перезапуске терминала задачи; терминал со `strictEnv` их не получает. Область папки — по папке cwd терминала, иначе по корню воркспейса. `persistent` коллекции хранятся в состоянии воркспейса (`terminal.integrated.environmentVariableCollectionsV2`) и приезжают расширению уже в `activate()`; коллекции удалённых расширений забываются. **Отступления:** `applyAtShellIntegration` никуда не уходит (shell integration нет — переменные `VSCODE_ENV_*` некому читать); нет индикатора «окружение терминала устарело» и перезапуска по `terminal.integrated.environmentChangesRelaunch` — новые значения получает следующий процесс; переменные `${…}` в значениях не разворачиваются |
| `SecretStorage` | **без шифрования**: связки ключей ОС у нас нет, секреты лежат открытым текстом в `<profileDir>/secrets.json` под правами `0600`. Всё остальное по контракту — `get`/`store`/`delete`/`keys` работают, `onDidChange` стреляет и на запись, и на удаление, значения переживают перезапуск и у каждого расширения свой лоток |
| `Extension.extensionKind` | всегда `ExtensionKind.UI` — ровно как предписывает upstream, когда удалённого extension host'а нет (а в Diode его нет и не будет) |
| `Extension.activate()` | у **уже активного** расширения отдаёт его `exports`, у неактивного — отклоняется с объяснением. Активацией распоряжается хост (события активации, per-extension изоляция, оживление после смерти субпроцесса); «субпроцесс просит хост поднять соседа» — отдельная задача со своим RPC |
| namespaces / value-типы | рантайм может опережать декларацию (см. `languages.match`, `workspace.getWorkspaceFolder`) |

## Как читать «частично»

«Частично» — не «работает вполсилы», а «поверхность объявлена, отмеченные в комментарии члены —
стабы». Комментарий строки называет, какие именно члены не активны, чтобы автор расширения мог
проверить свой случай за минуту, не запуская diode.
