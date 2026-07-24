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
  Aa/`\b`/`.*`, include/exclude, счётчик, поиск по мере ввода) + `searchResultsElement.ts`
  (плоский виртуализованный список с подсветкой совпадения).
- **Сайдбар-своп** — `browser/parts/sidebar/sidebarService.ts`, команды
  `browser/actions/searchActions.ts` + `showExplorerAction`.
- e2e-сценарий `e2e/scenarios/searchInFiles.scenario.ts` (демо + скриншоты).

## Дальше (отложено)

- **Открытие результата в редакторе** — клик/Enter по строке матча открывает файл
  на нужной строке/колонке (`commands.execute("workbench.openFile", …)` +
  `navigateActiveEditor`/`revealRange`; модель `ITextMatch` уже несёт `lineNumber`
  и колонки). Сейчас клик по результату — no-op.
- **Древовидный вид результатов** — сворачиваемые группы файл→матчи. Модель
  `file → matches` уже готова; апгрейд `SearchResultsElement` → `TreeViewElement`
  (или свои collapse-строки) — правка только вью.
- **Кросс-платформенный rg** — бандл/распаковка верифицированы на linux-x64; macOS/
  Windows — как у node-pty, отдельной задачей (CI-матрица).
- Прочее из VS Code: replace, подсветка контекста, `search.exclude`/`files.exclude`
  из настроек, история запросов, счётчик в статус-баре.
