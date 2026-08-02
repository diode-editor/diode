# vscode-раскладка — follow-up'ы после big-bang переезда

Осознанные отклонения от канона vscode, зафиксированные при переезде на
`src/vs/*`. Каждый пункт — самостоятельный заход; сверяться с upstream по
парным путям.

## Слои и оси

- [ ] **find/suggest → `editor/contrib`.** Сервисные части фич редактора
  (`FindService`/`CompletionService` и их компоненты) живут в
  `workbench/contrib/{find,suggest}`, у vscode — `editor/contrib`. DI-запрет
  для editor-слоя снят (токен объявляется рядом со своим типом, пилот —
  `editor/contrib/contextmenu`), но переезду мешает не он: оба сервиса честно
  зависят от `EditorService` (workbench-понятия групп/вкладок) и
  `Find/SuggestComponentDIToken` (workbench). Нужна развязка — в upstream
  editor-contrib работают с одним `ICodeEditor`, а не с сервисом групп.
- [ ] **Single-process исключения env-оси** (`EXCEPTIONS` в
  `scripts/check-layers.mjs`): «browser»-сторона напрямую зовёт node-сервисы
  (`services/search/node`, `services/terminalEnvironment/node`,
  `contrib/bulkEdit/node`) — у vscode тут RPC-фасады (`IFileService` и т.п.).
  Сближение — интерфейсные швы в common + node-реализации за DI.
- [ ] **`defaultStyles` → `editorElement`** (value-импорт unthemed-дефолтов):
  либо unthemed-дефолты редактора в platform, либо `getEditorStyles` в
  `editor/browser`.
- [ ] **DI-токены в `vexx/modules`**: `workbenchComponent` импортирует токен из
  модуля профиля (слой выше) — вынести токены из модулей в слои-владельцы.
- [ ] **`MenuEntry` в `platform/actions`** — type-only импорт из
  `base/browser/ui/menu`; завести собственный тип entry в platform.

## tuidom («браузер» вынут из src/vs)

- [ ] **Отдельный репозиторий**: `tuidom/` сейчас top-level каталог этого репо
  (граница видна, единый tsconfig); следующий шаг — пакет `tuidom` в своём
  репо, vexx потребляет как зависимость.
- [ ] **Наследие «контролы знают про vexx»**: все виджеты `ui/*` переехали в
  tuidom, но часть несёт vexx-специфику старого дизайна — `BodyElement` знает
  про `menuBarElement`/`statusBarElement`-слоты, editorgroup/statusbar/
  workbenchlayout/panel — по смыслу workbench-parts. Вычистить связи, чтобы
  tuidom-виджеты были «чистыми HTML-элементами».
- [ ] `TuiApplication.root` расширен до `TUIElement` (ядро не знает о
  виджетах); тестовый харнесс держит `BodyElement`-ссылку сам. Колокационные
  тесты ядра (`tuidom/dom/*.test.ts`) по-прежнему используют vexx-виджеты и
  редактор как подопытных — при выносе в отдельный репо их надо переписать на
  примитивы.

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
