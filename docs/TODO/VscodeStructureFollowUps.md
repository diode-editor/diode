# vscode-раскладка — follow-up'ы после big-bang переезда

Осознанные отклонения от канона vscode, зафиксированные при переезде на
`src/vs/*`. Каждый пункт — самостоятельный заход; сверяться с upstream по
парным путям.

## Слои и оси

- [ ] **Фичи редактора → `editor/contrib`.** В `workbench/contrib/` живут
  `find`, `suggest`, `hover`, `gotoDefinition`, `parameterHints` — у vscode все
  они в `editor/contrib/` (`parameterHints` там разложен на
  `parameterHints.ts`/`parameterHintsModel.ts`/`parameterHintsWidget.ts`/
  `provideSignatureHelp.ts` — импорты видно в наших же diff-фикстурах,
  `editor/common/diff/__fixtures__/ts-unfragmented-diffing/1.tst`). DI-запрет
  для editor-слоя снят (токен объявляется рядом со своим типом, пилот —
  `editor/contrib/contextmenu`), но переезду мешает не он: сервисы честно
  зависят от `EditorService` (workbench-понятия групп/вкладок) и от своих
  `*ComponentDIToken` (workbench). Нужна развязка — в upstream editor-contrib
  работают с одним `ICodeEditor`, а не с сервисом групп.

  Смежное следствие той же развязки: у vscode реестр провайдеров
  (`ILanguageFeaturesService.signatureHelpProvider` и соседи) живёт в ядре
  редактора со скорингом селекторов, а extension host регистрируется в него
  через `MainThreadLanguageFeatures`. У нас реестра в ядре нет: на фичу — одна
  функция-шов (`EditorService.signatureHelpSource`, `hoverSource`, …), матчинг
  селекторов и обход провайдеров живут в субпроцессе, а метаданные вроде
  триггер-символов пушатся нотификацией `languages.updateSubscriptions`.
  Переезд в `editor/contrib` без реестра даст фичам editor-слоя зависимость на
  workbench-шов — то есть решать эти два пункта имеет смысл вместе.
- [ ] **Single-process исключения env-оси** (`EXCEPTIONS` в
  `scripts/check-layers.mjs`): «browser»-сторона напрямую зовёт node-сервисы
  (`services/search/node`, `services/terminalEnvironment/node`,
  `contrib/bulkEdit/node`) — у vscode тут RPC-фасады (`IFileService` и т.п.).
  Сближение — интерфейсные швы в common + node-реализации за DI.
- [ ] **`defaultStyles` → `editorElement`** (value-импорт unthemed-дефолтов):
  либо unthemed-дефолты редактора в platform, либо `getEditorStyles` в
  `editor/browser`.
- [ ] **DI-токены в `diode/modules`**: `workbenchComponent` импортирует токен из
  модуля профиля (слой выше) — вынести токены из модулей в слои-владельцы.
- [ ] **`MenuEntry` в `platform/actions`** — type-only импорт из
  `base/browser/ui/menu`; завести собственный тип entry в platform.

## tuidom

Вынос движка в отдельный репозиторий завершён (2026-08-13, пакеты `@tuidom/*`).
Оставшееся наследие «прикладные виджеты в движке» — отдельная задача
[EngineWidgetRepatriation.md](EngineWidgetRepatriation.md).

## Механика (пути повторяем, механизм — нет; узаконено, ревизия по мере надобности)

- Явные массивы регистраций (`WORKBENCH_CONTRIBUTIONS`, `MENU_CONTRIBUTIONS`,
  `QUICK_ACCESS_PROVIDERS`, `CONFIGURATION_CONTRIBUTIONS`,
  `COLOR_CONTRIBUTIONS`) вместо `Registry.as(...)` + import-side-effect
  `*.contribution.ts`.
- DI на токенах со `static dependencies` вместо `createDecorator`-декораторов
  (erasable syntax / SEA).
- Тесты колокацией рядом с кодом, а не в `test/`-деревьях (оси на тесты не
  проверяются).
- Dev-тулинг (`Inspector`, `TestUtils`, `StoryRunner`, `demos`) — в `src/` вне
  `vs/`.

## Опциональные углубления (перенос из upstream, упрощён парностью путей)

- [ ] `Emitter`/`event.ts` из `vs/base/common/event.ts` вместо ad-hoc массивов
  колбэков (паттерн `onDidX(listener): IDisposable` уже совместим).
- [ ] `ContextKeyExpr`-парсер вместо `new Function` — см.
  [WhenContext.md](WhenContext.md).
- [ ] PieceTree (`pieceTreeTextBuffer`) — см. [PieceTree.md](PieceTree.md).
- [ ] Разнос `EditorViewState` на viewModel/viewLayout/cursor.
- [ ] `ProxyIdentifier`-типизация RPC extension host'а (сейчас строковая
  адресация методов).
- [ ] Семантические переименования файлов под upstream-имена (кодмод делал
  только camelCase): `disposable.ts`→`lifecycle.ts`,
  `geometryPromitives.ts`→`geometry.ts`, `iRange.ts`→`range.ts` и т.п.

## Документация

- [ ] Вычитка `docs/arch/*.md`: пути заменены механически, но проза написана в
  терминах прежних слоёв (Common/TUIDom/Controllers-эпоха); переписать
  per-layer справочник под оси `vs/*` (карта соответствий — в
  [../ARCHITECTURE.md](../ARCHITECTURE.md)).
