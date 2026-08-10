# LSP — стоковые language servers поверх extension host

Статус: **[~] платформа готова** — document sync + definition (F12) + диагностики +
автодополнение (Ctrl+Space, триггер-символы, панель описания, авто-импорт) работают со
стоковым `typescript-language-server` end-to-end (юнит-интеграция
`extensionHost.typescriptLsp.test.ts` и `extensionHost.typescriptLsp.completion.test.ts`,
e2e `e2e/gotoDefinition.test.ts`, скриншот-сценарии `goto-definition`, `lsp-completion`).
Открыто — «Отложенное» ниже (второй язык, закрытие остальных стабов).

## Архитектура (проверена спайком, ветка `worktree-lsp-spike`)

LSP-протокол vexx не пишет. Language server поднимает **не ядро, а builtin-расширение**
через стоковый `vscode-languageclient` (сам спавнит сервер, сам гоняет JSON-RPC,
прокидывает результаты через `vscode` API). Достаточно дописывать наш `vscode`-стаб —
спайк доказал это end-to-end (~540 строк наивных стабов): сервер спавнится, проходит
`initialize`, TS-диагностики доезжают до squiggle + панели Problems, кросс-файловый
go-to-definition работает; сервер-внук корректно убивается на `dispose()`.

План итерации — один PR, четыре шага:

1. **[x] document sync** — наивный push `editor.didOpen`/`editor.didChange`
   (полный текст) host → subprocess; `workspace.onDidOpen/onDidChangeTextDocument`
   фаерятся с настоящим текстом буфера. Без него languageclient не шлёт серверу ни байта.
2. **[x] definition-провайдер** — `languages.registerDefinitionProvider` по образцу
   completion/folding (core seam `iDefinitionSource` → RPC `languages.provideDefinition`)
   + UI-команда Go to Definition (F12) с кросс-файловой навигацией.
3. **[x] runway для languageclient** — перенос наивных стабов спайка
   (`vscodeTypes` value-классы, no-op `register*Provider`, naive-события),
   `diagnostics.publish` → `MarkerService` (squiggle + Problems без правок),
   builtin-расширение `vexx-lsp-typescript` (бандл с `vscode-languageclient@10`
   проходит гейт RELATIVE_REQUIRE; `version: "1.127.0"` в лок-степе с
   `extensions/VSCODE_VERSION` — тест в `vscodeNamespace.identity.test.ts`).
4. **[x] закрытие стоковым сервером** — тесты с настоящим `typescript-language-server`
   (правило: тесты над ИЗМЕНЯЕМЫМ кодом — правка без сохранения должна быть видна
   серверу), e2e + скриншот-демо. Сервер резолвится: настройка
   `vexx.lsp.typescript.serverPath` → workspace `node_modules/.bin` → PATH;
   `tsserverPath` — для песочниц без своего TypeScript
   (`initializationOptions.tsserver.path`). Dev-прогон «из коробки»: воркспейс
   с `typescript-language-server` в devDeps работает без настроек.
5. **[x] видимость запуска** — настоящий `window.withProgress` (спиннер в
   статус-баре: клиент оборачивает `client.start()` + `progressOnInitialization`
   для серверного прогресса) и настоящий `window.createOutputChannel`
   (канал в панели Output).

## Document sync (шаг 1 — сделано)

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

- **`editor.didClose` нет** — сервер держит последний буфер закрытой вкладки;
  `onDidCloseTextDocument` по-прежнему не фаерится, didOpen-дедуп никогда не сбрасывается.
- **Инкрементальные правки не передаются** — всегда полный текст. Настоящий
  debounce/инкрементальный sync — когда перф покажет.
- **Синхронизируется только активный редактор** — работа со сплитами/фоновыми
  документами не передаёт их правки (сплитов в vexx пока нет).
- Расширение без подписок document sync видит текст только по save/completion/folding
  pull-путям (статус-кво до этой задачи).

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
- Под SEA `process.execPath` — это vexx-бинарь: спавнить сервер только
  `{ command }`-формой (никаких `TransportKind.ipc`/fork).

## Таблица стабов vscode API (заполняется по шагам 2–3)

Статусы: no-op (валидный пустой), naive (работает наивно), real (полная проводка).

| Символ | Статус | Шаги закрытия |
|---|---|---|
| `workspace.onDidOpenTextDocument` | real | — (шаг 1) |
| `workspace.onDidChangeTextDocument` | real | — (шаг 1; одна full-range правка) |
| `workspace.onDidCloseTextDocument` | no-op | продюсер закрытия вкладки → `editor.didClose` → fire + сброс didOpen-дедупа |
| `languages.registerDefinitionProvider` | real | — (шаг 2: seam `iDefinitionSource` → RPC `languages.provideDefinition`, таймаут 5000 мс — холодный сервер; UI — `DefinitionService` + F12, кросс-файловая навигация паттерном Problems reveal) |
| `languages.registerCompletionItemProvider` | real | seam `iCompletionSource` → RPC `languages.provideCompletionItems` (ответ `{items, isIncomplete}`) + `languages.resolveCompletionItem` (описание, авто-импорт); `triggerCharacters` доезжают через `languages.updateSubscriptions`; UI — попап с панелью описания. **Грабля**: конвертер клиента конструирует `new code.CompletionList(...)` на КАЖДЫЙ ответ, а `new code.SnippetString(...)` — на сниппет-пункт; без этих классов в стабе конвертация падала целиком, и ошибка была видна только в `client.outputChannel` (0 пунктов, тишина) |
| `languages.createDiagnosticCollection` | naive | работает: notify `diagnostics.publish` → `diagnosticsSink` → `MarkerService.changeOne` (squiggle + Problems); наивность — related information не передаётся, маркеры мёртвого subprocess'а не сбрасываются до рестарта |
| `languages.match` | real | скоринг через `matchDocumentSelector` (10/0) — vscode-languageclient фильтрует ИМ документы для синхронизации с сервером; наивное «всегда 10» скармливало ts-серверу markdown и роняло его хендлеры |
| остальные `register*Provider` (25) | no-op | закрытие по образцу definition: core seam + RPC `languages.provideX` + UI-потребитель (hover-виджет, references-панель, rename и т.д.) |
| `workspace.applyEdit` | no-op | врёт `true`; закрытие: RPC `workspace.applyEdit` → `EditorService`/`BulkEdit` (нужен rename/code actions) |
| `workspace.getWorkspaceFolder` | naive | префикс-матч + fallback на первую папку |
| `workspace.createFileSystemWatcher` | no-op | валидный не-стреляющий watcher; закрытие: мост к `IFileWatcher` ядра |
| `workspace.onDid/Will{Create,Delete,Rename}Files`, notebook-события | no-op | продюсеры файловых операций ядра → RPC |
| `window.withProgress` | real | запись статус-бара с анимированным спиннером (`ProgressStatusBarAdapter`); message/increment серверного workDoneProgress обновляют текст; отмена НЕ поддержана — токен никогда не стреляет (`ProgressPart` languageclient'а это переживает); на смерть subprocess'а host сам гасит живые спиннеры |
| `window.tabGroups` | no-op | пустые группы; закрытие: проекция вкладок группы |
| `window.showTextDocument` | naive | возвращает активный редактор; закрытие: RPC открытия ресурса |
| `window.createOutputChannel` | real | канал в панели Output (`extensions.<slug(name)>`, label = name; `ExtensionOutputAdapter`): append/appendLine/LogOutputChannel-методы с уровнями, `show()` открывает панель на канале; люфты — `clear`/`replace` no-op (журнал ретенционный), trace/debug фильтруются уровнем логгера |
| `env` (appName/language/clipboard/openExternal) | naive | честные значения; клипборд пуст, openExternal отказывает |

## Отложенное (за рамками итерации)

- **[x] SEA-упаковка серверов — СДЕЛАНО** (итерация «вшитый сервер»):
  `ts-server.bundle` (~13 МБ: однофайловый `cli.mjs` сервера + минимальный
  `typescript/lib` без локалей/tsc/ATA) едет в обеих трубах поставки (SEA-ассет /
  файл рядом с `main.js` в self-extract), распаковывается в XDG-кэш
  (`~/.cache/vexx/ts-server/<version>-<sha256[0:12]>`) атомарно и
  конкурентно-безопасно (`extractBundleToCache`: mkdir-lock + tmp + `.vexx-ready`
  + rename — схема self-extract-стаба). Рантайм «как VS Code»: сервер запускается
  `process.execPath` субпроцесса (dev/self-extract — настоящий node; SEA —
  vexx-бинарь в node-режиме `VEXX_RUN_AS_NODE=1`, калька `ELECTRON_RUN_AS_NODE`;
  динамический `import()` из вшитого SEA-main перехвачен embedder-хуком, а
  `require(esm)` не берёт top-level await cli.mjs — поэтому в бандле лежит
  CJS-шим `run-cli.cjs`, чей `import()` идёт настоящим ESM-loader'ом).
  Резолв: настройка → workspace `node_modules/.bin` → **bundled (дефолт)** → PATH;
  для bundled — `tsserver.path` из поставки + ATA выключен. Компромисс ленивой
  распаковки: она стартует fire-and-forget при регистрации builtin'ов (вне
  критического пути первого кадра), целевые пути детерминированы и раздаются
  через configDefaults заранее; клиент при гонке коротко поллит готовность (5 с).
  E2E-пруф — `e2e/lspBundled.test.ts`: SEA и self-extract на голом окружении
  (PATH без node, воркспейс без node_modules, без настроек).
  - открытые вопросы: размер бинаря (+~55 МБ) vs отдельный распаковываемый
    артефакт; кросс-платформенность кэша; прогон e2e на «голой» машине без
    node_modules/node.
- **Второй язык** (gopls — один бинарь; python — basedpyright): не добавляет новых
  seam'ов; рецепт «как добавить язык» появится в шаге 3 (декларативная таблица
  `{ languageIds, serverResolver }` в builtin-клиенте).
- **Ленивая активация уже есть** (`onLanguage:<id>` в `activationEvents`) — клиент
  обязан объявлять её, чтобы не грузить сервер на старте без файлов языка.
- Инкрементальный sync + debounce; позиция курсора в didChange (для серверов,
  которым нужна — сейчас не передаётся).
