# Search — поиск по файлам

Панель поиска по содержимому файлов (аналог сайдбар-панели Search в VS Code).
Движок — ripgrep, бандлится под каждую платформу и распаковывается в рантайме
(как node-pty). Переключение Explorer↔Search — без activity bar: пункт меню View
и команда `workbench.view.search` (`Ctrl+Shift+F`).

## Сделано (минимальный срез)

- **Движок** — `services/search/common/textSearch.ts` (типы, `buildRgArgs`,
  `parseRgMatchLine`, порт `ITextSearchService`) + `services/search/node/textSearchService.ts`
  (spawn `rg --json`, потоковые результаты, отмена, cap 10k) + `loadRipgrep.ts`
  (dev `@vscode/ripgrep` / SEA-ассет `rg.bundle`).
- **Пакетирование** — `scripts/pack-ripgrep.mjs` → `dist/rg.bundle`, врезано в
  `build-dist`/`build-sea`/`build-selfextract`. Зависимость `@vscode/ripgrep`.
- **UI** — `contrib/search/browser/searchComponent.ts` (запрос + тумблеры
  Aa/`\b`/`.*`, include/exclude, счётчик, поиск по мере ввода) +
  `searchResultRows.ts` (фабрики строк с посимвольной подсветкой) поверх
  виртуализирующего `tuidom/ui/list/ListViewElement` (фокус, курсор,
  клавиатура, hover — от контейнера).
- **Интерактивные результаты** — режимы VS Code-семантики: `list` — файлы
  плоским списком, матчи-дети сворачиваются; `tree` — иерархия каталогов со
  сжатием одиночных цепочек (`searchResultTree.ts`, близнец `scmChangeTree`),
  стрим в tree-режиме пересобирает строки по троттлу. Пара команд
  `search.action.viewAsTree`/`viewAsList` живёт в «⋯»-меню заголовка с галочкой
  активного режима (персист `workbench.search.viewMode` v2 по-проектно).
  Enter/двойной клик по матчу открывает файл на строке/колонке совпадения (шов
  `SearchRevealTargetDIToken` → EditorService, по образцу Problems).
- **Панель как merged одно-view контейнер** — заголовок SEARCH с «⋯» рисует
  PaneHeaderElement (`ViewsService.mergeSingleView`); хедер с отступами,
  include/exclude спрятаны за «···» (`workbench.action.search.toggleQueryDetails`,
  Ctrl+Shift+J, персист раскрытости по-проектно, автораскрытие при непустых
  полях).
- **Collapse All / Expand All** — поэтапный CollapseDeepestExpandedLevel как в
  VS Code (сначала матчи под файлами, потом всё дерево); пара сменяется в
  «⋯»-меню по ключам `hasSearchResult`/`viewHasSomeCollapsibleResult`.
- **Кольцо фокуса** — Down/Up и Ctrl+Down/Ctrl+Up: query → include → exclude →
  список и обратно (`search.focus.nextInputBox`/`previousInputBox`,
  `search.action.focusSearchFromResults`, ключи `searchInputBoxFocus`/
  `firstMatchFocus`).
- **Сайдбар-своп** — `browser/parts/sidebar/sidebarService.ts`, команды
  `browser/actions/searchActions.ts` + `showExplorerAction`.
- e2e: сценарий `e2e/scenarios/searchInFiles.scenario.ts` (демо + скриншоты:
  «⋯»-меню, детали за «···», list/tree, поэтапный collapse, открытие на позиции)
  + функциональный `e2e/searchInFiles.functional.test.ts`.

## Дальше (отложено)

- **Кросс-платформенный rg** — бандл/распаковка верифицированы на linux-x64; macOS/
  Windows — как у node-pty, отдельной задачей (CI-матрица).
- Прочее из VS Code: replace, подсветка контекста, `search.exclude`/`files.exclude`
  из настроек, история запросов, счётчик в статус-баре.
