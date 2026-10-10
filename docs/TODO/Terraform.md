# Terraform: стоковое `hashicorp.terraform`

Статус: **PR1 (активация) сделан, PR2–PR3 открыты.** Родственные документы:
[Extensions.md](Extensions.md) (фаза 8b — деревья), [Marketplace.md](Marketplace.md),
матрица [API-COVERAGE.md](../public/API-COVERAGE.md).

Цель — стоковое расширение `hashicorp.terraform` из Open VSX (платформенный vsix со
вшитым `terraform-ls`, версию не пиним) работает в Diode без доработок со стороны
расширения: подсветка, hover, автодополнение, F12, диагностики.

## Что мешало (спайк, 2.40.0)

Как есть расширение падало при активации, падения шли цепочкой:

1. **Загрузка модуля** — `Class extends value undefined`: 16 классов бандла
   наследуются от `vscode.TreeItem`, в конструкторах — `ThemeIcon`.
2. **Первая строка `activate()`** — `context.extension.packageJSON`.
3. **`env.createTelemetryLogger is not a function`** — `@vscode/extension-telemetry`
   строит логгер в конструкторе репортера. Статический скан бандла этот вызов не
   видит: обращение идёт через `this.vscodeAPI`.
4. **Конструкторы панелей до старта LS** (HCP Terraform, Providers, Module Calls) —
   `authentication.getSession`/`onDidChangeSessions`/`registerAuthenticationProvider`
   и `window.createTreeView`/`registerTreeDataProvider`.

Пункты 1, 2 и деревья из пункта 4 приехали в main раньше, вместе с деревьями-заглушками
(`treeViewNoop.ts`) и `ExtensionContext.extension`. PR1 закрыл остальное:
`env.createTelemetryLogger` (с `TelemetryTrustedValue`) и `vscode.authentication`.

Классы-значения, которые бандл использует, но которых в рантайме нет (`DocumentSymbol`,
`SemanticTokens*`, `SelectionRange`, `Color*`, `LinkedEditingRanges`, `InlayHintLabelPart`,
`CallHierarchy*Call`, `DocumentHighlight`, `InlineValue*`, `QuickPickItemKind`,
`NotebookCellKind`), **для активации не нужны** — проверено живым прогоном без них. Их
зовут конвертеры languageclient только при вызове провайдера, а соответствующие
`register*Provider` у нас no-op. Понадобятся вместе с провайдерами. `SemanticTokens*`
приедут с семантическими токенами (отдельная ветка).

## Что работает (живой прогон 10.10.2026, `npm run drive`)

- Активация целиком: `terraform-ls` стартует, клиент в `Running`. В Output «Extensions» —
  одна строка про вход HCP Terraform и по строке на каждое из шести деревьев.
- TextMate-подсветка (грамматики из манифеста).
- Hover — работает, markdown выводится сырым (`_string_`) — общий долг рендера hover.
- Автодополнение со схемой AWS из вшитых схем (без terraform CLI и `terraform init`).
- F12 на `var.region` → `variable "region"`.
- Диагностики: undercurl в редакторе и строки в Problems.
- Форматирование — `Terraform (CLI) is required`: нужен terraform в PATH, как и в VS Code.
  Это окружение, а не Diode.

Наблюдение для [Suggest.md](Suggest.md): при наборе на машинной скорости (вся строка
за ~200 мс) попап не открылся. Каждая клавиша отменяет предыдущий запрос
(`-32800 RequestCancelled`), а на последнюю клавишу запрос до сервера не дошёл. При
человеческом темпе попап открывается. Не разобрано: это может быть и свойство
languageclient, и наше поведение.

Тесты: стоковый сьют `extensionHost.terraformLsp.test.ts` (настоящий vsix из магазина:
диагностика, hover, F12, автодополнение), герметичный `extensionHost.authTelemetry.test.ts`
(синтетическое расширение той же формы активации), сценарий `terraform-lsp`, смоук-чек
магазина в `e2e/marketplace/checks.ts`. Запись магазина — `hashicorp.terraform` с
`engines.diode >=0.7.3` (выпущенные 0.7.2 и раньше её не видят: на них расширение падает).

## План

- [x] **PR1 — активация.** No-op/null-объекты, чтобы `activate()` доходил до LS:
  `env.createTelemetryLogger`, `vscode.authentication` (`getSession` → `undefined`, вход
  отклоняется с причиной, провайдер принимается и не зовётся). Запись в магазин.
- [ ] **PR2 — деревья.** Панели Providers и Module Calls (данные дают команды
  `terraform-ls`) — через честное TreeView-API, фаза 8b в [Extensions.md](Extensions.md).
  Заодно `window.createQuickPick`/`showOpenDialog`, если их позовут команды панелей.
- [ ] **PR3 — HCP Terraform и прочее.** Настоящий `vscode.authentication` (провайдеры
  расширений, `getSession` через провайдер, `onAuthenticationRequest:<id>`), вход по
  токену в quick input; панели workspaces/runs поверх PR2. Code lens (счётчики ссылок
  `terraform-ls`) — когда `registerCodeLensProvider` перестанет быть no-op.
