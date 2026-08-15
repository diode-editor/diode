# View GRAPH — граф коммитов, страница истории и команды на коммите

Цель: довести секцию **GRAPH** контейнера Source Control с плоского списка последних
10 коммитов до настоящего графа с ветвлениями, бейджами refs, ограниченной страницей
истории и набором команд на коммите.

Продуктовая рамка — VS Code (Source Control Graph): страница на 50 коммитов, набор
ref'ов «auto», номенклатура команд контекстного меню, палитра и семантические цвета.
**Отрисовка дерева** — порт pipe-модели lazygit: она даёт настоящие переходы
`╭ ╮ ╯ ╰ ─ │ ┬ ┴` вместо вертикальных полос SVG-графа VS Code, и в терминале это
единственное, что читается.

Связанные документы: [SourceControl.md](SourceControl.md) — вьюлет и транспорты,
поверх которых всё это стоит.

---

## Архитектурная рамка

- **Укладка графа — чистый модуль** `src/vs/workbench/contrib/scm/common/commitGraph.ts`:
  дословный порт `pkg/gui/presentation/graph/{graph,cell}.go` из lazygit. Ни tuidom, ни
  DI, ни темы — только строки и числа. Порядок шагов `getNextPipes` и порядок трёх
  проходов `renderPipeSet` существенны: от них зависит, какая линия куда сдвинется и чей
  цвет победит. Гейт — фикстуры из `graph_test.go`, перенесённые дословно.
- **Единственное отличие от оригинала** — вместо строки с ANSI-escape возвращается
  `IGraphLine {text, styles[]}`: имя токена темы на каждый символ. Красит
  `TextLabelElement.setCharStyle`; RGB-литералов в коде нет (AGENTS.md).
- **Палитра** (`commitGraphPalette.ts`) — модель VS Code, не lazygit. Цвет принадлежит
  **дорожке**, а не коммиту: линия к первому родителю наследует цвет линии, которую
  продолжает, и ветка целиком идёт одним цветом. Новая дорожка (первый коммит списка,
  влитая ветка, несвязанный корень) берёт следующий из пяти токенов
  `scmGraph.foreground1..5` по кругу; коммит с текущей или remote-веткой перекрашивает
  свою дорожку в семантический цвет. У lazygit наследования нет — там цвет берётся у
  автора коммита (`md5 → HSL`), что и держит ветку одноцветной; для нас этот механизм не
  годится (мимо системы тем), а без наследования каждый коммит линейной истории вышел бы
  своего цвета.
- **Данные** — прежний push-канал `diode.scm.publishLog`, payload расширен до
  `{commits, hasMore}`; запись коммита получила `parents` (`%P`), `refs` (`%D`), `author`,
  `timestamp`. Формат лога — `--topo-order`: укладка рассчитывает, что потомки выше
  родителей.
- **Ref'ы истории — режим `auto` VS Code**: `git log HEAD [<upstream>]`, чтобы в графе
  были видны и невлитые коммиты remote. `--ignore-missing` страхует от исчезнувшего
  upstream-ref'а: без него `git log` вышел бы ненулевым и граф опустел бы целиком.
- **Страница** — `scm.graph.pageSize` (дефолт 50, зажимается в 1..1000). Предел держит
  расширение; ядро просит следующую страницу операцией `logLoadMore`. Расширение
  запрашивает у git на коммит больше предела: лишний в граф не идёт, он лишь отвечает
  на вопрос «есть ли что грузить дальше» → `hasMore` → строка «Load More…».
  Авто-подгрузки по скроллу (`scm.graph.pageOnScroll` в VS Code) нет — осознанно.
- **Строка** — `[граф][бейджи refs][subject]`. **Колонки sha нет**: в сайдбаре шириной
  ~30 хеш вытеснил бы тему коммита, а достать его можно командой Copy Commit ID.
  Графика **в колонку не выравнивается**: у каждой строки своя ширина
  (`2 × число дорожек`), и текст идёт сразу за её последней дорожкой — как в lazygit.
  Общая ширина превратила бы список в таблицу и в истории с парой ветвлений отодвинула
  бы все темы вправо ради нескольких строк. Ширина строки от выделения не зависит:
  подсветка меняет символы, но не число клеток, — поэтому текст не прыгает под курсором.
- **Команды** — точка меню `MenuId.ScmGraphContext` (аналог `scm/historyItem/context`),
  контекст `ScmGraphMenuContext {sha, shortSha, subject}`. Все — обычные `CommandAction`
  в `builtinActions.ts`; из палитры они тоже доступны, но без аргумента выходят тихо.

## Отклонения от VS Code (осознанные)

- **Reset to Commit** — в VS Code такой команды нет вовсе: там только `git.undoCommit`
  (= `reset --soft HEAD~`), а низкоуровневый `reset` умеет лишь `--soft|--hard`. У нас
  три режима с пикером; `--hard` требует подтверждения (`warning: true`).
- **Revert Commit** — в графе VS Code тоже отсутствует (`git.revertChange` там про
  диапазоны строк в редакторе, не про коммит).
- **Нет колонки sha** (см. выше), нет автоподгрузки по скроллу, нет compare-команд.

## Меню коммита

| Группа | Пункты |
|---|---|
| `1_checkout` | Checkout (Detached) |
| `2_branch` | Create Branch... |
| `3_tag` | Create Tag... |
| `4_modify` | Cherry Pick, Revert Commit |
| `5_reset` | **Reset to Commit...** (пикер Mixed/Soft/Hard, hard — с подтверждением) |
| `9_copy` | Copy Commit ID, Copy Commit Message |

Меню «⋯» секции GRAPH: Refresh, Load More.

## Файлы

| Файл | Роль |
|---|---|
| `src/vs/workbench/contrib/scm/common/commitGraph.ts` | порт укладки и отрисовки lazygit |
| `…/common/commitGraphPalette.ts` | раздача цветов линиям |
| `…/browser/graphService.ts` | снимок истории от расширения (`{commits, hasMore}`) |
| `…/browser/scmGraphRows.ts` | строки: графовая колонка, бейджи refs, «Load More…» |
| `…/browser/graphViewComponent.ts` | сама секция: список, подсветка, контекст-меню |
| `…/browser/graphActions.ts` | Refresh и Load More (меню «⋯») |
| `…/browser/graphCommitActions.ts` | команды на коммите |
| `src/vs/platform/theme/common/colors/scmGraphColors.ts` | токены `scmGraph.*` |
| `src/vs/workbench/common/configuration/scmConfiguration.ts` | `scm.graph.pageSize` |
| `extensions/git/lib/logParse.ts` | формат лога и разбор `%P`/`%D` |
| `extensions/git/lib/resetArgs.ts` | argv для `reset`/`revert` |

## Покрытие автоматизацией

- **Укладка и отрисовка** — `commitGraph.{fixtures,render,pipes}.test.ts`: кейсы
  `TestRenderCommitGraph`, `TestRenderPipeSet` (со сверкой стиля **каждого символа**) и
  `TestGetNextPipes` из lazygit, перенесённые дословно. Это главный гейт корректности:
  любая перестановка шагов ломает хотя бы один кейс.
- **Палитра, строки, модель, команды** — юниты колокацией
  (`commitGraphPalette`, `scmGraphRows`, `graphService`, `graphViewComponent`,
  `graphActions`, `graphCommitActions`).
- **Расширение** — `logParse.test.ts` (формат, `%D`), `resetArgs.test.ts`,
  `git.integration.test.ts` на temp-репо: родители и refs в публикации, `hasMore` на
  границе страницы, `logLoadMore`, `reset --hard`/`revert`.
- **Демо** — `e2e/scenarios/scmGraph.scenario.ts`: репозиторий с веткой и merge, кадры
  `sections` / `graph` / `commit-menu` / `more-actions-menu`.

## Follow-up

- Пикер ref'ов и режим `all` (в VS Code — `scm.graphView.referencesFilter`); сейчас
  жёстко `auto` = HEAD + upstream.
- Активация коммита: показ его файлов и диффа (нужен multi-diff), Compare with
  Remote / Merge Base / произвольным ref'ом.
- Действия на бейджах (Checkout ▸ / Delete Branch ▸ / Delete Tag ▸ как динамические
  подменю по ref'ам коммита — приём VS Code).
- Автоподгрузка по скроллу (`scm.graph.pageOnScroll`), incoming/outgoing псевдо-коммиты.
- Цвет `scmGraph.historyItemBaseRefColor` зарегистрирован, но не используется:
  base-ref (merge-base ветка) появится вместе с Compare with Merge Base.
