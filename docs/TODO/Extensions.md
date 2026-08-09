# Extensions — VS Code-совместимые расширения

Цель: загружать расширения по формату VS Code (`package.json` с `contributes`) — сначала встроенные, потом из `~/.vexx/extensions/`. Архитектура должна быть готова к разгрузке (clean unload через `IDisposable`) и инкрементальному добавлению contribution points.

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
- [ ] Workspace-слой (`.vexx/settings.json` в корне проекта).

## Phase 7 — Активация и lifecycle

- [~] `activationEvents`: `*`, `onStartupFinished`, `onLanguage:*` — сделаны (`ExtensionHost.registerExtension` = bookkeeping, `activateByEvent` активирует по событию; фаеринг — `main.ts` + `EditorService.onActiveEditorChanged` seam). Пример: builtin `vexx-settings` (автодополнение settings.json, `onLanguage:json`). Остаётся `onCommand:*` (нужен await активации во время dispatch команды).
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

Phase 9 отвечает на «как загрузить расширение из `<userData>/extensions/`». Phase 10 —
«откуда оно туда попадает»: как искать, версионировать и устанавливать расширения. В идеале
конечная цель — [openvsx](https://open-vsx.org/), но на старте — GitHub без центральной
курируемой инфраструктуры. Дизайн с самого начала артефакт- и версия-ориентированный, чтобы
переход от декларативных расширений к массивным code-расширениям не ломал ни схему, ни клиент,
а миграция на openvsx сводилась к смене провайдера.

**Модель:**

- **Discovery через GitHub topic `vexx-extension`** — топик помечает репозиторий как
  расширение (идиоматично для GitHub, не трогает имя; нативный поиск `topic:vexx-extension`).
  Не суффикс в имени репо: тот не кодирует publisher и не верифицируется.
- **Артефакты — `.vsix`** (zip с манифестом + собранными файлами; Vexx уже VS Code-совместим),
  лежат **распределённо** в GitHub Releases авторов. `browser_download_url` — прямая ссылка
  без auth и без API-лимитов на скачивание. Централизован только лёгкий индекс с метаданными
  и ссылками; бинарники в индекс не попадают.
- **Краулер** — GitHub Action в отдельном `vexx-registry`-репозитории, по расписанию.
  Находит репо по топику, через GraphQL читает `package.json` на тегах релизов
  (`version`, `engines.vexx`) **не распаковывая `.vsix`**, и публикует на GitHub Pages:
  - `index.json` — только валидные расширения (чистый список для клиента);
  - `diagnostics.json` — всё, что краулер видел, со статусом и текстом ошибок (pull-only
    обратная связь автору: зашёл по URL своего репо — посмотрел).
- **Клиент** — интерфейс `IRegistryProvider` (`search` / `resolve` / `download`) с
  реализацией `GitHubIndexProvider` сейчас и `OpenVsxProvider` позже (миграция = смена
  провайдера, не формата). Установка: скачать ассет → проверить `sha256` → распаковать
  в `<userData>/extensions/<publisher>.<name>-<version>/` → существующий `scanExtensions`
  подхватывает.

**Схема записи индекса:**

```jsonc
{
  "id": "acme.markdown-tools",
  "owner": "acme", "repo": "vexx-markdown", "stars": 42,
  "versions": [
    { "version": "1.2.0", "engines": { "vexx": "^0.5.0" },
      "asset": "https://github.com/acme/vexx-markdown/releases/download/v1.2.0/acme.markdown-tools-1.2.0.vsix",
      "size": 124000, "sha256": "…", "publishedAt": "…" }
  ]
}
```

Клиент берёт наивысшую версию, чей `engines.vexx` совместим с версией его сборки.

**Задачи:**

- [ ] Конвенция: топик `vexx-extension`; `.vsix`-ассет в GitHub Release (имя `<id>-<version>.vsix`).
- [ ] Краулер в `vexx-registry`-репо (Action + Pages): topic-поиск → чтение манифестов на
      тегах → `index.json` + `diagnostics.json`.
- [ ] Валидация при кравле: невалидные (нет `engines.vexx` / `publisher ≠ owner` / нет
      `.vsix`-ассета) → в `diagnostics.json`, не в `index.json`.
- [ ] Клиентский `IRegistryProvider` + `GitHubIndexProvider` (читает `index.json`, локальный
      поиск/фильтрация/ранжирование по звёздам).
- [ ] Резолв `engines.vexx` ↔ версия сборки; выбор совместимой версии.
- [ ] Install-флоу: download ассета → проверка `sha256` → распаковка в
      `<userData>/extensions/<id>-<version>/`.
- [ ] `vexx validate` (часть packaging-CLI) + GitHub Action-обёртка — ранний сигнал автору
      в его CI до публикации.

**Слои обратной связи автору (позже, поверх той же диагностики):**

- [ ] Краулер заводит/обновляет одну трекинг-issue в репо при ошибке (нативное письмо через
      GitHub-уведомления; одна issue, update-in-place, закрытие когда всё зелёное).
- [ ] Status-badge / страница расширения.
- [ ] GitHub App + Checks API — real-time ✅/❌ на коммите релиза (требует хостинга вебхука).

**Оговорки:**

- Иммутабельность ассетов неполная (GitHub допускает замену) → `sha256` в индексе + проверка
  на клиенте.
- Топик-самоподписка ⇒ возможны спам/сквоттинг; на старте неважно, дальше — порог по
  звёздам/возрасту или блок-лист на этапе валидации.
- Доверие publisher: на старте `publisher = owner` (без верификации) — это та часть, ради
  которой существуют настоящие реестры.

---

## Открытые вопросы

- Совместимость API `vscode.*` — насколько глубоко имитировать (минимум для language extensions: workspace, languages, commands, window).
- Unbundled vs bundled extensions при SEA-сборке.
- Webview / notebook — отдельный большой подпроект.
- Момент перехода с GitHub-индекса на openvsx (когда оправдан `OpenVsxProvider`).
- Свой формат артефакта или строго `.vsix`.
- Политика доверия/верификации publisher (`publisher = owner` → подпись/верификация).
