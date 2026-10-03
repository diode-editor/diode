# Diode — TODO

Трекер задач проекта. Каждая задача имеет статус, краткое описание и контекст.

Статусы: `[ ]` — открыта, `[~]` — в работе, `[x]` — сделана.

Завершённые задачи из трекера убираем — история живёт в git и в `docs/arch/`.
Задачи движка (не хватает API/виджета/поведения tuidom) ведутся в репозитории
[tuidom](https://github.com/tuidom/tuidom), не здесь (см. AGENTS.md).

---

## Визуальный ориентир

### NVChad — референс для UI/UX

Проект: https://github.com/NvChad/NvChad

NVChad — конфигурация Neovim с красивым UI, быстрым рендерингом и продуманной визуальной частью. Ориентируемся на него в плане:

- **Внешний вид**: цветовые темы (base46), statusline, tabufline, общая эстетика
- **Иконки**: nvim-web-devicons — файловые иконки, иконки типов файлов в дереве и табах
- **Рендеринг UI-элементов**: telescope (fuzzy finder с превью), nvim-tree (файловое дерево), cheatsheets
- **Цветовые схемы**: onedark и другие темы из base46 как отправная точка для палитры

Ключевые плагины NVChad для вдохновения:

- [base46](https://github.com/NvChad/base46) — темы и подсветка
- [NvChad UI](https://github.com/NvChad/ui) — statusline, tabufline, theme switcher
- [nvim-web-devicons](https://github.com/kyazdani42/nvim-web-devicons) — иконки файлов
- [telescope.nvim](https://github.com/nvim-telescope/telescope.nvim) — поиск файлов с превью
- [nvim-tree.lua](https://github.com/kyazdani42/nvim-tree.lua) — файловое дерево

---

## Крупные задачи

- [ ] [ParityBacklog](ParityBacklog.md) — заход по списку шероховатостей от пользователя (15 пунктов, живой ssh+tmux): диагноз по каждому снят до работы (часть — живым прогоном редактора), разбивка на три волны. Волна 1 — общие механизмы: bulk workspace edit (из-за него «Code action failed»), NLS манифестов (`%java.*%` в палитре), fuzzy+сплит запроса по пробелам (палитра вообще на `includes`), `files.exclude`/`search.exclude`, достижимость биндов (F1 под `tier == 'legacy'` — в tmux редактор остаётся без палитры вовсе)
- [ ] [Formatting](Formatting.md) — prettier и выбор форматтера (пункт 5 ParityBacklog, охват сужен: сначала prettier). Замерено: TS/JS форматирует tsserver, markdown/json не покрыты никем; провайдер выбирается первым матчащим, `editor.defaultFormatter` нет — отсюда риск конфликта prettier×tsserver
- [ ] [PreviewEditors](PreviewEditors.md) — режим предпросмотра вкладок (пункт 14 ParityBacklog): нет вовсе. Фаза 1 наша (preview-флаг + замещение + прикалывание правкой/Ctrl+K Enter), курсив в табе и двойной клик дерева требуют PR в tuidom
- [ ] [ClaudeCode](ClaudeCode.md) — интеграция с Claude Code: стоковое `Anthropic.claude-code` из OpenVSX в режиме `useTerminal` (проба: активируется, CLI подключается к его `ide`-серверу); фронт — мелочи API, терминал для расширений, предложенный дифф через `vscode.diff`, `getDiagnostics`
- [~] [Cancellation](Cancellation.md) — отмена и устаревание асинхронных запросов (H2): общий `LatestRequest` вместо счётчиков `requestSeq` сделан, Go to Definition больше не прыгает задним числом; осталось провести токен до провайдера (после G4/G5)
- [~] [WorkbenchContributions](WorkbenchContributions.md) — перенос vscode contribution points; основное сделано, остались хвосты MenuRegistry (серые пункты попапа, `when`-фильтр палитры, `alt`/hide-toggle/вложенные подменю)
- [~] [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — follow-up'ы после big-bang переезда на vscode-раскладку `src/vs/*` (осознанные отклонения от канона)
- [ ] [EngineWidgetRepatriation](EngineWidgetRepatriation.md) — прикладные виджеты, оставшиеся в `@tuidom/elements` (completionlist, editorgroup, editorpart, workbenchlayout, panel, terminal, menuBar): по критерию «публичный API не упоминает понятий Diode» им место у нас
- [~] [ListControls](ListControls.md) — два списочных контрола (`TreeViewElement` data-driven / `ListViewElement` DOM-строки): решение зафиксировано, остался техдолг (дублирование механик, union-instanceof)
- [~] [WhenContext](WhenContext.md) — остался полноценный парсер when-выражений вместо `new Function`
- [~] [SyntaxHighlighting](SyntaxHighlighting.md) — подсветка синтаксиса (TextMate готов; далее scope-селекторы, async/background токенизация)
- [~] [Theming](Theming.md) — цветовые темы (встроенные, пикер, live-reload, темы от расширений / установка из магазина готовы; открыто — подсветка текущей строки, группировка пикера, `IWorkbenchColors`)
- [~] [DiffViewer](DiffViewer.md) — смотрелка изменений: остались фаза 2 (интерактив: раскрытие свёртки жестом, Switch Side, F7) и фаза 6 (краевые случаи: большой файл, бинарник, whitespace). История движка и этапов — [Diff](Diff.md), дифф v2 на двух настоящих редакторах — [DiffEditable](DiffEditable.md) (сделан, в конце — follow-up'ы)
- [~] [SourceControl](SourceControl.md) — полный Source Control сделан (фазы 0–14); открыты follow-up'ы: `diode.scm.publishBusy`, UI-e2e для sync/branch/stash
- [~] [Search](Search.md) — поиск по файлам: базовый срез готов; дальше — кросс-платформенный rg, replace, `search.exclude`, история запросов
- [~] [MultiCursor](MultiCursor.md) — мульти-курсор готов; дальше — распределяющая вставка, колоночное выделение, связка `matchCase` с find-виджетом
- [x] [Marketplace](Marketplace.md) — курируемый магазин расширений сделан (шаги 1–4: формат реестра, файловый + HTTP-источники, `--install-extension <id>` из публичного реестра, прогон магазина `e2e/marketplace/`); открытые вопросы — в документах Marketplace/ExtensionsView
- [x] [ExtensionsView](ExtensionsView.md) — магазин из редактора сделан (вьюлет EXTENSIONS, страница расширения, установка/обновление/удаление с перезагрузкой окна); открытые вопросы — в конце документа
- [~] [WordWrap](WordWrap.md) — перенос строк по словам (`editor.wordWrap`, Alt+Z): v1 готова; открыты follow-up'ы (wrappingIndent, wrap в диффе, affinity, персист toggle)
- [ ] [PieceTree](PieceTree.md) — текстовый бэкенд документа (большие файлы, undo, snapshots)
- [~] [Extensions](Extensions.md) — VS Code-совместимые расширения: открыты фазы 2–7 (темы/иконки, language configuration, snippets, commands/menus, configuration, activation), 8b (views), 9 (внешние расширения); дистрибуция — [Marketplace](Marketplace.md)
- [~] [LSP](LSP.md) — платформа готова end-to-end со стоковым `typescript-language-server` (definition, hover, references, parameter hints, диагностики, автодополнение); Python готов ДВУМЯ серверами: сторонний basedpyright.vsix (типы, шесть фич сквозняком) + сторонний ruff.vsix (#305: линт-диагностики, quickfix, organize imports / fix all, формат от нативного `ruff server`; платформенные vsix через ось `targetPlatform` магазина); далее — gopls, закрытие остальных стабов (rename, implementations, …) по таблице в LSP.md
- [~] [JavaLSP](JavaLSP.md) — стоковый `redhat.java` (Eclipse JDT LS) поверх extension host: код закрыт целиком (#359 активация, #363 виртуальные `jdt:`-документы, добор `workspace.fs` / `workspace.findFiles` / `env.*` / заглушка custom editor), maven и gradle подняты живьём на JDK 21. Осталась запись в реестр магазина — платформенные vsix с вшитым JRE 21 плюс `universal` (затрагивает три репозитория, см. [Marketplace](Marketplace.md))
- [x] [KeybindingsEditor](KeybindingsEditor.md) — вкладка редактирования keyboard shortcuts как в VS Code: Ctrl+K Ctrl+S открывает UI-таблицу всех команд (`Command | Keybinding | When | Source`) с поиском (`@source:`/`@conflicts` + fuzzy), рекордером комбинаций (с предупреждением о непереносимых на legacy-терминале) и конфликт-детекцией; мутации применяются мгновенно и пишутся в keybindings.json (`KeybindingsEditorService`), JSON — отдельной командой `…openGlobalKeybindingsFile`. Заодно вынесен общий контрол `FilteredListControl` (третий потребитель, см. [ListControls](ListControls.md))
- [x] [References](References.md) — Find All References сделан (вьюлет REFERENCES, F4/Shift+F4); дальше — implementations/type definition на тех же рельсах, история запросов, peek
- [x] [ParameterHints](ParameterHints.md) — подсказка параметров сделана (попап по триггер-символам и Ctrl+K Ctrl+Space, перегрузки Up/Down); дальше — markdown в описаниях, скролл длинного текста
- [~] [Suggest](Suggest.md) — автодополнение работает; дальше — сниппет-сессия с табстопами, markdown в описании, скролл панели
- [~] [InlineCompletions](InlineCompletions.md) — призрачные подсказки (ghost text) v1 сделаны end-to-end (`registerInlineCompletionItemProvider`, Tab/Esc, view zones); открыты люфты (mid-line, partial accept, lifecycle-хуки, `selectedCompletionInfo`) и часть 2 — реальный LLM-провайдер
- [~] [E2E](E2E.md) — инфраструктура готова; открыто — кросс-платформенность Phase 1.x и найденный дефект фокуса (find + вторая вкладка)
- [ ] [MutationDebtAfterLintSweep](MutationDebtAfterLintSweep.md) — линт-прогон #333 переформатировал 598 файлов, скоуп мутаций считается по строкам, и гейт впервые отмутировал большой пласт кода: 71 выживший, балл 87.16. 18 закрыто тестами в самом PR, гейт на нём пропущен разово (порог оставлен 100); в документе — разбор остатка по двум группам: долг самого PR и давний непокрытый код, всплывший из-за переформатирования
- [ ] [MutationGateFlake](MutationGateFlake.md) — PR-гейт мутаций на неизменном коммите даёт разные наборы выживших (балл гуляет 97–100%), а локально те же файлы дают 100%: Stryker подбирает тесты через `vitest --related` и часть покрытия теряет. Улики и что попробовать — в документе; смежно — база диффа разъезжается, и в скоуп попадают чужие файлы
- [ ] [TestRunTime](TestRunTime.md) — полный проход гейтов перед сдачей стоит ~час на 4-ядерной машине (115 CPU-мин мутаций, из них 70 — статика; e2e в параллели ломает сам себя пересборкой dist). Замеры и проверенные ходы: `--ignoreStatic` локально, `--incremental` (повтор 45 с вместо 5 мин), гонка `tsup clean` в e2e, `isolate:false` для Stryker
- [ ] [Inspector](Inspector.md) — рефакторинг TUIElement-иерархии + основа приложения → inspector-протокол (`--inspect-tui`) для e2e
- [~] [ReadonlyEditor](ReadonlyEditor.md) — read-only редактор готов; далее — конфиг-слой `files.readonly*`, сообщение при попытке правки
- [~] [Logging](Logging.md) — ILogService + Output UI и CLI-флаги уровней (`--log`, `--verbose`) готовы; далее — inner tracing extension host, `--log-file`, фильтры/Clear в Output
- [~] [Startup](Startup.md) — параметры запуска: `diode` без аргументов поднимает пустое окно (cwd не трогаем), добавлены `-g/--goto`, `-d/--diff`, `--disable-extensions`, `--extensions-dir`, `--log`/`--verbose`; далее — welcome page и список недавних папок
- [ ] [Lifecycle](Lifecycle.md) — **исследование**: где жить `IDisposable`/`Disposable`/`DisposableStore`. Сейчас примитив принадлежит `@tuidom/core` (148 наших файлов, 77 продовых — вне `browser`), а сам движок класс `Disposable` не использует вовсе. Рекомендация — свой `vs/base/common/lifecycle.ts`; от tuidom для старта ничего не нужно. 4 малых PR (примитив → кодмод импортов → гейт слоёв на `@tuidom/*` → учёт утечек в тестах), порядок — до Emitter
- [ ] [MultiRoot](MultiRoot.md) — **исследование цены** мульти-рут-воркспейсов и файлов `.code-workspace`: инвентаризация единственного корня (10 потребителей), чего нет как класса (workspace-слой конфигурации, `scope` у ключей, идентичность воркспейса), разбивка на 8 PR (крупные — конфигурация и SCM) и список предохранителей (4 из 6 поставлены, см. раздел 7)
- [~] [OpenPerformance](OpenPerformance.md) — красивые бенчи открытия: линейка сделана (321 мс наших на `small`: 115 парс бандла + 206 кухня); исследован парс — V8-снапшот даёт 111 → 45 наших, мешают `Intl.Segmenter` и `http` в tuidom; далее кухня воркбенча, CJS + `useSnapshot`, жадные O(N)-проходы (13 МБ — 3 с), piece tree, стриминг гигантских файлов
- [~] [LongLinePerformance](LongLinePerformance.md) — фриз длинных строк снят порогом рендера, межредакторная связь — damage-tracking'ом; открыто: пер-строчный кеш `DisplayLine`, reveal-по-клику, конфиг порога
- [~] [FileTreePerformance](FileTreePerformance.md) — производительность больших файловых деревьев (главные блокеры сняты; остались точечные фиксы)
- [~] [MacKeybindings](MacKeybindings.md) — мак-раскладка: ОС клавиатуры по лестнице сигналов (с XTVERSION), мак-рунги `legacy < extended < cmd` с `cap_super`, токен `mod`, полный паритет с мак-раскладкой VS Code 1.138 (сверка тестом со срезом эталона), Keyboard Doctor для фидбека сделаны; дальше — фидбек с живого мака, мост Cmd для tmux, найденные сверкой дыры pc-паритета
- [ ] [EnvironmentTuning](EnvironmentTuning.md) — подсказки пользователю по тюнингу окружения (терминал/tmux/ssh); пункты — tmux extended-keys для Ctrl+Tab, лимит inotify (ENOSPC) с уведомлением как в VS Code
- [~] [Distribution](Distribution.md) — каналы дистрибуции: `install.sh`, apt (плоский репозиторий на Releases), npm `@diode-editor/diode`, Homebrew tap, winget; код и воркфлоу готовы, осталось завести секреты/репозитории и выпустить первый релиз с ними
- [~] [Folding](Folding.md) — indentation-фолдинг и API-провайдеры готовы; далее — region-маркеры/language-configuration, hover-контролы, персист свёрток
- [~] [Uri](Uri.md) — ядро на `Uri` готово, виртуальные read-only документы (`registerTextDocumentContentProvider`) доведены до вкладки; далее — `untitled:`-провайдер, язык безымянных буферов, кэш содержимого
- [~] [Problems](Problems.md) — маркер-сервис, squiggle и панель готовы; далее — счётчик в статус-баре, доп. поставщики (расширения/matchers)
- [~] [TerminalPanelBugs](TerminalPanelBugs.md) — баги панели/терминала из e2e-прогона MVP закрыты; осталась необработанная ошибка спавна шелла на неподдерживаемой платформе
- [~] [IntegratedTerminal](IntegratedTerminal.md) — встроенный терминал интегрирован; далее — кросс-платформенная упаковка + CI-матрица, UX (скролбэк/выделение/ссылки), список терминалов, тема-реактивная ANSI-палитра, commandsToSkipShell
- [x] [EditorGroups](EditorGroups.md) — сплиты области редактора сделаны (включая API расширений); в документе остались follow-up'ы (Quick Open Ctrl+Enter, read-only на документ, сплит untitled/дифф-вкладок)
- [x] [SourceControlGraph](SourceControlGraph.md) — панель GRAPH сделана; в документе остались follow-up'ы (пикер ref'ов, compare/diff коммита, действия на бейджах)

---

## Позиционирование и сайт

### [ ] Публичный роадмап + статус «альфа»

Страница роадмапа (в доке или на сайте) и явный статус «alpha» на главной (рядом с версией).
Смысл — управление ожиданиями: альфу не прячем, а показываем, куда идём и как быстро.
Ключевой заявляемый пункт — конечная цель: **полная поддержка API расширений VS Code там, где
она имеет смысл в терминале** (см. VISION.md «Что говорить вовне»). Ссылка с главной.

### [x] Матрица покрытия API VS Code

Публичная матрица «namespace/поверхность → поддержано / частично / запланировано / не будет
by design» — [docs/public/API-COVERAGE.md](../public/API-COVERAGE.md). Заполнена руками по
фактическому состоянию исходников (активная поверхность `vscode.d.ts` + таблица стабов из
[LSP.md](LSP.md)): сводка со счётчиками и якорями, member-таблицы активных namespace, графа
«не будет by design» (webview, UI-heavy). Решение — **без генератора, дисциплиной**: матрица
обновляется в том же PR, который меняет поверхность API (крючок — правило роста `vscode.d.ts`
в AGENTS.md и docs/arch/Extensions.md). Генератор остаётся опцией на будущее, если ручное
ведение начнёт врать.

### [ ] Страница бенчмарков + ссылка с главной

Заготовка страницы — [docs/public/BENCHMARKS.md](../public/BENCHMARKS.md): структура и лестница
готовы, осталось снять сравнительную таблицу одним прогоном, заполнить методику и дать ссылку
с главной страницы сайта (diode-editor.github.io). Скорость — допуск на поле
(см. [VISION.md](../VISION.md#скорость--допуск-на-поле)); цифра публичная — значит должна быть
воспроизводимая и защищённая:

- **Лестница старта**, а не одно число: пол Node 77мс → первый кадр 87мс → редактор готов 103мс
  (26мс воркбенча поверх пола Node); extension host лениво, LSP асинхронно.
- **Сравнительная таблица, снятая своей рукой** на одной машине: vim · nvim голый ·
  nvim+LazyVim/NVChad · helix · diode. Против голого vim проигрываем — называем честно.
- **Методика**: железо, условия (питание/батарея), как мерили, как воспроизвести.
- **Бюджет старта в CI** (`vitest.perf.config.ts` / `test:perf`) — зафиксировать, пока цифра
  хорошая: публичное число обязано быть защищено тестом.

---

## Кодировки

### [ ] `files.encoding` — дефолтная кодировка из настроек

Ось encoding в ядре и пикеры Reopen/Save with Encoding готовы (#106); детект — BOM-only,
без BOM всегда utf-8. Follow-up как в VS Code:

- **`files.encoding`** — кодировка по умолчанию для открытия/сохранения (вместо
  захардкоженного utf-8), применять в `EditorService.applyConfigurationToEditor` (`src/vs/workbench/services/editor/browser/editorService.ts`).
- **`files.autoGuessEncoding`** — эвристический детект содержимого (jschardet-подобный),
  отдельная опция поверх BOM-снифа.
- Предупреждение о некодируемых символах при сохранении (сейчас — молчаливый `?`
  от iconv-lite).

Файлы: `src/vs/editor/common/model/encoding.ts`, `src/vs/workbench/services/textfile/common/textFileModel.ts`,
`src/vs/workbench/services/editor/browser/editorService.ts`.

## Unicode и отображение символов

### [ ] Системная ширина символов: кодоген таблиц + рантайм-проба ambiguous-width

Таблицы `isWide`/`isZeroWidth` живут в движке (`unicodeWidth` в `@tuidom/core`) —
кодоген из официальных Unicode-файлов делается в репозитории tuidom. Наша часть —
**рантайм-проба (CPR)**: ширина _ambiguous-width_ символов (`·≈→↔–—…№`, EAW=A) и части
emoji терминально-зависима, terminfo этого не содержит; единственный источник правды —
спросить сам терминал (напечатать символ → `ESC[6n` → вычислить фактическую ширину).
Одноразовый probe в bootstrap для набора спорных символов, кэшировать результат.
Опционально — mode 2027 (grapheme clustering).

---

## Клавиатура

### [ ] Утечка парного keypress в отцепленный редактор (баг движка tuidom)

Команда, которая переключает активную вкладку, отцепляет от дерева
`EditorElement`, бывший целью её `keydown`. Парный `keypress` закреплён за той же
целью (`TuiApplication.pinnedKeypressTarget`), поэтому диспатчится от
отцепленного узла — глобальный capture-обработчик
`KeybindingDispatcher.handleKeyPressCapture` на корне **не вызывается**,
`swallowNextKeyPress` не срабатывает, и клавишу обрабатывает сам устаревший
редактор.

Воспроизведение (было при разработке истории навигации): повесить `Go Back` на
аккорд `Ctrl+K -`, открыть два файла, уйти кареткой, нажать аккорд — команда
отрабатывает правильно, но символ `-` печатается в документ, который мы только
что покинули (вкладка становится modified). С `Ctrl+K D` (`compareWithSaved`)
утечки нет — там `keypress` до корня доходит.

Обход на нашей стороне: вторая часть аккорда — клавиша с модификатором
(редактор её игнорирует сам), см. `navigationActions.ts` и «Конвенции системы
команд» в arch/Workbench.md. Настоящее лечение — в
[tuidom](https://github.com/tuidom/tuidom): если закреплённая цель больше не в
дереве приложения, `keypress` надо гасить (или диспатчить от корня), а не
доставлять мимо капчер-обработчиков.

---

## Layout

### [ ] View-секции сайдбара — follow-up'ы

Пилот (контейнер Source Control) и merged одно-view контейнеры (Search) готовы —
`browser/parts/views/`, см. arch/Workbench.md. Осталось:

- Перенос view между контейнерами (модель уже допускает: `containerId` в
  реестре view-дескрипторов) + персист размещения.
- Explorer — миграция на merged-контейнер по готовому пути Search.
