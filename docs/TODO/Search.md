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
- **Интерактивные результаты** — сворачиваемые группы файл→матчи (tree-режим),
  переключение дерево/плоско парой команд `search.action.viewAsTree`/`viewAsList`
  (`when: searchViewletVisible`, персист `workbench.search.viewMode` по-проектно),
  Enter/двойной клик по матчу открывает файл на строке/колонке совпадения (шов
  `SearchRevealTargetDIToken` → EditorService, по образцу Problems).
- **Сайдбар-своп** — `browser/parts/sidebar/sidebarService.ts`, команды
  `browser/actions/searchActions.ts` + `showExplorerAction`.
- e2e: сценарий `e2e/scenarios/searchInFiles.scenario.ts` (демо + скриншоты:
  дерево, collapse, flat, открытие на позиции) + функциональный
  `e2e/searchInFiles.functional.test.ts`.

## Дальше (отложено)

- **Кнопки тумблера дерево/плоско в шапке панели** — команды уже есть, нужен UI.
- **Кросс-платформенный rg** — бандл/распаковка верифицированы на linux-x64; macOS/
  Windows — как у node-pty, отдельной задачей (CI-матрица).
- Прочее из VS Code: replace, подсветка контекста, `search.exclude`/`files.exclude`
  из настроек, история запросов, счётчик в статус-баре.
