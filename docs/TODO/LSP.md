# LSP — стоковые language servers поверх extension host

Статус: **[~] в работе** — платформа document sync + definition + диагностики,
итог итерации: Go to Definition со стоковым `typescript-language-server`.

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
3. **[ ] runway для languageclient** — перенос наивных стабов спайка
   (`vscodeTypes` value-классы, no-op `register*Provider`, naive-события),
   `diagnostics.publish` → `MarkerService` (squiggle + Problems без правок),
   builtin-расширение `vexx-lsp-typescript`.
4. **[ ] закрытие стоковым сервером** — тесты с настоящим `typescript-language-server`
   (правило: тесты над ИЗМЕНЯЕМЫМ кодом — правка без сохранения должна быть видна
   серверу), e2e + скриншот-демо.

## Document sync (шаг 1 — сделано)

- RPC-нотификации `editor.didOpen` / `editor.didChange`
  (`IWireDocumentSyncSnapshot`: `uri`, `languageId`, `version` = `versionId` модели —
  LSP требует монотонной версии, `text`, `isDirty`).
- Продюсер — `bindDocumentSync` (`src/vs/workbench/api/browser/documentSyncAdapter.ts`):
  didOpen на смену активного редактора, didChange на `onDidChangeContent`; проводка в
  `extensionHostModule` и зеркально в `ExtensionTestHarness`.
- Гейт по подписке: без слушателей `onDidOpen/onDidChangeTextDocument` в субпроцессе
  RPC не гоняется вовсе (`workspace.updateSubscriptions.documentSync`); переход 0→1
  доталкивает текущий активный документ (расширение могло активироваться позже открытия).
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
| `languages.createDiagnosticCollection` | — | шаг 3: naive → notify `diagnostics.publish` → `MarkerService.changeOne` |
| остальные `register*Provider` (~28) | — | шаг 3: no-op; закрытие по образцу definition (seam + RPC + UI-потребитель) |

## Отложенное (за рамками итерации)

- **SEA-упаковка серверов**: курируемый набор языковых серверов должен приезжать
  с бинарём (VISION: «батарейки вшиваем»); сервер и его deps — реальный `node_modules`
  рядом, не SEA-блоб. Пока сервер резолвится из настройки/workspace/PATH.
- **Второй язык** (gopls — один бинарь; python — basedpyright): не добавляет новых
  seam'ов; рецепт «как добавить язык» появится в шаге 3 (декларативная таблица
  `{ languageIds, serverResolver }` в builtin-клиенте).
- **Ленивая активация уже есть** (`onLanguage:<id>` в `activationEvents`) — клиент
  обязан объявлять её, чтобы не грузить сервер на старте без файлов языка.
- Инкрементальный sync + debounce; позиция курсора в didChange (для серверов,
  которым нужна — сейчас не передаётся).
