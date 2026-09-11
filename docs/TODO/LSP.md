# LSP — стоковые language servers поверх extension host

Статус: **[~] платформа готова** — document sync + definition (F12) + диагностики +
автодополнение (Ctrl+Space, триггер-символы, панель описания, авто-импорт) + hover
(Ctrl+K Ctrl+U) + Find All References (Ctrl+K Ctrl+R, панель в сайдбаре) +
подсказка параметров (попап у каретки по «(») работают со
стоковым `typescript-language-server` end-to-end (юнит-интеграция
`extensionHost.typescriptLsp.test.ts`, `.completion.test.ts`, `.hover.test.ts`,
`.references.test.ts`, `.signatureHelp.test.ts`; e2e `e2e/gotoDefinition.test.ts`,
`e2e/references.test.ts`, `e2e/parameterHints.test.ts`;
скриншот-сценарии `goto-definition`, `lsp-completion`, `references`,
`parameter-hints`).
Открыто — «Отложенное» ниже (gopls, реестр для basedpyright, закрытие остальных стабов).

## Архитектура (проверена спайком, ветка `worktree-lsp-spike`)

LSP-протокол diode не пишет. Language server поднимает **не ядро, а builtin-расширение**
через стоковый `vscode-languageclient` (сам спавнит сервер, сам гоняет JSON-RPC,
прокидывает результаты через `vscode` API). Достаточно дописывать наш `vscode`-стаб —
спайк доказал это end-to-end (~540 строк наивных стабов): сервер спавнится, проходит
`initialize`, TS-диагностики доезжают до squiggle + панели Problems, кросс-файловый
go-to-definition работает; сервер-внук корректно убивается на `dispose()`.

Итерация «платформа» сделана целиком: document sync, definition-провайдер + F12,
runway для стокового `vscode-languageclient` (builtin `diode-lsp-typescript`,
`version` в лок-степе с `extensions/VSCODE_VERSION`), закрытие настоящим
`typescript-language-server` (резолв: настройка → workspace `node_modules/.bin` →
bundled → PATH), видимость запуска (`window.withProgress` + `createOutputChannel`).

## Document sync (сделано; конспект решений)

- RPC-нотификации `editor.didOpen` / `editor.didChange`
  (`IWireDocumentSyncSnapshot`: `uri`, `languageId`, `version` = `versionId` модели —
  LSP требует монотонной версии, `text`, `isDirty`).
- Продюсер — `bindDocumentSync` (`src/vs/workbench/api/browser/documentSyncAdapter.ts`):
  didOpen на смену активного редактора, didChange на `onDidChangeContent`; проводка в
  `extensionHostModule` и зеркально в `ExtensionTestHarness`.
- Гейты: `didChange` — по подписке (`workspace.updateSubscriptions.documentSync`,
  full-text на каждое нажатие без потребителей — расточительно); `didOpen` — БЕЗ
  гейта подписки: `workspace.textDocuments` обязан нести полный текст активного
  документа ещё до активации клиента (стоковый languageclient на `start()`
  рассылает серверу didOpen для документов реестра, отфильтрованных
  `languages.match`; meta-обёртка с пустым текстом отравила бы сервер).
- Push активного документа на `host.ready` ДО первой активации — стоковый
  languageclient читает `workspace.textDocuments`/`visibleTextEditors` на `start()`.
- didChange коалесируется в пределах тика (latest-wins) + лимит снапшота 8 МБ.
- `onDidChangeTextDocument` несёт одну full-range правку старого текста — валидно
  и для Full, и для Incremental sync сервера.

### Осознанные люфты (закрывать по мере надобности)

- **Инкрементальные правки не передаются** — всегда полный текст. Настоящий
  debounce/инкрементальный sync — когда перф покажет.
- Расширение без подписок document sync видит текст только по save/completion/folding
  pull-путям.

## Автодополнение (итерация «suggest × LSP»)

Стек целиком: попап у каретки ← `CompletionService` ← `EditorService.completionSource`
← host ← RPC ← провайдеры субпроцесса ← `vscode-languageclient` ← сервер.

- **Класс-ловушка.** `protocolConverter` клиента делает `new code.CompletionList(items,
  isIncomplete)` на каждый ответ-список (а `typescript-language-server` всегда отвечает
  списком). Пока `CompletionList`/`SnippetString` не были экспортированы из
  `vscodeNamespace`, конвертация падала целиком — LSP-пунктов не было вовсе, а
  единственный след уходил в `client.outputChannel`. Пруф — прогон
  `extensionHost.typescriptLsp.completion.test.ts` без экспорта: таймаут 60 с вместо ответа.
- **Dot-accessor.** После `.` tsserver отдаёт пункты вида `label: "getTime"`,
  `insertText`/`filterText`: `.getTime`, а `range` накрывает саму точку. Отсюда два
  требования к ядру: границу префикса брать из провайдерского `range` (свой `wordStart`
  включает `.` и `-` — префиксом стало бы `d.`), а фильтровать по `filterText`.
  Пересчитывать провайдерскую границу при доборе символов нельзя — попап закрывался
  на первом же символе.
- **Описание и авто-импорт — только через resolve.** Клиент объявляет серверу
  `resolveSupport: [documentation, detail, additionalTextEdits]`; в первом ответе их нет.
  Кэш ответов живёт в субпроцессе (последние 2 ведра, id = `"<cacheId>.<index>"`) —
  резолвить нужно ТОТ ЖЕ объект, который вернул провайдер (у клиента это
  `ProtocolCompletionItem` с приватным `data`). Accept ждёт resolve до 300 мс, потом
  вставляет без импорта — молчащий сервер не морозит правку.
- **Сниппеты не поддержаны** (осознанно): `SnippetString` нужен только как транспорт,
  плейсхолдеры вырезаются (`stripSnippetPlaceholders`), чтобы `${1:name}` не попал в
  буфер. Настоящие табстопы — отдельная задача.
- **Люфты**: отмены RPC нет (таймаут + счётчик `requestSeq` против устаревших ответов);
  markdown-документация показывается как текст (рендерера markdown в tuidom нет);
  на каждый запрос уходит полный текст документа.

## Ключевые грабли (из спайка, помнить при продуктивизации)

- `vscode-languageclient` шлёт `didOpen` серверу только для документов из
  `window.visibleTextEditors` — пустой стаб ⇒ сервер молча не получает документ,
  0 диагностик.
- Ошибки конвертации `p2c.asDiagnostics` логируются ТОЛЬКО в `client.outputChannel` —
  no-op канал молча теряет их; клиентский outputChannel обязан быть настоящим.
- `vscode.version` должен быть валидным VS Code semver (`1.127.0`, лок-степ с
  `extensions/VSCODE_VERSION`) — languageclient проверяет `^1.91.0`.
- Под SEA `process.execPath` — это diode-бинарь: наши builtin-клиенты спавнят
  сервер `{ command }`-формой. Для СТОРОННИХ расширений, которые форкают
  execPath сами (`TransportKind.ipc` у basedpyright), subprocess ext-host'а
  чистит наследуемое окружение: `DIODE_EXTENSION_HOST` снят,
  `DIODE_RUN_AS_NODE=1` — любой форк diode-бинаря из расширения работает как
  node (`main.ts` проверяет RUN_AS_NODE первым; env-фикс — в
  `runExtensionHostSubprocess`, гейт — `extensionHost.fork.test.ts` + e2e
  `pythonLsp.test.ts` на настоящем SEA).

## Таблица стабов vscode API (заполняется по шагам 2–3)

Статусы: no-op (валидный пустой), naive (работает наивно), real (полная проводка).

| Символ | Статус | Шаги закрытия |
|---|---|---|
| `workspace.onDidOpenTextDocument` | real | — (шаг 1) |
| `workspace.onDidChangeTextDocument` | real | — (шаг 1; одна full-range правка) |
| `workspace.onDidCloseTextDocument` | real | — (закрыт в [EditorGroups](EditorGroups.md): `editor.didClose` + сброс didOpen-дедупа) |
| `languages.registerDefinitionProvider` | real | — (шаг 2: seam `iDefinitionSource` → RPC `languages.provideDefinition`, таймаут 5000 мс — холодный сервер; UI — `DefinitionService` + F12, кросс-файловая навигация паттерном Problems reveal) |
| `languages.registerCompletionItemProvider` | real | seam `iCompletionSource` → RPC `languages.provideCompletionItems` (ответ `{items, isIncomplete}`) + `languages.resolveCompletionItem` (описание, авто-импорт); `triggerCharacters` доезжают через `languages.updateSubscriptions`; UI — попап с панелью описания. **Грабля**: конвертер клиента конструирует `new code.CompletionList(...)` на КАЖДЫЙ ответ, а `new code.SnippetString(...)` — на сниппет-пункт; без этих классов в стабе конвертация падала целиком, и ошибка была видна только в `client.outputChannel` (0 пунктов, тишина) |
| `languages.createDiagnosticCollection` | naive | работает: notify `diagnostics.publish` → `diagnosticsSink` → `MarkerService.changeOne` (squiggle + Problems); наивность — related information не передаётся, маркеры мёртвого subprocess'а не сбрасываются до рестарта |
| `languages.match` | real | скоринг через `matchDocumentSelector` (10/0) — vscode-languageclient фильтрует ИМ документы для синхронизации с сервером; наивное «всегда 10» скармливало ts-серверу markdown и роняло его хендлеры |
| `languages.registerHoverProvider` | real | seam `iHoverSource` → RPC `languages.provideHover` (таймаут 5000 мс — тот же холодный сервер); **несколько провайдеров** конкатенируются в порядке регистрации (по `WireHover` на непустой ответ), сбойный пропускается; wire несёт сырой markdown, стрип — в UI (`stripMarkdown` в `HoverService`). UI — contrib `hover` (пара `HoverService`/`HoverComponent` по образцу suggest, элемент `HoverElement` с рамкой и переносом), Ctrl+K Ctrl+U (не VS Code-овский Ctrl+K Ctrl+I: на legacy-tier'е Ctrl+I приезжает байтом Tab, и тот чорд там недостижим и занят фолбэком мультикурсора; одиночный `alt+буква` в дефолты не берём — `alt` layout-sensitive и молчит на кириллице), Escape/правка/каретка/фокус закрывают. Люфты v1: контент — плоский текст (markdown-рендерера нет), высота клампится без скролла, мышиного триггера нет |
| `languages.registerReferenceProvider` | real | seam `iReferenceSource` → RPC `languages.provideReferences` (таймаут 5000 мс — поиск ссылок по проекту дороже одиночного перехода); в параметрах LSP-контекст `includeDeclaration` (шлём `true`, как VS Code); **несколько провайдеров** конкатенируются в порядке регистрации, сбойный пропускается. UI — contrib `references`: вьюлет сайдбара REFERENCES (`ReferencesComponent` + `ReferencesService`), файлы со счётчиком и строки кода с подсветкой вхождения — строки общие с панелью поиска (`searchResultRows`). Текст строк LSP не отдаёт: добираем сами (`referencePreview.ts`) из открытой модели, иначе с диска. Ctrl+K Ctrl+R (и канонический Shift+Alt+F12 вторым биндом), F4/Shift+F4 — обход ссылок из редактора. Люфты v1: нет истории запросов, удаления результата из списка, иерархии каталогов и peek-виджета |
| `languages.registerSignatureHelpProvider` | real | seam `iSignatureHelpSource` → RPC `languages.provideSignatureHelp` (таймаут 5000 мс — тот же холодный сервер, что у hover). В отличие от hover/references ответы НЕ склеиваются: провайдеров обходим по очереди и берём первый непустой (так предписывает vscode API). **Грабля класса-ловушки**: конвертер клиента конструирует `new code.SignatureHelp()` (без аргументов), `SignatureInformation`, `ParameterInformation` на каждый ответ и читает `code.SignatureHelpTriggerKind.*` на каждом запросе — все четыре пришлось добавить в стаб. Поддержаны ОБЕ перегрузки регистрации (метаданные объектом и rest-строки): клиент выбирает первую, когда сервер прислал `retriggerCharacters`. Триггер-символы (`(`, `,`, `<`) и ретриггеры (`)`) едут в ядро через `languages.updateSubscriptions` — тот же канал, что у completion. UI — contrib `parameterHints`: попап НАД строкой каретки (автодополнение предпочитает низ), счётчик перегрузок, подсветка активного параметра, Ctrl+K Ctrl+Space (канонический Ctrl+Shift+Space вторым биндом), Up/Down листают перегрузки, уступая попапу автодополнения. Люфты v1 — [ParameterHints.md](ParameterHints.md) |
| остальные `register*Provider` (23) | no-op | закрытие по образцу definition/hover/references: core seam + RPC `languages.provideX` + UI-потребитель (rename, implementations и т.д.; для implementations/typeDefinition/declaration панель ссылок уже готова) |
| `workspace.applyEdit` | no-op | врёт `true`; закрытие: RPC `workspace.applyEdit` → `EditorService`/`BulkEdit` (нужен rename/code actions) |
| `workspace.getWorkspaceFolder` | naive | префикс-матч + fallback на первую папку |
| `workspace.createFileSystemWatcher` | готово | настоящие watcher'ы поверх `ITreeFileWatcher` ядра (`RelativePattern`, `ignore*Events`, excludes из `files.watcherExclude`); детали — [arch/Extensions.md](../arch/Extensions.md) |
| `workspace.onDid/Will{Create,Delete,Rename}Files`, notebook-события | no-op | продюсеры файловых операций ядра → RPC |
| `window.withProgress` | real | запись статус-бара с анимированным спиннером (`ProgressStatusBarAdapter`); message/increment серверного workDoneProgress обновляют текст; отмена НЕ поддержана — токен никогда не стреляет (`ProgressPart` languageclient'а это переживает); на смерть subprocess'а host сам гасит живые спиннеры |
| `window.tabGroups` | naive | проекция вкладок группы: снимки `Tab` на момент вызова (идентичность не гарантируется), `onDidChangeTabs` живой, `close` работает; на них опирается pull-диагностика languageclient 10 (basedpyright) |
| `vscode.extensions` | naive | `getExtension` честно `undefined`, `all` пуст, `onDidChange` не стреляет — каталог расширений субпроцессу не раздаётся; для pyright-семейства (детект Pylance/ms-python) это правильный ответ |
| `ExtensionContext` | naive | `subscriptions` + `extensionPath`/`extensionUri`/`asAbsolutePath` (корень установки vsix едет от host'а в регистрации; builtin'ы — от каталога `filename`) + `extensionMode: Production`; memento/secrets/storageUri — нет |
| `commands.registerTextEditorCommand` | naive | обёртка над `registerCommand`: без активного редактора — warn + no-op (семантика VS Code), edit-builder инертный (батч-правки — за `workspace.applyEdit`-путём) |
| `window.showTextDocument` | naive | возвращает активный редактор; закрытие: RPC открытия ресурса |
| `window.createOutputChannel` | real | канал в панели Output (`extensions.<slug(name)>`, label = name; `ExtensionOutputAdapter`): append/appendLine/LogOutputChannel-методы с уровнями, `show()` открывает панель на канале; люфты — `clear`/`replace` no-op (журнал ретенционный), trace/debug фильтруются уровнем логгера |
| `env` (appName/language/clipboard/openExternal) | naive | честные значения; клипборд пуст, openExternal отказывает |

## Отложенное (за рамками итерации)

- **SEA-упаковка серверов сделана** (`ts-server.bundle`, распаковка в XDG-кэш,
  запуск `process.execPath` в node-режиме `DIODE_RUN_AS_NODE=1`; e2e —
  `e2e/lspBundled.test.ts`). Открытые вопросы: размер бинаря (+~55 МБ) vs
  отдельный распаковываемый артефакт; кросс-платформенность кэша.
- **Второй язык — Python сделан, причём другим маршрутом**: не строка в таблице
  builtin-клиента, а НАСТОЯЩИЙ сторонний `detachhead.basedpyright`.vsix с
  open-vsx как есть (ставится `--install-extension`, ни строчки нашего кода
  расширения); доработки стаба и env-фикс fork/SEA — в таблице и «граблях»
  выше, курируемый дефолт `basedpyright.importStrategy: "useBundled"` —
  `curatedConfigInjection` в `main.ts` (манифестный `fromEnvironment` зовёт API
  ms-python.python без try/catch и роняет активацию). Гейты — сьюты
  `extensionHost.pythonLsp*`, e2e `pythonLsp.test.ts`, сценарий `python-lsp`;
  vsix приезжает из магазина — последняя опубликованная версия, без
  закоммиченной фикстуры (политика — [TESTING.md](../TESTING.md)). Folding у
  python — indentation-based ядра (сервер `textDocument/foldingRange` не
  реализует). Запись `proxy-openvsx` в реестре магазина — сделана
  ([Marketplace.md](Marketplace.md)); дальше — gopls (маршрут «бинарь в PATH»).
- Инкрементальный sync + debounce; позиция курсора в didChange (для серверов,
  которым нужна — сейчас не передаётся).
- **F12 при нескольких целях берёт первую вслепую** (`definitionService.ts`,
  `locations[0]`), а VS Code показывает список. После итерации references панель
  для этого уже есть — осталось развернуть в неё multi-target ответ.
