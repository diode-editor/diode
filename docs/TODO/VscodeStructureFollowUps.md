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

  Языковой блокер снят (G2): провайдеры фич живут в реестре ядра
  `editor/common/services/languageFeatures.ts` (`ILanguageFeaturesService`,
  скоринг селекторов — `editor/common/languageSelector.ts`), а не в полях-швах
  `EditorService`, так что переезд не потянет за собой workbench-шов. Агрегация
  ответов частично уже в `editor/contrib` (`format`, `codeAction`,
  `folding/syntaxRangeProvider`); `getHover`, `goToSymbol`, `getReferences`,
  `provideSignatureHelp`, `provideCompletions`, `provideInlineCompletions`
  переедут вместе со своими фичами.
- [ ] **Направление ядро workbench → contrib** — храповик `DIRECTION_EXCEPTIONS`
  в `scripts/check-layers.mjs`: 8 файлов ядра ещё импортируют фичи. Корень
  (`workbenchComponent.ts`) держат два вызова в `setWorkspaceFolder`:
  `ExplorerService.setRootPath(dirPath)` (+ `refresh` при Open Folder и в
  `activate`) и `TerminalService.setWorkingDirectory(dirPath)`. Подписаться на
  `onDidChangeWorkspaceFolders` им мешает то, что событие несёт только
  `IWorkspaceFolder.uri`, а `uri.fsPath` (vscode-uri) понижает регистр буквы
  диска на Windows (`C:\x` → `c:\x`): корень дерева разошёлся бы с путями
  редакторов, и сравнения префиксом в reveal сломались бы. Нужен либо исходный
  путь папки в `IWorkspaceContextService`, либо reveal без строкового префикса —
  тогда explorer становится `IActivatable`, а запись уходит. Остальное из E4
  (саморегистрация контейнеров с `order`, хост оверлеев через
  `LayoutService.mainContainer`, фаза `blockStartup`, агрегатор
  `workbench.common.main.ts`, restore view-состояния по
  `IStateService.onDidOpenWorkspace`) сделано; списки экшенов, меню и контекст-ключей
  фич уже в агрегаторе (F2). Мелкие action-файлы ядра (`layoutActions`,
  `editorGroupActions`, `inputActions`) ещё зовут сервисы фич — тоже зона E4.
  Запись удаляет задача, которая её закрыла.
- [ ] **`attachHost` у оверлеев `browser/parts` и `DialogService`** — quickInput,
  tabSwitcher, notifications и диалоги ещё получают корневую view от корня
  (правило направления это разрешает). Перевести их на
  `LayoutService.mainContainer`, как contrib-оверлеи (E4 PR3), — для единого
  пути; заодно z-порядок оверлеев перестанет зависеть от порядка создания
  сессий (сейчас слой рисует их в порядке `createSession`), см. H1.
- [ ] **Single-process исключения env-оси** (`EXCEPTIONS` в
  `scripts/check-layers.mjs`): «browser»-сторона напрямую зовёт node-сервисы
  (`services/terminalEnvironment/node`) — у vscode тут RPC-фасады (`IFileService`
  и т.п.). `contrib/bulkEdit/node` снят: исполнитель правок переехал в browser
  поверх `IFileService` ([FileService](FileService.md), PR 3). `services/search/node`
  снят: порт `IFileSearchService` и типы — в `services/search/common/fileSearch.ts`,
  реализация — в `search/node` (H4 PR0). Сближение — интерфейсные швы в common +
  node-реализации за DI.
- [ ] **`defaultStyles` → `editorElement`** (value-импорт unthemed-дефолтов):
  либо unthemed-дефолты редактора в platform, либо `getEditorStyles` в
  `editor/browser`.
- [ ] **`fileIcons.ts` в `base/common` на движковом `packRgb`** — единственное
  значение из `@tuidom` в `base/common` (`EXCEPTIONS` в
  `scripts/check-layers.mjs`): цветовую часть иконок поднять выше либо
  хранить цвет в `base/common` своим типом. Разбор — [Lifecycle.md](Lifecycle.md) §8.
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
- Пара Service ↔ Component — три узаконенные формы (Part над сервисом, сервис —
  владелец виджета, сервис — владелец layout-контрола), правила «сервис не знает
  view» нет, как и в upstream — см. [arch/Workbench.md](../arch/Workbench.md#модель-service--component).
  Известные отклонения (сервис конструирует панели редактора и диалоги, `?:`-хуки
  `EditorService`, `attachHost` от корня) перечислены там же с адресами задач.
- Состав фичи — путь upstream (всё, что фича регистрирует, лежит в
  `contrib/<f>/`, центр знает фичу одной строкой в агрегаторе
  `workbench.common.main.ts`), механизм наш: явный экспорт фичи вместо
  `<f>.contribution.ts` с побочным эффектом импорта. Канон и таблица оставшегося
  долга с адресами задач — [arch/Workbench.md](../arch/Workbench.md#состав-фичи).
  Необязательные хвосты H6 (узлы конфигурации фич в `contrib/<f>/common/`,
  revision-команды из `diff/compareActions.ts` в scm, DI-дескриптор фичи вместо
  блоков `workbenchModule.ts`) записаны там же в таблице долга. Разнос
  `workbenchModule.ts` на модули фич отдельно от этого дескриптора не делаем
  (исследование C5): без него число правок на фичу не уменьшается — те же
  строки переезжают из одного центрального места в другое.
- Жизненный цикл (`LifecycleService`, C6) — узкий срез upstream: четыре фазы
  `LifecyclePhase` с `when()`/`onDidChangePhase` и прощание
  `onWillShutdown`+`join`/`onShutdownSync`. Не переносим: `WorkbenchPhase` ×4 с
  lazy/onEditor-инстанцированием (фаза contribution'а — это фаза жизненного
  цикла, `ready`/`eventually`), veto-события поверх confirm-save,
  `ShutdownReason.CLOSE/LOAD` и `StartupKind`. `eventually` — сразу после
  первого кадра, а не таймер 2.5 с: это бенч-критично. Общего bootstrap'а
  prod/test нет, как и в upstream: `startWorkbench` гоняют юниты на тестовом
  контейнере, харнесс его не повторяет.

## Опциональные углубления (перенос из upstream, упрощён парностью путей)

- [x] `Emitter`/`event.ts` из `vs/base/common/event.ts` вместо ad-hoc массивов
  колбэков — сделано, свой узкий шим с именами эталона: [Events.md](Events.md).
- [ ] PieceTree (`pieceTreeTextBuffer`) — см. [PieceTree.md](PieceTree.md).
- [ ] Эталонный дефолт событий активации (пусто значит пусто, без неявного
  `*`): механизм готов (`computeActivationEvents`), но дефолт `*` оставлен —
  на нём держатся опубликованные в магазине записи без `activationEvents`
  (`test.tab-setter`). Снимается после того, как записи реестра объявят `"*"`
  сами (PR в репозиторий реестра — мерж за его владельцем), вместе с явным
  `"*"` у четырёх e2e-фикстур (`will-save-trim`, `tab-setter`,
  `inline-ghost`, `chat-panel`).
- [ ] Выход мимо прощания: SIGTERM/SIGHUP в главном процессе не обработаны
  (смерть по сигналу не фаерит даже `process.on("exit")` — теряется до 500 мс
  состояния и не снимается терминал), SIGINT-обработчик `NodeTerminalBackend`
  (tuidom) выходит мимо confirm-save и `LifecycleService.shutdown`. Точка
  подключения уже есть — `shutdown(reason, then)`; нужна причина `"signal"` и
  обработчики (для SIGINT — хук в tuidom).
- [ ] Разнос `EditorViewState` на viewModel/viewLayout/cursor.
- [ ] `ProxyIdentifier`-типизация RPC extension host'а (сейчас строковая
  адресация методов).
- [ ] Семантические переименования файлов под upstream-имена (кодмод делал
  только camelCase): `geometryPromitives.ts`→`geometry.ts`,
  `iRange.ts`→`range.ts` и т.п. (`disposable.ts`→`lifecycle.ts` закрыт:
  примитив переехал из движка в свой `vs/base/common/lifecycle.ts` —
  [Lifecycle.md](Lifecycle.md).)

## Документация

- [ ] Вычитка `docs/arch/*.md`: пути заменены механически, но проза написана в
  терминах прежних слоёв (Common/TUIDom/Controllers-эпоха); переписать
  per-layer справочник под оси `vs/*` (карта соответствий — в
  [../ARCHITECTURE.md](../ARCHITECTURE.md)).
