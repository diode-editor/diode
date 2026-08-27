# Extensions — VS Code-совместимые расширения

Цель: загружать расширения по формату VS Code (`package.json` с `contributes`) — сначала встроенные, потом из `~/.diode/extensions/`. Архитектура должна быть готова к разгрузке (clean unload через `IDisposable`) и инкрементальному добавлению contribution points.

Готовое (Phase 1 языки/грамматики, Phase 8 extension host + completion, стоковый editorconfig-vscode) описано в [docs/arch/Extensions.md](../arch/Extensions.md). Ниже — только открытые фазы.

---

## Phase 2 — Темы и иконки

- [ ] `contributes.themes` — workbench colors + `tokenColors` (TextMate). Парсинг готов в `Theme/`, нужно подцепить к scanner. Детали плана — [Theming.md](Theming.md).
- [ ] `contributes.iconThemes` / `productIconThemes` — file icons.
- [ ] Theme switcher в DI.

## Phase 3 — Language configuration runtime

- [ ] Загрузка `language-configuration.json` per language (через `LanguageRegistry` или отдельный `LanguageConfigurationRegistry`). Сейчас манифест несёт только путь — auto-closing pairs / brackets / on-enter rules не применяются (типизация в `ILanguageConfiguration.ts` готова).
- [ ] Auto-closing pairs / surrounding pairs в редакторе.
- [ ] On-enter rules (smart indent после `{`, продолжение `//`-комментариев).
- [ ] Bracket matching, folding markers.

## Phase 4 — Snippets

- [ ] `contributes.snippets` — JSON-парсер snippet bodies.
- [ ] Snippet engine (tabstops, placeholders, transforms).
- [ ] Интеграция с completion-механизмом.

## Phase 5 — Commands и keybindings

- [ ] `contributes.commands` — регистрация в `CommandRegistry` без runtime callback (заглушка пока нет extension host).
- [x] `contributes.keybindings` — регистрация в `KeybindingRegistry` с `when`-клаузами (#194,
  `extensionKeybindingContributor.ts`; `key`/`mac`/`linux`/`win`, `-command` для снятия;
  регистрируются после builtin, так что расширение переопределяет встроенный аккорд).
- [ ] `contributes.menus` / `submenus` — пункты в menu bar / context menus.

## Phase 6 — Configuration

Инфраструктура настроек готова (см. [docs/arch/Configuration.md](../arch/Configuration.md)). Остаётся:

- [ ] `contributes.configuration` — JSON-схема настроек расширений, регистрация в ConfigurationService.
- [ ] Persistent storage и запись из UI/расширений (`update(key, value)`).
- [ ] `contributes.configurationDefaults` — оверрайды для language-specific.
- [ ] Live-reload settings.json через fs.watch + эмит `onDidChangeConfiguration` (сейчас no-op).
- [ ] Workspace-слой (`.diode/settings.json` в корне проекта).

## Phase 7 — Активация и lifecycle

- [~] `activationEvents`: `*`, `onStartupFinished`, `onLanguage:*` — сделаны (`ExtensionHost.registerExtension` = bookkeeping, `activateByEvent` активирует по событию; фаеринг — `main.ts` + `EditorService.onActiveEditorChanged` seam). Пример: builtin `diode-settings` (автодополнение settings.json, `onLanguage:json`). Остаётся `onCommand:*` (нужен await активации во время dispatch команды).
- [x] Lazy activation — расширение не грузится до триггера (subprocess поднимается только на `activateByEvent`).
- [ ] `IDisposable`-цепочка: при unload корректно убираются все contributions (TokenizationRegistry, CommandRegistry, …).
- [ ] Reload расширения (dispose → re-register).

## Phase 8 — [~] Extension host (ядро готово)

Ядро (RPC поверх IPC, self-spawn, vscode-стаб, completion WP8, стоковый editorconfig) — сделано, см. [docs/arch/Extensions.md](../arch/Extensions.md). Остаётся:

- [~] `activationEvents` triggers — вызов `activate(context)` в нужный момент. Сделаны `*`/`onStartupFinished`/`onLanguage:*` (см. Phase 7); остаётся `onCommand:*`.
- [~] Расширение всего vscode-API: `commands`, `workspace`, `languages`, `window` за пределами `activeTextEditor.options`. Сделано: active-editor API (`window.activeTextEditor` / `onDidChangeActiveTextEditor` / `visibleTextEditors`); `languages.registerFoldingRangeProvider` (#194); **editor-write API** (`TextEditor.edit`/`selection(s)`, value-тип `Selection`, #194). Осталось: `revealRange`, snippets, ESM.
- [~] Изоляция исключений: упавшее расширение не валит host (RPC + try/catch; с #194 ещё и `unhandledRejection`-гард в субпроцессе — fire-and-forget вызов несуществующей команды больше не убивает host). Остаётся diagnostics.
- [ ] **Свежесть текста документа в субпроцессе.** `editor.activeEditorChanged` / `editor.selectionChanged` несут только метаданные; полный текст (`upsertFull`) заезжает попутно — на запросах `languages.provideFoldingRanges` / `provideCompletionItems` и в снапшоте will-save. Без зарегистрированных провайдеров `document.getText()` в расширении отстаёт от буфера. Нужен настоящий `workspace.onDidChangeTextDocument` с инкрементальной синхронизацией.
- [ ] Маршрутизация ошибок RPC обратно в `editor.options =`, чтобы fire-and-forget не глотал.
- [ ] ESM-расширения (`import * as vscode from "vscode"` через ESM loader hooks).
- [ ] Restart subprocess'а при крэше (сейчас при exit'е extension host'а все RPC падают).

## Phase 8b — UI-вклады: `contributes.viewsContainers` / `contributes.views`

Ядро под это готово: `ViewsService` — общая модель container↔view с местами
(`location: "sidebar" | "panel"`), заголовками, «⋯»-меню и переключателем
видимости секций (см. [docs/arch/Workbench.md](../arch/Workbench.md), раздел
`browser/parts/views/`). Ей уже подчиняются все встроенные панели, так что
контрибьютор расширений ложится на готовый контракт
(`registerContainer`/`registerView`/`setViewBody`) без переделки модели.

- [ ] Типы `IViewContribution` / `IViewContainerContribution` + раскомментировать
      `views`/`viewsContainers` в `iExtensionManifest.ts`.
- [ ] `extensionViewsContributor.ts` рядом с `extensionKeybindingContributor.ts`
      (декларативно, без host'а): контейнер + пустые секции с `body: null` и
      welcome-текстом; вызов — из `main.ts` рядом с регистрацией кейбиндов.
- [ ] Команда показа контейнера расширения (`workbench.view.<id>`) —
      activity bar'а нет, переключатель командный.
- [ ] Активация `onView:<id>` (Phase 7 закрывает `onCommand:*`, это следующее).
- [ ] TreeView-API поверх RPC: `window.registerTreeDataProvider`/`createTreeView`,
      `views.getChildren`/`getTreeItem` (pull, как у completion), рендер в
      `TreeViewElement`; раскомментировать закрытие типов в `vscode.d.ts`
      (`TreeDataProvider`, `TreeItem`, `TreeItemCollapsibleState`, `TreeView*`).
- [ ] `contributes.menus` для `view/title` и `view/item/context` — точки
      `MenuId.ViewTitle` / `MenuId.ViewContainerTitle` и императивная фильтрация
      по `menuContext` уже есть.

## Phase 9 — Внешние расширения

Инфраструктура сканирования user-префикса + `CompositeAssetAccess` + `mergeExtensions` готова (см. [docs/arch/Extensions.md](../arch/Extensions.md)). Остаётся:

- [ ] Установка из `.vsix` (откуда берётся артефакт и как выбирается версия — см. Phase 10).
- [ ] Версионирование (выбор последней из нескольких версий одного id), миграции (резолв версии — см. Phase 10).
- [ ] Конфликты contribution points (сейчас резолвится только по id расширения, не по перекрывающимся language ids).
- [ ] Активация user-расширений в ExtensionHost после Phase 7/8.

## Phase 10 — Discovery и дистрибуция (registry)

Модель пересмотрена: **курируемый registry-репозиторий** (наполнение PR-ами) вместо
краулера по GitHub-топику. Дизайн, формат данных, статус и оставшиеся шаги —
[Marketplace.md](Marketplace.md). Из старого дизайна сохранены артефакт/версия-
ориентированность, `sha256`, матчинг `engines` и install-флоу поверх `installVsix`;
сделан файловый источник (`FileExtensionRegistrySource`), резолв совместимой версии
и CLI `--registry` + `--install-extension <id>`.

---

## Открытые вопросы

- Совместимость API `vscode.*` — насколько глубоко имитировать (минимум для language extensions: workspace, languages, commands, window).
- Unbundled vs bundled extensions при SEA-сборке.
- Webview / notebook — отдельный большой подпроект.
- Вопросы дистрибуции (миграция на openvsx, формат артефакта, доверие publisher) — [Marketplace.md](Marketplace.md).
