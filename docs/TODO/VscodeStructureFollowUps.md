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

  Разрез сервиса по ролям сделан (E1): полоса групп — `IEditorGroupsService`,
  «редакторы» — `IEditorService`, оба интерфейса в `services/editor/common/`;
  модели — `TextFileModelService`, сборка вкладки — `TextEditorPaneBuilder`,
  `editor.*`-настройки — `TextEditorConfiguration`. Фичам, переезжающим в
  `editor/contrib`, остаётся опереться на роль «активный редактор» (аналог
  `ICodeEditorService`), а не на весь `IEditorService`.

  Хвосты E1 (не блокируют):
  - тестовые подделки `as unknown as IEditorService` (40 мест в тестах
    адаптеров, completion, inline, references, keyboardDoctor…) — переводить на
    типизированные фейки узких ролей постепенно, по образцу
    `createTestActiveEditorService` (`TestUtils/testActiveEditorService.ts`;
    восемь тестов команд уже на нём, `editorActions.test.ts` — нет: Alt+Z
    проверяется через `editorConfiguration` настоящего сервиса);
  - `IEditorService.getOpenFilePaths` в production никто не зовёт (персист
    сессии ходит через рецепты вкладок) — держится ради тестов;
  - detached-панель (Output) получает `editor.*` только при создании:
    live-reload и Alt+Z ходят по вкладкам и сторонам диффов (так было и до E1);
  - хуки `canAddGroupHook`/`focusGroupContentHook` переехали на
    `EditorGroupsService` как есть — форма порта за E5.

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
  хранить цвет в `base/common` своим типом. Разметка подпутей `@tuidom/*` по окружениям — шапка `scripts/check-layers.mjs`.
- [ ] **`MenuEntry` в `platform/actions`** — type-only импорт из
  `base/browser/ui/menu`; завести собственный тип entry в platform.

## tuidom

Вынос движка в отдельный репозиторий завершён (2026-08-13, пакеты `@tuidom/*`).
Оставшееся наследие «прикладные виджеты в движке» — отдельная задача
[EngineWidgetRepatriation.md](EngineWidgetRepatriation.md).

## Механика

Пути повторяем, механизм — нет: узаконенный список отличий — [ARCHITECTURE.md](../ARCHITECTURE.md#пути-повторяем-механизм--нет).

## Где канон «Состав фичи» ещё не выполнен

Канон записан как целевой. Ниже — центральные файлы, где регистрации фич лежат
сегодня, и задачи кампании рефакторингов, которые их разносят. Задача, закрывшая
строку, удаляет её отсюда.

| Сегодня в центре | Что там | Куда уходит | Задача |
|---|---|---|---|
| `workbench/browser/actions/{layout,editorGroup,input}Actions.ts` | экшены ядра зовут сервисы explorer, markers и поле ввода explorer напрямую | токены сервисов в `common/` фич или экшены — в фичи | E4 |
| `platform/contextkey/common/contextKeys.ts` | объявления ключей фич | `contrib/<f>/common/<f>ContextKeys.ts` | C7 |
| `workbench/common/stateKeys.ts` | ключи состояния фич | `<f>StateKeys.ts` у владельцев | E7 |
| `workbench/browser/workbenchComponent.ts` | корень дерева Explorer и cwd терминала в `setWorkspaceFolder` | подписки explorer и терминала на смену папки, explorer как `IActivatable` — после того как путь папки перестанет терять регистр буквы диска (см. TODO); храповик направления, контейнеры у владельцев, хост оверлеев через `LayoutService`, фаза `blockStartup` и агрегатор `workbench.common.main.ts` уже сделаны | E4 |
| `workbench/common/configuration/{scm,terminal,explorer,files,search,tasks}Configuration.ts` | узлы настроек фич | `contrib/<f>/common/` вместе с переездом `CONFIGURATION_CONTRIBUTIONS` в агрегатор | H6, необязательно |
| `src/vs/diode/modules/workbenchModule.ts` | DI-биндинги фич | дескриптор фичи `contrib/<f>/browser/<f>.contribution.ts` | H6/C5, необязательно, после F2, E4 и F3 |
| `contrib/diff/browser/compareActions.ts` | команды ревизий scm; из-за них цикл diff ↔ scm | `contrib/scm` | H6, необязательно |

## Опциональные углубления (перенос из upstream, упрощён парностью путей)

- [x] `Emitter`/`event.ts` из `vs/base/common/event.ts` вместо ad-hoc массивов
  колбэков — сделано, свой узкий шим с именами эталона: [arch/Common.md](../arch/Common.md#события-eventts).
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
- [ ] Семантические переименования файлов под upstream-имена (кодмод делал
  только camelCase): `geometryPromitives.ts`→`geometry.ts`,
  `iRange.ts`→`range.ts` и т.п. (`disposable.ts`→`lifecycle.ts` закрыт:
  примитив переехал из движка в свой `vs/base/common/lifecycle.ts` —
  [arch/Common.md](../arch/Common.md#жизненный-цикл-lifecyclets).)

## Документация

- [ ] Вычитка `docs/arch/*.md`: пути заменены механически, но проза написана в
  терминах прежних слоёв (Common/TUIDom/Controllers-эпоха); переписать
  per-layer справочник под оси `vs/*` (карта соответствий — в
  [../ARCHITECTURE.md](../ARCHITECTURE.md)).
