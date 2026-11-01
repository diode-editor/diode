# Языковые серверы и стоковые языковые расширения

Статус: `[~]` — платформа готова: LSP-протокол diode не пишет, сервер поднимает стоковый
`vscode-languageclient` внутри расширения (builtin `diode-lsp-typescript` или сторонний vsix из
магазина), а мы дописываем шим `vscode`. Работают TypeScript, Python (basedpyright + ruff),
JavaScript (eslint), Java (`redhat.java`), Go (`golang.go`), Terraform, prettier.

Устройство и грабли платформы — [arch/Extensions.md](../arch/Extensions.md#lsp-и-стоковые-клиенты);
заметки по конкретным расширениям — [arch/StockExtensions.md](../arch/StockExtensions.md); готовность
API (no-op провайдеры и наивные стабы) — [API-COVERAGE](../public/API-COVERAGE.md). Ниже — только
открытое.

## Платформа

- [ ] **Гонка didClose/didOpen и folding при быстром переоткрытии файла.** Закрыть вкладку и тут же
  открыть тот же файл — тост «Request textDocument/foldingRange failed … The document should be
  opened for foldingRanges». Воспроизводится на живом бинаре подряд идущими активациями,
  `e2e/fixtures/previewTabs` + стоковый typescript-language-server. Баг пре-существующий: A/B —
  одинаково и с `workbench.editor.enablePreview: false` (Ctrl+W + открытие), и с предпросмотром, где
  то же делает замещение вкладки; превью — частый повод, не причина. Чинить там, где
  `languages.provide*` проводит документ через document sync: запрос фолдинга не должен уходить
  серверу, пока didOpen переоткрытого документа его не догнал.
- [ ] Позиция курсора в didChange — для серверов, которым она нужна (сейчас не передаётся);
  коалесинг didChange (сейчас — синхронно на каждый батч).
- [ ] Вшитый сервер TypeScript (`ts-server.bundle`): размер бинаря (+~55 МБ) против отдельного
  распаковываемого артефакта; кросс-платформенность кэша распаковки.

## Go

Дыры ядра, найденные на `golang.go` (общие для любых серверов):

- [ ] **Completion: перезапрос неполного списка, пришедшего под устаревший префикс.** vscode-go при
  `isIncomplete: true` ставит всем пунктам `filterText` первого. Набрал `strings.ToL` быстрее, чем
  пришёл ответ на `strings.`, — попап показывает весь пакет и стоит так до следующего символа.
  `completionService.ts` перезапрашивает только на ввод **после** ответа; эталон (`SuggestModel`) по
  приходу результата для устаревшего контекста сразу перезапрашивает.
- [ ] **Hover: thematic break (`---`) печатается как есть** — `stripMarkdown` (`hoverService.ts`) его
  не знает; gopls разделяет им подпись, doc и ссылку на pkg.go.dev. Рисовать линией-разделителем, как
  между блоками провайдеров.

## Java

- [ ] **Снять курируемый дефолт `java.jdt.ls.lombokSupport.enabled: false`** из
  `curatedConfigInjection`, как только связка lombok/JDT перестанет ломать компиляцию
  ([arch/StockExtensions.md](../arch/StockExtensions.md#java-redhatjava-eclipse-jdt-ls)).

## Terraform

- [ ] **Деревья.** Панели Providers и Module Calls (данные дают команды `terraform-ls`) — через честное
  TreeView-API ([Extensions](Extensions.md#ui-вклады-viewscontainers--views)).
- [ ] **HCP Terraform.** Настоящий `vscode.authentication` (провайдеры расширений, `getSession` через
  провайдер, `onAuthenticationRequest:<id>`), вход по токену в quick input; панели workspaces/runs
  поверх деревьев.
- [x] **Code lens.** Счётчики ссылок `terraform-ls` работают на стоковом расширении (#942,
  [arch/StockExtensions.md](../arch/StockExtensions.md#terraform-hashicorpterraform)).
- [ ] Не разобрано: при наборе на машинной скорости (строка за ~200 мс) попап автодополнения не
  открылся — каждая клавиша отменяет предыдущий запрос (`-32800 RequestCancelled`), а на последнюю
  запрос до сервера не дошёл. При человеческом темпе открывается. Может быть свойством
  languageclient, может — нашим.

## Форматирование

- [ ] **Выбор форматтера — когда укусит** (решение человека: сейчас не делать; на `.ts` при
  установленном prettier выигрывает prettier, и это то, чего хочет пользователь):
  `editor.defaultFormatter` (глобальная и `[language]`); «Format Document With…»
  (`editor.action.formatDocument.multiple`) — пикер провайдеров, выбор пишется в
  `editor.defaultFormatter` языка; в проводе — личность провайдера (сейчас ядро видит только правки).
- [ ] **Остальная система (отложено):** `editor.formatOnPaste`, `editor.formatOnSaveMode` (`file`/`modifications` — дифф против
  git-версии в ядре есть).
- [ ] `Prettier: Create Configuration File` и `eslint.createConfig` упирались в отсутствие
  `showOpenDialog` и `createTerminal` — оба теперь есть: проверить живьём и снять пункт из
  `support.limits` записи prettier.
