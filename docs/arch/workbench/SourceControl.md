# Source Control и граф коммитов

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Открытое — [../../TODO/SourceControl.md](../../TODO/SourceControl.md).

Вьюлет Source Control повторяет VS Code: группы ресурсов, stage/unstage/discard (в т.ч. по
множественному выделению), commit input box, sync/branch/stash/remote-операции, меню «⋯» с подменю,
статус-бар, живое слежение, прогресс операций и секция GRAPH. Одно репо, без clone/init/мультирепо.
Номенклатура команд (`git.*`, титулы, `when`) и меню — по эталону; источник правды — `SCM_ACTIONS` и
регистрации меню в `contrib/scm/browser/`.

## Рамка

- **Все user-facing `git.*`-команды живут в ядре** (`CommandAction` в `SCM_ACTIONS` → `WORKBENCH_ACTIONS`):
  пикеры и диалоги — в ядре. Расширение `extensions/git` регистрирует только приватные мосты
  `diode.git.*` (одноимённая регистрация невозможна — `CommandRegistry` перезаписывает по id).
  Исключение — `git.refresh`, он за расширением. Транспорт — приватные двусторонние команды, `scm`-неймспейс
  `vscode.d.ts` не раскомментирован.
- **Мосты**: мутации staging (`diode.git.stage/unstage/clean` — списки uri), семантический диспетчер
  `diode.git.op {op, params}` (не generic-exec: argv собирает расширение), запросы
  `diode.git.query {kind: refs|stashes|remotes}` для пикеров, push-каналы `diode.scm.publishChanges`
  (+`group`), `diode.scm.publishRepoState`, `diode.scm.publishLog`.
- **Результат операции** — envelope `{ok:true} | {ok:false, kind, message, stderr}` с классификацией по
  stderr: `auth | conflict | dirty-worktree | push-rejected | no-upstream | not-merged | git-error`.
  Реакции — единый хелпер ядра: `auth` → «git не может спросить credentials в фоне — настройте
  credential helper / ssh-agent»; `push-rejected` → «Pull now?»; `no-upstream` → «Publish branch?»;
  `conflict` → notice, файлы в Merge Changes; `git-error` → notice + stderr в Output. Сетевые вызовы —
  `GIT_TERMINAL_PROMPT=0`, timeout 60 с.
- **Мьютекс мутаций в расширении** — фоновый `git status` тоже пишет index, без мьютекса —
  гонки `.git/index.lock`; после каждой операции — немедленный refresh.
- **Repo-state → when-ключи** `gitHasRepo, gitHasRemotes, gitHasUpstream, gitMerging, gitRebasing,
  gitDetached` — из `git status --porcelain=v2 --branch` + fs-проверок (`MERGE_HEAD`,
  `rebase-merge|rebase-apply`, `CHERRY_PICK_HEAD`).
- **Группы ресурсов**: porcelain `xy` → 0..2 записей по группам `merge | index | worktree | untracked`
  (MM — в двух; unmerged-коды → merge; `??` → untracked). Порядок и заголовки как в VS Code: Merge
  Changes → Staged Changes → Changes, пустые скрыты. Своего заголовка `untracked` не получает — идёт под
  «Changes» (как `git.untrackedChanges: mixed`), но id группы в протоколе остаётся: по нему discard
  выбирает `git clean` вместо `git checkout`, он же — в id строки.
- **Инлайн-кнопка строки одна — Open File**: раскрывается на строке под мышью или под курсором
  сфокусированного списка (`LIST_ROW_ACTIVE_STATE`), в покое отдаёт колонки имени. Stage/unstage/discard
  инлайн-кнопок нет — осознанное отклонение: те же действия есть в контекстном меню и палитре.
- **Commit input box** — в теле view над списком (собирает `ChangesComponent`), безрамочный
  `InputElement`, черновик персистится (workspace-scope). Ctrl+Enter — commit; в legacy-терминалах он
  неотличим от Enter — команды доступны из палитры. **Action button** под полем — правила VS Code: есть
  изменения → Commit; чисто и нет upstream → Publish Branch; чисто и расхождение → Sync Changes ↓N ↑M;
  синхронно → Commit выключен; вне репозитория скрыта.
- **Id строк** (e2e-селектор `#id` матчит только `[A-Za-z0-9_-]`): `scmGroup-<group>`,
  `scmRow-<group>-<sanitized-path>`, `scmDir-<group>-<sanitized-path>`.
- **Упрощения:** `openChanges` диффит с HEAD для обеих групп (index↔HEAD и worktree↔index не
  различаются); stage конфликтного файла — без проверки маркеров (VS Code спрашивает); noVerify-семейство
  без гейта конфигом и Amend-вариантов; Signed-off отложен; Delete Remote Tag выбирает из локальных тегов.

## Граф коммитов (секция GRAPH)

Продуктовая рамка — Source Control Graph VS Code (страница на 50 коммитов, ref'ы «auto», команды
контекстного меню, семантические цвета); **отрисовка дерева** — порт pipe-модели lazygit: настоящие
переходы `╭ ╮ ╯ ╰ ─ │ ┬ ┴` вместо вертикальных полос SVG — в терминале читается только так.

- **Укладка — чистый модуль** `contrib/scm/common/commitGraph.ts`, дословный порт
  `pkg/gui/presentation/graph/{graph,cell}.go`: ни tuidom, ни DI, ни темы. Порядок шагов `getNextPipes`
  и трёх проходов `renderPipeSet` существенен (какая линия куда сдвинется, чей цвет победит). Гейт —
  фикстуры `graph_test.go`, перенесённые дословно (`commitGraph.{fixtures,render,pipes}.test.ts`, со
  сверкой стиля каждого символа). Единственное отличие — вместо ANSI-строки `IGraphLine {text, styles[]}`
  с именем токена темы на символ (красит `TextLabelElement.setCharStyle`).
- **Палитра** (`commitGraphPalette.ts`) — модель VS Code, не lazygit: цвет принадлежит **дорожке**. Линия
  к первому родителю наследует цвет продолжаемой линии, ветка целиком идёт одним цветом; новая дорожка
  берёт следующий из `scmGraph.foreground1..5` по кругу; коммит с текущей или remote-веткой перекрашивает
  свою дорожку в семантический цвет. У lazygit цвет — от автора (`md5 → HSL`): мимо системы тем, а без
  наследования линейная история вышла бы разноцветной.
- **Данные** — `diode.scm.publishLog` с `{commits, hasMore}`, коммит несёт `parents` (`%P`), `refs`
  (`%D`), `author`, `timestamp`; лог `--topo-order` (укладка ждёт потомков выше родителей). Ref'ы — режим
  `auto`: `git log HEAD [<upstream>]`, `--ignore-missing` — иначе исчезнувший upstream опустошал граф.
- **Страница** — `scm.graph.pageSize` (дефолт 50, 1..1000); предел держит расширение, следующая страница —
  операция `logLoadMore`. У git просим на коммит больше: лишний отвечает на «есть ли дальше» → `hasMore`
  → «Load More…». Авто-подгрузки по скроллу нет — осознанно.
- **Строка** — `[граф][бейджи refs][subject]`. Колонки sha нет: в сайдбаре ~30 хеш вытеснил бы тему
  (есть Copy Commit ID). Графика в колонку не выравнивается — текст идёт сразу за последней дорожкой
  строки, как в lazygit; ширина строки от выделения не зависит, текст не прыгает под курсором.
- **Секция ленивая.** Свёрнутый или скрытый GRAPH не стоит ничего: строк нет, укладка не считается, а
  расширению (`ScmGraphService.setActive` → операция `logSetEnabled`) сказано не запускать `git log` —
  иначе он уходил бы подпроцессом на каждое событие watcher'а (каждое сохранение). Опора —
  `ViewsService.isViewExpanded`/`onDidChangeViewExpanded`. Плюс pull-команда ядра
  `diode.scm.graphEnabled`, которую расширение спрашивает при активации: ядро может объявить состояние
  раньше, чем расширение поднялось, а перезапуск extension host'а обнуляет его память; `undefined` —
  «канал не поддержан», работать по-старому. Раскрытие строит секцию из накопленного снимка сразу, не
  ожидая расширения: следующая публикация может быть байт-идентичной, и ядро погасит её по подписи.
- **Команды на коммите** — точка `MenuId.ScmGraphContext` (аналог `scm/historyItem/context`), контекст
  `ScmGraphMenuContext {sha, shortSha, subject}`: Checkout (Detached), Create Branch/Tag, Cherry Pick,
  Revert Commit, Reset to Commit (пикер Mixed/Soft/Hard, hard — с подтверждением), Copy Commit ID/Message.
  Отклонения: Reset to Commit с тремя режимами и Revert Commit в графе VS Code отсутствуют.
- Демо — `e2e/scenarios/scmGraph.scenario.ts`; staging и commit input — функциональные e2e
  `e2e/scmStaging.functional.test.ts`, `e2e/scmCommit.functional.test.ts`; push/pull и пикеры —
  `extensions/git/git.integration.test.ts` с локальным bare-remote.
