# LSP — стоковые language servers поверх extension host

Статус: **[~] платформа готова** — document sync + definition (F12) + диагностики
работают со стоковым `typescript-language-server` end-to-end (юнит-интеграция
`extensionHost.typescriptLsp.test.ts`, e2e `e2e/gotoDefinition.test.ts`,
скриншот-сценарий `goto-definition`). Открыто — «Отложенное» ниже
(SEA-упаковка серверов, второй язык, закрытие остальных стабов).

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
| `languages.createDiagnosticCollection` | naive | работает: notify `diagnostics.publish` → `diagnosticsSink` → `MarkerService.changeOne` (squiggle + Problems); наивность — related information не передаётся, маркеры мёртвого subprocess'а не сбрасываются до рестарта |
| `languages.match` | real | скоринг через `matchDocumentSelector` (10/0) — vscode-languageclient фильтрует ИМ документы для синхронизации с сервером; наивное «всегда 10» скармливало ts-серверу markdown и роняло его хендлеры |
| остальные `register*Provider` (26) | no-op | закрытие по образцу definition: core seam + RPC `languages.provideX` + UI-потребитель (hover-виджет, references-панель, rename и т.д.) |
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

- **SEA-упаковка серверов** (следующая итерация): курируемый набор языковых
  серверов должен приезжать с бинарём (VISION: «батарейки вшиваем»). Текущее
  требование «сервер в devDeps проекта или PATH» неканонично: ни VS Code
  (tsserver шипится с редактором), ни neovim (глобальная установка) не ставят
  сервер в проект; в devDeps реальных проектов живёт `typescript`, но не
  `typescript-language-server`. Набросок дизайна:
  - бандл: `typescript-language-server` (esbuild в один файл, ~5 МБ) +
    `typescript/lib` (tsserver.js + стандартные d.ts, ~50 МБ) в SEA-ассеты,
    распаковка в кэш при первом обращении (механика ripgrep/node-pty; нужна
    инвалидация по версии vexx);
  - node-рантайм: «vexx как node» — ранний branch в `main.ts` (по образцу
    `VEXX_EXTENSION_HOST=1`), которым СВОЙ бинарь исполняет `cli.mjs` сервера;
    внешний node в PATH перестаёт быть зависимостью;
  - резолв становится: настройка → workspace `node_modules/.bin` (оверрайд
    версии) → **bundled (дефолт)** → PATH; воркспейсный `typescript` сервер
    уважает сам (`Using Typescript version (workspace)`);
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
