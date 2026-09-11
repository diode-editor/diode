
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

- [~] [WorkbenchContributions](WorkbenchContributions.md) — перенос vscode contribution points; основное сделано, остались хвосты MenuRegistry (серые пункты попапа, `when`-фильтр палитры, `alt`/hide-toggle/вложенные подменю)
- [~] [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — follow-up'ы после big-bang переезда на vscode-раскладку `src/vs/*` (осознанные отклонения от канона)
- [ ] [EngineWidgetRepatriation](EngineWidgetRepatriation.md) — прикладные виджеты, оставшиеся в `@tuidom/elements` (completionlist, editorgroup, editorpart, workbenchlayout, panel, terminal, menuBar): по критерию «публичный API не упоминает понятий Diode» им место у нас
- [~] [ListControls](ListControls.md) — два списочных контрола (`TreeViewElement` data-driven / `ListViewElement` DOM-строки): решение зафиксировано, остался техдолг (дублирование механик, union-instanceof)
- [~] [WhenContext](WhenContext.md) — остался полноценный парсер when-выражений вместо `new Function`
- [~] [SyntaxHighlighting](SyntaxHighlighting.md) — подсветка синтаксиса (TextMate готов; далее scope-селекторы, async/background токенизация)
- [~] [Theming](Theming.md) — цветовые темы (встроенные + пикер готовы; далее темы от расширений, live-reload)
- [~] [DiffViewer](DiffViewer.md) — смотрелка изменений: остались фаза 2 (интерактив: раскрытие свёртки жестом, Switch Side, F7) и фаза 6 (краевые случаи: большой файл, бинарник, whitespace). История движка и этапов — [Diff](Diff.md), дифф v2 на двух настоящих редакторах — [DiffEditable](DiffEditable.md) (сделан, в конце — follow-up'ы)
- [~] [SourceControl](SourceControl.md) — полный Source Control сделан (фазы 0–14); открыты follow-up'ы: `diode.scm.publishBusy`, UI-e2e для sync/branch/stash
- [~] [Search](Search.md) — поиск по файлам: базовый срез готов; дальше — кросс-платформенный rg, replace, `search.exclude`, история запросов
- [~] [MultiCursor](MultiCursor.md) — мульти-курсор готов; дальше — распределяющая вставка, колоночное выделение, связка `matchCase` с find-виджетом
- [x] [Marketplace](Marketplace.md) — курируемый магазин расширений сделан (шаги 1–4: формат реестра, файловый + HTTP-источники, `--install-extension <id>` из публичного реестра, прогон магазина `e2e/marketplace/`); открытые вопросы — в документах Marketplace/ExtensionsView
- [x] [ExtensionsView](ExtensionsView.md) — магазин из редактора сделан (вьюлет EXTENSIONS, страница расширения, установка/обновление/удаление с перезагрузкой окна); открытые вопросы — в конце документа
- [~] [WordWrap](WordWrap.md) — перенос строк по словам (`editor.wordWrap`, Alt+Z): v1 готова; открыты follow-up'ы (wrappingIndent, wrap в диффе, affinity, персист toggle)
- [ ] [PieceTree](PieceTree.md) — текстовый бэкенд документа (большие файлы, undo, snapshots)
- [~] [Extensions](Extensions.md) — VS Code-совместимые расширения: открыты фазы 2–7 (темы/иконки, language configuration, snippets, commands/menus, configuration, activation), 8b (views), 9 (внешние расширения); дистрибуция — [Marketplace](Marketplace.md)
- [~] [LSP](LSP.md) — платформа готова end-to-end со стоковым `typescript-language-server` (definition, hover, references, parameter hints, диагностики, автодополнение); второй язык — Python — готов: настоящий сторонний basedpyright.vsix с open-vsx как есть (шесть фич сквозняком, ipc/fork под SEA через env-фикс ext-host'а); далее — запись basedpyright в реестр магазина (proxy-openvsx), gopls, закрытие остальных стабов (rename, implementations, …) по таблице в LSP.md
- [x] [KeybindingsEditor](KeybindingsEditor.md) — вкладка редактирования keyboard shortcuts как в VS Code: Ctrl+K Ctrl+S открывает UI-таблицу всех команд (`Command | Keybinding | When | Source`) с поиском (`@source:`/`@conflicts` + fuzzy), рекордером комбинаций (с предупреждением о непереносимых на legacy-терминале) и конфликт-детекцией; мутации применяются мгновенно и пишутся в keybindings.json (`KeybindingsEditorService`), JSON — отдельной командой `…openGlobalKeybindingsFile`. Заодно вынесен общий контрол `FilteredListControl` (третий потребитель, см. [ListControls](ListControls.md))
- [x] [References](References.md) — Find All References сделан (вьюлет REFERENCES, F4/Shift+F4); дальше — implementations/type definition на тех же рельсах, история запросов, peek
- [x] [ParameterHints](ParameterHints.md) — подсказка параметров сделана (попап по триггер-символам и Ctrl+K Ctrl+Space, перегрузки Up/Down); дальше — markdown в описаниях, скролл длинного текста
- [~] [Suggest](Suggest.md) — автодополнение работает; дальше — сниппет-сессия с табстопами, markdown в описании, скролл панели
- [~] [E2E](E2E.md) — инфраструктура готова; открыто — кросс-платформенность Phase 1.x и найденный дефект фокуса (find + вторая вкладка)
- [ ] [MutationGateFlake](MutationGateFlake.md) — PR-гейт мутаций на неизменном коммите даёт разные наборы выживших (балл гуляет 97–100%), а локально те же файлы дают 100%: Stryker подбирает тесты через `vitest --related` и часть покрытия теряет. Улики и что попробовать — в документе; смежно — база диффа разъезжается, и в скоуп попадают чужие файлы
- [ ] [Inspector](Inspector.md) — рефакторинг TUIElement-иерархии + основа приложения → inspector-протокол (`--inspect-tui`) для e2e
- [~] [ReadonlyEditor](ReadonlyEditor.md) — read-only редактор готов; далее — конфиг-слой `files.readonly*`, сообщение при попытке правки
- [~] [Logging](Logging.md) — ILogService + Output UI готовы; далее — inner tracing extension host, CLI flags, фильтры/Clear в Output
- [~] [LongLinePerformance](LongLinePerformance.md) — фриз длинных строк снят порогом рендера, межредакторная связь — damage-tracking'ом; открыто: пер-строчный кеш `DisplayLine`, reveal-по-клику, конфиг порога
- [~] [FileTreePerformance](FileTreePerformance.md) — производительность больших файловых деревьев (главные блокеры сняты; остались точечные фиксы)
- [ ] [EnvironmentTuning](EnvironmentTuning.md) — подсказки пользователю по тюнингу окружения (терминал/tmux/ssh); пункты — tmux extended-keys для Ctrl+Tab, лимит inotify (ENOSPC) с уведомлением как в VS Code
- [~] [Folding](Folding.md) — indentation-фолдинг и API-провайдеры готовы; далее — region-маркеры/language-configuration, hover-контролы, персист свёрток
- [~] [Uri](Uri.md) — ядро на `Uri` готово; далее — `untitled:`-провайдер, язык безымянных буферов
- [~] [Problems](Problems.md) — маркер-сервис, squiggle и панель готовы; далее — счётчик в статус-баре, доп. поставщики (расширения/matchers)
- [~] [TerminalPanelBugs](TerminalPanelBugs.md) — баги панели/терминала из e2e-прогона MVP закрыты; осталась необработанная ошибка спавна шелла на неподдерживаемой платформе
- [~] [IntegratedTerminal](IntegratedTerminal.md) — встроенный терминал интегрирован; далее — кросс-платформенная упаковка + CI-матрица, UX (скролбэк/выделение/ссылки), список терминалов, тема-реактивная ANSI-палитра, commandsToSkipShell
- [x] [EditorGroups](EditorGroups.md) — сплиты области редактора сделаны (включая API расширений); в документе остались follow-up'ы (Quick Open Ctrl+Enter, read-only на документ, сплит untitled/дифф-вкладок)
- [x] [SourceControlGraph](SourceControlGraph.md) — панель GRAPH сделана; в документе остались follow-up'ы (пикер ref'ов, compare/diff коммита, действия на бейджах)

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
**рантайм-проба (CPR)**: ширина *ambiguous-width* символов (`·≈→↔–—…№`, EAW=A) и части
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
